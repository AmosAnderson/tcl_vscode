import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { parseTclList } from '../utils/tclParser';
import { activeTclResource, resolveTclCwd, resolveTclFolder, resolveTclInterpreter } from './executionContext';
import { compareTclVersions, parsePackageMetadata, parsePackageRegistrations } from './packageModel';
import { executeTclDataScript, satisfiesPackageVersion, tclLiteral } from './tclProcess';
import { extractPackageArchive } from './packageArchive';
import { TclProjectTemplates } from './projectTemplates';

const execFileAsync = promisify(execFile);
export interface TclPackage { name: string; version: string; description?: string; location: string; type: 'tcllib' | 'tklib' | 'local' | 'system'; }
export interface PackageIndex { packages: TclPackage[]; lastUpdated: Date; }

export class TclPackageManager {
    private readonly catalogs = new Map<string, TclPackage[]>();
    private readonly pending = new Map<string, Promise<void>>();
    private readonly changes = new vscode.EventEmitter<void>();
    readonly onDidChangePackages = this.changes.event;
    private readonly outputChannel = vscode.window.createOutputChannel('TCL Package Manager');
    private readonly subscriptions: vscode.Disposable[] = [];
    private generation = 0;
    private disposed = false;
    private strategy: Promise<'teacup' | 'manual'> | undefined;

    constructor() {
        const watcher = vscode.workspace.createFileSystemWatcher('**/*.{tcl,tm}');
        const invalidate = () => { this.generation++; this.catalogs.clear(); this.changes.fire(); };
        this.subscriptions.push(watcher, watcher.onDidCreate(invalidate), watcher.onDidChange(invalidate), watcher.onDidDelete(invalidate),
            vscode.workspace.onDidChangeWorkspaceFolders(invalidate), vscode.workspace.onDidChangeConfiguration(event => {
                if (event.affectsConfiguration('tcl.interpreter') || event.affectsConfiguration('tcl.packages')) invalidate();
            }));
    }

    private key(resource?: vscode.Uri): string {
        return JSON.stringify([resolveTclFolder(resource)?.uri.toString() ?? '', resolveTclInterpreter(resource)]);
    }

    public async initialize(resource = activeTclResource(), force = false): Promise<void> { await this.ensurePackages(resource, force); }
    public async ensurePackages(resource = activeTclResource(), force = false): Promise<void> {
        if (this.disposed) return;
        if (!force && !vscode.workspace.getConfiguration('tcl', resource).get<boolean>('packages.autoDiscovery', true)) return;
        const key = this.key(resource);
        if (!force && this.catalogs.has(key)) return;
        const existing = this.pending.get(key);
        if (existing) { await existing; if (!this.catalogs.has(key) && !this.disposed) await this.ensurePackages(resource, force); return; }
        const generation = this.generation;
        const work = this.discover(resource).then(packages => {
            if (!this.disposed && generation === this.generation) { this.catalogs.set(key, packages); this.changes.fire(); }
        });
        this.pending.set(key, work);
        try { await work; } finally { this.pending.delete(key); }
    }

    public async getAutoPath(resource = activeTclResource()): Promise<string[]> {
        try {
            const stdout = await executeTclDataScript(resolveTclInterpreter(resource), 'puts $auto_path', resolveTclCwd(resource));
            return parseTclList(stdout).words.map(word => word.value);
        } catch (error) { this.outputChannel.appendLine(`Cannot read auto_path: ${error}`); return []; }
    }

    private async discover(resource?: vscode.Uri): Promise<TclPackage[]> {
        const packages: TclPackage[] = [];
        const paths = await this.getAutoPath(resource);
        const visited = new Set<string>();
        for (const directory of paths) packages.push(...await this.scanDirectory(directory, 'system', visited));
        try {
            const modulePaths = await executeTclDataScript(resolveTclInterpreter(resource), 'puts [::tcl::tm::path list]', resolveTclCwd(resource));
            for (const word of parseTclList(modulePaths).words) packages.push(...await this.scanDirectory(word.value, 'system', visited));
        } catch { /* Older or specialized interpreters may not support modules. */ }
        const folder = resolveTclFolder(resource);
        if (folder) packages.push(...await this.scanDirectory(folder.uri.fsPath, 'local', new Set()));
        try {
            const output = await executeTclDataScript(resolveTclInterpreter(resource), 'foreach name [package names] { set version [package provide $name]; if {$version ne ""} { puts [list $name $version] } }', resolveTclCwd(resource));
            for (const line of output.split('\n')) {
                const words = parseTclList(line).words;
                if (words.length === 2) packages.push({ name: words[0].value, version: words[1].value, location: 'system', type: 'system' });
            }
        } catch { /* Static discovery remains available without an interpreter. */ }
        const unique = new Map<string, TclPackage>();
        for (const pkg of packages) unique.set(JSON.stringify([pkg.name, pkg.version, pkg.location]), pkg);
        return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name) || compareTclVersions(b.version, a.version));
    }

    public async scanDirectory(directory: string, type: TclPackage['type'] = 'local', visited = new Set<string>(), depth = 0): Promise<TclPackage[]> {
        if (depth > 8 || visited.size >= 5000) return [];
        const root = path.resolve(directory);
        if (visited.has(root)) return [];
        visited.add(root);
        const result: TclPackage[] = [];
        try {
            const entries = await fs.promises.readdir(root, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isSymbolicLink()) continue;
                const target = path.join(root, entry.name);
                if (entry.isDirectory() && !['node_modules', '.git', '.vscode-test', 'out', 'build'].includes(entry.name)) {
                    result.push(...await this.scanDirectory(target, type, visited, depth + 1));
                } else if (entry.isFile() && (entry.name === 'pkgIndex.tcl' || entry.name === 'Package.tcl' || entry.name.endsWith('.tm'))) {
                    const text = await fs.promises.readFile(target, 'utf8');
                    const metadata = entry.name === 'Package.tcl' ? parsePackageMetadata(text) : undefined;
                    const registrations = parsePackageRegistrations(text);
                    if (metadata?.name && metadata.version) registrations.push({ name: metadata.name, version: metadata.version });
                    const module = /^(.*)-([\d][\da-b.]*)\.tm$/.exec(entry.name);
                    if (module) registrations.push({ name: module[1], version: module[2] });
                    for (const registration of registrations) result.push({ ...registration, description: metadata?.description, location: root, type });
                }
            }
        } catch (error) { this.outputChannel.appendLine(`Cannot scan ${root}: ${error}`); }
        return result;
    }

    public getPackages(resource = activeTclResource()): TclPackage[] { return this.catalogs.get(this.key(resource)) ?? []; }
    public findPackage(name: string, resource?: vscode.Uri): TclPackage | undefined { return this.getPackages(resource).find(pkg => pkg.name === name); }
    public getPackageCompletions(resource?: vscode.Uri): vscode.CompletionItem[] {
        const seen = new Set<string>();
        return this.getPackages(resource).filter(pkg => !seen.has(pkg.name) && !!seen.add(pkg.name)).map(pkg => {
            const item = new vscode.CompletionItem(pkg.name, vscode.CompletionItemKind.Module);
            item.detail = `${pkg.type} package v${pkg.version}`; item.documentation = pkg.description; item.insertText = pkg.name;
            return item;
        });
    }
    public async updatePackageIndex(resource = activeTclResource()): Promise<void> {
        await this.ensurePackages(resource, true);
        vscode.window.showInformationMessage(`Package index updated. Found ${this.getPackages(resource).length} package versions.`);
    }

    private detectInstallStrategy(): Promise<'teacup' | 'manual'> {
        return this.strategy ??= execFileAsync('teacup', ['version'], { timeout: 5000 }).then(() => 'teacup' as const, () => 'manual' as const);
    }

    public async getAvailableVersions(name: string, resource?: vscode.Uri): Promise<string[]> {
        await this.ensurePackages(resource);
        const versions = this.getPackages(resource).filter(pkg => pkg.name === name).map(pkg => pkg.version);
        if (await this.detectInstallStrategy() === 'teacup') {
            try {
                const { stdout } = await execFileAsync('teacup', ['list', name], { timeout: 10000 });
                for (const word of stdout.split(/\s+/)) if (/^\d+(?:\.\d+)*(?:[ab]\d+)?$/.test(word)) versions.push(word);
            } catch (error) { this.outputChannel.appendLine(`Cannot query available versions of ${name}: ${error}`); }
        }
        return [...new Set(versions)].sort((a, b) => compareTclVersions(b, a));
    }
    public async getLatestVersion(name: string, resource?: vscode.Uri): Promise<string | null> {
        return (await this.getAvailableVersions(name, resource))[0] ?? null;
    }

    public async verifyInstalled(name: string, version?: string, resource?: vscode.Uri): Promise<boolean> {
        const request = ['package', 'require', ...(version ? ['-exact'] : []), tclLiteral(name), ...(version ? [tclLiteral(version)] : [])].join(' ');
        try { return !!await executeTclDataScript(resolveTclInterpreter(resource), `puts [${request}]`, resolveTclCwd(resource)); }
        catch (error) { this.outputChannel.appendLine(`Package verification failed: ${error}`); return false; }
    }

    public async installPackage(name: string, version?: string, resource = activeTclResource(), acceptVersion?: (version: string) => Promise<boolean>): Promise<boolean> {
        this.outputChannel.show(true);
        if (await this.detectInstallStrategy() === 'teacup') {
            try {
                if (!version && acceptVersion) {
                    for (const candidate of await this.getAvailableVersions(name, resource)) {
                        if (await acceptVersion(candidate)) { version = candidate; break; }
                    }
                    if (!version) throw new Error('No compatible version could be resolved from the package source');
                }
                const result = await execFileAsync('teacup', ['install', name, ...(version ? [version] : [])], { timeout: 120000, cwd: resolveTclCwd(resource) });
                this.outputChannel.appendLine(result.stdout);
                if (!await this.verifyInstalled(name, version, resource)) throw new Error('The selected interpreter cannot load the installed package');
                await this.ensurePackages(resource, true); return true;
            } catch (error) { vscode.window.showErrorMessage(`Could not install ${name}: ${error}`); return false; }
        }
        const kind = await vscode.window.showQuickPick(['Local package directory', 'Local tar archive'], { placeHolder: `Select a source for ${name}${version ? ' ' + version : ''}` });
        if (!kind) return false;
        const selection = await vscode.window.showOpenDialog({ canSelectFiles: kind === 'Local tar archive', canSelectFolders: kind === 'Local package directory', canSelectMany: false,
            filters: kind === 'Local tar archive' ? { 'Tcl package archive': ['tar', 'tgz', 'gz'] } : undefined });
        if (!selection?.length) return false;
        const autoPaths = await this.getAutoPath(resource);
        let target = vscode.workspace.getConfiguration('tcl', resource).get<string>('packages.installDirectory', '');
        if (!target) {
            const writable: string[] = [];
            for (const directory of autoPaths) { try { await fs.promises.access(directory, fs.constants.W_OK); writable.push(directory); } catch { /* Skip unwritable system roots. */ } }
            target = await vscode.window.showQuickPick(writable, { placeHolder: 'Install directory on the selected interpreter auto_path' }) ?? '';
        }
        if (!target) return false;
        let temporary: string | undefined;
        try {
            let source = selection[0].fsPath;
            if (kind === 'Local tar archive') {
                temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tcl-package-'));
                await extractPackageArchive(source, temporary);
                source = temporary;
            }
            return await this.installFromDirectory(source, name, version, target, resource, acceptVersion);
        } catch (error) { vscode.window.showErrorMessage(`Could not install ${name}: ${error}`); return false; }
        finally { if (temporary) await fs.promises.rm(temporary, { recursive: true, force: true }); }
    }

    public async installFromDirectory(source: string, name: string, version: string | undefined, targetDirectory: string, resource?: vscode.Uri, acceptVersion?: (version: string) => Promise<boolean>): Promise<boolean> {
        const candidates = (await this.scanDirectory(source)).filter(pkg => pkg.name === name && (!version || compareTclVersions(pkg.version, version) === 0));
        if (!candidates.length) throw new Error('The selected source does not declare the requested package and version');
        let candidate: TclPackage | undefined;
        for (const proposed of candidates.sort((a, b) => compareTclVersions(b.version, a.version))) {
            if (!acceptVersion || await acceptVersion(proposed.version)) { candidate = proposed; break; }
        }
        if (!candidate) throw new Error('The selected package does not satisfy the project requirements');
        if (!/^\d+(?:\.\d+)*(?:[ab]\d+)?$/.test(candidate.version)) throw new Error('The source declares an invalid package version');
        const autoPaths = await this.getAutoPath(resource);
        if (!autoPaths.some(directory => path.resolve(directory) === path.resolve(targetDirectory))) throw new Error('Install directory must be on the selected interpreter auto_path');
        if (!/^[A-Za-z0-9_.:-]+$/.test(name)) throw new Error('Unsupported package name for local installation');
        const destination = path.join(targetDirectory, `${name.replace(/:/g, '_')}-${candidate.version}`);
        try { await fs.promises.lstat(destination); throw new Error(`Install destination already exists: ${destination}`); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        const validateTree = async (directory: string): Promise<void> => {
            for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
                if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) throw new Error('Package sources must contain only regular files and directories');
                if (entry.isDirectory()) await validateTree(path.join(directory, entry.name));
            }
        };
        await validateTree(candidate.location);
        await fs.promises.mkdir(destination, { recursive: false });
        try {
            for (const entry of await fs.promises.readdir(candidate.location)) {
                await fs.promises.cp(path.join(candidate.location, entry), path.join(destination, entry), { recursive: true, force: false, errorOnExist: true });
            }
            if (!await this.verifyInstalled(name, candidate.version, resource)) throw new Error('The installed package cannot be loaded by the selected interpreter');
            await this.ensurePackages(resource, true); return true;
        } catch (error) { await fs.promises.rm(destination, { recursive: true, force: true }); throw error; }
    }

    public async isCompatible(version: string, required: string[], exact: boolean, resource?: vscode.Uri): Promise<boolean> {
        return satisfiesPackageVersion(resolveTclInterpreter(resource), version, required, exact);
    }

    public async createPackageTcl(workspaceFolder: string): Promise<void> {
        const name = await vscode.window.showInputBox({ prompt: 'Package name', value: 'mypackage', validateInput: value => /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) ? null : 'Use a Tcl identifier (letters, numbers, underscores)' });
        if (!name) return;
        const version = await vscode.window.showInputBox({ prompt: 'Package version', value: '1.0.0', validateInput: value => /^\d+(?:\.\d+)*(?:[ab]\d+)?$/.test(value) ? null : 'Enter a Tcl package version' });
        if (!version) return;
        try { await new TclProjectTemplates().createProject('package', path.join(workspaceFolder, name), { name, version });
            const document = await vscode.workspace.openTextDocument(path.join(workspaceFolder, name, 'Package.tcl')); await vscode.window.showTextDocument(document);
        } catch (error) { vscode.window.showErrorMessage(`Failed to create package: ${error}`); }
    }
    public dispose(): void { this.disposed = true; this.generation++; this.subscriptions.forEach(item => item.dispose()); this.changes.dispose(); this.outputChannel.dispose(); }
}
