import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { TclPackageManager } from './packageManager';

export interface Dependency {
    name: string;
    version: string;
    source: string;
    status: 'available' | 'missing' | 'outdated';
    location?: string;
}

export interface ProjectDependencies {
    dependencies: Dependency[];
    devDependencies: Dependency[];
    lastChecked: Date;
}

export class TclDependencyManager {
    private packageManager: TclPackageManager;
    private outputChannel: vscode.OutputChannel;
    private dependencies: ProjectDependencies;

    constructor(packageManager: TclPackageManager) {
        this.packageManager = packageManager;
        this.outputChannel = vscode.window.createOutputChannel('TCL Dependencies');
        this.dependencies = {
            dependencies: [],
            devDependencies: [],
            lastChecked: new Date()
        };
    }

    public async initialize(): Promise<void> {
        await this.discoverDependencies();
        await this.checkDependencyStatus();
    }

    private async discoverDependencies(): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) return;

        this.dependencies.dependencies = [];
        this.dependencies.devDependencies = [];

        for (const folder of workspaceFolders) {
            await this.scanWorkspaceForDependencies(folder.uri.fsPath);
        }

        this.dependencies.lastChecked = new Date();
    }

    private async scanWorkspaceForDependencies(workspacePath: string): Promise<void> {
        // Look for Package.tcl files
        const packageFiles = await vscode.workspace.findFiles(
            new vscode.RelativePattern(workspacePath, '**/Package.tcl'),
            '**/node_modules/**'
        );

        for (const packageFile of packageFiles) {
            await this.parsePackageDependencies(packageFile.fsPath);
        }

        // Scan TCL files for package require statements
        const tclFiles = await vscode.workspace.findFiles(
            new vscode.RelativePattern(workspacePath, '**/*.{tcl,tk,tm}'),
            '**/node_modules/**'
        );

        for (const tclFile of tclFiles) {
            await this.scanFileForRequires(tclFile.fsPath);
        }
    }

    private async parsePackageDependencies(filePath: string): Promise<void> {
        try {
            const content = await fs.promises.readFile(filePath, 'utf-8');
            const lines = content.split('\n');

            for (const line of lines) {
                // Parse require statements
                const requireMatch = line.match(/^\s*require\s+(\S+)\s*([\d.]+)?\s*$/);
                if (requireMatch) {
                    const [, name, version] = requireMatch;
                    this.addDependency({
                        name,
                        version: version || 'latest',
                        source: filePath,
                        status: 'missing'
                    });
                }

                // Parse test-require statements (dev dependencies)
                const testRequireMatch = line.match(/^\s*test-require\s+(\S+)\s*([\d.]+)?\s*$/);
                if (testRequireMatch) {
                    const [, name, version] = testRequireMatch;
                    this.addDevDependency({
                        name,
                        version: version || 'latest',
                        source: filePath,
                        status: 'missing'
                    });
                }
            }
        } catch (error) {
            this.outputChannel.appendLine(`Error parsing ${filePath}: ${error}`);
        }
    }

    private async scanFileForRequires(filePath: string): Promise<void> {
        try {
            const content = await fs.promises.readFile(filePath, 'utf-8');
            const lines = content.split('\n');

            for (const line of lines) {
                // Find package require statements
                const requireMatch = line.match(/package\s+require\s+(\S+)(?:\s+([\d.]+))?/);
                if (requireMatch) {
                    const [, name, version] = requireMatch;
                    
                    // Skip built-in packages
                    if (!this.isBuiltinPackage(name)) {
                        this.addDependency({
                            name,
                            version: version || 'latest',
                            source: filePath,
                            status: 'missing'
                        });
                    }
                }
            }
        } catch (error) {
            this.outputChannel.appendLine(`Error scanning ${filePath}: ${error}`);
        }
    }

    private isBuiltinPackage(name: string): boolean {
        const builtinPackages = [
            'Tcl', 'Tk', 'expect', 'tcltest', 'msgcat', 'registry',
            'dde', 'http', 'platform', 'auto_mkindex', 'safe'
        ];
        return builtinPackages.includes(name);
    }

    private addDependency(dependency: Dependency): void {
        const existing = this.dependencies.dependencies.find(d => d.name === dependency.name);
        if (!existing) {
            this.dependencies.dependencies.push(dependency);
        }
    }

    private addDevDependency(dependency: Dependency): void {
        const existing = this.dependencies.devDependencies.find(d => d.name === dependency.name);
        if (!existing) {
            this.dependencies.devDependencies.push(dependency);
        }
    }

    private async checkDependencyStatus(): Promise<void> {
        const allDependencies = [
            ...this.dependencies.dependencies,
            ...this.dependencies.devDependencies
        ];

        for (const dependency of allDependencies) {
            const package_ = this.packageManager.findPackage(dependency.name);
            if (package_) {
                dependency.status = this.compareVersions(package_.version, dependency.version) >= 0 
                    ? 'available' 
                    : 'outdated';
                dependency.location = package_.location;
            } else {
                dependency.status = 'missing';
            }
        }
    }

    private compareVersions(available: string, required: string): number {
        if (required === 'latest') return 1;
        
        const availableParts = available.split('.').map(Number);
        const requiredParts = required.split('.').map(Number);

        for (let i = 0; i < Math.max(availableParts.length, requiredParts.length); i++) {
            const a = availableParts[i] || 0;
            const r = requiredParts[i] || 0;
            if (a !== r) {
                return a - r;
            }
        }
        return 0;
    }

    public getDependencies(): ProjectDependencies {
        return this.dependencies;
    }

    public getMissingDependencies(): Dependency[] {
        return [
            ...this.dependencies.dependencies,
            ...this.dependencies.devDependencies
        ].filter(d => d.status === 'missing');
    }

    public getOutdatedDependencies(): Dependency[] {
        return [
            ...this.dependencies.dependencies,
            ...this.dependencies.devDependencies
        ].filter(d => d.status === 'outdated');
    }

    public async installDependencies(): Promise<void> {
        const missing = this.getMissingDependencies();
        
        if (missing.length === 0) {
            vscode.window.showInformationMessage('All dependencies are already installed');
            return;
        }

        const selected = await vscode.window.showQuickPick(
            missing.map(dep => ({
                label: dep.name,
                description: `v${dep.version}`,
                detail: `Required by: ${path.basename(dep.source)}`,
                dependency: dep
            })),
            {
                placeHolder: 'Select dependencies to install',
                canPickMany: true
            }
        );

        if (!selected || selected.length === 0) {
            return;
        }

        // This is a placeholder for actual installation
        // In a real implementation, this would download and install packages
        for (const item of selected) {
            this.outputChannel.appendLine(`Installing ${item.dependency.name} v${item.dependency.version}...`);
            // await this.packageManager.installPackage(item.dependency.name);
        }

        vscode.window.showInformationMessage(
            `Installation queued for ${selected.length} package(s). Check output for details.`
        );
    }

    public async updateDependencies(): Promise<void> {
        const outdated = this.getOutdatedDependencies();
        
        if (outdated.length === 0) {
            vscode.window.showInformationMessage('All dependencies are up to date');
            return;
        }

        const selected = await vscode.window.showQuickPick(
            outdated.map(dep => ({
                label: dep.name,
                description: `${dep.version} → latest`,
                detail: `Currently at v${dep.version}`,
                dependency: dep
            })),
            {
                placeHolder: 'Select dependencies to update',
                canPickMany: true
            }
        );

        if (!selected || selected.length === 0) {
            return;
        }

        // Placeholder for update logic
        for (const item of selected) {
            this.outputChannel.appendLine(`Updating ${item.dependency.name}...`);
        }

        vscode.window.showInformationMessage(
            `Update queued for ${selected.length} package(s). Check output for details.`
        );
    }

    public async createDependencyReport(): Promise<void> {
        const report = this.generateDependencyReport();
        
        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file('dependency-report.md'),
            filters: {
                'Markdown': ['md'],
                'Text': ['txt'],
                'JSON': ['json']
            }
        });

        if (uri) {
            try {
                const extension = path.extname(uri.fsPath).toLowerCase();
                let content: string;

                if (extension === '.json') {
                    content = JSON.stringify(this.dependencies, null, 2);
                } else {
                    content = report;
                }

                await vscode.workspace.fs.writeFile(uri, Buffer.from(content));
                vscode.window.showInformationMessage(`Dependency report saved to ${uri.fsPath}`);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to save report: ${error}`);
            }
        }
    }

    private generateDependencyReport(): string {
        const total = this.dependencies.dependencies.length + this.dependencies.devDependencies.length;
        const missing = this.getMissingDependencies().length;
        const outdated = this.getOutdatedDependencies().length;
        const available = total - missing - outdated;

        let report = `# TCL Dependency Report

Generated: ${new Date().toISOString()}

## Summary

- Total dependencies: ${total}
- Available: ${available}
- Missing: ${missing}
- Outdated: ${outdated}

## Runtime Dependencies

| Package | Version | Status | Location |
|---------|---------|--------|----------|
`;

        for (const dep of this.dependencies.dependencies) {
            const status = dep.status === 'available' ? '✅' : 
                          dep.status === 'missing' ? '❌' : '⚠️';
            report += `| ${dep.name} | ${dep.version} | ${status} ${dep.status} | ${dep.location || 'N/A'} |\n`;
        }

        if (this.dependencies.devDependencies.length > 0) {
            report += `
## Development Dependencies

| Package | Version | Status | Location |
|---------|---------|--------|----------|
`;

            for (const dep of this.dependencies.devDependencies) {
                const status = dep.status === 'available' ? '✅' : 
                              dep.status === 'missing' ? '❌' : '⚠️';
                report += `| ${dep.name} | ${dep.version} | ${status} ${dep.status} | ${dep.location || 'N/A'} |\n`;
            }
        }

        if (missing > 0) {
            report += `
## Missing Dependencies

The following packages need to be installed:

`;
            const missingDeps = this.getMissingDependencies();
            for (const dep of missingDeps) {
                report += `- ${dep.name} v${dep.version} (required by ${path.basename(dep.source)})\n`;
            }
        }

        if (outdated > 0) {
            report += `
## Outdated Dependencies

The following packages have newer versions available:

`;
            const outdatedDeps = this.getOutdatedDependencies();
            for (const dep of outdatedDeps) {
                report += `- ${dep.name} (current: v${dep.version})\n`;
            }
        }

        return report;
    }

    public async refreshDependencies(): Promise<void> {
        await this.initialize();
        
        const total = this.dependencies.dependencies.length + this.dependencies.devDependencies.length;
        const missing = this.getMissingDependencies().length;
        
        let message = `Found ${total} dependencies`;
        if (missing > 0) {
            message += `, ${missing} missing`;
        }
        
        vscode.window.showInformationMessage(message);
    }

    public dispose(): void {
        this.outputChannel.dispose();
    }
}