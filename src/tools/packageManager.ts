import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
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

    constructor() {
        this.packageIndex = { packages: [], lastUpdated: new Date() };
        this.outputChannel = vscode.window.createOutputChannel('TCL Package Manager');
    }

    public async initialize(): Promise<void> {
        await this.discoverPackages();
        await this.loadWorkspacePackages();
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
            
            const { stdout } = await execAsync(`"${interpreterPath}" -c "${script}"`);
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

    public async installPackage(packageName: string): Promise<boolean> {
        // This is a placeholder for package installation
        // In a real implementation, this would download and install the package
        vscode.window.showInformationMessage(`Package installation not yet implemented for: ${packageName}`);
        return false;
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