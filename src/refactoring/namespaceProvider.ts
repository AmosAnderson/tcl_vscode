import * as vscode from 'vscode';
import { createNamespaceExtractionEdit } from './namespaceEdits';
import { procedureDeclarations } from '../analysis/procedures';

export class TclNamespaceExtractProvider implements vscode.CodeActionProvider {

    static readonly providedCodeActionKinds = [vscode.CodeActionKind.RefactorExtract];

    public createExtractionEdit = createNamespaceExtractionEdit;

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
            const edit = await this.createExtractionEdit(document, selection, namespaceName.trim());

            await vscode.workspace.applyEdit(edit);
            vscode.window.showInformationMessage(
                `Extracted ${procNames.length} procedure(s) into namespace '${namespaceName}'`
            );
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to extract to namespace: ${error}`);
        }
    }

    private containsProc(text: string): boolean { return procedureDeclarations(text).length > 0; }
    private findProcNames(text: string): string[] { return procedureDeclarations(text).map(proc => proc.name); }

    public registerCommands(context: vscode.ExtensionContext): void {
        context.subscriptions.push(
            vscode.commands.registerCommand('tcl.extractNamespace', async () => {
                await this.extractToNamespace();
            })
        );
    }
}
