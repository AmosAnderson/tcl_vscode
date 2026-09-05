import * as vscode from 'vscode';
import { WorkspaceIndex } from '../analysis/workspaceIndex';
import { SymbolTableCache } from '../analysis/symbolTableCache';
import { featureSymbolAt } from './languageFeatures';

export class TclDefinitionProvider implements vscode.DefinitionProvider {
    async provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.Location[] | null> {
        const index = WorkspaceIndex.getInstance();
        await index.ready(token);
        if (token.isCancellationRequested) return null;
        const symbol = featureSymbolAt(document, position, index);
        if (!symbol) return null;
        if (symbol.variableName) {
            const definitions = index.getVariableOccurrences(symbol.variableName, document).filter(item => item.declaration);
            if (definitions.length) return definitions.map(item => new vscode.Location(item.uri, item.range));
        }
        if (symbol.binding) return [new vscode.Location(document.uri, symbol.binding.range)];
        return symbol.declarations.map(item => new vscode.Location(item.analysis.document.uri, item.analysis.declarationRange(item.declaration)));
    }
}

export class TclReferenceProvider implements vscode.ReferenceProvider {
    constructor(_symbolTableCache?: SymbolTableCache) {}
    async provideReferences(document: vscode.TextDocument, position: vscode.Position, context: vscode.ReferenceContext, token: vscode.CancellationToken): Promise<vscode.Location[]> {
        const index = WorkspaceIndex.getInstance();
        await index.ready(token);
        if (token.isCancellationRequested) return [];
        const symbol = featureSymbolAt(document, position, index);
        if (!symbol) return [];
        if (symbol.variableName) return index.getVariableOccurrences(symbol.variableName, document, context.includeDeclaration).map(item => new vscode.Location(item.uri, item.range));
        if (symbol.binding) return [...(context.includeDeclaration ? [symbol.binding.range] : []), ...symbol.binding.references].map(range => new vscode.Location(document.uri, range));
        if (symbol.target) return index.getCallOccurrences(symbol.target, document, context.includeDeclaration).map(item => new vscode.Location(item.uri, item.range));
        return [];
    }
}
