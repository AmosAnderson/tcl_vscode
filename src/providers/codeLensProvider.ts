import * as vscode from 'vscode';
import { analyzeDocument } from '../analysis/documentAnalysis';
import { WorkspaceIndex } from '../analysis/workspaceIndex';

class ReferenceLens extends vscode.CodeLens {
    constructor(range: vscode.Range, readonly target: string, readonly document: vscode.TextDocument) { super(range); }
}
/** Counts are resolved through the index's shared occurrence cache, once per version. */
export class TclCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
    private changes = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses = this.changes.event;
    private subscriptions: vscode.Disposable[] = [];
    constructor(private index = WorkspaceIndex.getInstance(), private testLenses?: (document: vscode.TextDocument) => vscode.CodeLens[], testsChanged?: vscode.Event<void>) {
        this.subscriptions.push(index.onDidChange(() => this.changes.fire()), vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('tcl.codeLens')) this.changes.fire(); }));
        if (testsChanged) this.subscriptions.push(testsChanged(() => this.changes.fire()));
    }
    provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.CodeLens[] {
        if (token.isCancellationRequested) return [];
        const config = vscode.workspace.getConfiguration('tcl', document.uri);
        if (!config.get<boolean>('codeLens.enable', true)) return [];
        const lenses: vscode.CodeLens[] = [];
        if (config.get<boolean>('codeLens.references', true)) for (const declaration of analyzeDocument(document).declarations) {
            if (declaration.kind === 'procedure' || declaration.kind === 'method' && !['constructor', 'destructor'].includes(declaration.name)) lenses.push(new ReferenceLens(analyzeDocument(document).declarationRange(declaration), declaration.qualifiedName, document));
        }
        if (config.get<boolean>('codeLens.tests', true) && this.testLenses) lenses.push(...this.testLenses(document));
        return lenses;
    }
    async resolveCodeLens(lens: vscode.CodeLens, token: vscode.CancellationToken): Promise<vscode.CodeLens> {
        if (!(lens instanceof ReferenceLens)) return lens;
        await this.index.ready(token);
        if (token.isCancellationRequested || lens.document.isClosed) return lens;
        const locations = this.index.getCallOccurrences(lens.target, lens.document, false).map(item => new vscode.Location(item.uri, item.range));
        lens.command = { title: `${locations.length} reference${locations.length === 1 ? '' : 's'}`, command: 'editor.action.showReferences', arguments: [lens.document.uri, lens.range.start, locations] };
        return lens;
    }
    dispose(): void { this.subscriptions.forEach(disposable => disposable.dispose()); this.changes.dispose(); }
}
