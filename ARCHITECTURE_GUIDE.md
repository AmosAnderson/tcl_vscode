# Architecture guide

This guide describes the implemented architecture of TCL Language Support 0.8.0. For usage and settings, start with [README.md](README.md). [ARCHITECTURE_DIAGRAM.md](ARCHITECTURE_DIAGRAM.md) shows the component and execution flows. [AGENTS.md](AGENTS.md) records repository conventions, and [the Insiders verification report](docs/INSIDERS_UI_TEST_REPORT.md) distinguishes observed UI behavior from automated coverage.

## Runtime and activation

The extension runs in the VS Code extension host. It registers VS Code language providers directly; there is no separate language server process. `package.json` declares languages, commands, configuration, tasks, debugger configuration, and Tcl editor breakpoint support. `src/extension.ts` is the runtime entry point. TypeScript compiles to CommonJS in `out/`, with `out/extension.js` as the extension main module.

Activation registers formatting, diagnostics, lint, completion, hover, signature help, navigation, symbols, CodeLens, refactoring, debugging, REPL commands, Testing profiles, and a lightweight native task provider. Workspace indexing and test discovery begin in the background. Diagnostics are refreshed for already open Tcl documents and on open, edit, save, close, or relevant configuration changes.

Interpreter discovery, package discovery, dependencies, project templates, and run commands share `ensurePhase6Initialized()`. This name is retained from the original implementation phases. Initialization uses one promise to coalesce concurrent requests, disposes partially initialized services on failure, and allows a later retry. Package-name completion can also invoke this path when it needs the runtime package catalog.

Native Tasks requests must work immediately after activation. `TclTaskProviderManager` is therefore registered outside lazy initialization; only a task that actually installs dependencies calls the lazy services.

## Syntax, symbols, and shared analysis

| Component | Responsibility |
| --- | --- |
| `src/utils/tclParser.ts` | Pure Tcl script/list parsing with source spans, substitutions, executable bodies, expression substitutions, and literal `apply` lambdas. |
| `src/analysis/procedures.ts` | Walk executable command contexts and qualify or resolve static Tcl procedure and namespace names. |
| `src/analysis/symbolTable.ts` | Track procedure and lambda parameters, local/global/namespace bindings, supported aliases, declarations, and uses. |
| `src/analysis/documentAnalysis.ts` | Build a document-version analysis containing contexts, binding data, declarations, parameters, leading documentation comments, package names, namespace directives, and static TclOO declarations. |
| `src/analysis/symbolTableCache.ts` | Retain the scope-table API used by existing providers/refactorings, keyed by document URI and version, invalidated on change or close. |
| `src/analysis/workspaceIndex.ts` | Combine document analyses, resolve calls and static TclOO receivers, and cache semantic environments and reference occurrences. |
| `src/providers/languageFeatures.ts` | Resolve the symbol under a cursor for shared navigation, hover, and refactoring behavior. |
| `src/data/tclCommands.ts` | Central built-in command, option, signature, documentation, and snippet metadata. |

`analyzeDocument()` caches analysis by URI, document version, and document identity. The workspace index watches `*.tcl`, `*.tk`, `*.tm`, and `*.test`, scans all workspace folders, and honors `tcl.analysis.exclude` and enabled `files.exclude` entries. Edits invalidate semantic and occurrence caches immediately; file indexing is debounced. Open documents, including unsaved changes, override indexed content. Generation counters prevent late asynchronous reads from restoring deleted or superseded results. Folder or exclusion changes trigger rescans.

Static resolution supports namespace-qualified procedures, literal imports/exports and namespace paths, TclOO classes and methods, known object receivers, and unambiguous inheritance. A receiver assigned from a recognizable class construction can be tracked through its binding. Multiple possible receiver types or conflicting inherited methods remain unresolved. Literal `apply` bodies have their own parameter scope.

This is static analysis of recognizable Tcl syntax. It does not execute project code to discover generated commands. Dynamic names, arbitrary `eval`/callbacks, unknown custom control structures, dynamic namespace directives, or ambiguous TclOO dispatch cannot be resolved completely. Parsing treats braced data and executable bodies differently so data strings do not become fictitious declarations or references. Features return the results they can establish; they do not promise runtime equivalence for every Tcl metaprogram.

## Language providers

All registrations remain centralized in `src/extension.ts`.

| Provider files in `src/providers/` | Behavior |
| --- | --- |
| `completionProvider.ts` | Contextual commands, options, variables, procedures, namespaces, known methods, snippets, and package names. |
| `signatureHelpProvider.ts` | Active argument help for built-ins and static declarations, including defaults and variadic parameters. |
| `hoverProvider.ts` | Built-in documentation and resolved declaration or binding information. |
| `definitionProvider.ts` | Definitions and references using shared syntax and workspace resolution. |
| `symbolProvider.ts` | Document outline and workspace symbols, including static TclOO structure. |
| `codeLensProvider.ts` | Procedure/method reference counts and test Run/Debug actions. Reference counts resolve from the workspace occurrence cache. |
| `diagnosticProvider.ts` | Structural diagnostics with source locations and an optional debounced Tcl `info complete` check that treats document text as data. |
| `lintProvider.ts` | Configurable style diagnostics in the separate `tcl-lint` collection. |
| `codeActionProvider.ts` | Quick fixes associated with supported diagnostics and lint findings. |

Reference CodeLens reacts to index changes; test lenses react to discovery changes. CodeLens configuration changes also invalidate visible lenses. Cancellation is honored by asynchronous provider operations where supported.

## Formatting and refactoring

Formatting has two layers. `src/formatter/formattingProvider.ts` reads resource-scoped settings and VS Code indentation options, then translates results into editor edits. `src/formatter/tclFormatter.ts` performs pure syntax-aware formatting. Document and range formatting share this logic; range formatting uses surrounding document context. Script bodies and switch pattern/body lists are distinguished from literal data, preserving Tcl substitution and data semantics in supported cases.

Refactoring providers live in `src/refactoring/`:

- `renameProvider.ts` implements procedure, variable, namespace, class, and supported method rename paths. Workspace occurrences and binding identity keep edits scoped to the resolved symbol.
- `extractProvider.ts` implements procedure/variable extraction and procedure/variable inlining. Procedure inlining uses a lambda in the declaration namespace to preserve parameter evaluation and local scope.
- `variableEdits.ts` and `namespaceEdits.ts` isolate edit planning and checks for the corresponding transformations.
- `namespaceProvider.ts` presents namespace extraction actions and commands.

These operations produce `WorkspaceEdit` objects. They reject unsupported transformations when scope, control flow, dynamic callbacks, namespace changes, or name collisions prevent a safe edit. Extending a refactoring means extending its analysis and semantic regression fixtures, not applying a workspace-wide text replacement.

## Debugger and REPL

`src/debug/debugAdapterFactory.ts` supplies inline `TclDebugSession` instances and launch configuration resolution. `src/debug/tclDebugAdapter.ts` translates the Debug Adapter Protocol into the Tcl-side protocol implemented by `src/debug/scripts/debugServer.tcl`.

A launch spawns the selected interpreter with the bundled server. The server chooses an ephemeral loopback port and reports it to the adapter. The adapter authenticates with a per-session token, synchronizes breakpoints, and completes configuration before execution resumes. The Tcl server traces execution of original source commands; it does not rewrite every source line with a checkpoint. Source frames are captured before entering the paused event loop.

Supported operations include source breakpoints, conditional breakpoints, logpoints, pause/continue, step in/over/out, stack selection, locals/globals and arrays, variable editing, watches, and expression evaluation. Inspection requests carry frame identity. Adapter frame and variable handles are invalidated when execution resumes or the session ends so stale requests cannot inspect another frame. Step, pause, entry, and breakpoint reasons are propagated to VS Code. A recognized expression and its enclosing whole-value scalar assignment share one stop; arbitrary nested substitutions can still expose multiple command stops on a line.

Attach connects to a compatible authenticated server that has already been started. It accepts loopback addresses; remote use requires a tunnel. `sourceFileMap` translates source prefixes between target and editor. A normal disconnect from an attached process detaches without terminating that process; an explicit termination request can terminate it. Launch sessions own their child process and clean it up on termination.

With `debugThreads: true`, the Tcl server instruments supported `thread::create` calls when the Thread package is available. Worker endpoints appear as separate DAP threads. The parent adapter routes thread, frame, and variable operations to the owning worker, forwards breakpoints, and emits worker lifecycle events. This does not attach arbitrary existing OS threads or discover workers created before instrumentation. Runtime Tcl/Thread support is required.

`src/debug/tclREPL.ts` owns a VS Code terminal running the selected interpreter. The terminal is reused only when its interpreter and working directory match the requested resource. Closing it clears the cached handle, concurrent starts are coordinated, and a subsequent command can create a fresh terminal. Selection/line evaluation and sourcing the current saved file share that lifecycle.

## Testing and coverage

`TclTestProvider` in `src/testing/testProvider.ts` owns the VS Code TestController and Run, Debug, and Coverage profiles. `testDiscovery.ts` parses literal `tcltest::test` declarations, imported `test` declarations, and `test_*` procedures without running their bodies. File and document events refresh discovery, and the provider publishes matching test CodeLens actions.

A request is expanded into a deduplicated set of selected leaf tests with exclusions applied. Tests run sequentially, each with a generated runner. `testExecution.ts` installs the selected-test wrapper before sourcing the file: unselected tcltest bodies do not run, and a selected procedure test is called explicitly. Top-level setup code in the source file still executes. Results preserve passed, failed, and skipped states even when the test file calls `cleanupTests`.

`testProcess.ts` owns each spawned runner, applies the timeout and cancellation, waits for the child to close, and cleans up temporary files. Debug runs use the same selection script through the normal debug adapter and a private result file. The provider tracks only the matching debug session; cancellation stops that session. `testOutput.ts` removes internal result/coverage records from displayed output while raw data remains available for parsing.

Coverage uses `coverageExecution.ts` to trace commands in original source files within the selected workspace root. Tcl disassembly in a separate safe interpreter seeds executable command locations, including unvisited branches and procedure bodies where supported. This provides executable-line coverage, not branch coverage or an inventory of every unvisited project file. Results depend on Tcl's source/bytecode location information.

`coverageResults.ts` parses complete reports, normalizes file paths, and merges counts. `testProvider.ts` publishes native `FileCoverage` and detailed `StatementCoverage` for the current test run. `coverageProvider.ts` also owns source decorations, aggregate status, and HTML/JSON export. Coverage status messages are disposed when replaced or cleared so older messages do not reappear.

## Interpreters, packages, tasks, and projects

`src/tools/executionContext.ts` resolves the resource's workspace folder, working directory, interpreter, and configuration target. Explicit per-feature REPL/test paths and launch/task overrides take precedence; otherwise features use the selected `tcl.interpreter.path`, falling back to `tclsh`. A setting's default must not hide the selected project interpreter. Multi-folder requests use the test, task, or source resource's folder.

| Component in `src/tools/` | Responsibility |
| --- | --- |
| `interpreterManager.ts` | Discover system, TclKit, ActiveTcl, and configured interpreters; select and persist the project interpreter. |
| `packageManager.ts` | Maintain catalogs keyed by folder and interpreter, scan static package metadata and interpreter search paths, refresh catalogs, install and verify packages. |
| `packageModel.ts` | Parse static registrations, metadata, and requirements while retaining exact, ranged, development, or dynamic requirement information. |
| `tclProcess.ts` | Run bounded data-query scripts and delegate version compatibility to Tcl's own package commands. |
| `dependencyManager.ts` | Combine project requirements, identify missing/conflicting/dynamic dependencies, select compatible available updates, and verify installations. |
| `packageArchive.ts` | Read supported local tar/gzip archives with bounded extraction and validated regular-file/directory paths. |
| `taskProvider.ts` | Discover and resolve folder-scoped native Tcl tasks, preserve task options, run processes with argument arrays, and clean generated task scripts. |
| `runArguments.ts`, `runCommands.ts` | Parse run arguments and launch the current file with a selected interpreter or arguments. |
| `projectTemplates.ts` | Generate project scaffolds and related configuration. |

Package discovery reads literal `pkgIndex.tcl`, `Package.tcl`, and module metadata. It queries the selected interpreter for `auto_path`, Tcl module paths, and already available packages; it does not source each project package merely to build the catalog. Successful installation is separately verified by loading the package with the selected interpreter. Catalogs invalidate on relevant file, folder, interpreter, or package-setting changes.

Installation uses an available `teacup` executable or a user-selected local directory/tar archive. Available updates come from discovered catalogs and optional teacup results. Dynamic requirements remain unknown; the extension does not claim a complete remote package registry or infer compatibility from npm-style semantic version rules.

Tasks use `ProcessExecution` for scripts and external commands, preserving arguments containing spaces or shell metacharacters. Dependency installation uses `CustomExecution` to call the package service. Task discovery includes the current file, recognizable build/test/package files, and Makefile targets. Generated runner files are removed when their task finishes or the provider is disposed.

## Build, validation, and lifecycle

The development toolchain requires Node 22.12 or newer and VS Code 1.136 or newer. `npm run compile` runs the strict TypeScript build and copies Tcl debug scripts into `out/debug/scripts/`; `npm run watch` only watches TypeScript. Never edit generated `out/` files directly.

`npm run lint` runs oxlint. `npm run test:unit` compiles and runs the explicit standalone suite list, including pure parser/formatter/helper tests and real Tcl process fixtures. `npm test` compiles through `pretest`, then runs all suites in an isolated VS Code host with two workspace folders. Both runners accept `TCL_TEST_GREP`. `VSCODE_TEST_VERSION` and `VSCODE_EXECUTABLE_PATH` select the integration host. CI runs checks on Linux, macOS, and Windows; runtime-dependent tests report unavailable interpreter capabilities.

The release workflow validates stable version tags against `main`, the manifest/lockfile, and dated changelog notes. It calls the same three-platform CI workflow, builds the validated commit into a VSIX, and transfers that artifact to a separate publishing job. Build jobs have read-only repository permissions; only publishing receives `contents: write`. The publisher rechecks the exact tag object before creating the GitHub Release. See [CONTRIBUTING.md](CONTRIBUTING.md) for release operation and retries.

Providers, event listeners, watchers, terminals, and service resources are registered for disposal. Deactivation explicitly disposes test, coverage, and debug providers that may own child processes or sockets, then cleans temporary Tcl files. Cache invalidation and cleanup are part of each feature's behavior and should be considered when changing asynchronous code.

When adding a feature, update its manifest contributions and centralized registration, reuse the parser/metadata/analysis layer, keep expensive runtime discovery lazy, and add tests at the layer where the behavior can fail. Native editor or Testing integration requires a VS Code host regression; pure syntax and execution semantics belong in standalone fixtures where possible.
