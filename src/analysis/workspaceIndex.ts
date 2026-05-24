import * as vscode from 'vscode';

export interface IndexedProcedure {
    name: string;
    qualifiedName: string;
    params: string[];
    line: number;
    uri: vscode.Uri;
    namespace: string;
}

export interface IndexedNamespace {
    name: string;
    qualifiedName: string;
    line: number;
    uri: vscode.Uri;
}

export interface IndexedVariable {
    name: string;
    line: number;
    uri: vscode.Uri;
    scope: 'global' | 'namespace';
}

export interface FileSymbols {
    procedures: IndexedProcedure[];
    namespaces: IndexedNamespace[];
    variables: IndexedVariable[];
    lastModified: number;
}

const TCL_GLOB = '**/*.{tcl,tk,tm,test}';
const EXCLUDE_GLOB = '**/node_modules/**';
const DEBOUNCE_MS = 500;

export class WorkspaceIndex implements vscode.Disposable {
    private static instance: WorkspaceIndex;

    static getInstance(): WorkspaceIndex {
        if (!WorkspaceIndex.instance) {
            WorkspaceIndex.instance = new WorkspaceIndex();
        }
        return WorkspaceIndex.instance;
    }

    private fileIndex: Map<string, FileSymbols> = new Map();
    private watcher: vscode.FileSystemWatcher | undefined;
    private disposables: vscode.Disposable[] = [];
    private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
    private initialized = false;

    private constructor() {}

    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }
        this.initialized = true;

        // Scan workspace in the background — don't block activation
        this.scanWorkspace().catch(err => {
            console.error('WorkspaceIndex: initial scan failed:', err);
        });

        // Watch for file-system changes to TCL files
        this.watcher = vscode.workspace.createFileSystemWatcher(TCL_GLOB);
        this.watcher.onDidChange(uri => this.onFileChanged(uri));
        this.watcher.onDidCreate(uri => this.onFileCreated(uri));
        this.watcher.onDidDelete(uri => this.onFileDeleted(uri));
        this.disposables.push(this.watcher);

        // Also re-index open documents when they are edited (debounced)
        const docChangeDisposable = vscode.workspace.onDidChangeTextDocument(e => {
            if (this.isTclDocument(e.document)) {
                this.debouncedReindex(e.document.uri);
            }
        });
        this.disposables.push(docChangeDisposable);
    }

    dispose(): void {
        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer);
        }
        this.debounceTimers.clear();

        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables = [];
        this.fileIndex.clear();
        this.initialized = false;
    }

    // ── Queries ──────────────────────────────────────────────────────

    getProcedures(query?: string): IndexedProcedure[] {
        const results: IndexedProcedure[] = [];
        for (const symbols of this.fileIndex.values()) {
            results.push(...symbols.procedures);
        }
        if (query) {
            const lower = query.toLowerCase();
            return results.filter(p => p.name.toLowerCase().includes(lower));
        }
        return results;
    }

    getNamespaces(query?: string): IndexedNamespace[] {
        const results: IndexedNamespace[] = [];
        for (const symbols of this.fileIndex.values()) {
            results.push(...symbols.namespaces);
        }
        if (query) {
            const lower = query.toLowerCase();
            return results.filter(n => n.name.toLowerCase().includes(lower));
        }
        return results;
    }

    getVariables(query?: string): IndexedVariable[] {
        const results: IndexedVariable[] = [];
        for (const symbols of this.fileIndex.values()) {
            results.push(...symbols.variables);
        }
        if (query) {
            const lower = query.toLowerCase();
            return results.filter(v => v.name.toLowerCase().includes(lower));
        }
        return results;
    }

    getFileSymbols(uri: vscode.Uri): FileSymbols | undefined {
        return this.fileIndex.get(uri.toString());
    }

    /** Return all indexed file URIs (useful for reference scanning). */
    getIndexedFiles(): vscode.Uri[] {
        return Array.from(this.fileIndex.keys()).map(key => vscode.Uri.parse(key));
    }

    // ── Internal ─────────────────────────────────────────────────────

    private async scanWorkspace(): Promise<void> {
        const files = await vscode.workspace.findFiles(TCL_GLOB, EXCLUDE_GLOB);
        const BATCH_SIZE = 50;
        for (let i = 0; i < files.length; i += BATCH_SIZE) {
            const batch = files.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(uri => this.indexFile(uri)));
        }
    }

    private async indexFile(uri: vscode.Uri): Promise<void> {
        try {
            const symbols = await this.parseFile(uri);
            this.fileIndex.set(uri.toString(), symbols);
        } catch {
            // File may have been deleted or become inaccessible
        }
    }

    async parseFile(uri: vscode.Uri): Promise<FileSymbols> {
        let text: string;

        // Prefer the in-memory version if the file is open in an editor
        const openDoc = vscode.workspace.textDocuments.find(
            d => d.uri.toString() === uri.toString()
        );
        if (openDoc) {
            text = openDoc.getText();
        } else {
            const bytes = await vscode.workspace.fs.readFile(uri);
            text = Buffer.from(bytes).toString('utf8');
        }

        const procedures: IndexedProcedure[] = [];
        const namespaces: IndexedNamespace[] = [];
        const variables: IndexedVariable[] = [];

        const lines = text.split('\n');

        // Namespace tracking with brace depth (mirrors symbolProvider.ts)
        const nsStack: { name: string; qualifiedName: string; depth: number }[] = [];
        let braceDepth = 0;

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const line = lines[lineNum];

            // Update brace depth and pop namespaces as they close
            for (const ch of line) {
                if (ch === '{') {
                    braceDepth++;
                } else if (ch === '}') {
                    braceDepth--;
                    while (
                        nsStack.length > 0 &&
                        braceDepth < nsStack[nsStack.length - 1].depth
                    ) {
                        nsStack.pop();
                    }
                }
            }

            const currentNs = nsStack.length > 0
                ? nsStack[nsStack.length - 1].qualifiedName
                : '::';

            // Match namespace definitions
            const nsMatch = line.match(
                /^\s*namespace\s+eval\s+((?:::)?[a-zA-Z_][a-zA-Z0-9_:]*)\s*\{/
            );
            if (nsMatch) {
                const rawName = nsMatch[1];
                const qualifiedName = rawName.startsWith('::')
                    ? rawName
                    : (currentNs === '::' ? '::' + rawName : currentNs + '::' + rawName);

                namespaces.push({
                    name: rawName,
                    qualifiedName,
                    line: lineNum,
                    uri,
                });

                nsStack.push({ name: rawName, qualifiedName, depth: braceDepth });
            }

            // Match procedure definitions
            const procMatch = line.match(
                /^\s*proc\s+([a-zA-Z_][a-zA-Z0-9_:]*)\s*\{/
            );
            if (procMatch) {
                const procName = procMatch[1];

                // Extract params from the same line if possible
                const simpleArgsMatch = line.match(
                    /^\s*proc\s+[a-zA-Z_][a-zA-Z0-9_:]*\s*\{([^}]*)\}/
                );
                const params = simpleArgsMatch
                    ? simpleArgsMatch[1].trim().split(/\s+/).filter(Boolean)
                    : [];

                const activeNs = nsStack.length > 0
                    ? nsStack[nsStack.length - 1].qualifiedName
                    : '::';

                const qualifiedName = procName.includes('::')
                    ? (procName.startsWith('::') ? procName : '::' + procName)
                    : (activeNs === '::' ? '::' + procName : activeNs + '::' + procName);

                procedures.push({
                    name: procName,
                    qualifiedName,
                    params,
                    line: lineNum,
                    uri,
                    namespace: activeNs,
                });
            }

            // Match namespace-level variable declarations
            const varMatch = line.match(/^\s*variable\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
            if (varMatch && nsStack.length > 0) {
                variables.push({
                    name: varMatch[1],
                    line: lineNum,
                    uri,
                    scope: 'namespace',
                });
            }

            // Match global-level set for global variables: set ::name value
            const globalSetMatch = line.match(/^\s*set\s+::([a-zA-Z_][a-zA-Z0-9_:]*)/);
            if (globalSetMatch && nsStack.length === 0) {
                variables.push({
                    name: globalSetMatch[1],
                    line: lineNum,
                    uri,
                    scope: 'global',
                });
            }
        }

        return { procedures, namespaces, variables, lastModified: Date.now() };
    }

    // ── File-watcher callbacks ───────────────────────────────────────

    private onFileChanged(uri: vscode.Uri): void {
        this.indexFile(uri);
    }

    private onFileCreated(uri: vscode.Uri): void {
        this.indexFile(uri);
    }

    private onFileDeleted(uri: vscode.Uri): void {
        this.fileIndex.delete(uri.toString());
    }

    // ── Helpers ──────────────────────────────────────────────────────

    private debouncedReindex(uri: vscode.Uri): void {
        const key = uri.toString();
        const existing = this.debounceTimers.get(key);
        if (existing) {
            clearTimeout(existing);
        }
        this.debounceTimers.set(
            key,
            setTimeout(() => {
                this.debounceTimers.delete(key);
                this.indexFile(uri);
            }, DEBOUNCE_MS)
        );
    }

    private isTclDocument(doc: vscode.TextDocument): boolean {
        return doc.languageId === 'tcl' || /\.(tcl|tk|tm|test)$/.test(doc.fileName);
    }

    /** Reset the singleton — only for testing. */
    static resetInstance(): void {
        if (WorkspaceIndex.instance) {
            WorkspaceIndex.instance.dispose();
            WorkspaceIndex.instance = undefined as unknown as WorkspaceIndex;
        }
    }
}
