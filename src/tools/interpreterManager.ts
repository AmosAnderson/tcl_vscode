import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface TclInterpreter {
    path: string;
    version: string;
    name: string;
    type: 'system' | 'tclkit' | 'activetcl' | 'custom';
    isDefault: boolean;
}

export class TclInterpreterManager {
    private interpreters: TclInterpreter[] = [];
    private currentInterpreter: TclInterpreter | null = null;
    private outputChannel: vscode.OutputChannel;

    constructor() {
        this.outputChannel = vscode.window.createOutputChannel('TCL Interpreter');
    }

    public async initialize(): Promise<void> {
        await this.discoverInterpreters();
        await this.loadConfiguration();
    }

    private async discoverInterpreters(): Promise<void> {
        this.interpreters = [];

        // Discover system TCL interpreters
        await this.discoverSystemInterpreters();

        // Discover TclKit installations
        await this.discoverTclKitInterpreters();

        // Discover ActiveTcl installations
        await this.discoverActiveTclInterpreters();

        // Load custom interpreters from configuration
        this.loadCustomInterpreters();

        // Sort interpreters by version (newest first)
        this.interpreters.sort((a, b) => {
            return this.compareVersions(b.version, a.version);
        });
    }

    private async discoverSystemInterpreters(): Promise<void> {
        const possiblePaths = [
            // Generic launcher (may be 8.x or 9.x)
            'tclsh',
            // Explicit versioned binaries (add new versions here)
            'tclsh9.0', 'tclsh9',
            'tclsh8.7', 'tclsh8.6', 'tclsh8.5', 'tclsh8.4',
            // Common Unix install roots
            '/usr/bin/tclsh', '/usr/local/bin/tclsh', '/opt/local/bin/tclsh',
            // Windows typical installs (update as needed for 9.x distributions)
            'C:\\Tcl\\bin\\tclsh.exe',
            'C:\\Tcl\\bin\\tclsh90.exe', 'C:\\Tcl\\bin\\tclsh9.exe',
            'C:\\Tcl\\bin\\tclsh87.exe', 'C:\\Tcl\\bin\\tclsh86.exe', 'C:\\Tcl\\bin\\tclsh85.exe'
        ];

        for (const tclPath of possiblePaths) {
            try {
                const version = await this.getTclVersion(tclPath);
                if (version && this.isSupportedVersion(version)) {
                    this.interpreters.push({
                        path: tclPath,
                        version: version,
                        name: `System TCL ${version}`,
                        type: 'system',
                        isDefault: false
                    });
                } else if (version) {
                    this.outputChannel.appendLine(`[interpreterManager] Skipping unsupported TCL version ${version} at ${tclPath}`);
                }
            } catch (error) {
                // Path not found or not executable
            }
        }
    }

    private async discoverTclKitInterpreters(): Promise<void> {
        const tclkitPaths = [
            path.join(process.env.HOME || '', 'tclkit'),
            path.join(process.env.HOME || '', '.tclkit'),
            '/usr/local/tclkit',
            '/opt/tclkit',
            'C:\\TclKit'
        ];

        for (const basePath of tclkitPaths) {
            if (fs.existsSync(basePath)) {
                try {
                    const files = await fs.promises.readdir(basePath);
                    for (const file of files) {
                        if (file.includes('tclkit') && !file.endsWith('.txt')) {
                            const fullPath = path.join(basePath, file);
                            const version = await this.getTclVersion(fullPath);
                            if (version && this.isSupportedVersion(version)) {
                                this.interpreters.push({
                                    path: fullPath,
                                    version: version,
                                    name: `TclKit ${version}`,
                                    type: 'tclkit',
                                    isDefault: false
                                });
                            } else if (version) {
                                this.outputChannel.appendLine(`[interpreterManager] Skipping unsupported TclKit version ${version} at ${fullPath}`);
                            }
                        }
                    }
                } catch (error) {
                    // Directory not accessible
                }
            }
        }
    }

    private async discoverActiveTclInterpreters(): Promise<void> {
        const activeTclPaths = [
            'C:\\ActiveTcl\\bin\\tclsh.exe',
            'C:\\ActiveTcl\\bin\\tclsh86.exe',
            '/opt/ActiveTcl/bin/tclsh',
            '/usr/local/ActiveTcl/bin/tclsh',
            path.join(process.env.HOME || '', 'ActiveTcl', 'bin', 'tclsh')
        ];

        for (const tclPath of activeTclPaths) {
            if (fs.existsSync(tclPath)) {
                try {
                    const version = await this.getTclVersion(tclPath);
                    if (version && this.isSupportedVersion(version)) {
                        this.interpreters.push({
                            path: tclPath,
                            version: version,
                            name: `ActiveTcl ${version}`,
                            type: 'activetcl',
                            isDefault: false
                        });
                    } else if (version) {
                        this.outputChannel.appendLine(`[interpreterManager] Skipping unsupported ActiveTcl version ${version} at ${tclPath}`);
                    }
                } catch (error) {
                    // Path not executable
                }
            }
        }
    }

    private loadCustomInterpreters(): void {
        const config = vscode.workspace.getConfiguration('tcl');
        const customPaths = config.get<string[]>('interpreters.customPaths', []);

        for (const customPath of customPaths) {
            // Custom interpreters are added without version check
            // as they might be specialized builds
            this.interpreters.push({
                path: customPath,
                version: 'custom',
                name: `Custom: ${path.basename(customPath)}`,
                type: 'custom',
                isDefault: false
            });
        }
    }

    private async getTclVersion(tclPath: string): Promise<string | null> {
        try {
            // tclsh doesn't support -c flag, use echo and pipe instead
            const cmd = process.platform === 'win32'
                ? `echo puts $tcl_version | "${tclPath}"`
                : `echo 'puts $tcl_version' | "${tclPath}"`;
            const { stdout } = await execAsync(cmd);
            return stdout.trim();
        } catch (error) {
            return null;
        }
    }

    private isSupportedVersion(version: string): boolean {
        if (version === 'custom') return true; // allow custom
        // Normalize: keep first two numeric components
        const match = version.match(/^(\d+)(?:\.(\d+))?/);
        if (!match) return false;
        const major = parseInt(match[1], 10);
        const minor = match[2] ? parseInt(match[2], 10) : 0;
        // Support range: 8.4 <= version <= 9.0
        if (major === 8) {
            return minor >= 4; // 8.4 - 8.x (treat any >=4 as supported)
        }
        if (major === 9) {
            return minor <= 0; // currently only 9.0 tested
        }
        return false;
    }

    private compareVersions(v1: string, v2: string): number {
        if (v1 === 'custom') return -1;
        if (v2 === 'custom') return 1;

        const parts1 = v1.split('.').map(Number);
        const parts2 = v2.split('.').map(Number);

        for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
            const p1 = parts1[i] || 0;
            const p2 = parts2[i] || 0;
            if (p1 !== p2) {
                return p1 - p2;
            }
        }
        return 0;
    }

    private async loadConfiguration(): Promise<void> {
        const config = vscode.workspace.getConfiguration('tcl');
        const selectedPath = config.get<string>('interpreter.path');

        if (selectedPath) {
            // Find the interpreter with this path
            this.currentInterpreter = this.interpreters.find(i => i.path === selectedPath) || null;
        }

        if (!this.currentInterpreter && this.interpreters.length > 0) {
            // Use the first (newest) interpreter as default
            this.currentInterpreter = this.interpreters[0];
            this.currentInterpreter.isDefault = true;
        }
    }

    public async selectInterpreter(): Promise<void> {
        if (this.interpreters.length === 0) {
            vscode.window.showWarningMessage('No TCL interpreters found. Please install TCL or configure a custom path.');
            return;
        }

        const items: vscode.QuickPickItem[] = this.interpreters.map(interpreter => ({
            label: interpreter.name,
            description: interpreter.path,
            detail: `Version: ${interpreter.version}${interpreter.isDefault ? ' (default)' : ''}`
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select TCL Interpreter',
            matchOnDescription: true
        });

        if (selected) {
            const interpreter = this.interpreters.find(i => i.path === selected.description);
            if (interpreter) {
                await this.setCurrentInterpreter(interpreter);
            }
        }
    }

    private async setCurrentInterpreter(interpreter: TclInterpreter): Promise<void> {
        this.currentInterpreter = interpreter;

        // Update all interpreters' default status
        this.interpreters.forEach(i => i.isDefault = false);
        interpreter.isDefault = true;

        // Save to configuration
        const config = vscode.workspace.getConfiguration('tcl');
        await config.update('interpreter.path', interpreter.path, vscode.ConfigurationTarget.Global);

        // Update status bar
        this.updateStatusBar();

        vscode.window.showInformationMessage(`TCL interpreter set to: ${interpreter.name}`);
    }

    public getCurrentInterpreter(): TclInterpreter | null {
        return this.currentInterpreter;
    }

    public getInterpreterPath(): string {
        return this.currentInterpreter?.path || 'tclsh';
    }

    public async validateInterpreter(interpreterPath: string): Promise<boolean> {
        const version = await this.getTclVersion(interpreterPath);
        if (!version) return false;
        const supported = this.isSupportedVersion(version);
        if (!supported) {
            vscode.window.showWarningMessage(`TCL interpreter version ${version} is outside supported range (8.4 - 9.0). Some features may not work.`);
        }
        return true;
    }

    private updateStatusBar(): void {
        if (this.currentInterpreter) {
            vscode.window.setStatusBarMessage(
                `TCL: ${this.currentInterpreter.name}`,
                5000
            );
        }
    }

    public async addCustomInterpreter(): Promise<void> {
        const uri = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            openLabel: 'Select TCL Interpreter',
            filters: {
                'Executable': process.platform === 'win32' ? ['exe', 'bat'] : ['*']
            }
        });

        if (uri && uri.length > 0) {
            const interpreterPath = uri[0].fsPath;
            
            // Validate the interpreter
            if (await this.validateInterpreter(interpreterPath)) {
                // Add to custom paths
                const config = vscode.workspace.getConfiguration('tcl');
                const customPaths = config.get<string[]>('interpreters.customPaths', []);
                
                if (!customPaths.includes(interpreterPath)) {
                    customPaths.push(interpreterPath);
                    await config.update('interpreters.customPaths', customPaths, vscode.ConfigurationTarget.Global);
                    
                    // Refresh interpreter list
                    await this.initialize();
                    
                    vscode.window.showInformationMessage(`Added custom TCL interpreter: ${interpreterPath}`);
                } else {
                    vscode.window.showInformationMessage('This interpreter is already configured.');
                }
            } else {
                vscode.window.showErrorMessage('Selected file is not a valid TCL interpreter.');
            }
        }
    }

    public getInterpreters(): TclInterpreter[] {
        return this.interpreters;
    }

    public async refreshInterpreters(): Promise<void> {
        await this.discoverInterpreters();
        await this.loadConfiguration();
        vscode.window.showInformationMessage(`Found ${this.interpreters.length} TCL interpreter(s)`);
    }

    public dispose(): void {
        this.outputChannel.dispose();
    }
}