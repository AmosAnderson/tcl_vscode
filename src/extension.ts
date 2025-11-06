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
import { TclInterpreterManager } from './tools/interpreterManager';
import { TclPackageManager } from './tools/packageManager';
import { TclProjectTemplates } from './tools/projectTemplates';
import { TclTaskProviderManager } from './tools/taskProvider';
import { TclDependencyManager } from './tools/dependencyManager';

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

    // Register Phase 6 features: Integration and Tools (lazy initialization)
    let interpreterManager: TclInterpreterManager | undefined;
    let packageManager: TclPackageManager | undefined;
    let projectTemplates: TclProjectTemplates | undefined;
    let taskProvider: TclTaskProviderManager | undefined;
    let dependencyManager: TclDependencyManager | undefined;
    let phase6Initialized = false;

    const ensurePhase6Initialized = async () => {
        if (phase6Initialized) return;

        try {
            interpreterManager = new TclInterpreterManager();
            packageManager = new TclPackageManager();
            projectTemplates = new TclProjectTemplates();
            taskProvider = new TclTaskProviderManager();
            dependencyManager = new TclDependencyManager(packageManager);

            await interpreterManager.initialize();
            await packageManager.initialize();
            await dependencyManager.initialize();
            taskProvider.register(context);

            phase6Initialized = true;

            // Add to disposal
            context.subscriptions.push(interpreterManager, packageManager, dependencyManager, taskProvider);
        } catch (error) {
            console.error('Phase 6 initialization failed:', error);

            // Clean up any partially initialized managers
            try {
                interpreterManager?.dispose();
            } catch (e) { /* ignore */ }
            try {
                packageManager?.dispose();
            } catch (e) { /* ignore */ }
            try {
                dependencyManager?.dispose();
            } catch (e) { /* ignore */ }
            try {
                taskProvider?.dispose();
            } catch (e) { /* ignore */ }

            // Reset managers to undefined
            interpreterManager = undefined;
            packageManager = undefined;
            projectTemplates = undefined;
            taskProvider = undefined;
            dependencyManager = undefined;

            // Show error to user
            vscode.window.showErrorMessage(`Failed to initialize TCL tools: ${error}`);
        }
    };

    context.subscriptions.push(
        // Interpreter management commands
        vscode.commands.registerCommand('tcl.selectInterpreter', async () => {
            await ensurePhase6Initialized();
            interpreterManager?.selectInterpreter();
        }),

        vscode.commands.registerCommand('tcl.addCustomInterpreter', async () => {
            await ensurePhase6Initialized();
            interpreterManager?.addCustomInterpreter();
        }),

        vscode.commands.registerCommand('tcl.refreshInterpreters', async () => {
            await ensurePhase6Initialized();
            interpreterManager?.refreshInterpreters();
        }),

        // Package management commands
        vscode.commands.registerCommand('tcl.createPackage', async () => {
            await ensurePhase6Initialized();
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (workspaceFolder && packageManager) {
                await packageManager.createPackageTcl(workspaceFolder.uri.fsPath);
            } else if (!workspaceFolder) {
                vscode.window.showErrorMessage('No workspace folder open');
            }
        }),

        vscode.commands.registerCommand('tcl.updatePackageIndex', async () => {
            await ensurePhase6Initialized();
            packageManager?.updatePackageIndex();
        }),

        // Project template commands
        vscode.commands.registerCommand('tcl.newProject', async () => {
            await ensurePhase6Initialized();
            projectTemplates?.showProjectWizard();
        }),

        // Dependency management commands
        vscode.commands.registerCommand('tcl.installDependencies', async () => {
            await ensurePhase6Initialized();
            dependencyManager?.installDependencies();
        }),

        vscode.commands.registerCommand('tcl.updateDependencies', async () => {
            await ensurePhase6Initialized();
            dependencyManager?.updateDependencies();
        }),

        vscode.commands.registerCommand('tcl.refreshDependencies', async () => {
            await ensurePhase6Initialized();
            dependencyManager?.refreshDependencies();
        }),

        vscode.commands.registerCommand('tcl.createDependencyReport', async () => {
            await ensurePhase6Initialized();
            dependencyManager?.createDependencyReport();
        }),

        // Task management commands
        vscode.commands.registerCommand('tcl.runBuild', () => {
            vscode.commands.executeCommand('workbench.action.tasks.build');
        })
    );

    // Register disposal for core providers
    context.subscriptions.push(
        completionProvider,
        diagnosticProvider,
        debugAdapterFactory,
        testProvider,
        coverageProvider
    );

    // Phase 6 features are now initialized lazily when first used
}

export function deactivate() {}