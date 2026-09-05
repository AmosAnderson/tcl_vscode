# Architecture diagrams

These diagrams describe TCL Language Support 0.8.0. Component names correspond to the implementation in `src/`. See [the architecture guide](ARCHITECTURE_GUIDE.md) for details and limitations.

## Activation and service ownership

```mermaid
flowchart TD
    Manifest["package.json: language, commands, debugger, tasks"] --> Activate["extension.ts: activate"]
    Activate --> Language["Language providers, formatter, lint, refactoring"]
    Activate --> Index["WorkspaceIndex: background scan and watchers"]
    Activate --> Debug["Inline debug factory and REPL commands"]
    Activate --> Testing["TestController: discovery and Run / Debug / Coverage"]
    Testing --> Lens["Reference and test CodeLens"]
    Index --> Lens
    Activate --> Tasks["Register native Tcl task provider"]
    Activate --> Commands["Register tool command handlers"]
    Commands --> Lazy["ensurePhase6Initialized: shared promise"]
    Language -->|Package catalog needed| Lazy
    Tasks -->|Install dependencies task| Lazy
    Lazy --> Interpreter["Interpreter manager"]
    Lazy --> Packages["Package manager"]
    Lazy --> Dependencies["Dependency manager"]
    Lazy --> Templates["Project templates"]
    Packages --> Dependencies
```

Native task discovery and resolution are available before tool initialization. The lazy initialization promise is shared by simultaneous callers and reset after failed initialization. Extension subscriptions and explicit deactivation cleanup own the corresponding listeners, caches, terminals, processes, and sockets.

## Shared language analysis

```mermaid
flowchart LR
    Document["Tcl document: URI, version, text"] --> Parser["tclParser.ts: spans, words, scripts, substitutions"]
    Parser --> Context["procedures.ts: executable and namespace contexts"]
    Parser --> Bindings["symbolTable.ts: bindings and references"]
    Context --> Analysis["DocumentAnalysis: declarations and resolution data"]
    Bindings --> Analysis
    Analysis --> Cache["Document analysis cache"]
    Cache --> Index["WorkspaceIndex"]
    Changes["File, document, folder, exclusion events"] -->|Invalidate and refresh| Cache
    Changes -->|Invalidate and rescan| Index
    Index --> Resolve["Static procedures, namespaces, TclOO receivers"]
    Resolve --> Occurrences["Semantic and occurrence caches"]
    Metadata["tclCommands.ts: built-in command metadata"] --> Providers["Completion, signatures, hover, navigation, symbols"]
    Cache --> Providers
    Occurrences --> Providers
    Occurrences --> Lenses["Reference CodeLens"]
    Cache --> Refactor["Rename and refactoring edit planning"]
    Occurrences --> Refactor
```

Open document versions override disk-indexed data. The index watches `.tcl`, `.tk`, `.tm`, and `.test` files across workspace folders and honors configured exclusions. A separate `SymbolTableCache` preserves the scope-table interface for providers that use it.

Analysis follows known executable bodies and literal namespace/TclOO forms. Literal data, dynamic command generation, unresolved callbacks, and ambiguous receivers are not treated as proven symbol references.

## Formatting, diagnostics, and edits

```mermaid
flowchart TD
    Text["Document text and source spans"] --> Structure["Structural diagnostic provider"]
    Text --> Lint["Lint provider: tcl-lint collection"]
    Structure --> Fix["Code action provider"]
    Lint --> Fix
    Text --> FormatAPI["Formatting provider: document or range request"]
    Settings["Resource settings and editor indentation"] --> FormatAPI
    FormatAPI --> Formatter["Pure TclFormatter"]
    Formatter --> FormatEdit["TextEdit in original document coordinates"]
    Analysis["Shared analysis and workspace occurrences"] --> Planner["Refactoring and namespace / variable edit helpers"]
    Planner --> Validation["Scope, collision, control-flow and static-form checks"]
    Validation -->|Supported transformation| WorkspaceEdit["WorkspaceEdit"]
    Validation -->|Cannot establish a safe edit| Explanation["Decline with an explanation"]
```

Formatting distinguishes executable scripts and switch bodies from literal Tcl values. Refactoring checks must preserve scope and substitution semantics; they are not unrestricted text replacement.

## Debug launch and attach

```mermaid
flowchart LR
    Editor["VS Code Run and Debug"] -->|DAP requests| Factory["Inline TclDebugSession"]
    Factory -->|Launch interpreter| Tcl["debugServer.tcl"]
    Tcl -->|Port announcement| Factory
    Factory <-->|Authenticated loopback protocol| Tcl
    Tcl -->|Trace original commands| Program["User Tcl source"]
    Program -->|Source frames and trace callbacks| Tcl
    Tcl -->|Stops, stack, variables, output| Factory
    Factory -->|DAP events and responses| Editor
    Attach["Attach configuration: port, token, sourceFileMap"] --> Factory
    Factory <-->|Existing loopback endpoint or local tunnel| Existing["Compatible running Tcl debug server"]
```

Launch owns its interpreter process. Attach expects an already started compatible server, accepts loopback addresses, and uses an external tunnel for a remote target. Attach disconnect normally detaches; explicit termination can stop the target. `sourceFileMap` translates target/editor source prefixes.

```mermaid
sequenceDiagram
    participant UI as VS Code
    participant Adapter as TclDebugSession
    participant Server as Tcl debug server
    participant Script as Original source
    UI->>Adapter: Set breakpoints and configurationDone
    Adapter->>Server: Authenticate, synchronize, CONFIGDONE
    Server->>Script: Execute with command tracing
    Script->>Server: Trace callback at source command
    Server->>Server: Snapshot original frames, then pause
    Server-->>Adapter: Stop location and reason
    Adapter-->>UI: stopped event
    UI->>Adapter: stackTrace / scopes / variables / evaluate
    Adapter->>Server: Request with selected frame identity
    Server-->>Adapter: Data from that Tcl frame
    Adapter-->>UI: Frames, variables, or result
    UI->>Adapter: Continue or step
    Adapter->>Adapter: Invalidate frame and variable handles
    Adapter->>Server: Resume or step request
```

Frame identity is retained for recursive calls and selected caller inspection. Stops distinguish entry, pause, step, and breakpoint reasons. Recognized scalar assignment continuations avoid an immediate duplicate stop; nested substitutions can still expose multiple command stops on one line.

## Optional Thread workers

```mermaid
flowchart TD
    Root["Parent TclDebugSession"] --> Main["Main Tcl debug server"]
    Main -->|debugThreads enables supported thread::create wrapper| Bootstrap["Worker bootstrap and endpoint"]
    Bootstrap --> Worker["Worker Tcl debug server"]
    Main -->|Worker endpoint announcement| Root
    Root --> Child["Worker session with unique DAP thread ID"]
    Child <-->|Authenticated socket| Worker
    Root --> Owners["Frame and variable owner maps"]
    UI["VS Code thread and frame selection"] --> Root
    Owners -->|Route inspection / stepping| Child
    Root -->|Forward breakpoints| Child
    Child -->|Started, stopped, exited events| Root
```

Workers require the Tcl Thread package and creation through the instrumented path. The adapter does not discover arbitrary OS threads or workers that predate instrumentation. Each paused worker retains its own source frames and inspection handles.

## Selected tests and coverage

```mermaid
flowchart TD
    Sources["Test source files and open document changes"] --> Discovery["testDiscovery.ts: literal declarations"]
    Discovery --> Controller["TestController and test CodeLens"]
    Controller --> Selection["Include / exclude request to selected leaves"]
    Selection --> Runner["testExecution.ts: one selected-test runner"]
    Runner --> Run["Run: testProcess.ts child process"]
    Runner --> Debug["Debug: normal adapter plus private result file"]
    Runner --> Coverage["Coverage: original-source trace wrapper"]
    Coverage --> Seed["Safe compiler seeds executable locations"]
    Seed --> Reports["Complete source-line hit reports"]
    Run --> Result["Passed / failed / skipped result and output"]
    Debug --> Result
    Coverage --> Result
    Result --> Filter["testOutput.ts: hide internal records"]
    Filter --> UI["Testing results and application output"]
    Reports --> Parse["coverageResults.ts: validate and merge"]
    Parse --> Native["Native FileCoverage and StatementCoverage"]
    Parse --> Display["Coverage decorations, aggregate status, HTML / JSON"]
```

Selected tcltest runs suppress unselected test bodies; source-file top-level setup still executes. Procedure tests are called explicitly. Cancellation and timeouts belong to the runner process; debug cancellation targets the matching debug session. Coverage measures executable source lines in observed source files and does not promise branch coverage or whole-project discovery.

## Resource-aware tools and execution

```mermaid
flowchart TD
    Resource["Source, test, or task resource"] --> Context["executionContext.ts"]
    Overrides["Launch/task override or explicit REPL/test setting"] --> Context
    Settings["Folder interpreter setting and cwd"] --> Context
    Context --> Interpreter["Resolved interpreter and working directory"]
    Interpreter --> REPL["REPL terminal keyed by interpreter and cwd"]
    Interpreter --> Debug["Debug launch"]
    Interpreter --> Tests["Test process"]
    Interpreter --> Tasks["Native tasks and run commands"]
    Interpreter --> Query["Tcl package queries and version compatibility"]
    Files["Literal package and module metadata"] --> Catalog["Package catalog per folder / interpreter"]
    Query --> Catalog
    Catalog --> Dependencies["Combined project dependency requirements"]
    Requirements["package require and Package.tcl metadata"] --> Dependencies
    Dependencies --> Install["Compatible version selection and installation"]
    Teacup["Optional teacup"] --> Install
    Local["Local directory or validated tar archive"] --> Install
    Install --> Verify["Verify package load in selected interpreter"]
    Verify -->|Refresh| Catalog
```

Feature defaults do not override a selected project interpreter. Static package scanning does not source every project package; installation verification deliberately loads the requested package. Dynamic requirements remain unknown. Script tasks pass arguments as process arguments, and dependency installation tasks call the lazy dependency service through a custom execution.

## Build and validation flow

```mermaid
flowchart LR
    Source["src TypeScript"] --> Compile["npm run compile"]
    Scripts["src/debug/scripts/*.tcl"] --> Compile
    Compile --> Output["out JavaScript and copied Tcl scripts"]
    Source --> Lint["npm run lint: oxlint"]
    Output --> Unit["Standalone suites and real Tcl fixtures"]
    Output --> Host["VS Code host suites in isolated two-folder workspace"]
    Output --> UI["Separate Insiders development-host UI verification"]
    Output --> Package["VSIX packaging"]
```

`npm run watch` watches TypeScript only; run `npm run compile` after Tcl debug-server edits. CI exercises standalone and host suites on Linux, macOS, and Windows. The Insiders UI report records a separate manual verification pass and its coverage limits; it is not an automatic consequence of a passing host test run.

## Tagged release flow

```mermaid
flowchart LR
    Tag["Version tag push"] --> Guard["Verify main ancestry, version, and changelog"]
    Guard --> CI["Reusable Linux / macOS / Windows checks"]
    CI --> Build["Compile and package validated commit"]
    Build --> Artifact["Versioned VSIX and changelog notes"]
    Artifact --> Publish["Recheck tag; create GitHub Release"]
```

Tags outside main skip release jobs. The artifact publishing job alone has repository write permission. The [contributor guide](CONTRIBUTING.md) documents tag naming, version updates, and retry behavior.
