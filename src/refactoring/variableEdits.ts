import * as vscode from 'vscode';
import { DocumentSymbolTable } from '../analysis/symbolTable';
import { getScriptWords, isStaticWord, parseTclScript, TclCommand, walkTclCommands } from '../utils/tclParser';

function scriptCommands(text: string): TclCommand[] {
    const result: TclCommand[] = [];
    const visit = (start: number, end: number) => {
        for (const command of parseTclScript(text, start, end).commands) {
            result.push(command);
            for (const body of getScriptWords(command)) visit(body.contentStart, body.contentEnd);
        }
    };
    visit(0, text.length);
    return result;
}

export function createVariableExtractionEdit(document: vscode.TextDocument, range: vscode.Range, name: string): vscode.WorkspaceEdit {
    if (!/^[\p{L}_][\p{L}\p{N}_]*$/u.test(name)) throw new Error('Invalid variable name');
    const text = document.getText(), start = document.offsetAt(range.start), end = document.offsetAt(range.end);
    const command = scriptCommands(text).find(command => command.words.slice(1).some(word => word.start === start && word.end === end));
    if (!command || command.words.some(word => word.expanded)) throw new Error('Select a complete argument in an executable command');
    const index = command.words.findIndex(word => word.start === start && word.end === end);
    const word = command.words[index];
    // Moving a delayed script/expression or a substitution ahead of earlier arguments changes evaluation.
    if (!['set', 'puts', 'list', 'append', 'lappend', 'string', 'dict', 'lindex', 'format'].includes(command.words[0].value.replace(/^::/, '')) ||
        command.words.slice(0, index).some(argument => !isStaticWord(argument))) throw new Error('This argument cannot be moved without changing evaluation order');
    const table = new DocumentSymbolTable(document); table.parse();
    if (table.getVisibleSymbols(range.start).some(symbol => symbol.name === name) ||
        table.getVariableUsages().some(usage => usage.name === name)) throw new Error('The variable name is already in use');
    const edit = new vscode.WorkspaceEdit();
    const indent = document.lineAt(document.positionAt(command.start).line).text.match(/^[ \t]*/)?.[0] ?? '';
    const newline = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    edit.insert(document.uri, document.positionAt(command.start), `set ${name} ${word.text}${newline}${indent}`);
    edit.replace(document.uri, range, `$${name}`);
    return edit;
}

export function createVariableInlineEdit(document: vscode.TextDocument, position: vscode.Position): vscode.WorkspaceEdit {
    const text = document.getText();
    const table = new DocumentSymbolTable(document); table.parse();
    const symbol = table.getSymbolAt(position);
    if (!symbol || symbol.kind !== 'variable' || symbol.aliasOf || !['local', 'global'].includes(symbol.scope)) throw new Error('Select a variable with one literal assignment');
    const scope = table.getScopeAt(position);
    const commands = scriptCommands(text);
    const assignment = commands.find(command => command.words[0]?.value.replace(/^::/, '') === 'set' && command.words.length === 3 &&
        table.getSymbolAt(document.positionAt(command.words[1].contentStart)) === symbol);
    if (!assignment || !isStaticWord(assignment.words[2])) throw new Error('Only literal values can be inlined without repeating evaluation');
    const enclosingBodies = walkTclCommands(text).filter(command => getScriptWords(command).some(body => body.contentStart <= assignment.start && body.contentEnd >= assignment.end));
    if (enclosingBodies.some(command => command.start !== document.offsetAt(scope.range.start) || !['proc', 'method', 'constructor', 'destructor', 'apply'].includes(command.words[0].value.replace(/^::/, '')))) {
        throw new Error('The assignment may not execute before every read');
    }
    const value = assignment.words[2];
    const usages = table.getVariableUsages().filter(usage => usage.symbol === symbol);
    if (!usages.length) throw new Error('The variable has no resolved reads');
    const reads = new Set(usages.map(usage => document.offsetAt(usage.range.start)));
    if ([symbol.range, ...symbol.references].some(ref => document.offsetAt(ref.start) !== assignment.words[1].contentStart && !reads.has(document.offsetAt(ref.start)))) {
        throw new Error('The variable is assigned, mutated, or aliased more than once');
    }
    const scopeCommands = walkTclCommands(text).filter(command => scope.range.contains(document.positionAt(command.start)));
    const independentCommands = new Set(['set', 'puts', 'list', 'llength', 'lindex', 'lrange', 'linsert', 'lreplace', 'lsearch', 'lsort', 'split', 'join', 'string', 'format', 'expr', 'if', 'for', 'foreach', 'lmap', 'while', 'switch', 'catch', 'try', 'return', 'break', 'continue', 'error', 'incr', 'append', 'lappend', 'lset', 'unset']);
    if (scopeCommands.some(command => {
        const name = command.words[0]?.value.replace(/^::/, '');
        if (command.start === document.offsetAt(scope.range.start) && ['proc', 'method', 'constructor', 'destructor', 'apply'].includes(name)) return false;
        return !isStaticWord(command.words[0]) || !independentCommands.has(name);
    })) {
        throw new Error('Dynamic scope or introspection prevents safe variable inlining');
    }
    const edit = new vscode.WorkspaceEdit();
    for (const usage of usages) {
        const start = document.offsetAt(usage.range.start), end = document.offsetAt(usage.range.end);
        if (start < assignment.end) throw new Error('The variable is read before its assignment');
        const braced = text.slice(start - 2, start) === '${' && text[end] === '}';
        const from = braced ? start - 2 : start - 1;
        if (!braced && text[from] !== '$' || text[end] === '(') throw new Error('Unsupported variable reference');
        // format %s returns the exact literal value in bare words, quotes and expressions.
        edit.replace(document.uri, new vscode.Range(document.positionAt(from), document.positionAt(braced ? end + 1 : end)), `[::format %s ${value.text}]`);
    }
    // Remove only this command, preserving adjacent semicolon commands and comments.
    edit.delete(document.uri, new vscode.Range(document.positionAt(assignment.start), document.positionAt(assignment.end)));
    return edit;
}
