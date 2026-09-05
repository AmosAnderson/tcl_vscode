import * as vscode from 'vscode';
import { TCL_BUILTIN_COMMANDS } from '../data/tclCommands';
import { analyzeDocument } from '../analysis/documentAnalysis';
import { WorkspaceIndex } from '../analysis/workspaceIndex';

export class TclSignatureHelpProvider implements vscode.SignatureHelpProvider {
    async provideSignatureHelp(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, _context: vscode.SignatureHelpContext): Promise<vscode.SignatureHelp | null> {
        const index = WorkspaceIndex.getInstance();
        await index.ready(token);
        if (token.isCancellationRequested) return null;
        const analysis = analyzeDocument(document);
        const offset = document.offsetAt(position);
        const context = analysis.contextAt(offset, true);
        if (!context) return null;
        const words = context.command.words;
        const wordIndex = words.findIndex(word => word.start <= offset && offset <= word.end);
        const activeWord = wordIndex >= 0 ? wordIndex : words.filter(word => word.end <= offset).length;
        const call = index.resolveCall(context, document);
        const declarations = call ? index.getDeclarations(document).filter(item => (item.declaration.qualifiedName === call.target || item.declaration.qualifiedName === call.target + '#constructor') && item.declaration.params) : [];
        const result = new vscode.SignatureHelp();
        let argumentStart = call?.argumentStart ?? 1;
        if (declarations.length) {
            result.signatures = declarations.map(({ declaration }) => {
                const signature = new vscode.SignatureInformation(`${declaration.name} ${declaration.parameters.map(parameter => parameter.variadic ? '?args ...?' : parameter.defaultValue === undefined ? parameter.name : `?${parameter.name}=${parameter.defaultValue}?`).join(' ')}`, new vscode.MarkdownString(declaration.documentation));
                signature.parameters = declaration.parameters.map(parameter => new vscode.ParameterInformation(parameter.name, parameter.defaultValue === undefined ? undefined : `Default: ${parameter.defaultValue}`));
                return signature;
            });
        } else {
            const names = [words[0]?.value, `${words[0]?.value} ${words[1]?.value}`];
            const builtin = TCL_BUILTIN_COMMANDS.filter(command => names.includes(command.name)).sort((a, b) => b.name.length - a.name.length)[0];
            if (!builtin) return null;
            argumentStart = builtin.name.split(/\s+/).length;
            const signature = new vscode.SignatureInformation(builtin.signature, builtin.description);
            const labels = builtin.signature.slice(builtin.name.length).trim().match(/\?[^?]*\?|\S+/g) ?? [];
            signature.parameters = labels.map(label => new vscode.ParameterInformation(label));
            result.signatures = [signature];
        }
        if (activeWord < argumentStart) return null;
        result.activeSignature = 0;
        result.activeParameter = Math.max(0, Math.min(activeWord - argumentStart, result.signatures[0].parameters.length - 1));
        return result;
    }
}
