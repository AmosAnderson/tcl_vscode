import * as vscode from 'vscode';
import { analyzeDocument, Declaration } from '../analysis/documentAnalysis';
import { WorkspaceIndex } from '../analysis/workspaceIndex';

export function declarationKind(declaration: Declaration): vscode.SymbolKind {
    return declaration.kind === 'namespace' ? vscode.SymbolKind.Namespace : declaration.kind === 'class' ? vscode.SymbolKind.Class : declaration.kind === 'method' ? vscode.SymbolKind.Method : vscode.SymbolKind.Function;
}
export class TclDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
    provideDocumentSymbols(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.DocumentSymbol[] {
        const analysis = analyzeDocument(document);
        const result: vscode.DocumentSymbol[] = [];
        const entries: { declaration: Declaration; symbol: vscode.DocumentSymbol }[] = [];
        for (const declaration of analysis.declarations) {
            if (token.isCancellationRequested) return [];
            const symbol = new vscode.DocumentSymbol(declaration.kind === 'lambda' ? '(lambda)' : declaration.name, declaration.params ? `{${declaration.params.value}}` : declaration.kind, declarationKind(declaration), analysis.range(declaration.command.start, declaration.command.end), analysis.declarationRange(declaration));
            const parent = entries.filter(entry => entry.declaration.body && entry.declaration.body.contentStart <= declaration.command.start && entry.declaration.body.contentEnd >= declaration.command.end).sort((a, b) => b.declaration.command.start - a.declaration.command.start)[0];
            if (parent) parent.symbol.children.push(symbol); else result.push(symbol);
            entries.push({ declaration, symbol });
        }
        return result;
    }
}
export class TclWorkspaceSymbolProvider implements vscode.WorkspaceSymbolProvider {
    async provideWorkspaceSymbols(query: string, token: vscode.CancellationToken): Promise<vscode.SymbolInformation[]> {
        const index = WorkspaceIndex.getInstance();
        await index.ready(token);
        if (token.isCancellationRequested) return [];
        return index.getDeclarations().filter(item => item.declaration.kind !== 'lambda' && item.declaration.qualifiedName.toLowerCase().includes(query.toLowerCase())).map(({ declaration, analysis }) => new vscode.SymbolInformation(declaration.name, declarationKind(declaration), declaration.className ?? declaration.namespace, new vscode.Location(analysis.document.uri, analysis.declarationRange(declaration))));
    }
}
