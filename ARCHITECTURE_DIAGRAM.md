# TCL VS Code Extension - Architecture Diagram

## Extension Activation Flow

```
VS Code Opens TCL File or Triggers Debug
        ↓
Extension Activation Events:
  - onLanguage:tcl
  - onDebugResolve:tcl
  - onDebugInitialConfigurations
        ↓
activate(context) in src/extension.ts
        ↓
┌─────────────────────────────────────────────────────┐
│ PHASE 1-5: IMMEDIATE INITIALIZATION (SYNCHRONOUS)   │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌──────────────────────────────────────────┐       │
│  │ FORMATTER LAYER                          │       │
│  ├──────────────────────────────────────────┤       │
│  │ ├─ Document Formatting Provider          │       │
│  │ └─ Range Formatting Provider             │       │
│  │    (Uses TclFormatter for pure logic)    │       │
│  └──────────────────────────────────────────┘       │
│                                                      │
│  ┌──────────────────────────────────────────┐       │
│  │ DIAGNOSTIC & CODE ACTION LAYER           │       │
│  ├──────────────────────────────────────────┤       │
│  │ ├─ Diagnostic Provider                   │       │
│  │ │  └─ Validates syntax, reports errors   │       │
│  │ └─ Code Action Provider                  │       │
│  │    └─ Offers quick fixes                 │       │
│  └──────────────────────────────────────────┘       │
│                                                      │
│  ┌──────────────────────────────────────────┐       │
│  │ INTELLISENSE PROVIDERS                   │       │
│  ├──────────────────────────────────────────┤       │
│  │ ├─ Completion Provider                   │       │
│  │ │  ├─ Uses: TCL_BUILTIN_COMMANDS         │       │
│  │ │  ├─ Caches procedures per document     │       │
│  │ │  └─ Offers: commands, snippets, vars   │       │
│  │ │                                         │       │
│  │ ├─ Hover Provider                        │       │
│  │ │  ├─ Uses: TCL_BUILTIN_COMMANDS         │       │
│  │ │  └─ Shows: signatures, documentation   │       │
│  │ │                                         │       │
│  │ ├─ Symbol Provider (Document & Workspace)│       │
│  │ │  ├─ Finds: procedures, namespaces, vars│       │
│  │ │  └─ Builds: namespace hierarchy        │       │
│  │ │                                         │       │
│  │ ├─ Definition Provider                   │       │
│  │ │  ├─ Searches: document, then workspace │       │
│  │ │  └─ Returns: procedure locations       │       │
│  │ │                                         │       │
│  │ └─ Reference Provider                    │       │
│  │    └─ Finds: all references in workspace │       │
│  └──────────────────────────────────────────┘       │
│                                                      │
│  ┌──────────────────────────────────────────┐       │
│  │ DEBUG LAYER                              │       │
│  ├──────────────────────────────────────────┤       │
│  │ ├─ Debug Adapter Factory                 │       │
│  │ │  └─ Creates inline TclDebugSession     │       │
│  │ │                                         │       │
│  │ ├─ Debug Configuration Provider          │       │
│  │ │  └─ Provides launch configurations     │       │
│  │ │                                         │       │
│  │ └─ REPL Commands                         │       │
│  │    ├─ Start REPL (terminal-based)        │       │
│  │    ├─ Evaluate Selection                 │       │
│  │    └─ Run Current File                   │       │
│  └──────────────────────────────────────────┘       │
│                                                      │
│  ┌──────────────────────────────────────────┐       │
│  │ TESTING & COVERAGE LAYER                 │       │
│  ├──────────────────────────────────────────┤       │
│  │ ├─ Test Provider (Test Explorer UI)      │       │
│  │ │  ├─ Discovers tests in workspace       │       │
│  │ │  └─ Runs tests via TestController      │       │
│  │ │                                         │       │
│  │ └─ Coverage Provider                     │       │
│  │    ├─ Instruments TCL code               │       │
│  │    └─ Visualizes coverage with decorations│      │
│  └──────────────────────────────────────────┘       │
│                                                      │
│  ┌──────────────────────────────────────────┐       │
│  │ REFACTORING LAYER                        │       │
│  ├──────────────────────────────────────────┤       │
│  │ ├─ Rename Provider                       │       │
│  │ │  └─ Renames: procedures, variables, ns │       │
│  │ │                                         │       │
│  │ └─ Extract Provider                      │       │
│  │    ├─ Extract Procedure                  │       │
│  │    └─ Extract Variable                   │       │
│  └──────────────────────────────────────────┘       │
│                                                      │
└─────────────────────────────────────────────────────┘
        ↓
┌─────────────────────────────────────────────────────┐
│ PHASE 6: LAZY INITIALIZATION ON FIRST COMMAND       │
├─────────────────────────────────────────────────────┤
│ (Only initialized when user invokes first command)  │
│                                                      │
│  ┌──────────────────────────────────────────┐       │
│  │ TOOL MANAGERS                            │       │
│  ├──────────────────────────────────────────┤       │
│  │ ├─ Interpreter Manager                   │       │
│  │ │  ├─ Discovers: system, tclkit,         │       │
│  │ │  │              activetcl, custom      │       │
│  │ │  └─ Commands: select, add, refresh     │       │
│  │ │                                         │       │
│  │ ├─ Package Manager                       │       │
│  │ │  ├─ Discovers: Tcllib, Tklib, local   │       │
│  │ │  └─ Commands: create, updateIndex      │       │
│  │ │                                         │       │
│  │ ├─ Dependency Manager                    │       │
│  │ │  ├─ Scans: package require statements  │       │
│  │ │  └─ Commands: check, install, report   │       │
│  │ │                                         │       │
│  │ ├─ Project Templates                     │       │
│  │ │  └─ Scaffolds: program, library, GUI   │       │
│  │ │                                         │       │
│  │ └─ Task Provider                         │       │
│  │    └─ Integrates: build tasks            │       │
│  └──────────────────────────────────────────┘       │
│                                                      │
└─────────────────────────────────────────────────────┘
```

## Data Layer - Central Knowledge Base

```
src/data/tclCommands.ts
         ↓
    ┌────────────────────────────────────┐
    │  TCL_BUILTIN_COMMANDS (merged)     │
    ├────────────────────────────────────┤
    │ BASE_TCL_COMMANDS                  │
    │ ├─ String manipulation             │
    │ ├─ List manipulation               │
    │ ├─ Control flow                    │
    │ ├─ File I/O                        │
    │ ├─ Variables & procedures          │
    │ ├─ Arrays & dictionaries           │
    │ ├─ Math & expressions              │
    │ ├─ System interaction              │
    │ ├─ Interpreter & execution        │
    │ └─ Event handling                  │
    │                                    │
    │ ADDITIONAL_TCL_COMMANDS            │
    │ ├─ Advanced features               │
    │ ├─ OOP (TclOO)                     │
    │ ├─ Coroutines                      │
    │ └─ Other specialized               │
    │                                    │
    │ TK_WIDGET_COMMANDS                 │
    │ ├─ Standard widgets                │
    │ └─ Themed widgets (ttk)            │
    │                                    │
    │ TK_UTILITY_COMMANDS                │
    │ ├─ Event binding                   │
    │ ├─ Geometry management             │
    │ ├─ Dialogs                         │
    │ └─ Window management               │
    │                                    │
    │ EXPECT_COMMANDS                    │
    │ ├─ Pattern matching                │
    │ ├─ Spawning processes              │
    │ └─ Data transmission               │
    │                                    │
    │ STRING_SUBCOMMANDS                 │
    │ TCL_SNIPPETS (code templates)      │
    │ TCL_COMMAND_CATEGORIES             │
    └────────────────────────────────────┘
             ↓↓↓
    Used By Multiple Providers:
    ├─ Completion Provider → CompletionItems
    ├─ Hover Provider → Documentation
    ├─ Rename Provider → Validation
    └─ Diagnostic Provider → Potential validation
```

## Code Analysis Flow

```
Document Content (TCL file)
         ↓
    ┌────────────────────────────────────────────┐
    │ Multiple Independent Analyzers             │
    ├────────────────────────────────────────────┤
    │                                            │
    │  COMPLETION PROVIDER                       │
    │  ├─ Regex: "proc name {args}"             │
    │  ├─ Extracts: procedure names             │
    │  └─ Cache: per document URI               │
    │                                            │
    │  SYMBOL PROVIDER                           │
    │  ├─ Line-by-line matching                 │
    │  ├─ Extracts: procedures, namespaces,     │
    │  │            variables, packages         │
    │  └─ Builds: namespace hierarchy (stack)   │
    │                                            │
    │  DEFINITION PROVIDER                       │
    │  ├─ Regex: "proc name {args} {"           │
    │  ├─ Searches: current doc, then workspace │
    │  └─ Returns: Location objects             │
    │                                            │
    │  HOVER PROVIDER                            │
    │  ├─ Finds: procedure definitions          │
    │  ├─ Parses: preceding comments            │
    │  └─ Returns: formatted documentation      │
    │                                            │
    │  DIAGNOSTIC PROVIDER                       │
    │  ├─ Syntax check: brace/bracket balance   │
    │  ├─ Optional: tclsh validation            │
    │  └─ Reports: errors, warnings             │
    │                                            │
    │  RENAME PROVIDER                           │
    │  ├─ Searches: workspace with regex        │
    │  ├─ Finds: all references                 │
    │  └─ Returns: WorkspaceEdit                │
    │                                            │
    └────────────────────────────────────────────┘
            ↓
    Caching Strategy:
    ├─ Completion: caches procedures per URI
    ├─ Single workspace listener invalidates all
    └─ Prevents listener leaks per invocation
```

## Provider Dependencies and Data Sharing

```
    ┌─────────────────────────┐
    │ Configuration System    │
    │ (tcl.* settings)        │
    └────────────┬────────────┘
                 ↓
        ┌─────────────────────────────────────┐
        │ TCL_BUILTIN_COMMANDS & SNIPPETS    │
        │ (Central Language Knowledge)        │
        └────────────┬────────────────────────┘
                     ↓
    ┌────────────────┴────────────────────────┐
    │                                          │
    ↓                                          ↓
Completion Provider ◄─────────────────► Hover Provider
    │                                          │
    ├─────► Symbol Provider ◄────────────────┤
    │           │                              │
    │           ├─────► Definition Provider    │
    │           │           │                  │
    │           │           └─► Reference Prov.
    │           │                              │
    ↓           ↓                              ↓
Diagnostic Provider ◄──────► Code Action Provider
    │                              │
    ├─────────────────────────────┤
    │                              ↓
    │                      Rename Provider
    │
    └────────────────────────► Extract Provider
```

## Formatter Architecture

```
Formatting Request
       ↓
┌─────────────────────────────────────────────┐
│ TclDocumentFormattingEditProvider           │
│ (VS Code Language Integration)              │
├─────────────────────────────────────────────┤
│ 1. Read configuration (tcl.format.*)        │
│ 2. Create TclFormatter with options         │
│ 3. Call formatter.format(text)              │
│ 4. Return TextEdit[]                        │
└──────────────┬──────────────────────────────┘
               ↓
┌─────────────────────────────────────────────┐
│ TclFormatter (Pure Function)                │
│ (No VS Code dependencies)                   │
├─────────────────────────────────────────────┤
│ format(text: string): string {              │
│   1. Normalize inline blocks                │
│   2. Process line by line:                  │
│      ├─ Track indent from braces            │
│      ├─ Apply structural spacing            │
│      ├─ Apply operator spacing              │
│      ├─ Apply brace spacing                 │
│      └─ Apply bracket spacing               │
│   3. Return formatted text                  │
│ }                                           │
└─────────────────────────────────────────────┘
```

## Debug Adapter Architecture

```
VS Code Debug UI
       ↓
Debug Protocol (JSON-RPC)
       ↓
┌──────────────────────────────────────────────┐
│ TclDebugAdapterDescriptorFactory             │
├──────────────────────────────────────────────┤
│ Creates: DebugAdapterInlineImplementation    │
└──────────────┬───────────────────────────────┘
               ↓
┌──────────────────────────────────────────────┐
│ TclDebugSession                              │
│ extends DebugSession                         │
├──────────────────────────────────────────────┤
│                                              │
│ Protocol Handlers:                           │
│ ├─ initializeRequest                         │
│ │  └─ Advertises capabilities                │
│ │     └─ supportsConfigurationDoneRequest ✓ │
│ │     └─ supportsEvaluateForHovers ✓        │
│ │     └─ supportsBreakpointLocations ✗      │
│ │     └─ ... (most others disabled)          │
│ │                                            │
│ ├─ configurationDoneRequest                  │
│ │  └─ Finalization after config              │
│ │                                            │
│ └─ launchRequest                             │
│    ├─ Validates program file exists          │
│    ├─ Creates .tcl_debug_wrapper.tcl         │
│    ├─ Spawns: tclsh debug_wrapper.tcl        │
│    ├─ Handles: stdout, stderr, exit          │
│    └─ Manages: breakpoints, variables        │
│                                              │
│ State Variables:                             │
│ ├─ _breakpoints (Map<file, Breakpoint[]>)  │
│ ├─ _variableHandles                         │
│ ├─ _callStack                               │
│ ├─ _currentLine, _currentFile               │
│ ├─ _isRunning                               │
│ └─ _tclProcess                              │
│                                              │
└──────────────────────────────────────────────┘
       ↓
┌──────────────────────────────────────────────┐
│ Child Process: tclsh (user program)          │
│ With Debug Wrapper (breakpoint checking)     │
└──────────────────────────────────────────────┘
       ↓
┌──────────────────────────────────────────────┐
│ TclREPLProvider (Terminal-based REPL)        │
├──────────────────────────────────────────────┤
│ ├─ startREPL()                               │
│ │  └─ Create terminal running tclsh         │
│ │                                            │
│ ├─ evaluateSelection()                       │
│ │  └─ Send selected code to terminal         │
│ │                                            │
│ └─ runCurrentFile()                          │
│    └─ Send "source filename" to terminal     │
│                                              │
│ Terminal: managed by VS Code, persists       │
│ Output: displayed directly, not parsed       │
└──────────────────────────────────────────────┘
```

## Test Execution Flow

```
User Runs Tests (via Test Explorer)
       ↓
┌──────────────────────────────────────────┐
│ TclTestProvider                          │
├──────────────────────────────────────────┤
│ 1. Test Discovery Phase:                 │
│    ├─ Watches: **/*.{test,tcl}           │
│    ├─ Finds: "proc test_*" patterns      │
│    ├─ Parses: tcltest "test" commands    │
│    └─ Creates: TestItem hierarchy        │
│                                          │
│ 2. Execution Phase:                      │
│    ├─ Spawns: tclsh for each test       │
│    ├─ Parses: output (pass/fail/skip)   │
│    ├─ Captures: error messages           │
│    └─ Updates: TestController results    │
│                                          │
│ 3. Coverage Analysis (optional):         │
│    ├─ Instruments: proc wrapping         │
│    ├─ Tracks: line execution counts      │
│    └─ Visualizes: green/red decorations  │
│                                          │
└──────────────────────────────────────────┘
       ↓
VS Code Test Explorer UI
(Pass/Fail indicators, timing, output)
```

## Lazy Initialization Pattern

```
Extension Activation
       ↓
Phase 1-5 Features Initialized (Immediate)
├─ Providers
├─ Formatters
├─ Debug adapter
├─ REPL
└─ Testing
       ↓
Phase 6 Check
├─ Is interpreter manager initialized?
├─ Is package manager initialized?
└─ Is dependency manager initialized?
       ↓
      NO → (Lazy Load) ────┐
       │                    │
       └──→ YES (continue)  │
                            ↓
           User invokes "TCL: Select Interpreter"
           │
           ↓
           ensurePhase6Initialized()
           ├─ Create TclInterpreterManager
           ├─ Call initialize() (discovers interpreters)
           ├─ Create TclPackageManager
           ├─ Call initialize() (discovers packages)
           ├─ Create TclDependencyManager
           └─ Set phase6Initialized = true
           
           (Subsequent invocations skip initialization)
```

## Configuration Dependency Graph

```
tcl.format.* settings
    ↓
    Formatter
    ├─ alignBraces
    ├─ spacesAroundOperators
    ├─ spacesInsideBraces
    └─ spacesInsideBrackets

tcl.diagnostics.* settings
    ↓
    Diagnostic Provider
    ├─ enable
    └─ useTclsh

tcl.repl.tclPath
    ↓
    REPL Provider
    └─ Shell path for terminal

tcl.test.tclPath
    ↓
    Test Provider
    └─ Interpreter for test execution

tcl.interpreter.path
tcl.interpreters.customPaths
    ↓
    Interpreter Manager
    ├─ Default interpreter
    └─ Custom interpreter paths

tcl.packages.autoDiscovery
    ↓
    Package Manager
    └─ Auto-discover packages
```

---

This diagram provides a visual reference for understanding how all the components of the TCL VS Code extension fit together and interact.
