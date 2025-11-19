import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { promises as fsPromises, constants as fsConstants } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
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
const execFileAsync = promisify(execFile);

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

    const configuredCommand = config.get<string>('languageServer.path', 'tcl-language-server');
    const resolvedCommand = await resolveLanguageServerCommand(configuredCommand);

    if (!resolvedCommand) {
        const action = await vscode.window.showWarningMessage(
            `TCL Language Server not found at "${configuredCommand}". Install from https://github.com/AmosAnderson/tcl_languageserver`,
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
            command: resolvedCommand,
            options: {}
        };

        const debug: Executable = {
            command: resolvedCommand,
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

async function resolveLanguageServerCommand(command: string): Promise<string | undefined> {
    const sanitized = sanitizeCommand(command);
    if (!sanitized) {
        return undefined;
    }

    if (looksLikePath(sanitized)) {
        const candidates = resolveCandidatePaths(sanitized);
        for (const candidate of candidates) {
            if (await pathExists(candidate)) {
                return candidate;
            }
        }
        return undefined;
    }

    const locator = process.platform === 'win32' ? 'where' : 'which';
    try {
        const { stdout } = await execFileAsync(locator, [sanitized], { timeout: 5000 });
        const firstMatch = stdout
            ?.split(/\r?\n/)
            .map((line: string) => line.trim())
            .find((line: string) => line.length > 0);
        return firstMatch ?? sanitized;
    } catch {
        return undefined;
    }
}

function sanitizeCommand(command: string | undefined): string {
    if (!command) {
        return '';
    }
    return command.trim().replace(/^"(.+)"$/, '$1');
}

function looksLikePath(command: string): boolean {
    return path.isAbsolute(command) || command.includes('/') || command.includes('\\');
}

function resolveCandidatePaths(input: string): string[] {
    const expanded = expandHomeDirectory(input);
    const normalized = path.normalize(expanded);
    if (path.isAbsolute(normalized)) {
        return [normalized];
    }

    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    const workspaceCandidates = workspaceFolders.map((folder) => path.join(folder.uri.fsPath, normalized));
    return [path.resolve(process.cwd(), normalized), ...workspaceCandidates];
}

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await fsPromises.access(filePath, fsConstants.X_OK);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
            return false;
        }
        try {
            await fsPromises.access(filePath, fsConstants.F_OK);
            return true;
        } catch {
            return false;
        }
    }
}

function expandHomeDirectory(potentialPath: string): string {
    if (!potentialPath.startsWith('~')) {
        return potentialPath;
    }
    const home = os.homedir();
    return path.join(home, potentialPath.slice(1));
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
