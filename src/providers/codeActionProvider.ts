import * as vscode from 'vscode';

export class TclCodeActionProvider implements vscode.CodeActionProvider {
    
    public provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<(vscode.Command | vscode.CodeAction)[]> {
        
        const actions: vscode.CodeAction[] = [];

        // Process each diagnostic to provide quick fixes
        for (const diagnostic of context.diagnostics) {
            if (diagnostic.source === 'tcl') {
                const quickFix = this.createQuickFix(document, diagnostic);
                if (quickFix) {
                    actions.push(quickFix);
                }
            } else if (diagnostic.source === 'tcl-lint') {
                const quickFix = this.createLintQuickFix(document, diagnostic);
                if (quickFix) {
                    actions.push(quickFix);
                }
            }
        }

        // Add general code actions
        actions.push(...this.getGeneralCodeActions(document, range));

        return actions;
    }

    private createQuickFix(document: vscode.TextDocument, diagnostic: vscode.Diagnostic): vscode.CodeAction | null {
        const message = diagnostic.message;
        const range = diagnostic.range;

        // Fix missing space after control keywords
        if (message.includes("Missing space after")) {
            const match = message.match(/Missing space after '(\w+)'/);
            if (match) {
                const keyword = match[1];
                const action = new vscode.CodeAction(
                    `Add space after '${keyword}'`,
                    vscode.CodeActionKind.QuickFix
                );

                const line = document.lineAt(range.start.line);
                const text = line.text;
                const keywordPos = text.indexOf(`${keyword}{`);

                if (keywordPos !== -1) {
                    const edit = new vscode.WorkspaceEdit();
                    const insertPos = new vscode.Position(range.start.line, keywordPos + keyword.length);
                    edit.insert(document.uri, insertPos, ' ');
                    action.edit = edit;
                    action.diagnostics = [diagnostic];
                    return action;
                }
            }
        }

        // Fix command substitution backticks
        if (message.includes("Use [command] instead of `command`")) {
            const action = new vscode.CodeAction(
                'Replace backticks with [command] syntax',
                vscode.CodeActionKind.QuickFix
            );
            
            const line = document.lineAt(range.start.line);
            const text = line.text;
            
            // Simple replacement for basic cases
            const backquotePattern = /`([^`]+)`/g;
            const newText = text.replace(backquotePattern, '[$1]');
            
            if (newText !== text) {
                const edit = new vscode.WorkspaceEdit();
                const lineRange = new vscode.Range(
                    range.start.line, 0,
                    range.start.line, text.length
                );
                edit.replace(document.uri, lineRange, newText);
                action.edit = edit;
                action.diagnostics = [diagnostic];
                return action;
            }
        }

        // Fix unmatched braces/brackets
        if (message.includes("Unmatched closing")) {
            const action = new vscode.CodeAction(
                'Remove unmatched closing brace/bracket',
                vscode.CodeActionKind.QuickFix
            );
            
            const edit = new vscode.WorkspaceEdit();
            edit.delete(document.uri, range);
            action.edit = edit;
            action.diagnostics = [diagnostic];
            return action;
        }

        // Fix unclosed braces/brackets
        if (message.includes("Unclosed")) {
            const isUnclosedBrace = message.includes("brace");
            const closingChar = isUnclosedBrace ? '}' : ']';
            
            const action = new vscode.CodeAction(
                `Add missing ${isUnclosedBrace ? 'closing brace' : 'closing bracket'}`,
                vscode.CodeActionKind.QuickFix
            );
            
            const edit = new vscode.WorkspaceEdit();
            const endPos = new vscode.Position(range.end.line, range.end.character);
            edit.insert(document.uri, endPos, closingChar);
            action.edit = edit;
            action.diagnostics = [diagnostic];
            return action;
        }

        return null;
    }

    private createLintQuickFix(document: vscode.TextDocument, diagnostic: vscode.Diagnostic): vscode.CodeAction | null {
        if (diagnostic.code === 'tcl-lint-expr-bracing') {
            const line = document.lineAt(diagnostic.range.start.line);
            const text = line.text;

            // Find the expr command and wrap its arguments in braces
            const exprMatch = text.match(/\bexpr\s+(.+)/);
            if (exprMatch) {
                const exprStart = text.indexOf(exprMatch[0]);
                const argsStart = exprStart + 'expr '.length;
                // Find where the expr arguments end (end of line or before ; or ])
                let argsText = exprMatch[1];
                // Strip trailing ] or ; context
                argsText = argsText.replace(/\s*[\];].*$/, '');

                const action = new vscode.CodeAction(
                    'Brace the expr argument',
                    vscode.CodeActionKind.QuickFix
                );
                const edit = new vscode.WorkspaceEdit();
                const replaceRange = new vscode.Range(
                    diagnostic.range.start.line, argsStart,
                    diagnostic.range.start.line, argsStart + argsText.length
                );
                edit.replace(document.uri, replaceRange, `{${argsText}}`);
                action.edit = edit;
                action.diagnostics = [diagnostic];
                return action;
            }
        }

        if (diagnostic.code === 'tcl-lint-catch-no-var') {
            const line = document.lineAt(diagnostic.range.start.line);
            const text = line.text;

            // Add a result variable to catch
            const catchMatch = text.match(/(\bcatch\s+\{[^}]*\})\s*$/);
            if (catchMatch) {
                const action = new vscode.CodeAction(
                    'Add result variable to catch',
                    vscode.CodeActionKind.QuickFix
                );
                const edit = new vscode.WorkspaceEdit();
                const insertPos = new vscode.Position(
                    diagnostic.range.start.line,
                    text.indexOf(catchMatch[0]) + catchMatch[1].length
                );
                edit.insert(document.uri, insertPos, ' result');
                action.edit = edit;
                action.diagnostics = [diagnostic];
                return action;
            }
        }

        return null;
    }

    private getGeneralCodeActions(document: vscode.TextDocument, range: vscode.Range): vscode.CodeAction[] {
        const actions: vscode.CodeAction[] = [];

        // Add braces around single statement
        const line = document.lineAt(range.start.line);
        const text = line.text.trim();
        
        if (this.isSingleStatementLine(text)) {
            const action = new vscode.CodeAction(
                'Add braces around statement',
                vscode.CodeActionKind.Refactor
            );
            
            const edit = new vscode.WorkspaceEdit();
            const indent = line.text.substring(0, line.firstNonWhitespaceCharacterIndex);
            const statementText = line.text.substring(line.firstNonWhitespaceCharacterIndex);
            const lineRange = new vscode.Range(
                range.start.line, 0,
                range.start.line, line.text.length
            );

            const newText = `${indent}{\n${indent}    ${statementText}\n${indent}}`;

            edit.replace(document.uri, lineRange, newText);
            action.edit = edit;
            actions.push(action);
        }

        // Convert variable to array access
        const varMatch = text.match(/\$([a-zA-Z_][a-zA-Z0-9_]*)/);
        if (varMatch && range.start.character >= text.indexOf(varMatch[0])) {
            const action = new vscode.CodeAction(
                'Convert to array access',
                vscode.CodeActionKind.Refactor
            );
            
            const varName = varMatch[1];
            const edit = new vscode.WorkspaceEdit();
            const varPos = text.indexOf(varMatch[0]);
            const varRange = new vscode.Range(
                range.start.line, varPos,
                range.start.line, varPos + varMatch[0].length
            );
            
            edit.replace(document.uri, varRange, `$${varName}(key)`);
            action.edit = edit;
            actions.push(action);
        }

        return actions;
    }

    private isSingleStatementLine(text: string): boolean {
        // Check if line contains a single statement that could benefit from braces
        const controlKeywords = /^\s*(if|while|for|foreach)\s+/;
        if (!controlKeywords.test(text)) {
            return false;
        }

        // Check if it doesn't already have braces
        const hasBraces = text.includes('{') && text.includes('}');
        return !hasBraces;
    }
}