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
            const lineRange = new vscode.Range(
                range.start.line, line.firstNonWhitespaceCharacterIndex,
                range.start.line, line.text.length
            );
            
            const indentedText = line.text.substring(0, line.firstNonWhitespaceCharacterIndex);
            const statementText = line.text.substring(line.firstNonWhitespaceCharacterIndex);
            const newText = `${indentedText}{\n${indentedText}    ${statementText}\n${indentedText}}`;
            
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