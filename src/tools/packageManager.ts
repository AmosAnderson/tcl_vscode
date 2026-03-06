import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface TclPackage {
    name: string;
    version: string;
    description?: string;
    location: string;
    type: 'tcllib' | 'tklib' | 'local' | 'system';
}

export interface PackageIndex {
    packages: TclPackage[];
    lastUpdated: Date;
}

export class TclPackageManager {
    private packageIndex: PackageIndex;
    private outputChannel: vscode.OutputChannel;
    private workspacePackages: Map<string, TclPackage[]> = new Map();
    private installStrategy: 'teacup' | 'manual' = 'manual';

    constructor() {
        this.packageIndex = { packages: [], lastUpdated: new Date() };
        this.outputChannel = vscode.window.createOutputChannel('TCL Package Manager');
    }

    public async initialize(): Promise<void> {
        await this.detectInstallStrategy();
        await this.discoverPackages();
        await this.loadWorkspacePackages();
    }

    private async detectInstallStrategy(): Promise<void> {
        try {
            await execAsync('teacup version');
            this.installStrategy = 'teacup';
            this.outputChannel.appendLine('Package install strategy: teacup');
        } catch {
            this.installStrategy = 'manual';
            this.outputChannel.appendLine('Package install strategy: manual (teacup not found)');
        }
    }

    public async getAutoPath(): Promise<string[]> {
        try {
            const config = vscode.workspace.getConfiguration('tcl');
            const interpreterPath = config.get<string>('interpreter.path', 'tclsh');
            const script = `puts [join $auto_path \\n]`;
            const tempScriptPath = path.join(os.tmpdir(), `tcl_autopath_${Date.now()}.tcl`);

            try {
                await fs.promises.writeFile(tempScriptPath, script, 'utf8');
                const { stdout } = await execAsync(`"${interpreterPath}" "${tempScriptPath}"`);
                return stdout.trim().split('\n').map(p => p.trim()).filter(p => p.length > 0);
            } finally {
                try { await fs.promises.unlink(tempScriptPath); } catch (_) { /* ignore */ }
            }
        } catch (error) {
            this.outputChannel.appendLine(`Error getting auto_path: ${error}`);
            return [];
        }
    }

    private async discoverPackages(): Promise<void> {
        this.packageIndex.packages = [];

        // Discover Tcllib packages
        await this.discoverTcllibPackages();

        // Discover Tklib packages
        await this.discoverTklibPackages();

        // Discover system packages
        await this.discoverSystemPackages();

        this.packageIndex.lastUpdated = new Date();
    }

    private async discoverTcllibPackages(): Promise<void> {
        const tcllibPaths = [
            '/usr/share/tcllib',
            '/usr/local/share/tcllib',
            '/opt/local/share/tcllib',
            path.join(process.env.HOME || '', '.tcllib'),
            'C:\\Tcl\\lib\\tcllib'
        ];

        for (const tcllibPath of tcllibPaths) {
            if (fs.existsSync(tcllibPath)) {
                try {
                    const packages = await this.scanTcllibDirectory(tcllibPath);
                    this.packageIndex.packages.push(...packages);
                } catch (error) {
                    this.outputChannel.appendLine(`Error scanning Tcllib at ${tcllibPath}: ${error}`);
                }
            }
        }
    }

    private async scanTcllibDirectory(tcllibPath: string): Promise<TclPackage[]> {
        const packages: TclPackage[] = [];
        
        try {
            const entries = await fs.promises.readdir(tcllibPath, { withFileTypes: true });
            
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const packagePath = path.join(tcllibPath, entry.name);
                    const pkgIndexPath = path.join(packagePath, 'pkgIndex.tcl');
                    
                    if (fs.existsSync(pkgIndexPath)) {
                        const packageInfo = await this.parsePkgIndex(pkgIndexPath);
                        if (packageInfo) {
                            packages.push({
                                name: packageInfo.name || entry.name,
                                version: packageInfo.version || '1.0',
                                description: `Tcllib package: ${entry.name}`,
                                location: packagePath,
                                type: 'tcllib'
                            });
                        }
                    }
                }
            }
        } catch (error) {
            this.outputChannel.appendLine(`Error scanning directory: ${error}`);
        }

        return packages;
    }

    private async discoverTklibPackages(): Promise<void> {
        const tklibPaths = [
            '/usr/share/tklib',
            '/usr/local/share/tklib',
            '/opt/local/share/tklib',
            path.join(process.env.HOME || '', '.tklib'),
            'C:\\Tcl\\lib\\tklib'
        ];

        for (const tklibPath of tklibPaths) {
            if (fs.existsSync(tklibPath)) {
                try {
                    const packages = await this.scanTklibDirectory(tklibPath);
                    this.packageIndex.packages.push(...packages);
                } catch (error) {
                    this.outputChannel.appendLine(`Error scanning Tklib at ${tklibPath}: ${error}`);
                }
            }
        }
    }

    private async scanTklibDirectory(tklibPath: string): Promise<TclPackage[]> {
        const packages: TclPackage[] = [];
        
        try {
            const entries = await fs.promises.readdir(tklibPath, { withFileTypes: true });
            
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const packagePath = path.join(tklibPath, entry.name);
                    const pkgIndexPath = path.join(packagePath, 'pkgIndex.tcl');
                    
                    if (fs.existsSync(pkgIndexPath)) {
                        const packageInfo = await this.parsePkgIndex(pkgIndexPath);
                        if (packageInfo) {
                            packages.push({
                                name: packageInfo.name || entry.name,
                                version: packageInfo.version || '1.0',
                                description: `Tklib package: ${entry.name}`,
                                location: packagePath,
                                type: 'tklib'
                            });
                        }
                    }
                }
            }
        } catch (error) {
            this.outputChannel.appendLine(`Error scanning directory: ${error}`);
        }

        return packages;
    }

    private async discoverSystemPackages(): Promise<void> {
        try {
            const config = vscode.workspace.getConfiguration('tcl');
            const interpreterPath = config.get<string>('interpreter.path', 'tclsh');
            
            // Get list of available packages from TCL interpreter
            const script = `
                set packages {}
                catch {
                    foreach pkg [package names] {
                        catch {
                            set ver [package versions $pkg]
                            if {$ver ne ""} {
                                lappend packages [list $pkg $ver]
                            }
                        }
                    }
                }
                puts $packages
            `;
            
            const tempScriptPath = path.join(os.tmpdir(), `tcl_pkg_discover_${Date.now()}.tcl`);

            try {
                await fs.promises.writeFile(tempScriptPath, script, 'utf8');
                const { stdout } = await execAsync(`"${interpreterPath}" "${tempScriptPath}"`);
                const packageList = this.parseTclList(stdout.trim());
            
                for (const [name, version] of packageList) {
                    this.packageIndex.packages.push({
                        name: name,
                        version: version,
                        description: `System package`,
                        location: 'system',
                        type: 'system'
                    });
                }
            } finally {
                try {
                    await fs.promises.unlink(tempScriptPath);
                } catch (_) {
                    // Ignore temp file cleanup errors
                }
            }
        } catch (error) {
            this.outputChannel.appendLine(`Error discovering system packages: ${error}`);
        }
    }

    private async parsePkgIndex(pkgIndexPath: string): Promise<{ name?: string; version?: string } | null> {
        try {
            const content = await fs.promises.readFile(pkgIndexPath, 'utf-8');
            
            // Parse package provide statements
            const provideMatch = content.match(/package\s+provide\s+(\S+)\s+([\d.]+)/);
            if (provideMatch) {
                return {
                    name: provideMatch[1],
                    version: provideMatch[2]
                };
            }
            
            // Parse package ifneeded statements
            const ifneededMatch = content.match(/package\s+ifneeded\s+(\S+)\s+([\d.]+)/);
            if (ifneededMatch) {
                return {
                    name: ifneededMatch[1],
                    version: ifneededMatch[2]
                };
            }
        } catch (error) {
            this.outputChannel.appendLine(`Error parsing pkgIndex.tcl: ${error}`);
        }
        
        return null;
    }

    private parseTclList(listStr: string): string[][] {
        // Simple TCL list parser - handles basic cases
        const result: string[][] = [];
        const items = listStr.match(/\{[^}]+\}/g) || [];
        
        for (const item of items) {
            const cleaned = item.replace(/[{}]/g, '').trim();
            const parts = cleaned.split(/\s+/);
            if (parts.length >= 2) {
                result.push([parts[0], parts[1]]);
            }
        }
        
        return result;
    }

    private async loadWorkspacePackages(): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) return;

        for (const folder of workspaceFolders) {
            const packages = await this.scanWorkspaceForPackages(folder.uri.fsPath);
            this.workspacePackages.set(folder.uri.fsPath, packages);
            this.packageIndex.packages.push(...packages);
        }
    }

    private async scanWorkspaceForPackages(workspacePath: string): Promise<TclPackage[]> {
        const packages: TclPackage[] = [];
        
        // Look for Package.tcl files
        const packageFiles = await vscode.workspace.findFiles(
            new vscode.RelativePattern(workspacePath, '**/Package.tcl'),
            '**/node_modules/**'
        );

        for (const packageFile of packageFiles) {
            const packageInfo = await this.parsePackageTcl(packageFile.fsPath);
            if (packageInfo && packageInfo.name) {
                packages.push({
                    name: packageInfo.name,
                    version: packageInfo.version || '1.0.0',
                    description: packageInfo.description || `Local package: ${packageInfo.name}`,
                    location: path.dirname(packageFile.fsPath),
                    type: 'local'
                });
            }
        }

        // Look for pkgIndex.tcl files
        const pkgIndexFiles = await vscode.workspace.findFiles(
            new vscode.RelativePattern(workspacePath, '**/pkgIndex.tcl'),
            '**/node_modules/**'
        );

        for (const pkgIndexFile of pkgIndexFiles) {
            const packageInfo = await this.parsePkgIndex(pkgIndexFile.fsPath);
            if (packageInfo && packageInfo.name) {
                packages.push({
                    name: packageInfo.name,
                    version: packageInfo.version || '1.0',
                    description: `Local package from ${path.basename(path.dirname(pkgIndexFile.fsPath))}`,
                    location: path.dirname(pkgIndexFile.fsPath),
                    type: 'local'
                });
            }
        }

        return packages;
    }

    private async parsePackageTcl(filePath: string): Promise<Partial<TclPackage> | null> {
        try {
            const content = await fs.promises.readFile(filePath, 'utf-8');
            const lines = content.split('\n');
            
            const packageInfo: Partial<TclPackage> = {};
            
            for (const line of lines) {
                // Parse package metadata
                const nameMatch = line.match(/^\s*name\s+(.+)$/);
                if (nameMatch) {
                    packageInfo.name = nameMatch[1].trim();
                }
                
                const versionMatch = line.match(/^\s*version\s+(.+)$/);
                if (versionMatch) {
                    packageInfo.version = versionMatch[1].trim();
                }
                
                const descMatch = line.match(/^\s*description\s+(.+)$/);
                if (descMatch) {
                    packageInfo.description = descMatch[1].trim();
                }
            }
            
            return packageInfo.name ? packageInfo : null;
        } catch (error) {
            this.outputChannel.appendLine(`Error parsing Package.tcl: ${error}`);
            return null;
        }
    }

    public getPackages(): TclPackage[] {
        return this.packageIndex.packages;
    }

    public findPackage(name: string): TclPackage | undefined {
        return this.packageIndex.packages.find(p => p.name === name);
    }

    public async installPackage(packageName: string, version?: string): Promise<boolean> {
        this.outputChannel.show(true);

        if (this.installStrategy === 'teacup') {
            return this.installViaTeacup(packageName, version);
        }
        return this.installManually(packageName, version);
    }

    private async installViaTeacup(packageName: string, version?: string): Promise<boolean> {
        try {
            const cmd = version
                ? `teacup install ${packageName} ${version}`
                : `teacup install ${packageName}`;

            this.outputChannel.appendLine(`Running: ${cmd}`);

            const result = await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Installing ${packageName}...`,
                    cancellable: false
                },
                async () => {
                    const { stdout, stderr } = await execAsync(cmd, { timeout: 120000 });
                    if (stderr && stderr.trim()) {
                        this.outputChannel.appendLine(`stderr: ${stderr}`);
                    }
                    this.outputChannel.appendLine(stdout);
                    return stdout;
                }
            );

            // Refresh package index after install
            await this.discoverPackages();
            await this.loadWorkspacePackages();

            vscode.window.showInformationMessage(`Successfully installed ${packageName}`);
            return true;
        } catch (error) {
            this.outputChannel.appendLine(`Failed to install ${packageName}: ${error}`);
            vscode.window.showErrorMessage(`Failed to install ${packageName}: ${error}`);
            return false;
        }
    }

    private async installManually(packageName: string, _version?: string): Promise<boolean> {
        // Check if the package exists in already-discovered locations
        const knownPackage = this.findPackage(packageName);
        if (knownPackage && (knownPackage.type === 'tcllib' || knownPackage.type === 'tklib' || knownPackage.type === 'local')) {
            vscode.window.showInformationMessage(`Package '${packageName}' is already available at ${knownPackage.location}`);
            return true;
        }

        // Get auto_path directories for install targets
        const autoPaths = await this.getAutoPath();
        if (autoPaths.length === 0) {
            vscode.window.showErrorMessage(
                'Could not determine TCL auto_path. Ensure tclsh is available, or install teacup for automatic package management.'
            );
            return false;
        }

        // Check configured default install directory
        const config = vscode.workspace.getConfiguration('tcl');
        const configuredDir = config.get<string>('packages.installDirectory', '');

        let targetDir: string;
        if (configuredDir && fs.existsSync(configuredDir)) {
            targetDir = configuredDir;
        } else {
            // Let user choose from auto_path
            const writablePaths = [];
            for (const p of autoPaths) {
                try {
                    await fs.promises.access(p, fs.constants.W_OK);
                    writablePaths.push(p);
                } catch {
                    // Not writable, skip
                }
            }

            if (writablePaths.length === 0) {
                vscode.window.showErrorMessage(
                    'No writable directories found on auto_path. Install teacup for automatic package management, or configure tcl.packages.installDirectory.'
                );
                return false;
            }

            const selected = await vscode.window.showQuickPick(
                writablePaths.map(p => ({ label: p, description: 'auto_path directory' })),
                { placeHolder: `Select install directory for ${packageName}` }
            );

            if (!selected) {
                return false;
            }
            targetDir = selected.label;
        }

        // Look for the package in known source locations
        const sourcePackage = this.packageIndex.packages.find(
            p => p.name === packageName && p.location !== 'system'
        );

        if (sourcePackage && sourcePackage.location && fs.existsSync(sourcePackage.location)) {
            try {
                const destPath = path.join(targetDir, path.basename(sourcePackage.location));

                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: `Installing ${packageName}...`,
                        cancellable: false
                    },
                    async () => {
                        await fs.promises.cp(sourcePackage.location, destPath, { recursive: true });

                        // Run pkg_mkIndex to generate index
                        const interpreterPath = config.get<string>('interpreter.path', 'tclsh');
                        const indexScript = `pkg_mkIndex ${destPath.replace(/\\/g, '/')} *.tcl`;
                        const tempScriptPath = path.join(os.tmpdir(), `tcl_pkgindex_${Date.now()}.tcl`);

                        try {
                            await fs.promises.writeFile(tempScriptPath, indexScript, 'utf8');
                            await execAsync(`"${interpreterPath}" "${tempScriptPath}"`);
                        } finally {
                            try { await fs.promises.unlink(tempScriptPath); } catch (_) { /* ignore */ }
                        }
                    }
                );

                this.outputChannel.appendLine(`Installed ${packageName} to ${destPath}`);

                // Refresh package index
                await this.discoverPackages();
                await this.loadWorkspacePackages();

                vscode.window.showInformationMessage(`Successfully installed ${packageName}`);
                return true;
            } catch (error) {
                this.outputChannel.appendLine(`Failed to copy package: ${error}`);
                vscode.window.showErrorMessage(`Failed to install ${packageName}: ${error}`);
                return false;
            }
        }

        // Package source not found locally
        vscode.window.showWarningMessage(
            `Package '${packageName}' not found locally. Install tcllib/tklib on your system, or use teacup for automatic package management.`
        );
        return false;
    }

    public async getLatestVersion(packageName: string): Promise<string | null> {
        if (this.installStrategy === 'teacup') {
            try {
                const { stdout } = await execAsync(`teacup list ${packageName}`);
                const lines = stdout.trim().split('\n');
                // teacup list output has versions; pick the last (latest)
                for (let i = lines.length - 1; i >= 0; i--) {
                    const match = lines[i].match(/([\d.]+)/);
                    if (match) {
                        return match[1];
                    }
                }
            } catch {
                // Fall through to tclsh approach
            }
        }

        try {
            const config = vscode.workspace.getConfiguration('tcl');
            const interpreterPath = config.get<string>('interpreter.path', 'tclsh');
            const script = `puts [package versions ${packageName}]`;
            const tempScriptPath = path.join(os.tmpdir(), `tcl_pkgver_${Date.now()}.tcl`);

            try {
                await fs.promises.writeFile(tempScriptPath, script, 'utf8');
                const { stdout } = await execAsync(`"${interpreterPath}" "${tempScriptPath}"`);
                const versions = stdout.trim().split(/\s+/).filter(v => v.length > 0);
                return versions.length > 0 ? versions[versions.length - 1] : null;
            } finally {
                try { await fs.promises.unlink(tempScriptPath); } catch (_) { /* ignore */ }
            }
        } catch {
            return null;
        }
    }

    public async createPackageTcl(workspaceFolder: string): Promise<void> {
        const packageName = await vscode.window.showInputBox({
            prompt: 'Package name',
            placeHolder: 'mypackage'
        });

        if (!packageName) return;

        const packageVersion = await vscode.window.showInputBox({
            prompt: 'Package version',
            value: '1.0.0'
        });

        if (!packageVersion) return;

        const packageDescription = await vscode.window.showInputBox({
            prompt: 'Package description',
            placeHolder: 'A TCL package for...'
        });

        const packageTclContent = `# Package.tcl - Package definition file
name ${packageName}
version ${packageVersion}
description ${packageDescription || 'A TCL package'}

# Dependencies
# require somepackage 1.0

# Source files
source [file join [file dirname [info script]] main.tcl]

# Package initialization
package provide ${packageName} ${packageVersion}
`;

        const packagePath = path.join(workspaceFolder, packageName);
        const packageTclPath = path.join(packagePath, 'Package.tcl');
        const mainTclPath = path.join(packagePath, 'main.tcl');

        try {
            // Create package directory
            await fs.promises.mkdir(packagePath, { recursive: true });

            // Write Package.tcl
            await fs.promises.writeFile(packageTclPath, packageTclContent);

            // Write main.tcl
            const mainTclContent = `# ${packageName} - Main package file

namespace eval ::${packageName} {
    namespace export *
    
    proc hello {name} {
        return "Hello, $name from ${packageName}!"
    }
}
`;
            await fs.promises.writeFile(mainTclPath, mainTclContent);

            // Create pkgIndex.tcl for compatibility
            const pkgIndexContent = `# pkgIndex.tcl - Package index file
package ifneeded ${packageName} ${packageVersion} [list source [file join $dir main.tcl]]
`;
            await fs.promises.writeFile(path.join(packagePath, 'pkgIndex.tcl'), pkgIndexContent);

            vscode.window.showInformationMessage(`Package '${packageName}' created successfully`);

            // Open the Package.tcl file
            const doc = await vscode.workspace.openTextDocument(packageTclPath);
            await vscode.window.showTextDocument(doc);

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create package: ${error}`);
        }
    }

    public async updatePackageIndex(): Promise<void> {
        await this.initialize();
        vscode.window.showInformationMessage(`Package index updated. Found ${this.packageIndex.packages.length} packages.`);
    }

    public getPackageCompletions(): vscode.CompletionItem[] {
        return this.packageIndex.packages.map(pkg => {
            const item = new vscode.CompletionItem(pkg.name, vscode.CompletionItemKind.Module);
            item.detail = `${pkg.type} package v${pkg.version}`;
            item.documentation = pkg.description;
            item.insertText = new vscode.SnippetString(`package require ${pkg.name} ${pkg.version}`);
            return item;
        });
    }

    public dispose(): void {
        this.outputChannel.dispose();
    }
}
