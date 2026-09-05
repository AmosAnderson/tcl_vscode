import * as vscode from 'vscode';
import { isStaticWord, walkTclCommands } from '../utils/tclParser';

/** Source-span fixes; unsupported substitutions never receive speculative edits. */
export class TclCodeActionProvider implements vscode.CodeActionProvider {
    public provideCodeActions(document: vscode.TextDocument, _range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext, _token: vscode.CancellationToken): vscode.CodeAction[] {
        const text = document.getText(), commands = walkTclCommands(text), actions: vscode.CodeAction[] = [];
        for (const diagnostic of context.diagnostics) {
            const offset = document.offsetAt(diagnostic.range.start);
            const command = commands.find(candidate => candidate.start === offset);
            if (!command || !isStaticWord(command.words[0]) || command.words.some(word => word.expanded)) continue;
            const w = command.words, edit = new vscode.WorkspaceEdit();
            let title = '';
            if (diagnostic.source === 'tcl-lint' && diagnostic.code === 'tcl-lint-expr-bracing' && w[0].value.replace(/^::/, '') === 'expr' && w.length > 1) {
                if (w.slice(1).some(word => word.kind !== 'bare')) continue;
                const from = w[1].start, to = w[w.length - 1].end;
                const expression = text.slice(from, to);
                let numeric = expression;
                let safe = true;
                for (const word of w.slice(1).reverse()) for (const sub of [...word.commandSubstitutions].reverse()) {
                    const inner = word.substitutions.find(candidate => candidate.start === sub.start + 1);
                    const name = inner?.words[0]?.value.replace(/^::/, '');
                    if (!(name === 'llength' || name === 'string' && inner?.words[1]?.value === 'length')) safe = false;
                    numeric = numeric.slice(0, sub.start - from) + '0' + numeric.slice(sub.end - from);
                }
                // Bracing must not delay a short-circuited command or reinterpret variable values.
                if (!safe || /[&|?:$\\]/.test(numeric) || !/^[\s\dA-Fa-fxXobOB.eE+*/%()!<>=~-]+$/.test(numeric)) continue;
                edit.replace(document.uri, new vscode.Range(document.positionAt(from), document.positionAt(to)), `{${expression}}`);
                title = 'Brace the expr argument';
            } else if (diagnostic.source === 'tcl-lint' && diagnostic.code === 'tcl-lint-catch-no-var' && w[0].value.replace(/^::/, '') === 'catch' && w.length === 2) {
                let name = 'result';
                for (let i = 2; text.includes(name); i++) name = `result${i}`;
                edit.insert(document.uri, document.positionAt(command.end), ` ${name}`);
                title = `Store the catch result in '${name}'`;
            }
            if (title) {
                const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
                action.edit = edit; action.diagnostics = [diagnostic]; actions.push(action);
            }
        }
        return actions;
    }
}
