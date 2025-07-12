import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';

export class TclREPLProvider {
    private _terminal: vscode.Terminal | undefined;
    private _tclProcess: ChildProcess | undefined;
    private _outputChannel: vscode.OutputChannel;

    constructor() {
        this._outputChannel = vscode.window.createOutputChannel('TCL REPL');
    }

    public async startREPL(): Promise<void> {
        if (this._terminal) {
            this._terminal.show();
            return;
        }

        // Get TCL interpreter path from configuration
        const config = vscode.workspace.getConfiguration('tcl');
        const tclPath = config.get<string>('repl.tclPath', 'tclsh');

        try {
            // Create a pseudo-terminal for the REPL
            const writeEmitter = new vscode.EventEmitter<string>();
            const pty: vscode.Pseudoterminal = {
                onDidWrite: writeEmitter.event,
                open: () => {
                    this.startTclProcess(tclPath, writeEmitter);
                },
                close: () => {
                    this.stopTclProcess();
                },
                handleInput: (data: string) => {
                    if (this._tclProcess && this._tclProcess.stdin) {
                        this._tclProcess.stdin.write(data);
                    }
                }
            };

            this._terminal = vscode.window.createTerminal({
                name: 'TCL REPL',
                pty: pty
            });

            this._terminal.show();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to start TCL REPL: ${error}`);
        }
    }

    private startTclProcess(tclPath: string, writeEmitter: vscode.EventEmitter<string>): void {
        this._tclProcess = spawn(tclPath, [], {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        if (!this._tclProcess.pid) {
            writeEmitter.fire('Failed to start TCL interpreter\r\n');
            return;
        }

        writeEmitter.fire('TCL REPL started. Type TCL commands and press Enter.\r\n');
        writeEmitter.fire('Type "exit" to close the REPL.\r\n\r\n');
        writeEmitter.fire('% ');

        this._tclProcess.stdout?.on('data', (data) => {
            const output = data.toString();
            writeEmitter.fire(output);
            if (!output.endsWith('% ')) {
                writeEmitter.fire('\r\n% ');
            }
        });

        this._tclProcess.stderr?.on('data', (data) => {
            writeEmitter.fire(`Error: ${data.toString()}\r\n% `);
        });

        this._tclProcess.on('exit', (code) => {
            writeEmitter.fire(`\r\nTCL process exited with code ${code}\r\n`);
            this._tclProcess = undefined;
        });
    }

    private stopTclProcess(): void {
        if (this._tclProcess) {
            this._tclProcess.kill();
            this._tclProcess = undefined;
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
            // Wait a moment for the REPL to initialize
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Send the text to the REPL
        if (this._tclProcess && this._tclProcess.stdin) {
            this._tclProcess.stdin.write(text + '\n');
        }

        // Show the terminal
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
            // Wait a moment for the REPL to initialize
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Source the file in the REPL
        if (this._tclProcess && this._tclProcess.stdin) {
            this._tclProcess.stdin.write(`source "${filePath}"\n`);
        }

        // Show the terminal
        this._terminal?.show();
    }

    public dispose(): void {
        this.stopTclProcess();
        this._outputChannel.dispose();
        if (this._terminal) {
            this._terminal.dispose();
        }
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