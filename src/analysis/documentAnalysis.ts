import * as vscode from 'vscode';
import { CommandContext, commandContexts, NamespaceResolution, namespaceOf, qualifyTclName } from './procedures';
import { getExpressionWords, getLambdaParts, getScriptWords, isStaticWord, parseTclList, TclCommand, TclWord } from '../utils/tclParser';
import { DocumentSymbolTable } from './symbolTable';

export interface Parameter { name: string; defaultValue?: string; variadic: boolean; word: TclWord; }
export interface Declaration {
    kind: 'procedure' | 'namespace' | 'class' | 'method' | 'lambda';
    name: string;
    qualifiedName: string;
    namespace: string;
    className?: string;
    command: TclCommand;
    nameWord: TclWord;
    params?: TclWord;
    parameters: Parameter[];
    body?: TclWord;
    documentation: string;
}
export function parametersFromWord(text: string, word?: TclWord): Parameter[] {
    if (!word) return [];
    const args = parseTclList(text, word.contentStart, word.contentEnd);
    if (args.errors.length) return [];
    return args.words.flatMap((arg, index) => {
        const parts = arg.kind === 'bare' ? [arg] : parseTclList(text, arg.contentStart, arg.contentEnd).words;
        if (!parts.length || parts.length > 2 || !isStaticWord(parts[0])) return [];
        return [{ name: parts[0].value, defaultValue: parts[1]?.value, variadic: index === args.words.length - 1 && parts.length === 1 && parts[0].value === 'args', word: parts[0] }];
    });
}

/** Shared immutable syntax and binding view for a single document version. */
export class DocumentAnalysis {
    readonly text: string;
    readonly contexts: CommandContext[];
    readonly declarations: Declaration[] = [];
    readonly table: DocumentSymbolTable;
    readonly resolution: NamespaceResolution = { imports: [], paths: [], exports: [] };
    readonly packages = new Set<string>();
    readonly objects = new Map<string, string>();

    constructor(readonly document: vscode.TextDocument) {
        this.text = document.getText();
        this.contexts = commandContexts(this.text);
        this.table = new DocumentSymbolTable(document);
        this.table.parse();
        for (const context of this.contexts) this.collect(context);
    }
    range(start: number, end: number): vscode.Range { return new vscode.Range(this.document.positionAt(start), this.document.positionAt(end)); }
    declarationRange(declaration: Declaration): vscode.Range { return this.range(declaration.nameWord.contentStart, declaration.nameWord.contentEnd); }
    private documentation(start: number): string {
        const lines = this.text.slice(0, start).split('\n');
        lines.pop();
        const comments: string[] = [];
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i].trim();
            if (!line.startsWith('#')) break;
            comments.unshift(line.slice(1).trim());
        }
        return comments.join('\n');
    }
    private add(context: CommandContext, kind: Declaration['kind'], nameWord: TclWord, qualifiedName: string, params?: TclWord, body?: TclWord): void {
        this.declarations.push({ kind, name: nameWord.value, qualifiedName, namespace: kind === 'procedure' ? namespaceOf(qualifiedName) : context.namespace, className: context.className, command: context.command, nameWord, params, parameters: parametersFromWord(this.text, params), body, documentation: this.documentation(context.command.start) });
    }
    private collect(context: CommandContext): void {
        const w = context.command.words;
        if (!isStaticWord(w[0]) || w.some(word => word.expanded)) return;
        const name = w[0].value.replace(/^::/, '');
        if (name === 'proc' && w.length === 4 && isStaticWord(w[1]) && w[2].kind === 'braced' && w[3].kind === 'braced') {
            this.add(context, 'procedure', w[1], qualifyTclName(w[1].value, context.namespace), w[2], w[3]);
        } else if (name === 'namespace') {
            if (w[1]?.value === 'eval' && isStaticWord(w[2]) && w[3]?.kind === 'braced') this.add(context, 'namespace', w[2], qualifyTclName(w[2].value, context.namespace), undefined, w[3]);
            else if (w[1]?.value === 'import') for (const word of w.slice(2)) {
                if (isStaticWord(word) && word.value !== '-force') this.resolution.imports.push({ namespace: context.namespace, pattern: qualifyTclName(word.value, context.namespace) });
            }
            else if (w[1]?.value === 'export') this.resolution.exports.push({ namespace: context.namespace, patterns: w.slice(2).filter(word => isStaticWord(word) && word.value !== '-clear').map(word => word.value) });
            else if (w[1]?.value === 'path' && w.length === 3 && isStaticWord(w[2])) {
                const paths = parseTclList(this.text, w[2].contentStart, w[2].contentEnd);
                if (!paths.errors.length && paths.words.every(isStaticWord)) this.resolution.paths.push({ namespace: context.namespace, paths: paths.words.map(word => qualifyTclName(word.value, context.namespace)) });
            }
        } else if (['oo::class', 'oo::object'].includes(name) && w[1]?.value === 'create' && isStaticWord(w[2])) {
            const qualified = qualifyTclName(w[2].value, context.namespace);
            this.add(context, 'class', w[2], qualified, undefined, w[3]);
            if (name === 'oo::object') this.objects.set(qualified, qualified);
        } else if (context.className && name === 'method' && w.length === 4 && isStaticWord(w[1]) && w[2].kind === 'braced' && w[3].kind === 'braced') {
            this.add(context, 'method', w[1], `${context.className}#${w[1].value}`, w[2], w[3]);
        } else if (context.className && name === 'constructor' && w.length === 3) this.add(context, 'method', w[0], `${context.className}#constructor`, w[1], w[2]);
        else if (context.className && name === 'destructor' && w.length === 2) this.add(context, 'method', w[0], `${context.className}#destructor`, undefined, w[1]);
        else if (['oo::define', 'oo::objdefine'].includes(name) && isStaticWord(w[1]) && w.length > 3) {
            this.collect({ command: { ...context.command, words: w.slice(2) }, namespace: context.namespace, className: qualifyTclName(w[1].value, context.namespace) });
        }
        const lambda = getLambdaParts(context.command);
        if (lambda.length) this.add(context, 'lambda', w[0], `${this.document.uri.toString()}#lambda:${w[0].start}`, lambda[0], lambda[1]);
        if (name === 'package' && ['provide', 'require', 'present'].includes(w[1]?.value)) {
            const word = w[w[2]?.value === '-exact' ? 3 : 2];
            if (isStaticWord(word)) this.packages.add(word.value);
        }
    }
    /** Innermost executable command; braced data and command comments are excluded. */
    contextAt(offset: number, includeLiteral = false): CommandContext | undefined {
        const candidates = this.contexts.filter(context => context.command.start <= offset && (offset <= context.command.end || /^(?:[ \t]|\\\r?\n)*$/.test(this.text.slice(context.command.end, offset))));
        candidates.sort((a, b) => b.command.start - a.command.start || a.command.end - b.command.end);
        for (const context of candidates) {
            const containing = context.command.words.find(word => word.start < offset && offset < word.end);
            if (!includeLiteral && containing?.kind === 'braced' && ![...getScriptWords(context.command), ...getExpressionWords(context.command)].some(body => body.start === containing.start)) return undefined;
            return context;
        }
        return undefined;
    }
    declarationAt(offset: number): Declaration | undefined {
        return this.declarations.find(declaration => declaration.nameWord.contentStart <= offset && offset <= declaration.nameWord.contentEnd);
    }
}

const analyses = new Map<string, { version: number; analysis: DocumentAnalysis }>();
export function analyzeDocument(document: vscode.TextDocument): DocumentAnalysis {
    const key = document.uri.toString();
    const cached = analyses.get(key);
    if (cached?.version === document.version && cached.analysis.document === document) return cached.analysis;
    const analysis = new DocumentAnalysis(document);
    analyses.set(key, { version: document.version, analysis });
    return analysis;
}
export function invalidateAnalysis(uri?: vscode.Uri): void { if (uri) analyses.delete(uri.toString()); else analyses.clear(); }
