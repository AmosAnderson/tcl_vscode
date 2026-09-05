import * as vscode from 'vscode';
import { TCL_BUILTIN_COMMANDS, STRING_SUBCOMMANDS, TCL_SNIPPETS } from '../data/tclCommands';
import { analyzeDocument, Declaration } from '../analysis/documentAnalysis';
import { getScriptWords, isStaticWord } from '../utils/tclParser';
import { WorkspaceIndex } from '../analysis/workspaceIndex';

export type PackageCompletionSource = (document: vscode.TextDocument) => readonly string[] | PromiseLike<readonly string[]>;
export class TclCompletionItemProvider implements vscode.CompletionItemProvider {
    constructor(private packageSource?: PackageCompletionSource) {}
    dispose(): void {}
    async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, _context: vscode.CompletionContext): Promise<vscode.CompletionItem[] | vscode.CompletionList> {
        const index = WorkspaceIndex.getInstance();
        await index.ready(token);
        if (token.isCancellationRequested) return [];
        const analysis = analyzeDocument(document);
        const offset = document.offsetAt(position);
        const linePrefix = document.lineAt(position).text.slice(0, position.character);
        let context = analysis.contextAt(offset);
        if (/(?:^|;)\s*#/.test(linePrefix)) return [];
        if (!context && analysis.contextAt(offset, true)) return [];
        const variableMatch = /\$(?:\{)?([\p{L}\p{M}\p{N}_:]*)$/u.exec(linePrefix);
        if (variableMatch && context) {
            const prefix = variableMatch[1];
            const values = new Set<string>();
            for (const symbol of analysis.table.getVisibleSymbols(position)) {
                if (symbol.kind === 'procedure') continue;
                if (symbol.kind !== 'parameter' && document.offsetAt(symbol.range.start) > offset) continue;
                if (prefix.includes('::')) { if (symbol.qualifiedName) values.add(symbol.qualifiedName); }
                else values.add(symbol.name);
            }
            if (prefix.includes('::')) for (const symbol of index.getVariables()) if (symbol.qualifiedName) values.add(symbol.qualifiedName);
            const normalized = prefix.startsWith('::') ? prefix : prefix.includes('::') ? '::' + prefix : prefix;
            return [...values].filter(name => name.startsWith(normalized)).map(name => {
                const insert = prefix.includes('::') && !prefix.startsWith('::') ? name.replace(/^::/, '') : name;
                const item = new vscode.CompletionItem(insert, vscode.CompletionItemKind.Variable);
                item.range = new vscode.Range(position.translate(0, -prefix.length), position);
                item.insertText = insert;
                item.detail = name;
                return item;
            });
        }
        const arrayMatch = /\$([\p{L}\p{M}\p{N}_:]+)\(([^)$[\]]*)$/u.exec(linePrefix);
        if (arrayMatch && context) {
            const keys = new Set<string>();
            for (const command of analysis.contexts) {
                const word = command.command.words[1];
                if (command.command.words[0]?.value !== 'set' || !word || !isStaticWord(word)) continue;
                const match = /^(.*)\(([^()]*)\)$/.exec(word.value);
                if (match?.[1] === arrayMatch[1] && match[2].startsWith(arrayMatch[2])) keys.add(match[2]);
            }
            return [...keys].map(key => { const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Value); item.range = new vscode.Range(position.translate(0, -arrayMatch[2].length), position); return item; });
        }
        // Whitespace within a known script body starts a new command.
        if (context && getScriptWords(context.command).some(body => body.contentStart <= offset && offset <= body.contentEnd)) context = undefined;
        const words = context?.command.words ?? [];
        const currentWord = words.find(word => word.start <= offset && offset <= word.end);
        const wordIndex = currentWord ? words.indexOf(currentWord) : words.filter(word => word.end < offset).length;
        if (words[0]?.value === 'package' && ['require', 'provide', 'present'].includes(words[1]?.value) && wordIndex >= 2) {
            const names = new Set(index.getAnalyses(document).flatMap(item => [...item.packages]));
            if (this.packageSource) for (const name of await this.packageSource(document)) names.add(name);
            if (token.isCancellationRequested) return [];
            return [...names].map(name => new vscode.CompletionItem(name, vscode.CompletionItemKind.Module));
        }
        if (wordIndex > 0) {
            const prior = words.slice(0, wordIndex).map(word => word.value).join(' ');
            const names = new Set(TCL_BUILTIN_COMMANDS.map(command => command.name).filter(name => name.startsWith(prior + ' ')).map(name => name.slice(prior.length + 1).split(' ')[0]));
            if (prior === 'string') STRING_SUBCOMMANDS.forEach(name => names.add(name));
            if (prior === 'my' && context?.className) for (const { declaration } of index.getDeclarations(document)) if (declaration.kind === 'method' && declaration.className === context.className) names.add(declaration.name);
            if (wordIndex === 1 && context) index.getMethodsForReceiver(context, document).forEach(method => names.add(method.name));
            return [...names].map(name => new vscode.CompletionItem(name, vscode.CompletionItemKind.Method));
        }
        const items: vscode.CompletionItem[] = TCL_BUILTIN_COMMANDS.filter(command => !command.name.includes(' ')).map(command => {
            const item = new vscode.CompletionItem(command.name, vscode.CompletionItemKind.Function);
            item.detail = command.signature;
            item.documentation = new vscode.MarkdownString(command.description);
            return item;
        });
        const namespace = context?.namespace ?? analysis.table.getScopeAt(position).namespace ?? '::';
        const typed = currentWord ? analysis.text.slice(currentWord.contentStart, offset) : '';
        const seen = new Set<string>();
        for (const { declaration } of index.getDeclarations(document)) {
            if (!['procedure', 'class', 'namespace'].includes(declaration.kind)) continue;
            if (seen.has(declaration.qualifiedName)) continue;
            seen.add(declaration.qualifiedName);
            const name = declaration.namespace === namespace && !typed.includes('::') ? declaration.name.replace(/^.*::/, '') : declaration.qualifiedName;
            const item = this.procedureItem(declaration, name);
            if (currentWord) item.range = analysis.range(currentWord.contentStart, currentWord.contentEnd);
            items.push(item);
        }
        // Imported aliases are useful command spellings in their importing namespace.
        const resolution = index.getResolution(document);
        for (const entry of resolution.imports.filter(item => item.namespace === namespace)) for (const { declaration } of index.getDeclarations(document)) {
            if (declaration.kind !== 'procedure') continue;
            const short = declaration.name.replace(/^.*::/, '');
            const synthetic = { command: { start: offset, end: offset, words: [{ start: offset, end: offset, contentStart: offset, contentEnd: offset, text: short, value: short, kind: 'bare' as const, substitutions: [], commandSubstitutions: [] }] }, namespace: entry.namespace };
            if (index.resolveCall(synthetic, document)?.target === declaration.qualifiedName && !items.some(item => item.label === short)) items.push(this.procedureItem(declaration, short));
        }
        items.push(...TCL_SNIPPETS.map(snippet => { const item = new vscode.CompletionItem(snippet.label, vscode.CompletionItemKind.Snippet); item.insertText = new vscode.SnippetString(snippet.insertText); item.detail = snippet.detail; return item; }));
        return items;
    }
    private procedureItem(declaration: Declaration, name: string): vscode.CompletionItem {
        const item = new vscode.CompletionItem(name, declaration.kind === 'namespace' ? vscode.CompletionItemKind.Module : declaration.kind === 'class' ? vscode.CompletionItemKind.Class : vscode.CompletionItemKind.Function);
        item.detail = declaration.params ? `${declaration.qualifiedName} {${declaration.params.value}}` : declaration.qualifiedName;
        item.documentation = new vscode.MarkdownString(declaration.documentation);
        if (declaration.kind === 'procedure') {
            const snippet = new vscode.SnippetString();
            snippet.appendText(name);
            for (const parameter of declaration.parameters.filter(parameter => !parameter.variadic && parameter.defaultValue === undefined)) { snippet.appendText(' '); snippet.appendPlaceholder(parameter.name); }
            item.insertText = snippet;
        } else item.insertText = name;
        return item;
    }
}
