import * as vscode from 'vscode';
import { getExpressionWords, getScriptWords, isStaticWord, parseTclList, parseTclScript, parseTclExpressionSubstitutions, TclCommand, TclWord } from '../utils/tclParser';

export type SymbolKind = 'procedure' | 'variable' | 'namespace' | 'parameter';
export type VariableScope = 'local' | 'global' | 'namespace' | 'upvar' | 'parameter';
export interface ScopeNode {
    name: string;
    kind: 'procedure' | 'namespace' | 'global';
    range: vscode.Range;
    parent: ScopeNode | null;
    children: ScopeNode[];
    symbols: SymbolEntry[];
}
export interface SymbolEntry {
    name: string;
    kind: SymbolKind;
    scope: VariableScope;
    range: vscode.Range;
    references: vscode.Range[];
    aliasOf?: string;
}

/** Statically resolved bindings and source ranges, never regex matches in literal data. */
export class DocumentSymbolTable {
    private root: ScopeNode;
    private pending: { scope: ScopeNode; name: string; start: number; end: number }[] = [];
    private text = '';
    constructor(private document: vscode.TextDocument) {
        this.root = { name: '<global>', kind: 'global', range: new vscode.Range(0, 0, 0, 0), parent: null, children: [], symbols: [] };
    }

    parse(): void {
        this.text = this.document.getText();
        this.root.range = this.range(0, this.text.length);
        this.root.children = [];
        this.root.symbols = [];
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
            if (scope.kind === 'procedure') break;
            scope = scope.parent;
        }
        return result;
    }
    getSymbolAt(position: vscode.Position): SymbolEntry | undefined {
        // Exact recorded ranges distinguish parameters, command names, and literal words.
        const find = (scope: ScopeNode): SymbolEntry | undefined => {
            for (const symbol of scope.symbols) {
                if (symbol.range.contains(position) || symbol.references.some(r => r.contains(position))) return symbol;
            }
            for (const child of scope.children) { const match = find(child); if (match) return match; }
            return undefined;
        };
        return find(this.root);
    }
    getScopedReferences(name: string, position: vscode.Position): vscode.Range[] {
        const symbol = this.getSymbolAt(position);
        return symbol && symbol.name === name ? [symbol.range, ...symbol.references] : [];
    }
    getVariableUsages(): { name: string; range: vscode.Range; symbol?: SymbolEntry }[] {
        return this.pending.map(ref => ({ name: ref.name, range: this.range(ref.start, ref.end), symbol: this.resolve(ref.scope, ref.name) }));
    }
    private range(start: number, end: number): vscode.Range { return new vscode.Range(this.document.positionAt(start), this.document.positionAt(end)); }
    private addReference(symbol: SymbolEntry, range: vscode.Range): void {
        if (!symbol.range.isEqual(range) && !symbol.references.some(r => r.isEqual(range))) symbol.references.push(range);
    }
    private resolve(scope: ScopeNode, name: string): SymbolEntry | undefined {
        if (name.startsWith('::')) return this.root.symbols.find(s => s.name === name || s.name === name.slice(2));
        let current: ScopeNode | null = scope;
        while (current) {
            const match = current.symbols.find(s => s.name === name && s.kind !== 'procedure');
            if (match) return match;
            if (current.kind === 'procedure') break;
            current = current.parent;
        }
        return undefined;
    }
    private bind(scope: ScopeNode, word: TclWord, kind: SymbolKind = 'variable', variableScope?: VariableScope, aliasOf?: string): void {
        if (!word || word.expanded) return;
        const match = /^([\p{L}\p{M}\p{N}_:]+)(?:\([\s\S]*\))?$/u.exec(word.value);
        if (!match) return;
        const name = match[1];
        const range = this.range(word.contentStart, word.contentStart + name.length);
        let owner = name.startsWith('::') ? this.root : scope;
        if (variableScope === 'global') owner = this.root;
        if (variableScope === 'namespace') {
            while (owner.parent && owner.kind === 'procedure') owner = owner.parent;
        }
        let symbol = owner.symbols.find(s => s.name === name && s.kind !== 'procedure');
        if (!symbol) {
            symbol = { name, kind, scope: variableScope ?? (owner.kind === 'global' ? 'global' : owner.kind === 'namespace' ? 'namespace' : 'local'), range, references: [], aliasOf };
            owner.symbols.push(symbol);
        } else this.addReference(symbol, range);
        if (owner !== scope && !scope.symbols.includes(symbol) && !name.startsWith('::')) scope.symbols.push(symbol);
    }

    private variableTargets(command: TclCommand, scope: ScopeNode): void {
        const w = command.words;
        if (!isStaticWord(w[0]) || w.some(word => word.expanded)) return;
        const name = w[0].value.replace(/^::/, '');
        const bind = (word: TclWord | undefined, type?: VariableScope) => { if (word) this.bind(scope, word, 'variable', type); };
        if (['set', 'incr', 'append', 'lappend', 'lset'].includes(name)) bind(w[1]);
        else if (name === 'unset') w.slice(1).filter(word => !word.value.startsWith('-')).forEach(word => bind(word));
        else if (name === 'global') w.slice(1).forEach(word => bind(word, 'global'));
        else if (name === 'variable') for (let i = 1; i < w.length; i += 2) bind(w[i], 'namespace');
        else if (name === 'upvar') {
            const start = /^#?\d+$/.test(w[1]?.value ?? '') ? 2 : 1;
            for (let i = start; i + 1 < w.length; i += 2) this.bind(scope, w[i + 1], 'variable', 'upvar', w[i].value);
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
            const match = /^\$\{([\p{L}\p{M}\p{N}_:]+)\}|^\$([\p{L}\p{M}\p{N}_:]+)/u.exec(this.text.slice(i, word.contentEnd));
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
                const child: ScopeNode = { name: w[1].value, kind: 'procedure', range: this.range(command.start, command.end), parent: scope, children: [], symbols: [] };
                scope.children.push(child);
                for (const argument of parseTclList(this.text, w[2].contentStart, w[2].contentEnd).words) {
                    const parameter = argument.kind === 'braced' || argument.kind === 'quoted' ? parseTclList(this.text, argument.contentStart, argument.contentEnd).words[0] : argument;
                    if (parameter) this.bind(child, parameter, 'parameter', 'parameter');
                }
                this.visit(parseTclScript(this.text, w[3].contentStart, w[3].contentEnd).commands, child);
                continue;
            }
            if (!w.some(word => word.expanded) && name === 'namespace' && w[1]?.value === 'eval' && w.length === 4 && isStaticWord(w[2]) && w[3].kind === 'braced') {
                const child: ScopeNode = { name: w[2].value, kind: 'namespace', range: this.range(command.start, command.end), parent: scope, children: [], symbols: [] };
                scope.children.push(child);
                this.visit(parseTclScript(this.text, w[3].contentStart, w[3].contentEnd).commands, child);
                continue;
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
