import * as vscode from 'vscode';
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind,
    ExecutableOptions,
    Executable,
    State
} from 'vscode-languageclient/node';
import { ServerCapabilities } from 'vscode-languageserver-protocol';

let client: LanguageClient | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;

export interface LanguageServerActivationResult {
    status: 'disabled' | 'unavailable' | 'started' | 'failed';
    client?: LanguageClient;
    capabilities?: ServerCapabilities;
}

export async function activateLanguageServer(context: vscode.ExtensionContext): Promise<LanguageServerActivationResult> {
    const config = vscode.workspace.getConfiguration('tcl');
    const enabled = config.get<boolean>('languageServer.enable', true);

    if (!enabled) {
        vscode.window.showInformationMessage('TCL Language Server is disabled. Enable it in settings to use enhanced features.');
        return { status: 'disabled' };
    }

    const serverCommand = config.get<string>('languageServer.path', 'tcl-language-server');

    // Check if the language server is available
    const isAvailable = await checkLanguageServerAvailability(serverCommand);
    if (!isAvailable) {
        const action = await vscode.window.showWarningMessage(
            `TCL Language Server not found at "${serverCommand}". Install from https://github.com/AmosAnderson/tcl_languageserver`,
            'Open GitHub',
            'Configure Path',
            'Disable'
        );

        if (action === 'Open GitHub') {
            vscode.env.openExternal(vscode.Uri.parse('https://github.com/AmosAnderson/tcl_languageserver'));
        } else if (action === 'Configure Path') {
            vscode.commands.executeCommand('workbench.action.openSettings', 'tcl.languageServer.path');
        } else if (action === 'Disable') {
            await config.update('languageServer.enable', false, vscode.ConfigurationTarget.Global);
        }
        return { status: 'unavailable' };
    }

    try {
        // Server executable options
        const run: Executable = {
            command: serverCommand,
            options: {}
        };

        const debug: Executable = {
            command: serverCommand,
            options: {}
        };

        // Server options
        const serverOptions: ServerOptions = {
            run,
            debug
        };

        // Client options
        const clientOptions: LanguageClientOptions = {
            documentSelector: [
                { scheme: 'file', language: 'tcl' },
                { scheme: 'untitled', language: 'tcl' }
            ],
            synchronize: {
                fileEvents: vscode.workspace.createFileSystemWatcher('**/*.{tcl,tk,tm,test}')
            },
            outputChannelName: 'TCL Language Server',
            traceOutputChannel: vscode.window.createOutputChannel('TCL Language Server Trace'),
            revealOutputChannelOn: 4 // RevealOutputChannelOn.Never
        };

        // Create the language client
        client = new LanguageClient(
            'tclLanguageServer',
            'TCL Language Server',
            serverOptions,
            clientOptions
        );

        // Create status bar item
        statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 0);
        context.subscriptions.push(statusBarItem);

        // Update status bar on state change
        client.onDidChangeState((event) => {
            updateStatusBarItem(event.newState);
        });

        // Start the client and server
        await client.start();

        // Initial status update (in case state change didn't fire or we want to be sure)
        updateStatusBarItem(State.Running);

        vscode.window.showInformationMessage('TCL Language Server started successfully');

        // Register commands
        registerLanguageServerCommands(context);

        return {
            status: 'started',
            client,
            capabilities: client.initializeResult?.capabilities
        };
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to start TCL Language Server: ${error}`);
        console.error('Language Server Error:', error);
        return { status: 'failed' };
    }
}

export async function deactivateLanguageServer(): Promise<void> {
    if (statusBarItem) {
        statusBarItem.dispose();
        statusBarItem = undefined;
    }
    if (client) {
        await client.stop();
        client = undefined;
    }
}

export function getLanguageClient(): LanguageClient | undefined {
    return client;
}

function updateStatusBarItem(state: State): void {
    if (!statusBarItem) {
        return;
    }

    switch (state) {
        case State.Starting:
            statusBarItem.text = '$(sync~spin) TCL Server';
            statusBarItem.tooltip = 'TCL Language Server is starting...';
            statusBarItem.show();
            break;
        case State.Running:
            statusBarItem.text = '$(check) TCL Server';
            statusBarItem.tooltip = 'TCL Language Server is running';
            statusBarItem.command = 'tcl.languageServerStatus';
            statusBarItem.show();
            break;
        case State.Stopped:
            statusBarItem.text = '$(circle-slash) TCL Server';
            statusBarItem.tooltip = 'TCL Language Server is stopped';
            statusBarItem.show();
            break;
    }
}

async function checkLanguageServerAvailability(command: string): Promise<boolean> {
    try {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);

        // Try to execute the command with --version or --help to check if it exists
        await execAsync(`${command} --version`, { timeout: 5000 });
        return true;
    } catch (error) {
        // If command fails, try without arguments
        try {
            const { exec } = require('child_process');
            const { promisify } = require('util');
            const execAsync = promisify(exec);

            await execAsync(`which ${command}`, { timeout: 5000 });
            return true;
        } catch {
            return false;
        }
    }
}

function registerLanguageServerCommands(context: vscode.ExtensionContext): void {
    // Restart language server command
    context.subscriptions.push(
        vscode.commands.registerCommand('tcl.restartLanguageServer', async () => {
            if (client) {
                await client.stop();
                await client.start();
                vscode.window.showInformationMessage('TCL Language Server restarted');
            }
        })
    );

    // Show language server output
    context.subscriptions.push(
        vscode.commands.registerCommand('tcl.showLanguageServerOutput', () => {
            if (client) {
                client.outputChannel.show();
            }
        })
    );

    // Show language server status
    context.subscriptions.push(
        vscode.commands.registerCommand('tcl.languageServerStatus', () => {
            if (client) {
                const state = client.state;
                const stateNames = ['Stopped', 'Starting', 'Running'];
                vscode.window.showInformationMessage(`TCL Language Server: ${stateNames[state]}`);
            } else {
                vscode.window.showInformationMessage('TCL Language Server: Not initialized');
            }
        })
    );
}
