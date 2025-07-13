import * as vscode from 'vscode';

export class TclREPLProvider {
    private _terminal: vscode.Terminal | undefined;

    public async startREPL(): Promise<void> {
        if (this._terminal) {
            this._terminal.show();
            return;
        }

        // Get TCL interpreter path from configuration
        const config = vscode.workspace.getConfiguration('tcl');
        const tclPath = config.get<string>('repl.tclPath', 'tclsh');

        try {
            // Create a simple terminal that runs tclsh directly
            this._terminal = vscode.window.createTerminal({
                name: 'TCL REPL',
                shellPath: tclPath,
                iconPath: new vscode.ThemeIcon('terminal'),
                color: new vscode.ThemeColor('terminal.ansiBlue')
            });

            this._terminal.show();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to start TCL REPL: ${error}`);
        }
    }

    public async evaluateSelection(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage('No active editor');
            return;
        }

        const selection = editor.selection;
        let text: string;

        if (selection.isEmpty) {
            // If no selection, use the current line
            const line = editor.document.lineAt(selection.active.line);
            text = line.text.trim();
        } else {
            // Use the selected text
            text = editor.document.getText(selection);
        }

        if (!text) {
            vscode.window.showInformationMessage('No text to evaluate');
            return;
        }

        // Start REPL if not already running
        if (!this._terminal) {
            await this.startREPL();
        }

        // Send the text to the terminal
        this._terminal?.sendText(text);
        this._terminal?.show();
    }

    public async runCurrentFile(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'tcl') {
            vscode.window.showInformationMessage('No active TCL file');
            return;
        }

        // Save the file first
        await editor.document.save();

        const filePath = editor.document.fileName;
        
        // Start REPL if not already running
        if (!this._terminal) {
            await this.startREPL();
        }

        // Source the file in the REPL
        this._terminal?.sendText(`source "${filePath}"`);
        this._terminal?.show();
    }

    public dispose(): void {
        // Terminal will be disposed automatically by VS Code
    }
}

export class TclREPLCommands {
    private _replProvider: TclREPLProvider;

    constructor() {
        this._replProvider = new TclREPLProvider();
    }

    public registerCommands(context: vscode.ExtensionContext): void {
        // Register REPL commands
        context.subscriptions.push(
            vscode.commands.registerCommand('tcl.startREPL', () => {
                this._replProvider.startREPL();
            }),

            vscode.commands.registerCommand('tcl.evaluateSelection', () => {
                this._replProvider.evaluateSelection();
            }),

            vscode.commands.registerCommand('tcl.runCurrentFile', () => {
                this._replProvider.runCurrentFile();
            })
        );

        // Register disposal
        context.subscriptions.push(this._replProvider);
    }
}