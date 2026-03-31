import * as vscode from 'vscode';
import { TclInterpreterManager, TclInterpreter } from './interpreterManager';

/**
 * Get the active TCL editor, or show a warning and return undefined.
 */
function getActiveTclEditor(): vscode.TextEditor | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'tcl') {
        vscode.window.showWarningMessage('No active TCL file');
        return undefined;
    }
    return editor;
}

/**
 * Shell-quote a file path for safe use in a terminal command.
 * Uses double quotes on Windows, single quotes elsewhere.
 */
function shellQuote(value: string): string {
    if (process.platform === 'win32') {
        // On Windows, wrap in double quotes and escape inner double quotes
        return `"${value.replace(/"/g, '\\"')}"`;
    }
    // On Unix, wrap in single quotes (escape existing single quotes)
    return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Build QuickPickItems from discovered interpreters, marking the current default.
 */
function interpretersToQuickPick(
    interpreters: TclInterpreter[],
    current: TclInterpreter | null
): vscode.QuickPickItem[] {
    return interpreters.map(interp => ({
        label: interp.name,
        description: interp.path,
        detail: `Version: ${interp.version}${interp === current ? ' (current)' : ''}`
    }));
}

/**
 * Register command-palette commands for running TCL scripts with
 * different interpreters and custom arguments.
 *
 * Call this inside the Phase 6 lazy block of `extension.ts`.
 */
export function registerRunCommands(
    context: vscode.ExtensionContext,
    interpreterManager: TclInterpreterManager
): void {
    // ── tcl.runWithInterpreter ──────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('tcl.runWithInterpreter', async () => {
            const editor = getActiveTclEditor();
            if (!editor) {
                return;
            }

            await editor.document.save();

            const interpreters = interpreterManager.getInterpreters();
            if (interpreters.length === 0) {
                vscode.window.showWarningMessage(
                    'No TCL interpreters found. Use "TCL: Add Custom Interpreter" to configure one.'
                );
                return;
            }

            const items = interpretersToQuickPick(
                interpreters,
                interpreterManager.getCurrentInterpreter()
            );

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select a TCL interpreter to run the script',
                matchOnDescription: true
            });

            if (!selected) {
                return;
            }

            const interpreter = interpreters.find(i => i.path === selected.description);
            if (!interpreter) {
                return;
            }

            const filePath = editor.document.fileName;
            const terminal = vscode.window.createTerminal({
                name: `TCL: ${interpreter.name}`,
                iconPath: new vscode.ThemeIcon('play'),
                color: new vscode.ThemeColor('terminal.ansiGreen')
            });
            terminal.show();
            terminal.sendText(`${shellQuote(interpreter.path)} ${shellQuote(filePath)}`);
        })
    );

    // ── tcl.runWithArgs ─────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('tcl.runWithArgs', async () => {
            const editor = getActiveTclEditor();
            if (!editor) {
                return;
            }

            await editor.document.save();

            const args = await vscode.window.showInputBox({
                prompt: 'Enter command-line arguments for the TCL script',
                placeHolder: 'arg1 arg2 ...',
                ignoreFocusOut: true
            });

            // User pressed Escape
            if (args === undefined) {
                return;
            }

            const tclPath = interpreterManager.getInterpreterPath();
            const filePath = editor.document.fileName;

            const terminal = vscode.window.createTerminal({
                name: 'TCL: Run with Args',
                iconPath: new vscode.ThemeIcon('play'),
                color: new vscode.ThemeColor('terminal.ansiGreen')
            });
            terminal.show();

            // Shell-quote tclPath and filePath; split user args and quote each individually
            const quotedParts = [shellQuote(tclPath), shellQuote(filePath)];
            if (args) {
                // Split on whitespace, preserving quoted segments
                const argTokens = args.match(/"[^"]*"|'[^']*'|\S+/g) || [];
                for (const token of argTokens) {
                    // Strip outer quotes if user provided them, then re-quote safely
                    const stripped = token.replace(/^["']|["']$/g, '');
                    quotedParts.push(shellQuote(stripped));
                }
            }
            terminal.sendText(quotedParts.join(' '));
        })
    );
}
