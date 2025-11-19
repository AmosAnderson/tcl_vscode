import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

interface TclTaskDefinition extends vscode.TaskDefinition {
    type: 'tcl';
    script?: string;
    command?: string;
    args?: string[];
    cwd?: string;
}

export class TclTaskProvider implements vscode.TaskProvider {
    private tasks: vscode.Task[] | undefined;
    
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
            command: 'install_deps',
            script: 'Package.tcl'
        });
        installTask.name = 'Install Dependencies';
        tasks.push(installTask);
        
        // Package task
        const packageTask = this.createTask({
            type: 'tcl',
            command: 'package',
            script: 'Package.tcl'
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
            execution = this.createCommandExecution(definition.command, definition.args || []);
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

    private createCommandExecution(command: string, args: string[]): vscode.ProcessExecution | vscode.ShellExecution {
        const config = vscode.workspace.getConfiguration('tcl');
        const interpreterPath = config.get<string>('interpreter.path', 'tclsh');
        
        switch (command) {
            case 'run_tests':
                return new vscode.ShellExecution(
                    `${interpreterPath} ${path.join(this.workspaceRoot || '', 'run_tests.tcl')}`
                );
                
            case 'build_package':
                return this.createBuildPackageExecution();
                
            case 'install_deps':
                return this.createInstallDepsExecution();
                
            case 'package':
                return this.createPackageExecution();
                
            default:
                return new vscode.ShellExecution(`${command} ${args.join(' ')}`);
        }
    }

    private createBuildPackageExecution(): vscode.ShellExecution {
        const script = `
#!/usr/bin/env tclsh
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
    puts $fp "package ifneeded $pkg_name $pkg_version [list source [file join \\$dir main.tcl]]"
    close $fp
}

puts "Package built in ./build directory"
`;
        
        return new vscode.ShellExecution(`echo '${script}' | tclsh`);
    }

    private createInstallDepsExecution(): vscode.ShellExecution {
        const script = `
#!/usr/bin/env tclsh
# Install dependencies from Package.tcl

if {[file exists Package.tcl]} {
    source Package.tcl
    
    # Look for require statements
    set fp [open Package.tcl r]
    while {[gets $fp line] >= 0} {
        if {[regexp {^\\s*require\\s+(\\S+)\\s+(\\S+)} $line -> pkg ver]} {
            puts "Installing $pkg version $ver..."
            if {[catch {package require $pkg $ver} err]} {
                puts "Warning: Could not load $pkg $ver: $err"
            } else {
                puts "$pkg $ver is available"
            }
        }
    }
    close $fp
} else {
    puts "No Package.tcl found"
}
`;
        
        return new vscode.ShellExecution(`echo '${script}' | tclsh`);
    }

    private createPackageExecution(): vscode.ShellExecution {
        const script = `
#!/usr/bin/env tclsh
# Create package from Package.tcl

if {![file exists Package.tcl]} {
    puts "Error: Package.tcl not found"
    exit 1
}

source Package.tcl

# Get package info from global variables
if {![info exists name] || ![info exists version]} {
    puts "Error: Package.tcl must define 'name' and 'version'"
    exit 1
}

set pkg_file "\\$name-\\$version.tar"

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
        
        return new vscode.ShellExecution(`echo '${script}' | tclsh`);
    }
}

export class TclTaskProviderManager {
    private taskProvider: vscode.Disposable | undefined;

    public register(context: vscode.ExtensionContext): void {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
        const provider = new TclTaskProvider(workspaceRoot);
        
        this.taskProvider = vscode.tasks.registerTaskProvider('tcl', provider);
        context.subscriptions.push(this.taskProvider);

        // Register commands for running tasks
        context.subscriptions.push(
            vscode.commands.registerCommand('tcl.runTask', () => {
                vscode.commands.executeCommand('workbench.action.tasks.runTask');
            }),

            vscode.commands.registerCommand('tcl.runBuildTask', () => {
                vscode.commands.executeCommand('workbench.action.tasks.build');
            }),

            vscode.commands.registerCommand('tcl.runTestTask', () => {
                vscode.commands.executeCommand('workbench.action.tasks.test');
            }),

            vscode.commands.registerCommand('tcl.configureTasks', () => {
                vscode.commands.executeCommand('workbench.action.tasks.configureTaskRunner');
            })
        );
    }

    public dispose(): void {
        if (this.taskProvider) {
            this.taskProvider.dispose();
        }
    }
}