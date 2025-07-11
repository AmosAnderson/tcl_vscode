import * as vscode from 'vscode';
import { TclDocumentFormattingEditProvider, TclDocumentRangeFormattingEditProvider } from './formatter/formattingProvider';
import { TclCompletionItemProvider } from './providers/completionProvider';
import { TclDocumentSymbolProvider, TclWorkspaceSymbolProvider } from './providers/symbolProvider';
import { TclDefinitionProvider, TclReferenceProvider } from './providers/definitionProvider';
import { TclHoverProvider } from './providers/hoverProvider';

export function activate(context: vscode.ExtensionContext) {
    console.log('TCL Language Support is now active!');

    // Register formatting providers
    const documentFormattingProvider = new TclDocumentFormattingEditProvider();
    const rangeFormattingProvider = new TclDocumentRangeFormattingEditProvider();

    context.subscriptions.push(
        vscode.languages.registerDocumentFormattingEditProvider('tcl', documentFormattingProvider),
        vscode.languages.registerDocumentRangeFormattingEditProvider('tcl', rangeFormattingProvider)
    );

    // Register IntelliSense providers
    const completionProvider = new TclCompletionItemProvider();
    const hoverProvider = new TclHoverProvider();
    const definitionProvider = new TclDefinitionProvider();
    const referenceProvider = new TclReferenceProvider();
    const documentSymbolProvider = new TclDocumentSymbolProvider();
    const workspaceSymbolProvider = new TclWorkspaceSymbolProvider();

    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider('tcl', completionProvider, '.', ':', '$'),
        vscode.languages.registerHoverProvider('tcl', hoverProvider),
        vscode.languages.registerDefinitionProvider('tcl', definitionProvider),
        vscode.languages.registerReferenceProvider('tcl', referenceProvider),
        vscode.languages.registerDocumentSymbolProvider('tcl', documentSymbolProvider),
        vscode.languages.registerWorkspaceSymbolProvider(workspaceSymbolProvider)
    );

    // Register format document command
    context.subscriptions.push(
        vscode.commands.registerCommand('tcl.formatDocument', () => {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.languageId === 'tcl') {
                vscode.commands.executeCommand('editor.action.formatDocument');
            } else {
                vscode.window.showInformationMessage('No active TCL document');
            }
        })
    );

    // Register format on save if enabled (disabled by default)
    context.subscriptions.push(
        vscode.workspace.onWillSaveTextDocument((event) => {
            const config = vscode.workspace.getConfiguration('tcl');
            const formatOnSave = config.get<boolean>('format.enable', false);
            
            if (formatOnSave && event.document.languageId === 'tcl') {
                event.waitUntil(
                    vscode.commands.executeCommand('editor.action.formatDocument')
                );
            }
        })
    );
}

export function deactivate() {}