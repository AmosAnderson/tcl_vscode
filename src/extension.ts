import * as vscode from 'vscode';
import { TclDocumentFormattingEditProvider, TclDocumentRangeFormattingEditProvider } from './formatter/formattingProvider';
import { TclCompletionItemProvider } from './providers/completionProvider';
import { TclDocumentSymbolProvider, TclWorkspaceSymbolProvider } from './providers/symbolProvider';
import { TclDefinitionProvider, TclReferenceProvider } from './providers/definitionProvider';
import { TclHoverProvider } from './providers/hoverProvider';
import { TclDiagnosticProvider } from './providers/diagnosticProvider';
import { TclCodeActionProvider } from './providers/codeActionProvider';
import { TclDebugAdapterDescriptorFactory, TclConfigurationProvider } from './debug/debugAdapterFactory';
import { TclREPLCommands } from './debug/tclREPL';
import { TclTestProvider } from './testing/testProvider';
import { TclCoverageProvider } from './testing/coverageProvider';
import { TclRenameProvider } from './refactoring/renameProvider';
import { TclExtractProvider } from './refactoring/extractProvider';

export function activate(context: vscode.ExtensionContext) {
    console.log('TCL Language Support is now active!');

    // Register formatting providers
    const documentFormattingProvider = new TclDocumentFormattingEditProvider();
    const rangeFormattingProvider = new TclDocumentRangeFormattingEditProvider();

    context.subscriptions.push(
        vscode.languages.registerDocumentFormattingEditProvider('tcl', documentFormattingProvider),
        vscode.languages.registerDocumentRangeFormattingEditProvider('tcl', rangeFormattingProvider)
    );

    // Register diagnostic and code action providers
    const diagnosticProvider = new TclDiagnosticProvider();
    const codeActionProvider = new TclCodeActionProvider();

    // Set up diagnostic validation on document changes
    const validateDocument = (document: vscode.TextDocument) => {
        if (document.languageId === 'tcl') {
            diagnosticProvider.provideDiagnostics(document);
        }
    };

    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider('tcl', codeActionProvider),
        vscode.workspace.onDidOpenTextDocument(validateDocument),
        vscode.workspace.onDidChangeTextDocument(event => validateDocument(event.document)),
        vscode.workspace.onDidSaveTextDocument(validateDocument)
    );

    // Validate already open documents
    vscode.workspace.textDocuments.forEach(validateDocument);

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

    // Register Phase 5 features: Debugging Support
    const debugAdapterFactory = new TclDebugAdapterDescriptorFactory();
    const debugConfigProvider = new TclConfigurationProvider();
    
    context.subscriptions.push(
        vscode.debug.registerDebugAdapterDescriptorFactory('tcl', debugAdapterFactory),
        vscode.debug.registerDebugConfigurationProvider('tcl', debugConfigProvider)
    );

    // Register REPL commands
    const replCommands = new TclREPLCommands();
    replCommands.registerCommands(context);

    // Register Phase 5 features: Testing Support
    const testProvider = new TclTestProvider();
    testProvider.discoverAllTests();

    const coverageProvider = new TclCoverageProvider();
    
    context.subscriptions.push(
        vscode.commands.registerCommand('tcl.runTests', () => {
            // Test running is handled by the test provider automatically
            vscode.window.showInformationMessage('Use the Test Explorer to run tests');
        }),

        vscode.commands.registerCommand('tcl.generateCoverage', async () => {
            const testFiles = await vscode.workspace.findFiles('**/*.{test,tcl}');
            if (testFiles.length === 0) {
                vscode.window.showInformationMessage('No test files found');
                return;
            }
            await coverageProvider.generateCoverage(testFiles.map(f => f.fsPath));
        }),

        vscode.commands.registerCommand('tcl.clearCoverage', () => {
            coverageProvider.clearCoverage();
        }),

        vscode.commands.registerCommand('tcl.exportCoverageReport', () => {
            coverageProvider.exportCoverageReport();
        })
    );

    // Register Phase 5 features: Refactoring
    const renameProvider = new TclRenameProvider();
    const extractProvider = new TclExtractProvider();
    
    context.subscriptions.push(
        vscode.languages.registerRenameProvider('tcl', renameProvider),
        vscode.languages.registerCodeActionsProvider('tcl', extractProvider, {
            providedCodeActionKinds: [vscode.CodeActionKind.RefactorExtract]
        })
    );

    // Register refactoring commands
    extractProvider.registerCommands(context);

    // Register disposal for all providers
    context.subscriptions.push(
        diagnosticProvider,
        debugAdapterFactory,
        testProvider,
        coverageProvider
    );
}

export function deactivate() {}