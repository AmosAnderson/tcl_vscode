import * as vscode from 'vscode';
import * as path from 'path';
import { TclInterpreterManager } from './interpreterManager';
import { resolveTclCwd, resolveTclFolder, resolveTclInterpreter, tclConfigurationTarget } from './executionContext';

export { parseRunArguments } from './runArguments';
import { parseRunArguments } from './runArguments';

export function createRunTask(resource: vscode.Uri, args: string[], interpreter?: string): vscode.Task {
    const config = vscode.workspace.getConfiguration('tcl', resource);
    const execution = new vscode.ProcessExecution(resolveTclInterpreter(resource, undefined, interpreter), [resource.fsPath, ...args], {
        cwd: resolveTclCwd(resource, config.get<string>('run.cwd')),
        env: config.get<Record<string, string>>('run.env', {})
    });
    return new vscode.Task({ type: 'tcl', script: resource.fsPath, args }, resolveTclFolder(resource) ?? vscode.TaskScope.Workspace,
        `Run ${path.basename(resource.fsPath)}`, 'tcl', execution, ['$tcl']);
}

async function savedEditor(): Promise<vscode.TextEditor | undefined> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'tcl') { vscode.window.showWarningMessage('No active TCL file'); return; }
    if (!await editor.document.save() || editor.document.isUntitled) return;
    return editor;
}

export async function runWithInterpreter(manager: TclInterpreterManager): Promise<void> {
    const editor = await savedEditor();
    if (!editor) return;
    const selected = await vscode.window.showQuickPick(manager.getInterpreters().map(interpreter => ({
        label: interpreter.name, description: interpreter.path, interpreter
    })), { placeHolder: 'Select a TCL interpreter to run the script', matchOnDescription: true });
    if (!selected) return;
    const args = vscode.workspace.getConfiguration('tcl', editor.document.uri).get<string[]>('run.args', []);
    await vscode.tasks.executeTask(createRunTask(editor.document.uri, args, selected.interpreter.path));
}

export async function runWithArgs(_manager: TclInterpreterManager): Promise<void> {
    const editor = await savedEditor();
    if (!editor) return;
    const config = vscode.workspace.getConfiguration('tcl', editor.document.uri);
    const input = await vscode.window.showInputBox({
        prompt: 'Script arguments (JSON array or quoted arguments)', value: JSON.stringify(config.get<string[]>('run.args', [])),
        placeHolder: '["argument with spaces", "", "日本語"]', ignoreFocusOut: true,
        validateInput: value => { try { parseRunArguments(value); return null; } catch (error) { return String(error); } }
    });
    if (input === undefined) return;
    const args = parseRunArguments(input);
    if (config.get<boolean>('run.rememberArgs', false)) await config.update('run.args', args, tclConfigurationTarget(editor.document.uri));
    await vscode.tasks.executeTask(createRunTask(editor.document.uri, args));
}

export function registerRunCommands(context: vscode.ExtensionContext, manager: TclInterpreterManager): void {
    context.subscriptions.push(vscode.commands.registerCommand('tcl.runWithInterpreter', () => runWithInterpreter(manager)),
        vscode.commands.registerCommand('tcl.runWithArgs', () => runWithArgs(manager)));
}
