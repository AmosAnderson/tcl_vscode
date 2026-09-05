import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { TclPackageManager } from './packageManager';
import { PackageRequirement, compareTclVersions, parsePackageRequirements } from './packageModel';
import { activeTclResource, resolveTclFolder } from './executionContext';

export interface Dependency {
    name: string;
    version: string;
    source: string;
    status: 'available' | 'missing' | 'outdated' | 'conflict' | 'unknown';
    location?: string;
    requirements: PackageRequirement[];
    resource: vscode.Uri;
    installedVersion?: string;
    updateVersion?: string;
}
export interface ProjectDependencies { dependencies: Dependency[]; devDependencies: Dependency[]; lastChecked: Date; }

export class TclDependencyManager {
    private readonly outputChannel = vscode.window.createOutputChannel('TCL Dependencies');
    private dependencies: ProjectDependencies = { dependencies: [], devDependencies: [], lastChecked: new Date() };
    constructor(private readonly packageManager: TclPackageManager) {}

    public async initialize(resource?: vscode.Uri, force = false): Promise<void> {
        const folders = resource ? [resolveTclFolder(resource)].filter((folder): folder is vscode.WorkspaceFolder => !!folder) : vscode.workspace.workspaceFolders ?? [];
        const runtime: Dependency[] = [], development: Dependency[] = [];
        for (const folder of folders) {
            if (!force && !vscode.workspace.getConfiguration('tcl', folder.uri).get<boolean>('packages.autoDiscovery', true)) continue;
            await this.packageManager.ensurePackages(folder.uri, force);
            const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*.{tcl,tk,tm,test}'), '**/{node_modules,.git,out,build,.vscode-test}/**');
            const grouped = new Map<string, Dependency>();
            for (const uri of files) {
                try {
                    const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString());
                    const text = document?.getText() ?? await fs.promises.readFile(uri.fsPath, 'utf8');
                    for (const requirement of parsePackageRequirements(text, uri.fsPath, path.basename(uri.fsPath) === 'Package.tcl')) {
                        if (/\.test$/.test(uri.fsPath) || /[/\\]tests?[/\\]/.test(uri.fsPath)) requirement.development = true;
                        const key = requirement.dynamic ? `${requirement.source}:${requirement.offset}` : requirement.name;
                        let dependency = grouped.get(key);
                        if (!dependency) {
                            dependency = { name: requirement.name, version: '', source: requirement.source,
                                status: requirement.dynamic ? 'unknown' : 'missing', requirements: [], resource: folder.uri };
                            grouped.set(key, dependency);
                        }
                        dependency.requirements.push(requirement);
                    }
                } catch (error) { this.outputChannel.appendLine(`Cannot inspect ${uri.fsPath}: ${error}`); }
            }
            for (const dependency of grouped.values()) {
                dependency.version = [...new Set(dependency.requirements.map(requirement =>
                    `${requirement.exact ? '= ' : ''}${requirement.versions.join(' or ') || 'any'}`))].join(' and ');
                (dependency.requirements.every(requirement => requirement.development) ? development : runtime).push(dependency);
            }
        }
        this.dependencies = { dependencies: runtime, devDependencies: development, lastChecked: new Date() };
        await this.checkDependencyStatus();
    }

    public async compatible(dependency: Dependency, version: string): Promise<boolean> {
        for (const requirement of dependency.requirements) {
            if (requirement.dynamic || !await this.packageManager.isCompatible(version, requirement.versions, requirement.exact, dependency.resource)) return false;
        }
        return true;
    }

    private async checkDependencyStatus(): Promise<void> {
        for (const dependency of this.all()) {
            dependency.installedVersion = undefined; dependency.location = undefined; dependency.updateVersion = undefined;
            if (dependency.requirements.some(requirement => requirement.dynamic)) { dependency.status = 'unknown'; continue; }
            const exact = dependency.requirements.filter(requirement => requirement.exact).flatMap(requirement => requirement.versions);
            try {
                if (exact.some(version => compareTclVersions(version, exact[0]) !== 0) || (exact.length && !await this.compatible(dependency, exact[0]))) {
                    dependency.status = 'conflict'; continue;
                }
                // Every intersection of Tcl version intervals starts at one of its lower bounds.
                const lowerBounds = [...new Set(dependency.requirements.flatMap(requirement => requirement.versions.map(version => version.split('-')[0])))];
                if (lowerBounds.length) {
                    let satisfiable = false;
                    for (const lower of lowerBounds) if (await this.compatible(dependency, lower)) { satisfiable = true; break; }
                    if (!satisfiable) { dependency.status = 'conflict'; continue; }
                }
                const candidates = this.packageManager.getPackages(dependency.resource).filter(pkg => pkg.name === dependency.name)
                    .sort((a, b) => compareTclVersions(b.version, a.version));
                dependency.status = candidates.length ? 'outdated' : 'missing';
                for (const candidate of candidates) {
                    if (await this.compatible(dependency, candidate.version)) {
                        dependency.status = 'available'; dependency.installedVersion = candidate.version; dependency.location = candidate.location; break;
                    }
                }
                if (!dependency.installedVersion && candidates.length) dependency.installedVersion = candidates[0].version;
            } catch (error) { dependency.status = 'unknown'; this.outputChannel.appendLine(`Cannot resolve ${dependency.name}: ${error}`); }
        }
    }

    private all(): Dependency[] { return [...this.dependencies.dependencies, ...this.dependencies.devDependencies]; }
    public getDependencies(): ProjectDependencies { return this.dependencies; }
    public getMissingDependencies(): Dependency[] { return this.all().filter(dep => dep.status === 'missing'); }
    public getOutdatedDependencies(): Dependency[] { return this.all().filter(dep => dep.status === 'outdated' || !!dep.updateVersion); }

    public async findUpdates(): Promise<Dependency[]> {
        for (const dependency of this.all()) {
            dependency.updateVersion = undefined;
            if (dependency.status === 'unknown' || dependency.status === 'conflict') continue;
            for (const version of await this.packageManager.getAvailableVersions(dependency.name, dependency.resource)) {
                if ((!dependency.installedVersion || compareTclVersions(version, dependency.installedVersion) > 0) && await this.compatible(dependency, version)) {
                    dependency.updateVersion = version; break;
                }
            }
        }
        return this.all().filter(dependency => dependency.updateVersion);
    }

    public async installDependencies(resource = activeTclResource()): Promise<boolean> {
        await this.initialize(resource, true);
        const missing = this.all().filter(dep => dep.status === 'missing' || dep.status === 'outdated');
        const unresolved = this.all().filter(dep => dep.status === 'unknown' || dep.status === 'conflict');
        if (!missing.length) {
            if (unresolved.length) vscode.window.showWarningMessage(`${unresolved.length} dependencies have dynamic or conflicting requirements; inspect the dependency report.`);
            else vscode.window.showInformationMessage('All declared dependencies are available');
            return !unresolved.length;
        }
        const selected = await vscode.window.showQuickPick(missing.map(dependency => ({ label: dependency.name, description: dependency.version, dependency })),
            { canPickMany: true, placeHolder: 'Select dependencies to install' });
        if (!selected?.length) return false;
        let success = true;
        for (const { dependency } of selected) {
            let target: string | undefined;
            for (const candidate of await this.packageManager.getAvailableVersions(dependency.name, dependency.resource)) {
                if (await this.compatible(dependency, candidate)) { target = candidate; break; }
            }
            const exact = dependency.requirements.find(requirement => requirement.exact)?.versions[0];
            // A local source may supply a version that is absent from the catalog. Check all constraints after installation.
            const installed = await this.packageManager.installPackage(dependency.name, target ?? exact, dependency.resource, version => this.compatible(dependency, version));
            if (!installed) { success = false; continue; }
            await this.packageManager.ensurePackages(dependency.resource, true);
            const candidates = this.packageManager.getPackages(dependency.resource).filter(pkg => pkg.name === dependency.name);
            let compatible = false;
            for (const candidate of candidates) if (await this.compatible(dependency, candidate.version)) { compatible = true; break; }
            if (!compatible) { success = false; this.outputChannel.appendLine(`${dependency.name} was installed, but its version does not satisfy all declared requirements.`); }
        }
        await this.checkDependencyStatus();
        vscode.window[success ? 'showInformationMessage' : 'showWarningMessage'](success ? 'Selected dependencies installed and verified.' : 'Some dependencies could not be installed or did not satisfy their requirements.');
        return success;
    }

    public async updateDependencies(resource = activeTclResource()): Promise<boolean> {
        await this.initialize(resource, true);
        const updates = await this.findUpdates();
        if (!updates.length) { vscode.window.showInformationMessage('No newer compatible versions were found in the available package sources.'); return true; }
        const selected = await vscode.window.showQuickPick(updates.map(dependency => ({ label: dependency.name,
            description: `${dependency.installedVersion ?? 'missing'} → ${dependency.updateVersion}`, dependency })),
        { canPickMany: true, placeHolder: 'Select compatible package updates' });
        if (!selected?.length) return false;
        let success = true;
        for (const { dependency } of selected) if (!await this.packageManager.installPackage(dependency.name, dependency.updateVersion, dependency.resource)) success = false;
        await this.checkDependencyStatus();
        vscode.window[success ? 'showInformationMessage' : 'showWarningMessage'](success ? 'Selected updates installed and verified.' : 'Some package updates failed.');
        return success;
    }

    public async refreshDependencies(resource?: vscode.Uri): Promise<void> {
        await this.initialize(resource, true);
        vscode.window.showInformationMessage(`Found ${this.all().length} dependencies, ${this.getMissingDependencies().length} missing.`);
    }
    public async createDependencyReport(): Promise<void> {
        await this.initialize(undefined, true);
        const uri = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(resolveTclFolder()?.uri.fsPath ?? process.cwd(), 'dependency-report.md')),
            filters: { Markdown: ['md'], JSON: ['json'] } });
        if (!uri) return;
        const content = path.extname(uri.fsPath) === '.json' ? JSON.stringify(this.dependencies, null, 2) : this.generateDependencyReport();
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content));
    }
    private generateDependencyReport(): string {
        const cell = (value: string) => value.replace(/\|/g, '\\|').replace(/[\r\n]/g, ' ');
        return `# TCL Dependency Report\n\nGenerated: ${this.dependencies.lastChecked.toISOString()}\n\n| Package | Required | Installed | Status | Sources |\n| --- | --- | --- | --- | --- |\n` +
            this.all().map(dep => `| ${cell(dep.name)} | ${cell(dep.version)} | ${cell(dep.installedVersion ?? '—')} | ${dep.status} | ${dep.requirements.map(req => cell(req.source)).join(', ')} |`).join('\n') + '\n';
    }
    public dispose(): void { this.outputChannel.dispose(); }
}
