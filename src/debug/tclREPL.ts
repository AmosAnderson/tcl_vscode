import * as vscode from 'vscode';
import { which, escapeTclString } from '../utils/tclUtils';
import { activeTclResource, resolveTclCwd, resolveTclInterpreter } from '../tools/executionContext';

/** Patterns that indicate potentially dangerous TCL commands (shell-out, file I/O). */
const DANGEROUS_TCL_PATTERNS = /\b(exec\s|open\s+\|)/;

interface ReplHost {
    interpreter(resource?: vscode.Uri): string;
    cwd(resource?: vscode.Uri): string | undefined;
    which(command: string): Promise<string | null>;
    createTerminal(options: vscode.TerminalOptions): vscode.Terminal;
    onDidCloseTerminal(listener: (terminal: vscode.Terminal) => void): vscode.Disposable;
}

export class TclREPLProvider {
    private _terminal: vscode.Terminal | undefined;

    private starting: Promise<void> | undefined;
    private terminalContext: string | undefined;
    private disposed = false;
    private readonly closeSubscription: vscode.Disposable;
    constructor(private readonly host: ReplHost = {
        interpreter: resource => resolveTclInterpreter(resource, 'repl'), cwd: resolveTclCwd, which,
        createTerminal: options => vscode.window.createTerminal(options), onDidCloseTerminal: vscode.window.onDidCloseTerminal
    }) {
        this.closeSubscription = host.onDidCloseTerminal(terminal => {
            if (this._terminal === terminal) { this._terminal = undefined; this.terminalContext = undefined; }
        });
    }

    public async startREPL(resource = activeTclResource()): Promise<void> {
        if (this.starting) { await this.starting; return this.startREPL(resource); }
        if (this.disposed) return;
        const tclPath = this.host.interpreter(resource);
        const cwd = this.host.cwd(resource);
        const key = JSON.stringify([tclPath, cwd]);
        if (this._terminal && this.terminalContext === key) { this._terminal.show(); return; }
        this._terminal?.dispose();
        this._terminal = undefined;
        this.terminalContext = undefined;
        this.starting = (async () => {
            const resolvedPath = await this.host.which(tclPath);
            if (!resolvedPath) {
                vscode.window.showErrorMessage(`TCL interpreter not found: "${tclPath}". Check the interpreter settings.`);
                return;
            }
            if (this.disposed) return;
            this._terminal?.dispose();
            this._terminal = this.host.createTerminal({ name: 'TCL REPL', shellPath: resolvedPath, cwd,
                iconPath: new vscode.ThemeIcon('terminal'), color: new vscode.ThemeColor('terminal.ansiBlue') });
            this.terminalContext = key;
            this._terminal.show();
        })();
        try { await this.starting; } catch (error) { vscode.window.showErrorMessage(`Failed to start TCL REPL: ${error}`); }
        finally { this.starting = undefined; }
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

        // Warn when code contains commands that can execute system processes
        if (DANGEROUS_TCL_PATTERNS.test(text)) {
            const choice = await vscode.window.showWarningMessage(
                'The selected code contains commands that can execute system processes (exec, open |). Evaluate anyway?',
                { modal: true },
                'Evaluate'
            );
            if (choice !== 'Evaluate') {
                return;
            }
        }

        // Start REPL if not already running
        await this.startREPL(editor.document.uri);

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
        if (!await editor.document.save() || editor.document.isUntitled) return;

        const filePath = editor.document.fileName;
        
        // Start REPL if not already running
        await this.startREPL(editor.document.uri);

        // Source the file in the REPL using double-quote quoting with proper escaping
        this._terminal?.sendText(`source "${escapeTclString(filePath)}"`);
        this._terminal?.show();
    }

    public dispose(): void {
        this.disposed = true;
        this.closeSubscription.dispose();
        this._terminal?.dispose();
        this._terminal = undefined;
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
            vscode.commands.registerCommand('tcl.startREPL', async () => {
                await this._replProvider.startREPL();
            }),

            vscode.commands.registerCommand('tcl.evaluateSelection', async () => {
                await this._replProvider.evaluateSelection();
            }),

            vscode.commands.registerCommand('tcl.runCurrentFile', async () => {
                await this._replProvider.runCurrentFile();
            })
        );

        // Register disposal
        context.subscriptions.push(this._replProvider);
    }
}