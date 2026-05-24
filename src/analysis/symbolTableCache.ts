import * as vscode from 'vscode';
import { DocumentSymbolTable } from './symbolTable';

/**
 * Per-document cache for DocumentSymbolTable instances.
 * Automatically invalidates when documents change.
 */
export class SymbolTableCache implements vscode.Disposable {
    private cache = new Map<string, { table: DocumentSymbolTable; version: number }>();
    private disposables: vscode.Disposable[] = [];

    /** Get or create a parsed symbol table for the given document. */
    getOrCreate(document: vscode.TextDocument): DocumentSymbolTable {
        const key = document.uri.toString();
        const cached = this.cache.get(key);

        if (cached && cached.version === document.version) {
            return cached.table;
        }

        const table = new DocumentSymbolTable(document);
        table.parse();
        this.cache.set(key, { table, version: document.version });
        return table;
    }

    /** Invalidate the cached symbol table for a URI. */
    invalidate(uri: vscode.Uri): void {
        this.cache.delete(uri.toString());
    }

    /** Listen to document changes and invalidate stale entries. */
    registerListeners(context: vscode.ExtensionContext): void {
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument(event => {
                this.invalidate(event.document.uri);
            }),
            vscode.workspace.onDidCloseTextDocument(doc => {
                this.invalidate(doc.uri);
            })
        );
        context.subscriptions.push(...this.disposables);
    }

    dispose(): void {
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables = [];
        this.cache.clear();
    }
}
