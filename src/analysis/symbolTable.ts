import * as vscode from 'vscode';
import { findMatchingBrace } from '../utils/tclUtils';

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

export class DocumentSymbolTable {
    private root: ScopeNode;
    private document: vscode.TextDocument;

    constructor(document: vscode.TextDocument) {
        this.document = document;
        this.root = {
            name: '<global>',
            kind: 'global',
            range: new vscode.Range(0, 0, document.lineCount - 1, 0),
            parent: null,
            children: [],
            symbols: []
        };
    }

    /** Build the symbol table by parsing the document. */
    parse(): void {
        this.root.children = [];
        this.root.symbols = [];

        const text = this.document.getText();
        const lines = text.split('\n');
        const scopeStack: ScopeNode[] = [this.root];

        // braceStack tracks the character offset of each opening brace so we
        // know which closing brace matches which opening scope.
        const braceStack: { offset: number; scopeIndex: number }[] = [];
        let charOffset = 0;

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const line = lines[lineNum];
            const trimmed = line.trim();
            const currentScope = scopeStack[scopeStack.length - 1];

            // Skip pure comment lines
            if (trimmed.startsWith('#')) {
                charOffset += line.length + 1;
                continue;
            }

            // --- Detect scope-opening constructs BEFORE processing braces ---
            this.detectProcDefinition(line, lineNum, charOffset, text, scopeStack, braceStack);
            this.detectNamespaceEval(line, lineNum, charOffset, text, scopeStack, braceStack);

            // --- Detect variable declarations ---
            this.detectSetCommand(line, lineNum, scopeStack);
            this.detectVariableCommand(line, lineNum, scopeStack);
            this.detectGlobalCommand(line, lineNum, scopeStack);
            this.detectUpvarCommand(line, lineNum, scopeStack);

            // --- Detect variable references ($var / ${var}) ---
            this.detectVariableReferences(line, lineNum, scopeStack);

            // --- Track braces for scope closing ---
            this.trackBraces(line, lineNum, charOffset, scopeStack, braceStack);

            charOffset += line.length + 1;
        }
    }

    /** Get the innermost scope containing a position. */
    getScopeAt(position: vscode.Position): ScopeNode {
        return this.findScopeAt(this.root, position);
    }

    /** Get all symbols visible at a position (walks up scope chain). */
    getVisibleSymbols(position: vscode.Position): SymbolEntry[] {
        const visible: SymbolEntry[] = [];
        let scope: ScopeNode | null = this.getScopeAt(position);
        while (scope) {
            for (const sym of scope.symbols) {
                // Don't shadow: only add if not already present with same name
                if (!visible.some(v => v.name === sym.name && v.kind === sym.kind)) {
                    visible.push(sym);
                }
            }
            scope = scope.parent;
        }
        return visible;
    }

    /** Get symbol info at a specific position. */
    getSymbolAt(position: vscode.Position): SymbolEntry | undefined {
        const wordRange = this.document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return undefined;
        }

        let word = this.document.getText(wordRange);
        const line = this.document.lineAt(position.line).text;
        const charBefore = wordRange.start.character > 0
            ? line[wordRange.start.character - 1]
            : '';

        // Strip leading $ for variable references
        if (charBefore === '$') {
            // word is already just the name (VS Code word range excludes $)
        }

        // Walk up scope chain to find the symbol
        let scope: ScopeNode | null = this.getScopeAt(position);
        while (scope) {
            const match = scope.symbols.find(s => s.name === word);
            if (match) {
                return match;
            }
            scope = scope.parent;
        }
        return undefined;
    }

    /** Get all references to a symbol, respecting scope. */
    getScopedReferences(symbolName: string, position: vscode.Position): vscode.Range[] {
        // Find the symbol's owning scope
        const owningScope = this.findSymbolOwningScope(symbolName, position);
        if (!owningScope) {
            return [];
        }

        const symbol = owningScope.symbols.find(s => s.name === symbolName);
        if (!symbol) {
            return [];
        }

        // Return the definition + all references
        const ranges: vscode.Range[] = [symbol.range, ...symbol.references];
        return ranges;
    }

    /** Get the root scope. */
    getRoot(): ScopeNode {
        return this.root;
    }

    // --- Private helpers ---

    private findScopeAt(scope: ScopeNode, position: vscode.Position): ScopeNode {
        for (const child of scope.children) {
            if (child.range.contains(position)) {
                return this.findScopeAt(child, position);
            }
        }
        return scope;
    }

    private findSymbolOwningScope(
        symbolName: string,
        position: vscode.Position
    ): ScopeNode | null {
        let scope: ScopeNode | null = this.getScopeAt(position);
        while (scope) {
            if (scope.symbols.some(s => s.name === symbolName)) {
                return scope;
            }
            scope = scope.parent;
        }
        return null;
    }

    private currentScope(stack: ScopeNode[]): ScopeNode {
        return stack[stack.length - 1];
    }

    /** Detect `proc name {params} {` and create a child scope + parameter symbols. */
    private detectProcDefinition(
        line: string,
        lineNum: number,
        lineOffset: number,
        fullText: string,
        scopeStack: ScopeNode[],
        braceStack: { offset: number; scopeIndex: number }[]
    ): void {
        const procMatch = line.match(/\bproc\s+([\w:]+)\s*\{/);
        if (!procMatch) {
            return;
        }

        const procName = procMatch[1];
        const procIndex = line.indexOf(procMatch[0]);

        // Find opening brace of params
        const paramsOpenIdx = lineOffset + line.indexOf('{', procIndex + 5);
        const paramsCloseIdx = findMatchingBrace(fullText, paramsOpenIdx);
        if (paramsCloseIdx === -1) {
            return;
        }

        const paramsText = fullText.substring(paramsOpenIdx + 1, paramsCloseIdx).trim();

        // Find opening brace of body (after params close brace)
        const afterParams = fullText.substring(paramsCloseIdx + 1);
        const bodyBraceRelative = afterParams.search(/\{/);
        if (bodyBraceRelative === -1) {
            return;
        }

        const bodyOpenIdx = paramsCloseIdx + 1 + bodyBraceRelative;
        const bodyCloseIdx = findMatchingBrace(fullText, bodyOpenIdx);
        if (bodyCloseIdx === -1) {
            return;
        }

        const bodyStartPos = this.document.positionAt(bodyOpenIdx);
        const bodyEndPos = this.document.positionAt(bodyCloseIdx);

        const scopeNode: ScopeNode = {
            name: procName,
            kind: 'procedure',
            range: new vscode.Range(bodyStartPos, bodyEndPos),
            parent: this.currentScope(scopeStack),
            children: [],
            symbols: []
        };
        this.currentScope(scopeStack).children.push(scopeNode);

        // Parse parameters into SymbolEntries
        if (paramsText) {
            const params = this.parseParamList(paramsText);
            const paramsStartLine = this.document.positionAt(paramsOpenIdx + 1).line;
            for (const param of params) {
                scopeNode.symbols.push({
                    name: param,
                    kind: 'parameter',
                    scope: 'parameter',
                    range: new vscode.Range(paramsStartLine, 0, paramsStartLine, 0),
                    references: []
                });
            }
        }

        // Push scope so subsequent lines inside the body are in this scope.
        // We record the body opening brace so trackBraces knows when to pop.
        scopeStack.push(scopeNode);
        braceStack.push({ offset: bodyOpenIdx, scopeIndex: scopeStack.length - 1 });
    }

    /** Detect `namespace eval name {` and create a child scope. */
    private detectNamespaceEval(
        line: string,
        lineNum: number,
        lineOffset: number,
        fullText: string,
        scopeStack: ScopeNode[],
        braceStack: { offset: number; scopeIndex: number }[]
    ): void {
        const nsMatch = line.match(/\bnamespace\s+eval\s+([\w:]+)\s*\{/);
        if (!nsMatch) {
            return;
        }

        const nsName = nsMatch[1];
        const matchIdx = line.indexOf(nsMatch[0]);
        const braceIdx = lineOffset + line.indexOf('{', matchIdx + nsMatch[0].length - 1);
        const closeIdx = findMatchingBrace(fullText, braceIdx);
        if (closeIdx === -1) {
            return;
        }

        const startPos = this.document.positionAt(braceIdx);
        const endPos = this.document.positionAt(closeIdx);

        const scopeNode: ScopeNode = {
            name: nsName,
            kind: 'namespace',
            range: new vscode.Range(startPos, endPos),
            parent: this.currentScope(scopeStack),
            children: [],
            symbols: []
        };
        this.currentScope(scopeStack).children.push(scopeNode);

        scopeStack.push(scopeNode);
        braceStack.push({ offset: braceIdx, scopeIndex: scopeStack.length - 1 });
    }

    /** Detect `set varName` (not array element set) and create a local variable if first use. */
    private detectSetCommand(
        line: string,
        lineNum: number,
        scopeStack: ScopeNode[]
    ): void {
        const setMatch = line.match(/\bset\s+([\w:]+)(?:\s|$)/);
        if (!setMatch) {
            return;
        }

        const varName = setMatch[1];
        // Skip array element assignments like set arr(key)
        if (line.match(new RegExp(`\\bset\\s+${varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\(`))) {
            return;
        }

        const scope = this.currentScope(scopeStack);
        if (!scope.symbols.some(s => s.name === varName)) {
            const col = line.indexOf(varName, line.indexOf('set'));
            scope.symbols.push({
                name: varName,
                kind: 'variable',
                scope: scope.kind === 'global' ? 'global' : 'local',
                range: new vscode.Range(lineNum, col, lineNum, col + varName.length),
                references: []
            });
        }
    }

    /** Detect `variable varName` → namespace-scoped variable. */
    private detectVariableCommand(
        line: string,
        lineNum: number,
        scopeStack: ScopeNode[]
    ): void {
        const varMatch = line.match(/\bvariable\s+([\w:]+)/);
        if (!varMatch) {
            return;
        }

        const varName = varMatch[1];
        const scope = this.currentScope(scopeStack);
        if (!scope.symbols.some(s => s.name === varName)) {
            const col = line.indexOf(varName, line.indexOf('variable'));
            scope.symbols.push({
                name: varName,
                kind: 'variable',
                scope: 'namespace',
                range: new vscode.Range(lineNum, col, lineNum, col + varName.length),
                references: []
            });
        }
    }

    /** Detect `global varName` → marks variable as global. */
    private detectGlobalCommand(
        line: string,
        lineNum: number,
        scopeStack: ScopeNode[]
    ): void {
        const globalMatch = line.match(/\bglobal\s+(.+)/);
        if (!globalMatch) {
            return;
        }

        const varNames = globalMatch[1].trim().split(/\s+/);
        const scope = this.currentScope(scopeStack);
        for (const varName of varNames) {
            if (!varName || !/^[\w:]+$/.test(varName)) {
                continue;
            }
            if (!scope.symbols.some(s => s.name === varName)) {
                const col = line.indexOf(varName, line.indexOf('global'));
                scope.symbols.push({
                    name: varName,
                    kind: 'variable',
                    scope: 'global',
                    range: new vscode.Range(lineNum, col, lineNum, col + varName.length),
                    references: []
                });
            }
        }
    }

    /** Detect `upvar ?level? sourceVar localVar` → upvar-scoped alias. */
    private detectUpvarCommand(
        line: string,
        lineNum: number,
        scopeStack: ScopeNode[]
    ): void {
        const upvarMatch = line.match(/\bupvar\s+(.+)/);
        if (!upvarMatch) {
            return;
        }

        const args = upvarMatch[1].trim().split(/\s+/);
        let idx = 0;

        // Optional level argument (number or #N)
        if (args.length >= 3 && /^(#?\d+)$/.test(args[0])) {
            idx = 1;
        }

        // Remaining args are source/local pairs
        const scope = this.currentScope(scopeStack);
        while (idx + 1 < args.length) {
            const sourceVar = args[idx];
            const localVar = args[idx + 1];
            if (/^[\w:]+$/.test(localVar) && !scope.symbols.some(s => s.name === localVar)) {
                const col = line.lastIndexOf(localVar);
                scope.symbols.push({
                    name: localVar,
                    kind: 'variable',
                    scope: 'upvar',
                    range: new vscode.Range(lineNum, col, lineNum, col + localVar.length),
                    references: [],
                    aliasOf: sourceVar
                });
            }
            idx += 2;
        }
    }

    /** Detect `$varName` and `${varName}` references and attach to nearest symbol. */
    private detectVariableReferences(
        line: string,
        lineNum: number,
        scopeStack: ScopeNode[]
    ): void {
        // Match $varName (word chars and colons) or ${varName}
        const refRegex = /\$\{([\w:]+)\}|\$([\w:]+)/g;
        let match;
        while ((match = refRegex.exec(line)) !== null) {
            const varName = match[1] || match[2];
            const dollarIdx = match.index;
            const nameStart = dollarIdx + (match[1] ? 2 : 1); // skip ${ or $
            const nameEnd = nameStart + varName.length;
            const refRange = new vscode.Range(lineNum, nameStart, lineNum, nameEnd);

            // Walk up scope chain to find the symbol and add this reference
            let scope: ScopeNode | null = this.currentScope(scopeStack);
            while (scope) {
                const sym = scope.symbols.find(s => s.name === varName);
                if (sym) {
                    // Don't add the definition position as a reference
                    if (!sym.range.isEqual(refRange)) {
                        sym.references.push(refRange);
                    }
                    break;
                }
                scope = scope.parent;
            }
        }
    }

    /**
     * Track opening/closing braces on a line to manage scope popping.
     * Only pops scopes when a closing brace matches the opening brace
     * that started a scope (proc body or namespace eval body).
     */
    private trackBraces(
        line: string,
        lineNum: number,
        lineOffset: number,
        scopeStack: ScopeNode[],
        braceStack: { offset: number; scopeIndex: number }[]
    ): void {
        let inString = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                let backslashes = 0;
                let j = i - 1;
                while (j >= 0 && line[j] === '\\') { backslashes++; j--; }
                if (backslashes % 2 === 0) {
                    inString = !inString;
                }
                continue;
            }
            if (inString) {
                continue;
            }
            if (ch === '\\') {
                i++; // skip escaped character
                continue;
            }
            if (ch === '{') {
                // Only push if this brace is NOT already tracked as a scope-opener
                // (detectProcDefinition/detectNamespaceEval already pushed their braces)
                const absOffset = lineOffset + i;
                if (!braceStack.some(b => b.offset === absOffset)) {
                    braceStack.push({ offset: absOffset, scopeIndex: -1 });
                }
            } else if (ch === '}') {
                if (braceStack.length > 0) {
                    const top = braceStack.pop()!;
                    if (top.scopeIndex >= 0 && top.scopeIndex < scopeStack.length) {
                        // This closing brace ends a scope
                        scopeStack.splice(top.scopeIndex);
                    }
                }
            }
        }
    }

    /** Parse a TCL parameter list like "a b {c default}" into parameter names. */
    private parseParamList(paramsText: string): string[] {
        const params: string[] = [];
        let i = 0;
        const text = paramsText.trim();

        while (i < text.length) {
            // Skip whitespace
            while (i < text.length && /\s/.test(text[i])) { i++; }
            if (i >= text.length) { break; }

            if (text[i] === '{') {
                // Param with default: {name default}
                const close = text.indexOf('}', i);
                if (close === -1) { break; }
                const inner = text.substring(i + 1, close).trim();
                const name = inner.split(/\s+/)[0];
                if (name && name !== 'args') {
                    params.push(name);
                } else if (name === 'args') {
                    params.push('args');
                }
                i = close + 1;
            } else {
                // Simple param name
                const start = i;
                while (i < text.length && !/\s/.test(text[i])) { i++; }
                const name = text.substring(start, i);
                if (name) {
                    params.push(name);
                }
            }
        }
        return params;
    }
}
