import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { createTempTclPath } from '../utils/tclUtils';
import { resolveTclCwd, resolveTclFolder, resolveTclInterpreter } from './executionContext';
import { parsePackageMetadata } from './packageModel';
import { tclLiteral } from './tclProcess';

const temporaryScripts = new Set<string>();

interface TclTaskDefinition extends vscode.TaskDefinition {
    type: 'tcl';
    script?: string;
    command?: string;
    args?: string[];
    cwd?: string;
    interpreter?: string;
    env?: Record<string, string>;
}

export class TclTaskProvider implements vscode.TaskProvider {
    constructor(private workspaceRoot: string | undefined,
        private installDependencies: (resource?: vscode.Uri) => Promise<boolean | void> = async resource => vscode.commands.executeCommand('tcl.installDependencies', resource)) {}

    private get resource(): vscode.Uri | undefined { return this.workspaceRoot ? vscode.Uri.file(this.workspaceRoot) : undefined; }
    private get scope(): vscode.WorkspaceFolder | vscode.TaskScope { return resolveTclFolder(this.resource) ?? vscode.TaskScope.Workspace; }

    public provideTasks(): Thenable<vscode.Task[]> | undefined {
        if (!this.workspaceRoot) {
            return undefined;
        }
        
        return this.getTclTasks();
    }

    public resolveTask(task: vscode.Task): vscode.Task | undefined {
        const definition = task.definition as TclTaskDefinition;
        if (!definition.script && !definition.command) return undefined;
        const resolved = this.createTask(definition);
        resolved.name = task.name;
        resolved.detail = task.detail;
        resolved.group = task.group;
        resolved.presentationOptions = task.presentationOptions;
        resolved.runOptions = task.runOptions;
        resolved.isBackground = task.isBackground;
        resolved.problemMatchers = task.problemMatchers;
        return resolved;
    }

    private async getTclTasks(): Promise<vscode.Task[]> {
        const tasks: vscode.Task[] = [];
        
        // Add default tasks
        tasks.push(...this.getDefaultTasks());
        
        // Discover tasks from files
        const discoveredTasks = await this.discoverTasks();
        tasks.push(...discoveredTasks);
        
        return tasks;
    }

    private getDefaultTasks(): vscode.Task[] {
        const tasks: vscode.Task[] = [];
        const run = this.createTask({ type: 'tcl', script: '${file}' });
        run.name = 'Run Current TCL File';
        tasks.push(run);
        if (this.workspaceRoot && fs.existsSync(path.join(this.workspaceRoot, 'run_tests.tcl'))) {
            const test = this.createTask({ type: 'tcl', command: 'run_tests' });
            test.name = 'Run TCL Tests'; test.group = vscode.TaskGroup.Test; tasks.push(test);
        }
        if (this.workspaceRoot && ['pkgIndex.tcl', 'Package.tcl'].some(file => fs.existsSync(path.join(this.workspaceRoot!, file)))) {
            const build = this.createTask({ type: 'tcl', command: 'build_package' });
            build.name = 'Build TCL Package'; build.group = vscode.TaskGroup.Build; tasks.push(build);
        }
        return tasks;
    }

    private async discoverTasks(): Promise<vscode.Task[]> {
        const tasks: vscode.Task[] = [];
        
        if (!this.workspaceRoot) {
            return tasks;
        }

        // Look for Makefile
        const makefilePath = path.join(this.workspaceRoot, 'Makefile');
        if (fs.existsSync(makefilePath)) {
            tasks.push(...await this.parseMakefile(makefilePath));
        }

        // Look for build.tcl
        const buildScriptPath = path.join(this.workspaceRoot, 'build.tcl');
        if (fs.existsSync(buildScriptPath)) {
            const buildTask = this.createTask({
                type: 'tcl',
                script: 'build.tcl',
                args: []
            });
            buildTask.name = 'Build (build.tcl)';
            buildTask.group = vscode.TaskGroup.Build;
            tasks.push(buildTask);
        }

        // Look for tasks.json
        const tasksJsonPath = path.join(this.workspaceRoot, '.vscode', 'tasks.json');
        if (fs.existsSync(tasksJsonPath)) {
            // VS Code handles tasks.json automatically
        }

        // Look for Package.tcl
        const packageTclPath = path.join(this.workspaceRoot, 'Package.tcl');
        if (fs.existsSync(packageTclPath)) {
            tasks.push(...this.createPackageTasks());
        }

        return tasks;
    }

    private async parseMakefile(makefilePath: string): Promise<vscode.Task[]> {
        const tasks: vscode.Task[] = [];
        
        try {
            const content = await fs.promises.readFile(makefilePath, 'utf-8');
            const lines = content.split('\n');
            
            for (const line of lines) {
                // Find make targets
                const targetMatch = line.match(/^([a-zA-Z0-9_-]+):/);
                if (targetMatch) {
                    const target = targetMatch[1];
                    const makeTask = new vscode.Task(
                        { type: 'shell' },
                        this.scope,
                        `make ${target}`,
                        'make',
                        new vscode.ProcessExecution('make', [target], { cwd: this.workspaceRoot })
                    );
                    makeTask.group = target === 'all' ? vscode.TaskGroup.Build : undefined;
                    tasks.push(makeTask);
                }
            }
        } catch (error) {
            console.error('Error parsing Makefile:', error);
        }
        
        return tasks;
    }

    private createPackageTasks(): vscode.Task[] {
        const tasks: vscode.Task[] = [];
        
        // Install dependencies
        const installTask = this.createTask({
            type: 'tcl',
            command: 'install_deps'
        });
        installTask.name = 'Install Dependencies';
        tasks.push(installTask);
        
        // Package task
        const packageTask = this.createTask({
            type: 'tcl',
            command: 'package'
        });
        packageTask.name = 'Create Package';
        packageTask.group = vscode.TaskGroup.Build;
        tasks.push(packageTask);
        
        return tasks;
    }

    private createTask(definition: TclTaskDefinition): vscode.Task {
        const interpreterPath = resolveTclInterpreter(this.resource, undefined, definition.interpreter);
        
        let execution: vscode.ProcessExecution | vscode.ShellExecution | vscode.CustomExecution;
        
        if (definition.script) {
            // Run a TCL script
            const args = definition.args || [];
            execution = new vscode.ProcessExecution(
                interpreterPath,
                [definition.script, ...args],
                { cwd: resolveTclCwd(this.resource, definition.cwd ?? this.workspaceRoot), env: definition.env }
            );
        } else if (definition.command === 'install_deps') {
            execution = new vscode.CustomExecution(async () => {
                const write = new vscode.EventEmitter<string>();
                const close = new vscode.EventEmitter<number>();
                let closed = false;
                return { onDidWrite: write.event, onDidClose: close.event,
                    open: () => { void this.installDependencies(this.resource).then(result => {
                        if (!closed) { write.fire(result === false ? 'Dependency installation failed or cancelled.\r\n' : 'Dependency installation finished.\r\n'); close.fire(result === false ? 1 : 0); }
                    }, error => { if (!closed) { write.fire(`${error}\r\n`); close.fire(1); } }); },
                    close: () => { closed = true; write.dispose(); close.dispose(); } };
            });
        } else if (definition.command) {
            // Run a command (could be a build command)
            execution = this.createCommandExecution(definition.command, definition.args || [], resolveTclCwd(this.resource, definition.cwd ?? this.workspaceRoot), definition.interpreter, definition.env);
        } else {
            // Default to shell execution
            execution = new vscode.ShellExecution('echo "No task defined"');
        }
        
        const task = new vscode.Task(
            definition,
            this.scope,
            definition.script || definition.command || 'TCL Task',
            'tcl',
            execution,
            ['$tcl']
        );
        
        return task;
    }

    private createCommandExecution(command: string, args: string[], cwd = this.workspaceRoot, override?: string, env?: Record<string, string>): vscode.ProcessExecution | vscode.ShellExecution {
        const interpreterPath = resolveTclInterpreter(this.resource, undefined, override);
        
        switch (command) {
            case 'run_tests':
                return new vscode.ProcessExecution(
                    interpreterPath,
                    [path.join(cwd || '', 'run_tests.tcl'), ...args],
                    { cwd, env }
                );
                
            case 'build_package':
                return this.createBuildPackageExecution(cwd, override, env);
                
            case 'package':
                return this.createPackageExecution(cwd, override, env);
                
            default:
                return new vscode.ProcessExecution(command, args, { cwd, env });
        }
    }

    private createBuildPackageExecution(cwd = this.workspaceRoot, override?: string, env?: Record<string, string>): vscode.ProcessExecution {
        const script = `#!/usr/bin/env tclsh
# Build package script

puts "Building package..."

# Find all TCL files
set files [glob -nocomplain *.tcl lib/*.tcl src/*.tcl]

# Create package directory
file mkdir build

# Copy files to build directory
foreach file $files {
    set dest [file join build $file]
    file mkdir [file dirname $dest]
    file copy -force $file $dest
}

# Create pkgIndex.tcl if it doesn't exist
if {![file exists build/pkgIndex.tcl]} {
    set pkg_name [file tail [pwd]]
    set pkg_version "1.0"

    set fp [open build/pkgIndex.tcl w]
    puts $fp [format {package ifneeded %s %s [list source [file join $dir main.tcl]]} [list $pkg_name] [list $pkg_version]]
    close $fp
}

puts "Package built in ./build directory"
`;
        return this.createScriptExecution('task_build', script, cwd, override, env);
    }

    /** Read metadata as data; archiving must not execute the package or its dependencies. */
    private packageDefinitionScript(cwd = this.workspaceRoot): string {
        try {
            const metadata = parsePackageMetadata(fs.readFileSync(path.join(cwd ?? '', 'Package.tcl'), 'utf8'));
            if (metadata.name && metadata.version) return `set name ${tclLiteral(metadata.name)}\nset version ${tclLiteral(metadata.version)}\n`;
        } catch { /* The task reports missing or unsupported metadata when executed. */ }
        return 'puts stderr "Package.tcl must declare static name and version metadata"\nexit 1\n';
    }

    private createPackageExecution(cwd = this.workspaceRoot, override?: string, env?: Record<string, string>): vscode.ProcessExecution {
        const script = `#!/usr/bin/env tclsh
# Create package from Package.tcl

if {![file exists Package.tcl]} {
    puts "Error: Package.tcl not found"
    exit 1
}

${this.packageDefinitionScript(cwd)}

# Get package info from global variables
if {![info exists name] || ![info exists version]} {
    puts "Error: Package.tcl must define 'name' and 'version'"
    exit 1
}

set pkg_file "$name-$version.tar"

# Create package archive
puts "Creating package $pkg_file..."

# Get list of files to include
set files [list Package.tcl]
if {[file exists pkgIndex.tcl]} {
    lappend files pkgIndex.tcl
}
lappend files {*}[glob -nocomplain *.tcl src/*.tcl lib/*.tcl]

# Create tar archive (simplified - in real implementation use tar command)
exec tar -cf $pkg_file {*}$files >@stdout 2>@stderr

puts "Package created: $pkg_file"
`;
        return this.createScriptExecution('task_pkg', script, cwd, override, env);
    }
    private createScriptExecution(label: string, script: string, cwd: string | undefined, override?: string, env?: Record<string, string>): vscode.ProcessExecution {
        const tmpFile = createTempTclPath(label);
        fs.writeFileSync(tmpFile, script, 'utf8');
        temporaryScripts.add(tmpFile);
        const interpreterPath = resolveTclInterpreter(this.resource, undefined, override);
        return new vscode.ProcessExecution(interpreterPath, [tmpFile], { cwd, env });
    }
}

export class TclTaskProviderManager {
    private taskProvider: vscode.Disposable | undefined;
    constructor(private installDependencies?: (resource?: vscode.Uri) => Promise<boolean | void>) {}

    public register(context: vscode.ExtensionContext): void {
        if (this.taskProvider) return;
        this.taskProvider = vscode.tasks.registerTaskProvider('tcl', {
            provideTasks: async () => {
                const results = await Promise.all((vscode.workspace.workspaceFolders ?? []).map(folder =>
                    new TclTaskProvider(folder.uri.fsPath, this.installDependencies).provideTasks() ?? []));
                return results.flat();
            },
            resolveTask: task => {
                const folder = typeof task.scope === 'object' ? task.scope : resolveTclFolder();
                return new TclTaskProvider(folder?.uri.fsPath, this.installDependencies).resolveTask(task);
            }
        });
        context.subscriptions.push(this.taskProvider, vscode.tasks.onDidEndTask(event => {
            const execution = event.execution.task.execution;
            if (execution instanceof vscode.ProcessExecution) {
                for (const file of execution.args) if (temporaryScripts.delete(file)) void fs.promises.rm(file, { force: true }).catch(() => {});
            }
        }));
    }
    public dispose(): void {
        this.taskProvider?.dispose(); this.taskProvider = undefined;
        for (const file of temporaryScripts) void fs.promises.rm(file, { force: true }).catch(() => {});
        temporaryScripts.clear();
    }
}
