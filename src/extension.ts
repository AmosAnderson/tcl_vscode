import * as vscode from 'vscode';
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
import { TclLintProvider } from './providers/lintProvider';
import { TclRenameProvider } from './refactoring/renameProvider';
import { TclExtractProvider } from './refactoring/extractProvider';
import { TclNamespaceExtractProvider } from './refactoring/namespaceProvider';
import { SymbolTableCache } from './analysis/symbolTableCache';
import { TclInterpreterManager } from './tools/interpreterManager';
import { TclPackageManager } from './tools/packageManager';
import { TclProjectTemplates } from './tools/projectTemplates';
import { TclTaskProviderManager } from './tools/taskProvider';
import { TclDependencyManager } from './tools/dependencyManager';
import { runWithArgs, runWithInterpreter } from './tools/runCommands';
import { cleanupTempTclFiles } from './utils/tclUtils';
import { WorkspaceIndex } from './analysis/workspaceIndex';
import { TclCodeLensProvider } from './providers/codeLensProvider';
import { activeTclResource, resolveTclFolder } from './tools/executionContext';

// Track disposable providers so deactivate() can clean them up
let activeTestProvider: TclTestProvider | undefined;
let activeCoverageProvider: TclCoverageProvider | undefined;
let activeDebugAdapterFactory: TclDebugAdapterDescriptorFactory | undefined;

export async function activate(context: vscode.ExtensionContext) {
    console.log('TCL Language Support is now active!');

    // Clean up any orphaned temp TCL files from previous sessions
    cleanupTempTclFiles();

    // Register formatting providers for TCL documents
    const formattingProvider = new TclFormattingProvider();

    context.subscriptions.push(
        vscode.languages.registerDocumentFormattingEditProvider('tcl', formattingProvider, {
            displayName: 'TCL Formatter (Built-in)'
        }),
        vscode.languages.registerDocumentRangeFormattingEditProvider('tcl', formattingProvider, {
            displayName: 'TCL Formatter (Built-in)'
        })
    );

    // Register diagnostic, lint, and code action providers when needed
    const diagnosticProvider = new TclDiagnosticProvider();
    const lintProvider = new TclLintProvider();
    const codeActionProvider = new TclCodeActionProvider();

    const validateDocument = async (document: vscode.TextDocument) => {
        if (document.languageId === 'tcl') {
            lintProvider.lint(document);
            await diagnosticProvider.provideDiagnostics(document);
        }
    };

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(validateDocument),
        vscode.workspace.onDidChangeTextDocument(event => validateDocument(event.document)),
        vscode.workspace.onDidSaveTextDocument(validateDocument),
        vscode.workspace.onDidCloseTextDocument(document => { diagnosticProvider.clear(document.uri); lintProvider.clear(document.uri); }),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('tcl')) for (const document of vscode.workspace.textDocuments) void validateDocument(document);
        })
    );

    for (const doc of vscode.workspace.textDocuments) {
        validateDocument(doc).catch(() => {});
    }

    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider('tcl', codeActionProvider)
    );

    // Initialize scope-aware symbol table cache
    const symbolTableCache = new SymbolTableCache();
    symbolTableCache.registerListeners(context);
    context.subscriptions.push(symbolTableCache);

    // Register IntelliSense providers
    const completionProvider = new TclCompletionItemProvider(async document => {
        await ensurePhase6Initialized();
        await packageManager?.ensurePackages(document.uri);
        return packageManager?.getPackages(document.uri).map(pkg => pkg.name) ?? [];
    });
    const hoverProvider = new TclHoverProvider(symbolTableCache);
    const definitionProvider = new TclDefinitionProvider();
    const referenceProvider = new TclReferenceProvider(symbolTableCache);
    const documentSymbolProvider = new TclDocumentSymbolProvider();
    const workspaceSymbolProvider = new TclWorkspaceSymbolProvider();
    const signatureHelpProvider = new TclSignatureHelpProvider();

    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider('tcl', completionProvider, '.', ':', '$')
    );

    context.subscriptions.push(
        vscode.languages.registerHoverProvider('tcl', hoverProvider)
    );

    context.subscriptions.push(
        vscode.languages.registerSignatureHelpProvider('tcl', signatureHelpProvider, ' ', '[')
    );

    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider('tcl', definitionProvider)
    );

    context.subscriptions.push(
        vscode.languages.registerReferenceProvider('tcl', referenceProvider)
    );

    context.subscriptions.push(
        vscode.languages.registerDocumentSymbolProvider('tcl', documentSymbolProvider)
    );

    context.subscriptions.push(
        vscode.languages.registerWorkspaceSymbolProvider(workspaceSymbolProvider)
    );

    // Initialize workspace-wide symbol index (runs in background, won't block activation)
    const workspaceIndex = WorkspaceIndex.getInstance();
    workspaceIndex.initialize();
    context.subscriptions.push(workspaceIndex);

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
            const config = vscode.workspace.getConfiguration('tcl', event.document.uri);
            const formatOnSave = config.get<boolean>('format.enable', false);
            
            if (formatOnSave && event.document.languageId === 'tcl') {
                event.waitUntil(
                    vscode.commands.executeCommand<vscode.TextEdit[]>(
                        'vscode.executeFormatDocumentProvider',
                        event.document.uri
                    )
                );
            }
        })
    );

    // Register Phase 5 features: Debugging Support
    const debugAdapterFactory = new TclDebugAdapterDescriptorFactory();
    activeDebugAdapterFactory = debugAdapterFactory;
    const debugConfigProvider = new TclConfigurationProvider();
    
    context.subscriptions.push(
        vscode.debug.registerDebugAdapterDescriptorFactory('tcl', debugAdapterFactory),
        vscode.debug.registerDebugConfigurationProvider('tcl', debugConfigProvider)
    );

    // Register REPL commands
    const replCommands = new TclREPLCommands();
    replCommands.registerCommands(context);

    // Register Phase 5 features: Testing Support
    const coverageProvider = new TclCoverageProvider();
    activeCoverageProvider = coverageProvider;
    const testProvider = new TclTestProvider(coverageProvider);
    activeTestProvider = testProvider;
    void testProvider.discoverAllTests();
    const codeLensProvider = new TclCodeLensProvider(workspaceIndex,
        document => testProvider.getTestLenses(document), testProvider.onDidChangeTests);
    context.subscriptions.push(codeLensProvider, vscode.languages.registerCodeLensProvider('tcl', codeLensProvider));

    context.subscriptions.push(
        vscode.commands.registerCommand('tcl.runTests', () => testProvider.runTestItem()),
        vscode.commands.registerCommand('tcl.runTestItem', (id: string, mode: 'run' | 'debug') => testProvider.runTestItem(id, mode)),
        vscode.commands.registerCommand('tcl.generateCoverage', () => testProvider.runTestItem(undefined, 'coverage')),
        vscode.commands.registerCommand('tcl.clearCoverage', () => coverageProvider.clearCoverage()),
        vscode.commands.registerCommand('tcl.exportCoverageReport', () => coverageProvider.exportCoverageReport())
    );

    // Register Phase 5 features: Refactoring
    const renameProvider = new TclRenameProvider(symbolTableCache);
    const extractProvider = new TclExtractProvider();
    
    context.subscriptions.push(
        vscode.languages.registerRenameProvider('tcl', renameProvider)
    );

    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider('tcl', extractProvider, {
            providedCodeActionKinds: [
                vscode.CodeActionKind.RefactorExtract,
                vscode.CodeActionKind.RefactorInline
            ]
        })
    );

    const namespaceExtractProvider = new TclNamespaceExtractProvider();
    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider('tcl', namespaceExtractProvider, {
            providedCodeActionKinds: TclNamespaceExtractProvider.providedCodeActionKinds
        })
    );

    // Register refactoring commands
    extractProvider.registerCommands(context);
    namespaceExtractProvider.registerCommands(context);

    // Register Phase 6 features: Integration and Tools (lazy initialization)
    let interpreterManager: TclInterpreterManager | undefined;
    let packageManager: TclPackageManager | undefined;
    let projectTemplates: TclProjectTemplates | undefined;
    let dependencyManager: TclDependencyManager | undefined;
    let phase6Initialization: Promise<void> | undefined;
    const ensurePhase6Initialized = (): Promise<void> => {
        if (phase6Initialization) return phase6Initialization;
        phase6Initialization = (async () => {
            try {
                interpreterManager = new TclInterpreterManager();
                packageManager = new TclPackageManager();
                projectTemplates = new TclProjectTemplates();
                dependencyManager = new TclDependencyManager(packageManager);
                await interpreterManager.initialize();
                await packageManager.initialize();
                await dependencyManager.initialize();
                context.subscriptions.push(interpreterManager, packageManager, dependencyManager);
            } catch (error) {
                interpreterManager?.dispose(); packageManager?.dispose(); dependencyManager?.dispose();
                interpreterManager = undefined; packageManager = undefined; dependencyManager = undefined;
                projectTemplates = undefined; phase6Initialization = undefined;
                console.error('Failed to initialize TCL tools', error);
                throw error;
            }
        })();
        return phase6Initialization;
    };
    const taskProvider = new TclTaskProviderManager(async resource => {
        await ensurePhase6Initialized();
        return dependencyManager?.installDependencies(resource);
    });
    taskProvider.register(context);
    context.subscriptions.push(taskProvider);

    context.subscriptions.push(
        // Interpreter management commands
        vscode.commands.registerCommand('tcl.selectInterpreter', async () => {
            await ensurePhase6Initialized();
            return interpreterManager?.selectInterpreter();
        }),

        vscode.commands.registerCommand('tcl.addCustomInterpreter', async () => {
            await ensurePhase6Initialized();
            return interpreterManager?.addCustomInterpreter();
        }),

        vscode.commands.registerCommand('tcl.refreshInterpreters', async () => {
            await ensurePhase6Initialized();
            return interpreterManager?.refreshInterpreters();
        }),

        // Package management commands
        vscode.commands.registerCommand('tcl.createPackage', async () => {
            await ensurePhase6Initialized();
            const workspaceFolder = resolveTclFolder(activeTclResource());
            if (workspaceFolder && packageManager) {
                await packageManager.createPackageTcl(workspaceFolder.uri.fsPath);
            } else if (!workspaceFolder) {
                vscode.window.showErrorMessage('No workspace folder open');
            }
        }),

        vscode.commands.registerCommand('tcl.updatePackageIndex', async () => {
            await ensurePhase6Initialized();
            return packageManager?.updatePackageIndex();
        }),

        // Project template commands
        vscode.commands.registerCommand('tcl.newProject', async () => {
            await ensurePhase6Initialized();
            return projectTemplates?.showProjectWizard();
        }),

        // Dependency management commands
        vscode.commands.registerCommand('tcl.installDependencies', async (resource?: vscode.Uri) => {
            await ensurePhase6Initialized();
            return dependencyManager?.installDependencies(resource);
        }),

        vscode.commands.registerCommand('tcl.updateDependencies', async () => {
            await ensurePhase6Initialized();
            return dependencyManager?.updateDependencies();
        }),

        vscode.commands.registerCommand('tcl.refreshDependencies', async () => {
            await ensurePhase6Initialized();
            return dependencyManager?.refreshDependencies();
        }),

        vscode.commands.registerCommand('tcl.createDependencyReport', async () => {
            await ensurePhase6Initialized();
            return dependencyManager?.createDependencyReport();
        }),

        // Task and run commands
        vscode.commands.registerCommand('tcl.runBuild', async () => {
            await ensurePhase6Initialized();
            vscode.commands.executeCommand('workbench.action.tasks.build');
        }),

        vscode.commands.registerCommand('tcl.runTask', async () => {
            await ensurePhase6Initialized();
            vscode.commands.executeCommand('workbench.action.tasks.runTask');
        }),

        vscode.commands.registerCommand('tcl.runTestTask', async () => {
            await ensurePhase6Initialized();
            vscode.commands.executeCommand('workbench.action.tasks.test');
        }),

        vscode.commands.registerCommand('tcl.configureTasks', async () => {
            await ensurePhase6Initialized();
            vscode.commands.executeCommand('workbench.action.tasks.configureTaskRunner');
        }),

        vscode.commands.registerCommand('tcl.runWithInterpreter', async () => {
            await ensurePhase6Initialized();
            if (interpreterManager) {
                await runWithInterpreter(interpreterManager);
            }
        }),

        vscode.commands.registerCommand('tcl.runWithArgs', async () => {
            await ensurePhase6Initialized();
            if (interpreterManager) {
                await runWithArgs(interpreterManager);
            }
        })
    );

    // Register disposal for core providers
    context.subscriptions.push(completionProvider);
    context.subscriptions.push(diagnosticProvider);
    context.subscriptions.push(lintProvider);
    context.subscriptions.push(
        debugAdapterFactory,
        testProvider,
        coverageProvider
    );

    // Phase 6 features are now initialized lazily when first used
}

export async function deactivate() {
    // Dispose providers that may hold child processes or sockets
    try { activeTestProvider?.dispose(); } catch { /* ignore */ }
    try { activeCoverageProvider?.dispose(); } catch { /* ignore */ }
    try { activeDebugAdapterFactory?.dispose(); } catch { /* ignore */ }

    activeTestProvider = undefined;
    activeCoverageProvider = undefined;
    activeDebugAdapterFactory = undefined;

    // Clean up any temp files created during this session
    cleanupTempTclFiles(0);
}
