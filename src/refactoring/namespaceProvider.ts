import * as vscode from 'vscode';

export class TclNamespaceExtractProvider implements vscode.CodeActionProvider {

    static readonly providedCodeActionKinds = [vscode.CodeActionKind.RefactorExtract];

    private static readonly procPattern = /^\s*proc\s+(\S+)\s+\{[^}]*\}\s*\{/gm;

    public provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        _context: vscode.CodeActionContext,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.CodeAction[]> {
        if (range.isEmpty) {
            return;
        }

        const selectedText = document.getText(range);
        if (!this.containsProc(selectedText)) {
            return;
        }

        const action = new vscode.CodeAction(
            'Extract to Namespace',
            vscode.CodeActionKind.RefactorExtract
        );
        action.command = {
            command: 'tcl.extractNamespace',
            title: 'Extract to Namespace'
        };

        return [action];
    }

    public async extractToNamespace(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor');
            return;
        }

        const selection = editor.selection;
        if (selection.isEmpty) {
            vscode.window.showInformationMessage('Select one or more procedure definitions to extract');
            return;
        }

        const document = editor.document;
        const selectedText = document.getText(selection);

        const procNames = this.findProcNames(selectedText);
        if (procNames.length === 0) {
            vscode.window.showInformationMessage('Select one or more procedure definitions to extract');
            return;
        }

        const namespaceName = await vscode.window.showInputBox({
            prompt: 'Enter namespace name',
            value: 'myNamespace',
            validateInput: (value) => {
                if (!value || !value.trim()) {
                    return 'Namespace name cannot be empty';
                }
                if (!/^[a-zA-Z_][a-zA-Z0-9_]*(::[a-zA-Z_][a-zA-Z0-9_]*)*$/.test(value.trim())) {
                    return 'Invalid TCL namespace name';
                }
                return null;
            }
        });

        if (!namespaceName) {
            return;
        }

        try {
            const namespaceBlock = this.buildNamespaceBlock(namespaceName.trim(), selectedText);
            const edit = new vscode.WorkspaceEdit();
            const uri = document.uri;

            // Replace selection with the namespace block
            edit.replace(uri, selection, namespaceBlock);

            // Update call sites outside the selection
            this.updateCallSites(edit, document, selection, procNames, namespaceName.trim());

            await vscode.workspace.applyEdit(edit);
            vscode.window.showInformationMessage(
                `Extracted ${procNames.length} procedure(s) into namespace '${namespaceName}'`
            );
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to extract to namespace: ${error}`);
        }
    }

    private containsProc(text: string): boolean {
        return /^\s*proc\s+\S+\s+\{/m.test(text);
    }

    private findProcNames(text: string): string[] {
        const names: string[] = [];
        const pattern = /^\s*proc\s+(\S+)\s+\{/gm;
        let match;
        while ((match = pattern.exec(text)) !== null) {
            names.push(match[1]);
        }
        return names;
    }

    private buildNamespaceBlock(namespaceName: string, selectedText: string): string {
        const indented = selectedText
            .split('\n')
            .map(line => line.length > 0 ? `    ${line}` : line)
            .join('\n');

        return `namespace eval ::${namespaceName} {\n    namespace export *\n\n${indented}\n}`;
    }

    private updateCallSites(
        edit: vscode.WorkspaceEdit,
        document: vscode.TextDocument,
        selection: vscode.Selection,
        procNames: string[],
        namespaceName: string
    ): void {
        const fullText = document.getText();
        const selectionStart = document.offsetAt(selection.start);
        const selectionEnd = document.offsetAt(selection.end);
        const qualifiedPrefix = `${namespaceName}::`;

        for (const procName of procNames) {
            const escaped = procName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            // Match bare calls: procName at word boundary (not already namespace-qualified)
            const barePattern = new RegExp(`(?<![:\\w])${escaped}(?=\\s|\\])`, 'g');
            // Match calls inside brackets: [procName ...]
            const bracketPattern = new RegExp(`(\\[)${escaped}(?=\\s|\\])`, 'g');

            let match;

            // We need to find occurrences outside the selection range.
            // Process bare calls first.
            while ((match = barePattern.exec(fullText)) !== null) {
                const matchStart = match.index;
                const matchEnd = matchStart + procName.length;

                // Skip if inside the selection
                if (matchStart >= selectionStart && matchEnd <= selectionEnd) {
                    continue;
                }

                const startPos = document.positionAt(matchStart);
                const endPos = document.positionAt(matchEnd);
                const range = new vscode.Range(startPos, endPos);
                edit.replace(document.uri, range, `${qualifiedPrefix}${procName}`);
            }
        }
    }

    public registerCommands(context: vscode.ExtensionContext): void {
        context.subscriptions.push(
            vscode.commands.registerCommand('tcl.extractNamespace', async () => {
                await this.extractToNamespace();
            })
        );
    }
}
