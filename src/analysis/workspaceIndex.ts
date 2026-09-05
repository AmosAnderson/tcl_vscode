import * as vscode from 'vscode';
import { analyzeDocument, Declaration, DocumentAnalysis, invalidateAnalysis } from './documentAnalysis';
import { CommandContext, NamespaceResolution, qualifyTclName, resolveProcedureName } from './procedures';
import { isStaticWord, TclWord } from '../utils/tclParser';
import { SymbolEntry } from './symbolTable';

export interface IndexedProcedure { name: string; qualifiedName: string; params: string[]; line: number; uri: vscode.Uri; namespace: string; declaration?: Declaration; }
export interface IndexedNamespace { name: string; qualifiedName: string; line: number; uri: vscode.Uri; }
export interface IndexedVariable { name: string; line: number; uri: vscode.Uri; scope: 'global' | 'namespace'; qualifiedName?: string; }
export interface FileSymbols { procedures: IndexedProcedure[]; namespaces: IndexedNamespace[]; variables: IndexedVariable[]; lastModified: number; analysis?: DocumentAnalysis; }
export interface IndexedDeclaration { analysis: DocumentAnalysis; declaration: Declaration; }
export interface ResolvedCall { target: string; word: TclWord; argumentStart: number; }
export interface SymbolOccurrence { uri: vscode.Uri; range: vscode.Range; declaration: boolean; }
interface ResolutionEnvironment {
    key: string;
    analyses: DocumentAnalysis[];
    declarations: IndexedDeclaration[];
    resolution: NamespaceResolution;
    names: Set<string>;
    classes: Set<string>;
    methods: Set<string>;
    objects: Map<string, Set<string>>;
    variableObjects: Map<string, Set<string>>;
    superclasses: Map<string, string[]>;
}
const TCL_GLOB = '**/*.{tcl,tk,tm,test}';

/** One versioned syntax index shared by all workspace language providers. */
export class WorkspaceIndex implements vscode.Disposable {
    private static instance: WorkspaceIndex | undefined;
    static getInstance(): WorkspaceIndex { return this.instance ??= new WorkspaceIndex(); }
    static resetInstance(): void { this.instance?.dispose(); this.instance = undefined; }
    private fileIndex = new Map<string, FileSymbols>();
    private disposables: vscode.Disposable[] = [];
    private timers = new Map<string, ReturnType<typeof setTimeout>>();
    private generations = new Map<string, number>();
    private initialScan?: Promise<void>;
    private disposed = false;
    private changes = new vscode.EventEmitter<void>();
    readonly onDidChange = this.changes.event;
    private revision = 0;
    private occurrenceCache?: { key: string; calls: Map<string, SymbolOccurrence[]> };
    private semanticCache?: ResolutionEnvironment;
    private deleted = new Set<string>();
    private constructor() {}

    initialize(): Promise<void> {
        if (this.initialScan) return this.initialScan;
        this.disposed = false;
        const watcher = vscode.workspace.createFileSystemWatcher(TCL_GLOB);
        this.disposables.push(watcher,
            watcher.onDidChange(uri => { void this.indexFile(uri); }),
            watcher.onDidCreate(uri => { this.deleted.delete(uri.toString()); void this.indexFile(uri); }),
            watcher.onDidDelete(uri => { this.deleted.add(uri.toString()); this.remove(uri); }),
            vscode.workspace.onDidChangeTextDocument(event => {
                if (!this.isTclDocument(event.document)) return;
                invalidateAnalysis(event.document.uri);
                this.changed();
                this.schedule(event.document.uri);
            }),
            vscode.workspace.onDidOpenTextDocument(document => { if (this.isTclDocument(document)) this.schedule(document.uri); }),
            vscode.workspace.onDidCloseTextDocument(document => {
                invalidateAnalysis(document.uri);
                if (this.isTclDocument(document)) { this.remove(document.uri); if (document.uri.scheme !== 'untitled') this.schedule(document.uri); }
            }),
            vscode.workspace.onDidChangeWorkspaceFolders(() => { void this.rescan(); }),
            vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('tcl.analysis.exclude') || event.affectsConfiguration('files.exclude')) void this.rescan(); })
        );
        this.initialScan = this.rescan().catch(error => { console.error('Tcl workspace indexing failed', error); });
        return this.initialScan;
    }
    async ready(token?: vscode.CancellationToken): Promise<void> {
        if (token?.isCancellationRequested) return;
        const ready = this.initialize();
        if (!token) { await ready; return; }
        let cancellation: vscode.Disposable | undefined;
        try { await Promise.race([ready, new Promise<void>(resolve => { cancellation = token.onCancellationRequested(resolve); })]); }
        finally { cancellation?.dispose(); }
    }
    dispose(): void {
        this.disposed = true;
        for (const timer of this.timers.values()) clearTimeout(timer);
        this.timers.clear();
        this.disposables.forEach(disposable => disposable.dispose());
        this.disposables = [];
        this.fileIndex.clear();
        this.generations.clear();
        this.initialScan = undefined;
        this.occurrenceCache = undefined;
        this.semanticCache = undefined;
        this.deleted.clear();
        this.changes.dispose();
        invalidateAnalysis();
        if (WorkspaceIndex.instance === this) WorkspaceIndex.instance = undefined;
    }
    private changed(): void { this.revision++; this.occurrenceCache = undefined; this.semanticCache = undefined; this.changes.fire(); }
    private schedule(uri: vscode.Uri): void {
        const key = uri.toString();
        const existing = this.timers.get(key);
        if (existing) clearTimeout(existing);
        this.timers.set(key, setTimeout(() => { this.timers.delete(key); void this.indexFile(uri); }, 150));
    }
    private excluded(uri: vscode.Uri): boolean {
        const configured = this.exclusions(uri);
        const relative = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
        return configured.some(pattern => {
            const regex = pattern.split('**').map(part => part.split('*').map(text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*');
            return new RegExp(`^(?:${regex}|${regex.replace(/^\.\*\//, '')})$`).test(relative);
        });
    }
    private exclusions(uri?: vscode.Uri): string[] {
        const configured = vscode.workspace.getConfiguration('tcl', uri).get<string[]>('analysis.exclude', ['**/node_modules/**', '**/.git/**']);
        const files = vscode.workspace.getConfiguration('files', uri).get<Record<string, unknown>>('exclude', {});
        return [...configured, ...Object.keys(files).filter(key => files[key] === true)];
    }
    private async rescan(): Promise<void> {
        for (const key of this.fileIndex.keys()) {
            const uri = vscode.Uri.parse(key);
            if (!vscode.workspace.getWorkspaceFolder(uri) || this.excluded(uri)) this.remove(uri);
        }
        const excludes = this.exclusions();
        const files = await vscode.workspace.findFiles(TCL_GLOB, excludes.length ? `{${excludes.join(',')}}` : undefined);
        for (let i = 0; i < files.length && !this.disposed; i += 32) await Promise.all(files.slice(i, i + 32).map(uri => this.indexFile(uri)));
        if (!this.disposed) this.changed();
    }
    private async indexFile(uri: vscode.Uri): Promise<void> {
        if (this.disposed || this.deleted.has(uri.toString()) || this.excluded(uri)) return;
        const key = uri.toString();
        const generation = (this.generations.get(key) ?? 0) + 1;
        this.generations.set(key, generation);
        try {
            const symbols = await this.parseFile(uri);
            if (!this.disposed && this.generations.get(key) === generation) { this.fileIndex.set(key, symbols); this.changed(); }
        } catch { if (this.generations.get(key) === generation) this.remove(uri); }
    }
    private remove(uri: vscode.Uri): void {
        const key = uri.toString();
        this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
        const timer = this.timers.get(key);
        if (timer) clearTimeout(timer);
        this.timers.delete(key);
        this.fileIndex.delete(key);
        invalidateAnalysis(uri);
        this.changed();
    }
    async parseFile(uri: vscode.Uri): Promise<FileSymbols> {
        const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString()) ?? await vscode.workspace.openTextDocument(uri);
        const analysis = analyzeDocument(document);
        return this.fileSymbols(analysis);
    }
    private fileSymbols(analysis: DocumentAnalysis): FileSymbols {
        return {
            analysis, lastModified: Date.now(),
            procedures: analysis.declarations.filter(declaration => declaration.kind === 'procedure').map(declaration => ({ name: declaration.name, qualifiedName: declaration.qualifiedName, params: declaration.parameters.map(parameter => parameter.name), line: analysis.document.positionAt(declaration.nameWord.start).line, uri: analysis.document.uri, namespace: declaration.namespace, declaration })),
            namespaces: analysis.declarations.filter(declaration => declaration.kind === 'namespace').map(declaration => ({ name: declaration.name, qualifiedName: declaration.qualifiedName, line: analysis.document.positionAt(declaration.nameWord.start).line, uri: analysis.document.uri })),
            variables: analysis.table.getAllSymbols().filter(symbol => symbol.qualifiedName && symbol.kind !== 'procedure').map(symbol => ({ name: symbol.name, qualifiedName: symbol.qualifiedName, line: symbol.range.start.line, uri: analysis.document.uri, scope: symbol.scope === 'global' ? 'global' : 'namespace' })),
        };
    }
    getAnalyses(current?: vscode.TextDocument): DocumentAnalysis[] {
        const results = new Map<string, DocumentAnalysis>();
        for (const [key, symbols] of this.fileIndex) if (symbols.analysis) results.set(key, symbols.analysis);
        for (const document of vscode.workspace.textDocuments) if (!document.isClosed && !this.deleted.has(document.uri.toString()) && this.isTclDocument(document) && !this.excluded(document.uri)) {
            if (document.uri.scheme === 'untitled' || vscode.workspace.getWorkspaceFolder(document.uri) || document === current) results.set(document.uri.toString(), analyzeDocument(document));
        }
        if (current) results.set(current.uri.toString(), analyzeDocument(current));
        return [...results.values()];
    }
    getDeclarations(current?: vscode.TextDocument): IndexedDeclaration[] { return this.getAnalyses(current).flatMap(analysis => analysis.declarations.map(declaration => ({ analysis, declaration }))); }
    getProcedures(query?: string): IndexedProcedure[] { return this.getAnalyses().flatMap(analysis => this.fileSymbols(analysis).procedures).filter(item => !query || item.qualifiedName.toLowerCase().includes(query.toLowerCase())); }
    getNamespaces(query?: string): IndexedNamespace[] { return this.getAnalyses().flatMap(analysis => this.fileSymbols(analysis).namespaces).filter(item => !query || item.qualifiedName.toLowerCase().includes(query.toLowerCase())); }
    getVariables(query?: string): IndexedVariable[] { return this.getAnalyses().flatMap(analysis => this.fileSymbols(analysis).variables).filter(item => !query || item.name.toLowerCase().includes(query.toLowerCase())); }
    getFileSymbols(uri: vscode.Uri): FileSymbols | undefined {
        const open = vscode.workspace.textDocuments.find(document => document.uri.toString() === uri.toString());
        return open ? this.fileSymbols(analyzeDocument(open)) : this.fileIndex.get(uri.toString());
    }
    getIndexedFiles(): vscode.Uri[] { return this.getAnalyses().map(analysis => analysis.document.uri); }
    private environment(current?: vscode.TextDocument): ResolutionEnvironment {
        const analyses = this.getAnalyses(current);
        const key = `${this.revision}:${analyses.map(analysis => `${analysis.document.uri}:${analysis.document.version}`).join('|')}`;
        if (this.semanticCache?.key === key) return this.semanticCache;
        const declarations = analyses.flatMap(analysis => analysis.declarations.map(declaration => ({ analysis, declaration })));
        const resolution: NamespaceResolution = { imports: [], paths: [], exports: [] };
        for (const analysis of analyses) { resolution.imports.push(...analysis.resolution.imports); resolution.exports.push(...analysis.resolution.exports); resolution.paths.push(...analysis.resolution.paths); }
        const names = new Set(declarations.filter(item => item.declaration.kind === 'procedure').map(item => item.declaration.qualifiedName));
        const classes = new Set(declarations.filter(item => item.declaration.kind === 'class').map(item => item.declaration.qualifiedName));
        const methods = new Set(declarations.filter(item => item.declaration.kind === 'method').map(item => item.declaration.qualifiedName));
        const objects = new Map<string, Set<string>>();
        const variableObjects = new Map<string, Set<string>>();
        const superclasses = new Map<string, string[]>();
        const object = (name: string, className: string) => { if (!objects.has(name)) objects.set(name, new Set()); objects.get(name)!.add(className); };
        for (const analysis of analyses) {
            for (const [name, className] of analysis.objects) object(name, className);
            for (const creation of analysis.contexts) {
                const words = creation.command.words;
                if (creation.className && words[0]?.value === 'superclass' && words.slice(1).every(isStaticWord)) {
                    superclasses.set(creation.className, words.slice(1).map(word => resolveProcedureName(word.value, creation.namespace, classes, resolution)).filter((name): name is string => !!name));
                }
                if (words[0]?.value.replace(/^::/, '') === 'set' && words.length === 3 && isStaticWord(words[1])) {
                    const symbol = analysis.table.getSymbolAt(analysis.document.positionAt(words[1].contentStart));
                    if (symbol) {
                        const key = this.bindingKey(analysis, symbol);
                        if (!variableObjects.has(key)) variableObjects.set(key, new Set());
                        const value = words[2];
                        const constructor = value.substitutions.length === 1 && value.commandSubstitutions.length === 1 && value.commandSubstitutions[0].start === value.contentStart && value.commandSubstitutions[0].end === value.contentEnd ? value.substitutions[0].words : [];
                        const className = isStaticWord(constructor[0]) && ['new', 'create'].includes(constructor[1]?.value) ? resolveProcedureName(constructor[0].value, creation.namespace, classes, resolution) : undefined;
                        variableObjects.get(key)!.add(className ?? '<unknown>');
                    }
                }
                if (!isStaticWord(words[0]) || words[1]?.value !== 'create' || !isStaticWord(words[2])) continue;
                const className = resolveProcedureName(words[0].value, creation.namespace, classes, resolution);
                if (className) object(qualifyTclName(words[2].value, creation.namespace), className);
            }
        }
        return this.semanticCache = { key, analyses, declarations, resolution, names, classes, methods, objects, variableObjects, superclasses };
    }
    private bindingKey(analysis: DocumentAnalysis, symbol: SymbolEntry): string { return symbol.qualifiedName ?? `${analysis.document.uri}#${analysis.document.offsetAt(symbol.range.start)}`; }
    private receiver(context: CommandContext, environment: ResolutionEnvironment, analysis?: DocumentAnalysis): string | undefined {
        const word = context.command.words[0];
        if (!word) return undefined;
        const value = word.value, contentStart = word.contentStart;
        let receivers: Set<string> | undefined;
        if (isStaticWord(word)) receivers = word.value === 'my' && context.className ? new Set([context.className]) : environment.objects.get(qualifyTclName(word.value, context.namespace));
        else if (analysis && /^\$(?:\{[\p{L}\p{M}\p{N}_:]+\}|[\p{L}\p{M}\p{N}_:]+)$/u.test(value)) {
            const symbol = analysis.table.getSymbolAt(analysis.document.positionAt(contentStart + (value.startsWith('${') ? 2 : 1)));
            if (symbol) receivers = environment.variableObjects.get(this.bindingKey(analysis, symbol));
        }
        return receivers?.size === 1 && !receivers.has('<unknown>') ? [...receivers][0] : undefined;
    }
    private methodTarget(receiver: string, name: string, environment: ResolutionEnvironment, visited = new Set<string>()): string | undefined {
        if (visited.has(receiver)) return undefined;
        visited.add(receiver);
        const direct = `${receiver}#${name}`;
        if (environment.methods.has(direct)) return direct;
        const inherited = new Set((environment.superclasses.get(receiver) ?? []).map(parent => this.methodTarget(parent, name, environment, new Set(visited))).filter((target): target is string => !!target));
        return inherited.size === 1 ? [...inherited][0] : undefined;
    }
    getResolution(current?: vscode.TextDocument): NamespaceResolution { return this.environment(current).resolution; }
    resolveCall(context: CommandContext, current?: vscode.TextDocument): ResolvedCall | undefined { return this.resolveWith(context, this.environment(current), current ? analyzeDocument(current) : undefined); }
    getMethodsForReceiver(context: CommandContext, current?: vscode.TextDocument): Declaration[] {
        const environment = this.environment(current);
        const receiver = this.receiver(context, environment, current ? analyzeDocument(current) : undefined);
        if (!receiver) return [];
        return environment.declarations.filter(item => item.declaration.kind === 'method' && this.methodTarget(receiver, item.declaration.name, environment) === item.declaration.qualifiedName).map(item => item.declaration);
    }
    private resolveWith(context: CommandContext, environment: ResolutionEnvironment, analysis?: DocumentAnalysis): ResolvedCall | undefined {
        const w = context.command.words;
        if (!w[0] || w.some(word => word.expanded)) return undefined;
        const procedure = isStaticWord(w[0]) ? resolveProcedureName(w[0].value, context.namespace, environment.names, environment.resolution) : undefined;
        if (procedure) return { target: procedure, word: w[0], argumentStart: 1 };
        const className = isStaticWord(w[0]) ? resolveProcedureName(w[0].value, context.namespace, environment.classes, environment.resolution) : undefined;
        if (className && (w[1]?.value === 'new' || w[1]?.value === 'create')) return { target: className, word: w[0], argumentStart: w[1].value === 'create' ? 3 : 2 };
        if (!isStaticWord(w[1])) return undefined;
        const receiver = this.receiver(context, environment, analysis);
        const target = receiver ? this.methodTarget(receiver, w[1].value, environment) : undefined;
        return target ? { target, word: w[1], argumentStart: 2 } : undefined;
    }
    getCallOccurrences(target: string, current?: vscode.TextDocument, includeDeclaration = true): SymbolOccurrence[] {
        const environment = this.environment(current);
        const { key, analyses, declarations } = environment;
        if (this.occurrenceCache?.key !== key) {
            const calls = new Map<string, SymbolOccurrence[]>();
            const add = (name: string, occurrence: SymbolOccurrence) => { if (!calls.has(name)) calls.set(name, []); calls.get(name)!.push(occurrence); };
            for (const { analysis, declaration } of declarations) add(declaration.qualifiedName, { uri: analysis.document.uri, range: analysis.declarationRange(declaration), declaration: true });
            for (const analysis of analyses) for (const context of analysis.contexts) {
                const call = this.resolveWith(context, environment, analysis);
                if (call) add(call.target, { uri: analysis.document.uri, range: analysis.range(call.word.contentStart, call.word.contentEnd), declaration: false });
                const words = context.command.words;
                const name = words[0]?.value.replace(/^::/, '');
                const classWords = ['oo::define', 'oo::objdefine'].includes(name) ? words.slice(1, 2) : name === 'superclass' && context.className ? words.slice(1) : [];
                for (const word of classWords) if (isStaticWord(word)) {
                    const target = resolveProcedureName(word.value, context.namespace, environment.classes, environment.resolution);
                    if (target) add(target, { uri: analysis.document.uri, range: analysis.range(word.contentStart, word.contentEnd), declaration: false });
                }
            }
            this.occurrenceCache = { key, calls };
        }
        return (this.occurrenceCache.calls.get(target) ?? []).filter(occurrence => includeDeclaration || !occurrence.declaration);
    }
    getVariableOccurrences(qualifiedName: string, current?: vscode.TextDocument, includeDeclaration = true): SymbolOccurrence[] {
        const results: SymbolOccurrence[] = [];
        for (const analysis of this.getAnalyses(current)) {
            for (const symbol of analysis.table.getAllSymbols()) {
                if (symbol.qualifiedName === qualifiedName || symbol.aliasTarget === qualifiedName) {
                    if (includeDeclaration) results.push({ uri: analysis.document.uri, range: symbol.range, declaration: true });
                    results.push(...symbol.references.map(range => ({ uri: analysis.document.uri, range, declaration: false })));
                }
            }
            for (const usage of analysis.table.getVariableUsages()) if (!usage.symbol && usage.qualifiedName === qualifiedName) results.push({ uri: analysis.document.uri, range: usage.range, declaration: false });
        }
        const seen = new Set<string>();
        return results.filter(item => { const key = `${item.uri}:${item.range.start.line}:${item.range.start.character}`; if (seen.has(key)) return false; seen.add(key); return true; });
    }
    private isTclDocument(document: vscode.TextDocument): boolean { return document.languageId === 'tcl' || /\.(tcl|tk|tm|test)$/.test(document.fileName); }
}
