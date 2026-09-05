import * as vscode from 'vscode';
import { analyzeDocument, DocumentAnalysis } from '../analysis/documentAnalysis';
import { IndexedDeclaration, WorkspaceIndex } from '../analysis/workspaceIndex';
import { SymbolEntry } from '../analysis/symbolTable';

export interface FeatureSymbol {
    range: vscode.Range;
    analysis: DocumentAnalysis;
    binding?: SymbolEntry;
    variableName?: string;
    target?: string;
    declarations: IndexedDeclaration[];
}
export function featureSymbolAt(document: vscode.TextDocument, position: vscode.Position, index = WorkspaceIndex.getInstance()): FeatureSymbol | undefined {
    const analysis = analyzeDocument(document);
    const offset = document.offsetAt(position);
    const binding = analysis.table.getSymbolAt(position);
    if (binding && binding.kind !== 'procedure') {
        const range = [binding.range, ...binding.references].find(candidate => candidate.contains(position))!;
        return { analysis, binding, variableName: binding.aliasTarget ?? binding.qualifiedName, range, declarations: [] };
    }
    const usage = analysis.table.getVariableUsages().find(item => item.range.contains(position));
    if (usage?.qualifiedName) return { analysis, variableName: usage.qualifiedName, range: usage.range, declarations: [] };
    const declaration = analysis.declarationAt(offset);
    if (declaration) return { analysis, target: declaration.qualifiedName, range: analysis.declarationRange(declaration), declarations: index.getDeclarations(document).filter(item => item.declaration.qualifiedName === declaration.qualifiedName) };
    const context = analysis.contextAt(offset);
    if (!context) return undefined;
    const call = index.resolveCall(context, document);
    if (call && call.word.contentStart <= offset && offset <= call.word.contentEnd) return { analysis, target: call.target, range: analysis.range(call.word.contentStart, call.word.contentEnd), declarations: index.getDeclarations(document).filter(item => item.declaration.qualifiedName === call.target) };
    return undefined;
}
