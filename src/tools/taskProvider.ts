import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { createTempTclPath } from '../utils/tclUtils';

interface TclTaskDefinition extends vscode.TaskDefinition {
    type: 'tcl';
    script?: string;
    command?: string;
    args?: string[];
    cwd?: string;
}

export class TclTaskProvider implements vscode.TaskProvider {
    constructor(private workspaceRoot: string | undefined) {}

    public provideTasks(): Thenable<vscode.Task[]> | undefined {
        if (!this.workspaceRoot) {
            return undefined;
        }
        
        return this.getTclTasks();
    }

    public resolveTask(task: vscode.Task): vscode.Task | undefined {
        const definition = task.definition as TclTaskDefinition;
        return this.createTask(definition);
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
        
        // Run current file task
        const runFileTask = this.createTask({
            type: 'tcl',
            script: '${file}',
            group: 'build'
        });
        runFileTask.name = 'Run Current TCL File';
        runFileTask.group = vscode.TaskGroup.Build;
        tasks.push(runFileTask);
        
        // Run tests task
        const runTestsTask = this.createTask({
            type: 'tcl',
            command: 'run_tests',
            args: []
        });
        runTestsTask.name = 'Run TCL Tests';
        runTestsTask.group = vscode.TaskGroup.Test;
        tasks.push(runTestsTask);
        
        // Build package task
        const buildPackageTask = this.createTask({
            type: 'tcl',
            command: 'build_package',
            args: []
        });
        buildPackageTask.name = 'Build TCL Package';
        buildPackageTask.group = vscode.TaskGroup.Build;
        tasks.push(buildPackageTask);
        
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
                        vscode.TaskScope.Workspace,
                        `make ${target}`,
                        'make',
                        new vscode.ShellExecution('make', [target])
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
        const config = vscode.workspace.getConfiguration('tcl');
        const interpreterPath = config.get<string>('interpreter.path', 'tclsh');
        
        let execution: vscode.ProcessExecution | vscode.ShellExecution;
        
        if (definition.script) {
            // Run a TCL script
            const args = definition.args || [];
            execution = new vscode.ProcessExecution(
                interpreterPath,
                [definition.script, ...args],
                { cwd: definition.cwd || this.workspaceRoot }
            );
        } else if (definition.command) {
            // Run a command (could be a build command)
            execution = this.createCommandExecution(definition.command, definition.args || [], definition.cwd);
        } else {
            // Default to shell execution
            execution = new vscode.ShellExecution('echo "No task defined"');
        }
        
        const task = new vscode.Task(
            definition,
            vscode.TaskScope.Workspace,
            definition.script || definition.command || 'TCL Task',
            'tcl',
            execution,
            ['$tcl']
        );
        
        return task;
    }

    private createCommandExecution(command: string, args: string[], cwd = this.workspaceRoot): vscode.ProcessExecution | vscode.ShellExecution {
        const config = vscode.workspace.getConfiguration('tcl');
        const interpreterPath = config.get<string>('interpreter.path', 'tclsh');
        
        switch (command) {
            case 'run_tests':
                return new vscode.ProcessExecution(
                    interpreterPath,
                    [path.join(this.workspaceRoot || '', 'run_tests.tcl')],
                    { cwd }
                );
                
            case 'build_package':
                return this.createBuildPackageExecution(cwd);
                
            case 'install_deps':
                return this.createInstallDepsExecution(cwd);
                
            case 'package':
                return this.createPackageExecution(cwd);
                
            default:
                return new vscode.ShellExecution(command, args, { cwd });
        }
    }

    private createBuildPackageExecution(cwd = this.workspaceRoot): vscode.ProcessExecution {
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
        return this.createScriptExecution('task_build', script, cwd);
    }

    /** Support the metadata commands written by the package wizard. */
    private packageDefinitionScript(): string {
        return `
set ::taskDependencies {}
proc name {value} { set ::name $value }
proc version {value} { set ::version $value }
proc description {args} {}
proc require {pkg {ver ""}} {
    lappend ::taskDependencies [list $pkg $ver]
    set request [list package require $pkg]
    if {$ver ne ""} { lappend request $ver }
    uplevel #0 $request
}
proc test-require {pkg {ver ""}} { require $pkg $ver }
source Package.tcl
`;
    }

    private createInstallDepsExecution(cwd = this.workspaceRoot): vscode.ProcessExecution {
        const script = `${this.packageDefinitionScript()}
set missing 0
foreach dependency $::taskDependencies {
    lassign $dependency pkg ver
    set request [list package require $pkg]
    if {$ver ne ""} { lappend request $ver }
    if {[catch {uplevel #0 $request} error]} {
        puts stderr "Could not load $pkg: $error"
        set missing 1
    } else {
        puts "$pkg is available"
    }
}
exit $missing
`;
        return this.createScriptExecution('task_deps', script, cwd);
    }

    private createPackageExecution(cwd = this.workspaceRoot): vscode.ProcessExecution {
        const script = `#!/usr/bin/env tclsh
# Create package from Package.tcl

if {![file exists Package.tcl]} {
    puts "Error: Package.tcl not found"
    exit 1
}

${this.packageDefinitionScript()}

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
exec tar -cf $pkg_file {*}$files

puts "Package created: $pkg_file"
`;
        return this.createScriptExecution('task_pkg', script, cwd);
    }
    private createScriptExecution(label: string, script: string, cwd: string | undefined): vscode.ProcessExecution {
        const tmpFile = createTempTclPath(label);
        fs.writeFileSync(tmpFile, script, 'utf8');
        const interpreterPath = vscode.workspace.getConfiguration('tcl').get<string>('interpreter.path', 'tclsh');
        return new vscode.ProcessExecution(interpreterPath, [tmpFile], { cwd });
    }
}

export class TclTaskProviderManager {
    private taskProvider: vscode.Disposable | undefined;

    public register(context: vscode.ExtensionContext): void {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const provider = new TclTaskProvider(workspaceRoot);
        
        this.taskProvider = vscode.tasks.registerTaskProvider('tcl', provider);
        context.subscriptions.push(this.taskProvider);
    }

    public dispose(): void {
        if (this.taskProvider) {
            this.taskProvider.dispose();
        }
    }
}