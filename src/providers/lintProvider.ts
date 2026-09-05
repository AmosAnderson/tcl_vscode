import * as vscode from 'vscode';
import { getScriptWords, isStaticWord, parseTclList, parseTclScript, walkTclCommands } from '../utils/tclParser';
import { DocumentSymbolTable } from '../analysis/symbolTable';

export class TclLintProvider implements vscode.Disposable {
    private readonly collection = vscode.languages.createDiagnosticCollection('tcl-lint');

    public lint(document: vscode.TextDocument): vscode.Diagnostic[] {
        if (document.languageId !== 'tcl') return [];
        const config = vscode.workspace.getConfiguration('tcl', document.uri);
        if (!config.get<boolean>('lint.enable', true)) { this.clear(document.uri); return []; }
        const text = document.getText(), diagnostics: vscode.Diagnostic[] = [];
        const rules = config.get<Record<string, string>>('lint.rules', {});
        const suppressed = new Map<number, Set<string>>();
        const comments = (from: number, to: number): void => {
            let cursor = from;
            const parsed = parseTclScript(text, from, to);
            const gap = (end: number) => {
                const value = text.slice(cursor, end);
                for (const match of value.matchAll(/#\s*tcl-lint-disable-next-line\s+([^\r\n]+)/g)) {
                    const line = document.positionAt(cursor + match.index!).line + 1;
                    suppressed.set(line, new Set(match[1].trim().split(/[\s,]+/)));
                }
            };
            for (const command of parsed.commands) { gap(command.start); cursor = command.end; for (const body of getScriptWords(command)) comments(body.contentStart, body.contentEnd); }
            gap(to);
        };
        comments(0, text.length);
        const add = (rule: string, start: number, end: number, message: string, fallback = vscode.DiagnosticSeverity.Warning) => {
            const position = document.positionAt(start), disabled = suppressed.get(position.line);
            if (rules[rule] === 'off' || disabled?.has(rule) || disabled?.has('all')) return;
            const severities: Record<string, vscode.DiagnosticSeverity> = { error: 0, warning: 1, information: 2, hint: 3 };
            const diagnostic = new vscode.Diagnostic(new vscode.Range(position, document.positionAt(end)), message, severities[rules[rule]] ?? fallback);
            diagnostic.code = `tcl-lint-${rule}`; diagnostic.source = 'tcl-lint'; diagnostics.push(diagnostic);
        };
        for (const command of walkTclCommands(text)) {
            const w = command.words;
            if (!isStaticWord(w[0]) || w.some(word => word.expanded)) continue;
            const name = w[0].value.replace(/^::/, '');
            if (name === 'expr' && w.length > 1 && !(w.length === 2 && w[1].kind === 'braced') && config.get<boolean>('lint.exprBracing', true)) {
                add('expr-bracing', command.start, command.end, 'Consider bracing the expr argument to avoid double substitution');
            }
            if (name === 'catch' && w.length === 2) add('catch-no-var', command.start, command.end, 'catch without a result variable discards the error message');
            if (name === 'string' && ['bytelength', 'wordend', 'wordstart'].includes(w[1]?.value)) add('deprecated', command.start, w[1].end, `Review use of legacy command 'string ${w[1].value}'`);
            if (name === 'switch') {
                let i = 1;
                while (w[i]?.value.startsWith('-')) { const option = w[i++].value; if (option === '--') break; if (['-matchvar', '-indexvar'].includes(option)) i++; }
                i++;
                const parsed = w.length - i === 1 && w[i].kind === 'braced' ? parseTclList(text, w[i].contentStart, w[i].contentEnd) : { words: w.slice(i), errors: [] };
                if (!parsed.errors.length && parsed.words.length >= 2 && parsed.words.length % 2 === 0 && !parsed.words.some((word, index) => index % 2 === 0 && isStaticWord(word) && word.value === 'default')) {
                    add('switch-default', command.start, w[0].end, 'switch statement has no default clause', vscode.DiagnosticSeverity.Information);
                }
            }
        }
        const maximum = config.get<number>('lint.maxLineLength', 120);
        if (maximum > 0) for (let line = 0; line < document.lineCount; line++) {
            const value = document.lineAt(line);
            if (value.text.length > maximum) add('line-length', document.offsetAt(new vscode.Position(line, maximum)), document.offsetAt(value.range.end), `Line exceeds ${maximum} characters`, vscode.DiagnosticSeverity.Information);
        }
        const table = new DocumentSymbolTable(document); table.parse();
        const globals = new Map<string, ReturnType<DocumentSymbolTable['getVariableUsages']>>();
        for (const usage of table.getVariableUsages()) {
            const scope = table.getScopeAt(usage.range.start);
            if (!usage.name.startsWith('::') || scope.kind !== 'procedure') continue;
            const key = `${scope.range.start.line}:${scope.range.start.character}:${usage.name}`;
            const items = globals.get(key) ?? []; items.push(usage); globals.set(key, items);
        }
        for (const usages of globals.values()) if (usages.length >= 3) {
            add('global-shorthand', document.offsetAt(usages[0].range.start), document.offsetAt(usages[0].range.end), `Consider a global declaration for repeated '${usages[0].name}' references`, vscode.DiagnosticSeverity.Information);
        }
        this.collection.set(document.uri, diagnostics);
        return diagnostics;
    }

    public clear(uri: vscode.Uri): void { this.collection.delete(uri); }
    public dispose(): void { this.collection.dispose(); }
}
