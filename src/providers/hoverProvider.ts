import * as vscode from 'vscode';
import { TCL_BUILTIN_COMMANDS } from '../data/tclCommands';
import { SymbolTableCache } from '../analysis/symbolTableCache';
import { WorkspaceIndex } from '../analysis/workspaceIndex';
import { analyzeDocument } from '../analysis/documentAnalysis';
import { featureSymbolAt } from './languageFeatures';

export class TclHoverProvider implements vscode.HoverProvider {
    constructor(_symbolTableCache?: SymbolTableCache) {}
    async provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.Hover | null> {
        const index = WorkspaceIndex.getInstance();
        await index.ready(token);
        if (token.isCancellationRequested) return null;
        const symbol = featureSymbolAt(document, position, index);
        const markdown = new vscode.MarkdownString();
        if (symbol?.binding || symbol?.variableName) {
            markdown.appendCodeblock(`$${symbol.variableName ?? symbol.binding!.name}`, 'tcl');
            markdown.appendText(`${symbol.binding?.scope ?? 'namespace'} variable`);
            if (symbol.binding?.aliasOf) markdown.appendText(`; alias of ${symbol.binding.aliasOf}`);
            return new vscode.Hover(markdown, symbol.range);
        }
        if (symbol?.declarations.length) {
            for (const { declaration, analysis } of symbol.declarations) {
                markdown.appendCodeblock(`${declaration.kind} ${declaration.qualifiedName}${declaration.params ? ` {${declaration.params.value}}` : ''}`, 'tcl');
                if (declaration.documentation) markdown.appendText(declaration.documentation + '\n\n');
                markdown.appendText(`Defined in ${vscode.workspace.asRelativePath(analysis.document.uri)}\n\n`);
            }
            return new vscode.Hover(markdown, symbol.range);
        }
        const analysis = analyzeDocument(document);
        const offset = document.offsetAt(position);
        const context = analysis.contextAt(offset);
        if (!context) return null;
        const words = context.command.words;
        const builtin = TCL_BUILTIN_COMMANDS.filter(command => command.name === words[0]?.value || command.name === `${words[0]?.value} ${words[1]?.value}`).sort((a, b) => b.name.length - a.name.length)[0];
        if (!builtin) return null;
        const last = words[builtin.name.split(/\s+/).length - 1];
        if (offset < words[0].contentStart || offset > last.contentEnd) return null;
        markdown.appendCodeblock(builtin.signature, 'tcl');
        markdown.appendText(builtin.description);
        return new vscode.Hover(markdown, analysis.range(words[0].contentStart, last.contentEnd));
    }
}
