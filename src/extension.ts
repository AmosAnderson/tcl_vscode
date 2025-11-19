import * as vscode from 'vscode';
import { ServerCapabilities } from 'vscode-languageserver-protocol';
import { TclFormattingProvider } from './formatter/formattingProvider';
import { TclCompletionItemProvider } from './providers/completionProvider';
import { TclDocumentSymbolProvider, TclWorkspaceSymbolProvider } from './providers/symbolProvider';
import { TclDefinitionProvider, TclReferenceProvider } from './providers/definitionProvider';
import { TclHoverProvider } from './providers/hoverProvider';
import { TclSignatureHelpProvider } from './providers/signatureHelpProvider';
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
import { activateLanguageServer, deactivateLanguageServer } from './languageServer/client';

interface BuiltInFeatureFlags {
    formatting: boolean;
    diagnostics: boolean;
    codeAction: boolean;
    completion: boolean;
    hover: boolean;
    definition: boolean;
    references: boolean;
    documentSymbol: boolean;
    workspaceSymbol: boolean;
    rename: boolean;
    signatureHelp: boolean;
}

function determineBuiltInFeatureFlags(capabilities?: ServerCapabilities): BuiltInFeatureFlags {
    if (!capabilities) {
        return {
            formatting: true,
            diagnostics: true,
            codeAction: true,
            completion: true,
            hover: true,
            definition: true,
            references: true,
            documentSymbol: true,
            workspaceSymbol: true,
            rename: true,
            signatureHelp: true
        };
    }

    const supportsFormatting = Boolean(capabilities.documentFormattingProvider ?? capabilities.documentRangeFormattingProvider);
    const supportsDiagnostics = languageServerSupportsDiagnostics(capabilities);

    return {
        formatting: !supportsFormatting,
        diagnostics: !supportsDiagnostics,
        codeAction: !Boolean(capabilities.codeActionProvider),
        completion: !Boolean(capabilities.completionProvider),
        hover: !Boolean(capabilities.hoverProvider),
        definition: !Boolean(capabilities.definitionProvider),
        references: !Boolean(capabilities.referencesProvider),
        documentSymbol: !Boolean(capabilities.documentSymbolProvider),
        workspaceSymbol: !Boolean(capabilities.workspaceSymbolProvider),
        rename: !Boolean(capabilities.renameProvider),
        signatureHelp: !Boolean(capabilities.signatureHelpProvider)
    };
}

function languageServerSupportsDiagnostics(capabilities: ServerCapabilities): boolean {
    if (capabilities.diagnosticProvider) {
        return true;
    }

    return typeof capabilities.textDocumentSync !== 'undefined';
}

export async function activate(context: vscode.ExtensionContext) {
    console.log('TCL Language Support is now active!');

    // Initialize Language Server (if enabled)
    // The language server provides enhanced IntelliSense, diagnostics, and more
    // Built-in providers below serve as fallback when LSP is disabled or unavailable
    const languageServerResult = await activateLanguageServer(context);
    const serverCapabilities = languageServerResult.status === 'started'
        ? languageServerResult.capabilities
        : undefined;
    const featureFlags = determineBuiltInFeatureFlags(serverCapabilities);

    // Register formatting providers when language server does not provide formatting
    const formattingProvider = featureFlags.formatting ? new TclFormattingProvider() : undefined;

    if (formattingProvider) {
        context.subscriptions.push(
            vscode.languages.registerDocumentFormattingEditProvider('tcl', formattingProvider, {
                displayName: 'TCL Formatter (Built-in)'
            }),
            vscode.languages.registerDocumentRangeFormattingEditProvider('tcl', formattingProvider, {
                displayName: 'TCL Formatter (Built-in)'
            })
        );
    } else {
        console.log('Skipping built-in formatter registration because the language server provides formatting.');
    }

    // Register diagnostic and code action providers when needed
    const diagnosticProvider = featureFlags.diagnostics ? new TclDiagnosticProvider() : undefined;
    const codeActionProvider = featureFlags.codeAction ? new TclCodeActionProvider() : undefined;

    if (diagnosticProvider) {
        const validateDocument = (document: vscode.TextDocument) => {
            if (document.languageId === 'tcl') {
                diagnosticProvider.provideDiagnostics(document);
            }
        };

        context.subscriptions.push(
            vscode.workspace.onDidOpenTextDocument(validateDocument),
            vscode.workspace.onDidChangeTextDocument(event => validateDocument(event.document)),
            vscode.workspace.onDidSaveTextDocument(validateDocument)
        );

        vscode.workspace.textDocuments.forEach(validateDocument);
    } else {
        console.log('Skipping built-in diagnostics because the language server provides diagnostics.');
    }

    if (codeActionProvider) {
        context.subscriptions.push(
            vscode.languages.registerCodeActionsProvider('tcl', codeActionProvider)
        );
    } else {
        console.log('Skipping built-in code actions because the language server provides code actions.');
    }

    // Register IntelliSense providers
    const completionProvider = featureFlags.completion ? new TclCompletionItemProvider() : undefined;
    const hoverProvider = featureFlags.hover ? new TclHoverProvider() : undefined;
    const definitionProvider = featureFlags.definition ? new TclDefinitionProvider() : undefined;
    const referenceProvider = featureFlags.references ? new TclReferenceProvider() : undefined;
    const documentSymbolProvider = featureFlags.documentSymbol ? new TclDocumentSymbolProvider() : undefined;
    const workspaceSymbolProvider = featureFlags.workspaceSymbol ? new TclWorkspaceSymbolProvider() : undefined;
    const signatureHelpProvider = featureFlags.signatureHelp ? new TclSignatureHelpProvider() : undefined;

    if (completionProvider) {
        context.subscriptions.push(
            vscode.languages.registerCompletionItemProvider('tcl', completionProvider, '.', ':', '$')
        );
    } else {
        console.log('Skipping built-in completions because the language server provides completion items.');
    }

    if (hoverProvider) {
        context.subscriptions.push(
            vscode.languages.registerHoverProvider('tcl', hoverProvider)
        );
    } else {
        console.log('Skipping built-in hover provider because the language server provides hovers.');
    }

    if (signatureHelpProvider) {
        context.subscriptions.push(
            vscode.languages.registerSignatureHelpProvider('tcl', signatureHelpProvider, ' ', '[')
        );
    } else {
        console.log('Skipping built-in signature help provider because the language server provides signature help.');
    }

    if (definitionProvider) {
        context.subscriptions.push(
            vscode.languages.registerDefinitionProvider('tcl', definitionProvider)
        );
    } else {
        console.log('Skipping built-in definition provider because the language server provides definitions.');
    }

    if (referenceProvider) {
        context.subscriptions.push(
            vscode.languages.registerReferenceProvider('tcl', referenceProvider)
        );
    } else {
        console.log('Skipping built-in reference provider because the language server provides references.');
    }

    if (documentSymbolProvider) {
        context.subscriptions.push(
            vscode.languages.registerDocumentSymbolProvider('tcl', documentSymbolProvider)
        );
    } else {
        console.log('Skipping built-in document symbol provider because the language server provides document symbols.');
    }

    if (workspaceSymbolProvider) {
        context.subscriptions.push(
            vscode.languages.registerWorkspaceSymbolProvider(workspaceSymbolProvider)
        );
    } else {
        console.log('Skipping built-in workspace symbol provider because the language server provides workspace symbols.');
    }

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
    const renameProvider = featureFlags.rename ? new TclRenameProvider() : undefined;
    const extractProvider = new TclExtractProvider();
    
    if (renameProvider) {
        context.subscriptions.push(
            vscode.languages.registerRenameProvider('tcl', renameProvider)
        );
    } else {
        console.log('Skipping built-in rename provider because the language server provides rename support.');
    }

    context.subscriptions.push(
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
    if (completionProvider) {
        context.subscriptions.push(completionProvider);
    }
    if (diagnosticProvider) {
        context.subscriptions.push(diagnosticProvider);
    }
    context.subscriptions.push(
        debugAdapterFactory,
        testProvider,
        coverageProvider
    );

    // Phase 6 features are now initialized lazily when first used
}

export async function deactivate() {
    // Stop the language server
    await deactivateLanguageServer();
}
