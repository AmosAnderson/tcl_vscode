import * as vscode from 'vscode';
import { getExpressionWords, getScriptWords, getLambdaParts, isStaticWord, parseTclList, parseTclScript, parseTclExpressionSubstitutions, TclCommand, TclWord } from '../utils/tclParser';
import { namespaceOf, qualifyTclName } from './procedures';

export type SymbolKind = 'procedure' | 'variable' | 'namespace' | 'parameter';
export type VariableScope = 'local' | 'global' | 'namespace' | 'upvar' | 'parameter';
export interface ScopeNode {
    name: string;
    kind: 'procedure' | 'namespace' | 'global';
    range: vscode.Range;
    parent: ScopeNode | null;
    children: ScopeNode[];
    symbols: SymbolEntry[];
    namespace?: string;
    className?: string;
}
export interface SymbolEntry {
    name: string;
    kind: SymbolKind;
    scope: VariableScope;
    range: vscode.Range;
    references: vscode.Range[];
    aliasOf?: string;
    /** Present for bindings whose identity is shared across namespace blocks/files. */
    qualifiedName?: string;
    aliasTarget?: string;
}

/** Statically resolved bindings and source ranges, never regex matches in literal data. */
export class DocumentSymbolTable {
    private root: ScopeNode;
    private pending: { scope: ScopeNode; name: string; start: number; end: number }[] = [];
    private text = '';
    private namespaceBindings = new Map<string, SymbolEntry[]>();
    constructor(private document: vscode.TextDocument) {
        this.root = { name: '<global>', kind: 'global', range: new vscode.Range(0, 0, 0, 0), parent: null, children: [], symbols: [], namespace: '::' };
    }

    parse(): void {
        this.text = this.document.getText();
        this.root.range = this.range(0, this.text.length);
        this.root.children = [];
        this.root.symbols = [];
        this.namespaceBindings.clear();
        this.namespaceBindings.set('::', this.root.symbols);
        this.pending = [];
        this.visit(parseTclScript(this.text).commands, this.root);
        for (const ref of this.pending) {
            const symbol = this.resolve(ref.scope, ref.name);
            if (symbol) this.addReference(symbol, this.range(ref.start, ref.end));
        }
    }

    getRoot(): ScopeNode { return this.root; }
    getScopeAt(position: vscode.Position): ScopeNode {
        const find = (scope: ScopeNode): ScopeNode => {
            for (const child of scope.children) if (child.range.contains(position)) return find(child);
            return scope;
        };
        return find(this.root);
    }
    getVisibleSymbols(position: vscode.Position): SymbolEntry[] {
        const result: SymbolEntry[] = [];
        let scope: ScopeNode | null = this.getScopeAt(position);
        while (scope) {
            for (const symbol of scope.symbols) if (!result.some(s => s.name === symbol.name)) result.push(symbol);
            if (scope.className) for (const symbol of this.namespaceSymbols(scope.className + '::__object')) if (!result.some(s => s.name === symbol.name)) result.push(symbol);
            if (scope.kind === 'procedure') break;
            scope = scope.parent;
        }
        return result;
    }
    getSymbolAt(position: vscode.Position): SymbolEntry | undefined {
        // Qualified bindings can belong to a namespace declared in another file.
        return this.getAllSymbols().find(symbol => symbol.range.contains(position) || symbol.references.some(range => range.contains(position)));
    }
    getScopedReferences(name: string, position: vscode.Position): vscode.Range[] {
        const symbol = this.getSymbolAt(position);
        return symbol && (symbol.name === name || symbol.qualifiedName === name || name.endsWith('::' + symbol.name)) ? [symbol.range, ...symbol.references] : [];
    }
    getVariableUsages(): { name: string; range: vscode.Range; symbol?: SymbolEntry; qualifiedName?: string }[] {
        return this.pending.map(ref => ({ name: ref.name, range: this.range(ref.start, ref.end), symbol: this.resolve(ref.scope, ref.name), qualifiedName: ref.name.includes('::') || ref.scope.kind !== 'procedure' ? qualifyTclName(ref.name, ref.scope.namespace ?? '::') : undefined }));
    }
    getAllSymbols(): SymbolEntry[] {
        const result = new Set<SymbolEntry>();
        const visit = (scope: ScopeNode) => { scope.symbols.forEach(symbol => result.add(symbol)); scope.children.forEach(visit); };
        visit(this.root);
        for (const symbols of this.namespaceBindings.values()) symbols.forEach(symbol => result.add(symbol));
        return [...result];
    }
    private namespaceSymbols(name: string): SymbolEntry[] {
        if (!this.namespaceBindings.has(name)) this.namespaceBindings.set(name, []);
        return this.namespaceBindings.get(name)!;
    }
    private range(start: number, end: number): vscode.Range { return new vscode.Range(this.document.positionAt(start), this.document.positionAt(end)); }
    private addReference(symbol: SymbolEntry, range: vscode.Range): void {
        if (!symbol.range.isEqual(range) && !symbol.references.some(r => r.isEqual(range))) symbol.references.push(range);
    }
    private resolve(scope: ScopeNode, name: string): SymbolEntry | undefined {
        if (name.includes('::')) {
            const qualified = qualifyTclName(name, scope.namespace ?? '::');
            return this.namespaceSymbols(namespaceOf(qualified)).find(symbol => symbol.qualifiedName === qualified);
        }
        let current: ScopeNode | null = scope;
        while (current) {
            const match = current.symbols.find(s => s.name === name && s.kind !== 'procedure');
            if (match) return match;
            if (current.className) {
                const member = this.namespaceSymbols(current.className + '::__object').find(symbol => symbol.name === name);
                if (member) return member;
            }
            if (current.kind === 'procedure') break;
            if (current.kind === 'namespace') break;
            current = current.parent;
        }
        return undefined;
    }
    private bind(scope: ScopeNode, word: TclWord, kind: SymbolKind = 'variable', variableScope?: VariableScope, aliasOf?: string): void {
        if (!word || word.expanded) return;
        const match = /^([\p{L}\p{M}\p{N}_:]+)(?:\([\s\S]*\))?$/u.exec(word.value);
        if (!match) return;
        const rawName = match[1];
        const range = this.range(word.contentStart, word.contentStart + rawName.length);
        const isShared = kind !== 'parameter' && (rawName.includes('::') || variableScope === 'global' || variableScope === 'namespace' || scope.kind !== 'procedure');
        const qualifiedName = isShared ? qualifyTclName(rawName, variableScope === 'global' ? '::' : variableScope === 'namespace' && scope.className ? scope.className + '::__object' : scope.namespace ?? '::') : undefined;
        const name = qualifiedName ? qualifiedName.slice(qualifiedName.lastIndexOf('::') + 2) : rawName;
        const symbols = qualifiedName ? this.namespaceSymbols(namespaceOf(qualifiedName)) : scope.symbols;
        let symbol = symbols.find(s => s.name === name && s.kind !== 'procedure');
        if (!symbol) {
            symbol = { name, kind, scope: variableScope ?? (qualifiedName ? namespaceOf(qualifiedName) === '::' ? 'global' : 'namespace' : 'local'), range, references: [], aliasOf, qualifiedName };
            symbols.push(symbol);
        } else this.addReference(symbol, range);
        if (symbols !== scope.symbols && !scope.symbols.includes(symbol) && (variableScope === 'global' || variableScope === 'namespace')) scope.symbols.push(symbol);
    }

    private variableTargets(command: TclCommand, scope: ScopeNode): void {
        const w = command.words;
        if (!isStaticWord(w[0]) || w.some(word => word.expanded)) return;
        const name = w[0].value.replace(/^::/, '');
        const bind = (word: TclWord | undefined, type?: VariableScope) => { if (word) this.bind(scope, word, 'variable', type); };
        if (['set', 'incr', 'append', 'lappend', 'lset'].includes(name)) bind(w[1]);
        else if (name === 'unset') w.slice(1).filter(word => !word.value.startsWith('-')).forEach(word => bind(word));
        else if (name === 'global') w.slice(1).forEach(word => bind(word, 'global'));
        else if (name === 'variable') for (let i = 1; i < w.length; i += scope.className && scope.kind === 'namespace' ? 1 : 2) bind(w[i], 'namespace');
        else if (name === 'upvar') {
            const start = /^#?\d+$/.test(w[1]?.value ?? '') ? 2 : 1;
            for (let i = start; i + 1 < w.length; i += 2) this.bind(scope, w[i + 1], 'variable', 'upvar', w[i].value);
            if (w[1]?.value === '#0') for (let i = start; i + 1 < w.length; i += 2) {
                const local = scope.symbols.find(symbol => symbol.name === w[i + 1].value);
                if (local && isStaticWord(w[i])) local.aliasTarget = qualifyTclName(w[i].value, '::');
            }
        } else if (name === 'namespace' && w[1]?.value === 'upvar' && isStaticWord(w[2])) {
            for (let i = 3; i + 1 < w.length; i += 2) {
                this.bind(scope, w[i + 1], 'variable', 'upvar', w[i].value);
                const local = scope.symbols.find(symbol => symbol.name === w[i + 1].value);
                if (local && isStaticWord(w[i])) local.aliasTarget = qualifyTclName(w[i].value, qualifyTclName(w[2].value, scope.namespace ?? '::'));
            }
        } else if (name === 'foreach' || name === 'lmap') {
            for (let i = 1; i < w.length - 1; i += 2) {
                if (isStaticWord(w[i])) parseTclList(this.text, w[i].contentStart, w[i].contentEnd).words.forEach(word => bind(word));
            }
        } else if (name === 'catch') { bind(w[2]); bind(w[3]); }
        else if (name === 'gets') bind(w[2]);
        else if (name === 'array') bind(w[2]);
        else if (name === 'dict') {
            if (['set', 'unset', 'incr', 'append', 'lappend', 'update', 'with'].includes(w[1]?.value)) bind(w[2]);
            if (['for', 'map'].includes(w[1]?.value) && isStaticWord(w[2])) parseTclList(this.text, w[2].contentStart, w[2].contentEnd).words.forEach(word => bind(word));
            if (w[1]?.value === 'update') for (let i = 4; i < w.length - 1; i += 2) bind(w[i]);
        } else if (name === 'try') {
            for (let i = 2; i + 3 < w.length; i += 4) {
                if (['on', 'trap'].includes(w[i].value) && isStaticWord(w[i + 2])) parseTclList(this.text, w[i + 2].contentStart, w[i + 2].contentEnd).words.forEach(word => bind(word));
            }
        }
    }

    private references(word: TclWord, scope: ScopeNode, expression = false): void {
        if (word.kind === 'braced' && !expression) return;
        // Substitution ranges are visited separately in their own command context.
        let inQuote = false;
        for (let i = word.contentStart; i < word.contentEnd; i++) {
            const sub = word.commandSubstitutions.find(s => s.start === i);
            if (sub) { i = sub.end - 1; continue; }
            if (this.text[i] === '\\') { i++; continue; }
            if (expression && this.text[i] === '"') { inQuote = !inQuote; continue; }
            if (expression && this.text[i] === '{' && !inQuote) {
                let depth = 1;
                while (++i < word.contentEnd && depth) {
                    if (this.text[i] === '\\') i++;
                    else if (this.text[i] === '{') depth++;
                    else if (this.text[i] === '}') depth--;
                }
                i--;
                continue;
            }
            if (this.text[i] !== '$') continue;
            const match = /^\$\{([^}]+)\}|^\$((?:[\p{L}\p{M}\p{N}_]+|:{2,})+)/u.exec(this.text.slice(i, word.contentEnd));
            if (!match) continue;
            const name = match[1] ?? match[2];
            const start = i + (match[1] ? 2 : 1);
            this.pending.push({ scope, name, start, end: start + name.length });
            i += match[0].length - 1;
        }
    }

    private visit(commands: TclCommand[], scope: ScopeNode): void {
        for (const command of commands) {
            const w = command.words;
            const name = isStaticWord(w[0]) ? w[0].value.replace(/^::/, '') : '';
            for (const word of w) {
                this.references(word, scope);
                this.visit(word.substitutions, scope);
            }
            if (!w.some(word => word.expanded) && name === 'proc' && w.length === 4 && isStaticWord(w[1]) && w[2].kind === 'braced' && w[3].kind === 'braced') {
                scope.symbols.push({ name: w[1].value, kind: 'procedure', scope: 'global', range: this.range(w[1].contentStart, w[1].contentEnd), references: [] });
                const child: ScopeNode = { name: w[1].value, kind: 'procedure', range: this.range(command.start, command.end), parent: scope, children: [], symbols: [], namespace: namespaceOf(qualifyTclName(w[1].value, scope.namespace ?? '::')) };
                scope.children.push(child);
                for (const argument of parseTclList(this.text, w[2].contentStart, w[2].contentEnd).words) {
                    const parameter = argument.kind === 'braced' || argument.kind === 'quoted' ? parseTclList(this.text, argument.contentStart, argument.contentEnd).words[0] : argument;
                    if (parameter) this.bind(child, parameter, 'parameter', 'parameter');
                }
                this.visit(parseTclScript(this.text, w[3].contentStart, w[3].contentEnd).commands, child);
                continue;
            }
            if (!w.some(word => word.expanded) && name === 'namespace' && w[1]?.value === 'eval' && w.length === 4 && isStaticWord(w[2]) && w[3].kind === 'braced') {
                const namespace = qualifyTclName(w[2].value, scope.namespace ?? '::');
                const child: ScopeNode = { name: w[2].value, kind: 'namespace', range: this.range(command.start, command.end), parent: scope, children: [], symbols: this.namespaceSymbols(namespace), namespace };
                scope.children.push(child);
                this.visit(parseTclScript(this.text, w[3].contentStart, w[3].contentEnd).commands, child);
                continue;
            }
            if (!w.some(word => word.expanded)) {
                const classWord = ['oo::class', 'oo::object'].includes(name) && w[1]?.value === 'create' ? w[2] : ['oo::define', 'oo::objdefine'].includes(name) ? w[1] : undefined;
                if (classWord && isStaticWord(classWord)) {
                    const className = qualifyTclName(classWord.value, scope.namespace ?? '::');
                    const child: ScopeNode = { name: className, kind: 'namespace', namespace: scope.namespace, className, range: this.range(command.start, command.end), parent: scope, children: [], symbols: this.namespaceSymbols(className + '::__object') };
                    scope.children.push(child);
                    if (['oo::define', 'oo::objdefine'].includes(name) && w.length > 3) this.visit([{ ...command, words: w.slice(2) }], child);
                    else for (const body of getScriptWords(command)) this.visit(parseTclScript(this.text, body.contentStart, body.contentEnd).commands, child);
                    continue;
                }
                const lambda = getLambdaParts(command);
                const method = !!scope.className && ['method', 'constructor', 'destructor'].includes(name);
                if (lambda.length || method) {
                    const params = lambda[0] ?? (name === 'method' ? w[2] : name === 'constructor' ? w[1] : undefined);
                    const body = lambda[1] ?? (name === 'method' ? w[3] : name === 'constructor' ? w[2] : w[1]);
                    if (body?.kind === 'braced') {
                        const child: ScopeNode = { name: lambda.length ? '<lambda>' : name === 'method' ? w[1].value : name, kind: 'procedure', namespace: lambda.length ? lambda[2] ? qualifyTclName(lambda[2].value, '::') : '::' : scope.namespace, className: lambda.length ? undefined : scope.className, range: this.range(command.start, command.end), parent: scope, children: [], symbols: [] };
                        scope.children.push(child);
                        if (params?.kind === 'braced') for (const argument of parseTclList(this.text, params.contentStart, params.contentEnd).words) {
                            const parameter = argument.kind === 'braced' || argument.kind === 'quoted' ? parseTclList(this.text, argument.contentStart, argument.contentEnd).words[0] : argument;
                            if (parameter) this.bind(child, parameter, 'parameter', 'parameter');
                        }
                        if (method) child.symbols.push(...scope.symbols.filter(symbol => symbol.kind !== 'procedure'));
                        this.visit(parseTclScript(this.text, body.contentStart, body.contentEnd).commands, child);
                    }
                    continue;
                }
            }
            this.variableTargets(command, scope);
            for (const expression of getExpressionWords(command)) if (expression.kind === 'braced') {
                const parsed = parseTclExpressionSubstitutions(this.text, expression.contentStart, expression.contentEnd);
                this.references({ ...expression, commandSubstitutions: parsed.spans }, scope, true);
                this.visit(parsed.commands, scope);
            }
            for (const body of getScriptWords(command)) this.visit(parseTclScript(this.text, body.contentStart, body.contentEnd).commands, scope);
        }
    }
}
