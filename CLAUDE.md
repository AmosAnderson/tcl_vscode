# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Summary

This is a comprehensive VS Code language extension for TCL (Tool Command Language) that provides syntax highlighting, IntelliSense, formatting, debugging, testing, and refactoring capabilities. The extension supports TCL, Tk (graphical toolkit), and Expect (automation framework). It includes full Language Server Protocol (LSP) integration for enhanced code intelligence.

**Current Version:** 0.3.6
**Target:** VS Code 1.105.0+

## Common Development Commands

### Building and Testing
```bash
npm install              # Install dependencies
npm run compile          # Compile TypeScript to JavaScript
npm run watch            # Watch mode for development
npm run lint             # Run ESLint
npm test                 # Run tests in VS Code test environment
npm run package          # Create .vsix package for distribution
```

### Development Workflow
- Press `F5` to launch a new VS Code Extension Development Host window with the extension loaded
- Make changes to TypeScript files in `src/`
- Use `npm run watch` for automatic recompilation
- Reload the Extension Development Host window to test changes

---

## 1. Overall Architecture Pattern

The extension follows a **layered, feature-driven architecture** organized into distinct phases:

### Architectural Layers

1. **Data Layer** (`src/data/`)
   - Central definition of TCL commands, categories, and code snippets
   - Single source of truth for language knowledge (`tclCommands.ts`)

2. **Provider Layer** (`src/providers/`)
   - VS Code language providers implementing LSP-like protocol
   - Each provider addresses one aspect of IntelliSense/code intelligence
   - Works with built-in commands and user-defined code

3. **Feature Layers**
   - **Language Server** (`src/languageServer/`) - LSP client for enhanced IntelliSense
   - **Formatter** (`src/formatter/`) - Document formatting with configurable rules
   - **Debugger** (`src/debug/`) - Debug adapter, REPL, and process execution
   - **Testing** (`src/testing/`) - Test discovery, execution, and coverage
   - **Refactoring** (`src/refactoring/`) - Rename and extract operations
   - **Tools** (`src/tools/`) - Interpreter, package, and dependency management

4. **Extension Entry Point** (`src/extension.ts`)
   - Single activation point that orchestrates all feature registration
   - Activates Language Server first (if enabled and available)
   - Lazy-loads Phase 6 features (tools) on-demand
   - Manages subscription lifecycle and cleanup

### Design Pattern: Lazy Initialization

Phase 6 features (interpreter, package, and dependency managers) use lazy initialization:
- These resource-intensive managers are only initialized when first needed
- Reduces extension startup time for users who don't use these features
- Triggered by explicit command invocation

---

## 2. Key Components and Their Relationships

### 2.1 Extension Activation & Entry Points

**File:** `src/extension.ts`

**Activation Events** (from `package.json`):
- `onLanguage:tcl` - Activates when a TCL file is opened
- `onDebugResolve:tcl` - Activates when TCL debugging is requested
- `onDebugInitialConfigurations` - Activates for debug setup

**Initialization Flow:**
```
activate() → Language Server (Phase 0, async)
           ├─ Check if enabled (tcl.languageServer.enable)
           ├─ Check availability of tcl-language-server command
           ├─ Start LSP client if available
           └─ Fallback to built-in providers if not available

           → Phase 1-5 Initialization (synchronous)
           ├─ Formatting Providers (document + range)
           ├─ Diagnostic & Code Action Providers
           ├─ IntelliSense Providers (completion, hover, definition, symbols)
           ├─ Debug Adapter & Configuration
           ├─ REPL Commands
           ├─ Testing & Coverage Providers
           └─ Refactoring Providers (rename, extract)

           → Phase 6 (Lazy Initialization on command)
             ├─ Interpreter Manager
             ├─ Package Manager
             ├─ Dependency Manager
             ├─ Project Templates
             └─ Task Provider
```

### 2.2 Language Server Client

**File:** `src/languageServer/client.ts`

**Purpose:** Integrates with the external TCL Language Server for enhanced IntelliSense and code intelligence.

**Architecture:**

```
activateLanguageServer()
  ├─ Check configuration (tcl.languageServer.enable)
  ├─ Check availability of tcl-language-server executable
  │   ├─ Try: command --version
  │   └─ Fallback: which command
  │
  ├─ If not available → Show user prompt
  │   ├─ "Open GitHub" → Opens language server repository
  │   ├─ "Configure Path" → Opens settings
  │   └─ "Disable" → Disables language server
  │
  └─ If available → Start LSP client
      ├─ Configure ServerOptions (executable path)
      ├─ Configure ClientOptions
      │   ├─ Document selector (tcl files)
      │   ├─ File system watcher (*.tcl, *.tk, *.tm, *.test)
      │   └─ Output channels (server output, trace)
      │
      └─ LanguageClient.start()
          └─ Communicates via stdio with language server
```

**Integration Strategy:**
- **Graceful Fallback**: Extension works with or without language server
- **Built-in Providers**: Always registered as fallback when LSP is unavailable
- **LSP Priority**: When language server is active, it takes priority over built-in providers
- **User Control**: Can be disabled via `tcl.languageServer.enable` setting

**Configuration Settings:**
- `tcl.languageServer.enable` (boolean, default: true) - Enable/disable language server
- `tcl.languageServer.path` (string, default: "tcl-language-server") - Executable path
- `tcl.languageServer.trace.server` (string, default: "off") - Trace LSP communication

**Management Commands:**
- `tcl.restartLanguageServer` - Restart the language server
- `tcl.showLanguageServerOutput` - Show language server output channel
- `tcl.languageServerStatus` - Display current state (Stopped/Starting/Running)

**Lifecycle:**
- Activated during extension activation (async)
- Deactivated during extension deactivation
- Can be restarted without reloading extension

**Language Server Repository:**
- https://github.com/AmosAnderson/tcl_languageserver
- Separate executable, installed independently
- Provides enhanced semantic analysis beyond built-in providers

### 2.3 IntelliSense Providers (Working Together)

These providers share the common pattern of analyzing code to provide language intelligence:

#### **Completion Provider** (`src/providers/completionProvider.ts`)
- **Input:** Document position, trigger character (`.`, `:`, `$`)
- **Output:** Array of CompletionItem objects

**Intelligence Sources (in priority order):**
1. String subcommands (e.g., `string length`, `string match`)
2. Namespace-qualified commands (e.g., `ns::`)
3. Package names (for `package require`)
4. Variable completions (from `$` trigger)
5. Built-in command completions (from `TCL_BUILTIN_COMMANDS`)
6. User-defined procedures (parsed from current document)
7. Code snippets (templates for common constructs)

**Caching Strategy:**
- Maintains per-document procedure cache keyed by URI
- Single document-change listener invalidates all caches
- Prevents listener leaks from repeated invocations

#### **Symbol Provider** (`src/providers/symbolProvider.ts`)
- **Two implementations:**
  - `TclDocumentSymbolProvider` - Returns symbols in current file (Document Outline)
  - `TclWorkspaceSymbolProvider` - Returns symbols across workspace (Go to Symbol)

**Symbol Types Recognized:**
- Procedures (from `proc` definitions)
- Namespaces (from `namespace eval`)
- Global variables (from `global` declarations)
- Namespace variables (from `variable` declarations)
- Packages (from `package provide`)

**Namespace Hierarchy:**
- Maintains stack of namespace contexts
- Nests procedures/variables under their parent namespace
- Visualizes TCL's namespace structure in outline

#### **Definition Provider** (`src/providers/definitionProvider.ts`)
- **Triggered by:** Ctrl+Click or "Go to Definition" command

**Resolution Strategy:**
1. Identifies word at cursor position
2. Checks if it's a procedure call
3. Searches in current document first (fast path)
4. Falls back to workspace search (async)
5. Also handles namespace references (`::` syntax)

**Search Algorithm:**
- Uses regex patterns to find `proc <name> {args} {`
- Searches all TCL files (`**/*.{tcl,tk,tm}`)
- Returns multiple locations if procedure defined in multiple files

#### **Reference Provider** (`src/providers/definitionProvider.ts`)
- Complements definition provider
- Finds all references to a symbol in workspace
- Uses similar regex-based search strategy

#### **Hover Provider** (`src/providers/hoverProvider.ts`)
- **Triggered by:** Hovering over code

**Information Sources:**
1. Built-in command documentation (from `TCL_BUILTIN_COMMANDS`)
   - Displays signature, description, and category
2. User-defined procedures (parsed from current document)
   - Shows procedure signature
   - Includes preceding comment blocks as documentation
3. Variable info (from document analysis)
   - Shows variable type and value if determinable
4. Namespace references
   - Identifies namespace syntax

### 2.4 Formatter Architecture

**Files:** `src/formatter/tclFormatter.ts`, `src/formatter/formattingProvider.ts`

**Separation of Concerns:**
- `formattingProvider.ts` - VS Code integration (implements DocumentFormattingEditProvider)
- `tclFormatter.ts` - Pure formatting logic, configuration-agnostic

**Configuration** (from `package.json`):
```typescript
- tcl.format.alignBraces (boolean) - Put closing braces on separate lines
- tcl.format.spacesAroundOperators (boolean) - Add spaces around +, -, *, /, etc.
- tcl.format.spacesInsideBraces (boolean) - Add spaces inside {}
- tcl.format.spacesInsideBrackets (boolean) - Add spaces inside []
- tcl.format.enable (boolean) - Enable format-on-save
```

**Formatting Algorithm:**
1. Normalize inline blocks (convert `proc name {args} {body}` to multi-line)
2. Process line-by-line:
   - Track indent level from brace balance
   - Apply structural and operator spacing rules
   - Handle special cases (closing-brace-only lines)
3. Output properly indented and spaced code

**Key Challenges Addressed:**
- Distinguishing braces in strings vs. actual braces
- Preserving TCL's flexible syntax while normalizing style
- Handling both tabs and spaces based on configuration

### 2.5 Debug Adapter Implementation

**Files:**
- `src/debug/debugAdapterFactory.ts` - Factory and configuration
- `src/debug/tclDebugAdapter.ts` - Debug session implementation
- `src/debug/tclREPL.ts` - REPL integration

**Architecture Pattern:**

```
VS Code Debug Protocol
        ↓
DebugAdapterFactory creates TclDebugSession (inline implementation)
        ↓
TclDebugSession (extends DebugSession)
  ├─ Protocol Handlers
  │   ├─ initializeRequest (advertise capabilities)
  │   ├─ configurationDoneRequest (finalize setup)
  │   └─ launchRequest (spawn TCL process)
  │
  ├─ Process Management
  │   ├─ Spawns tclsh with debug wrapper script
  │   ├─ Reads stdout/stderr
  │   └─ Tracks process lifecycle
  │
  └─ Debug State
      ├─ _breakpoints (map of file → breakpoints)
      ├─ _variableHandles (for variable inspection)
      ├─ _callStack (current execution stack)
      └─ _currentLine/_currentFile (execution position)
```

**Debug Wrapper Script Generation:**
- Creates temporary `.tcl_debug_wrapper.tcl` in program directory
- Wraps user program with breakpoint checking logic
- Provides hooks for debugger to halt execution and inspect state

**Capabilities Advertised:**
- `supportsConfigurationDoneRequest` ✓
- `supportsEvaluateForHovers` ✓
- Most other capabilities disabled (simple implementation)

**REPL Integration:**
- `TclREPLProvider` creates terminal running `tclsh`
- `evaluateSelection()` sends selected code to REPL
- `runCurrentFile()` sources entire file in REPL
- Terminal is managed by VS Code, persists until closed

**Lifecycle:**
- REPL terminal created on-demand and reused
- User code execution through terminal's `sendText()`
- No direct output parsing; REPL displays results directly

### 2.6 Testing Framework Integration

**File:** `src/testing/testProvider.ts`

**Architecture:**
```
TestController (VS Code Testing API)
  ├─ Run Profile: "Run TCL Tests"
  ├─ Debug Profile: "Debug TCL Tests"
  │
  ├─ Test Discovery
  │   ├─ Watches for .test files and .tcl files
  │   ├─ Scans for test procedures (naming patterns)
  │   └─ Parses tcltest package test cases
  │
  └─ Test Execution
      ├─ Spawns tclsh for each test
      ├─ Parses test output
      └─ Updates test results in Test Explorer UI
```

**Test Discovery Patterns:**
1. Procedure-based tests:
   - Looks for procedures matching test naming conventions
   - Creates TestItem for each discovered test
2. tcltest package tests:
   - Parses `test` command invocations
   - Extracts test names and line numbers
3. File-based organization:
   - Groups tests under their source files in hierarchy

**Test Result Handling:**
- Maps test output to pass/fail/skip status
- Captures error messages and stack traces
- Supports both test output parsing and command-line assertions

### 2.7 Coverage Analysis

**File:** `src/testing/coverageProvider.ts`

**Approach:**
- Instruments TCL code at runtime using `proc` wrapping
- Tracks line execution counts
- Generates coverage visualization with decorations

**Coverage Script:**
- Wraps user procedures with coverage tracking
- Records every executed line
- Saves coverage data to file for analysis

**Visualization:**
- Green decorations for covered lines
- Red decorations for uncovered lines
- Percentage summary shown in status

### 2.8 Refactoring Support

**Rename Provider** (`src/refactoring/renameProvider.ts`)
- Implements `RenameProvider` interface
- Two methods:
  - `prepareRename()` - Validates rename is possible before user types
  - `provideRenameEdits()` - Returns WorkspaceEdit with all changes

**Symbol Type Detection:**
- Procedure: Renames all procedure definitions and calls
- Variable: Renames all variable references (including `$var` forms)
- Namespace: Updates namespace references and contents

**Constraints:**
- Prevents renaming of built-in TCL commands
- Validates identifiers (alphanumeric, underscores, colons for namespaces)
- Uses regex-based search across workspace

**Extract Provider** (`src/refactoring/extractProvider.ts`)
- Implements `CodeActionProvider` interface
- Provides code actions when text is selected

**Extract Operations:**
1. Extract Procedure: Creates new procedure with selection, replaces with call
2. Extract Variable: Creates variable assignment, replaces selection with variable reference

**Implementation:**
- Prompts user for extracted symbol name
- Validates name syntax
- Generates procedure signature with detected arguments
- Inserts at appropriate location (top of file or namespace)

### 2.9 Tool Managers (Phase 6 - Lazy Loaded)

#### **Interpreter Manager** (`src/tools/interpreterManager.ts`)

**Purpose:** Discover and manage TCL interpreter installations

**Discovery Strategy:**
```
discoverInterpreters()
  ├─ System Interpreters
  │   ├─ Generic: tclsh, tclsh9, tclsh8.x
  │   ├─ Unix: /usr/bin/tclsh, /usr/local/bin/tclsh
  │   └─ Windows: C:\Tcl\bin\tclsh*.exe
  │
  ├─ TclKit installations
  │   └─ Searches standard TclKit paths
  │
  ├─ ActiveTcl installations
  │   └─ Searches vendor-specific paths
  │
  └─ Custom interpreters
      └─ Loaded from config: tcl.interpreters.customPaths
```

**Data Structure:**
```typescript
interface TclInterpreter {
    path: string;          // Executable path
    version: string;       // e.g., "8.6.13"
    name: string;          // Display name
    type: 'system' | 'tclkit' | 'activetcl' | 'custom';
    isDefault: boolean;
}
```

**Features:**
- Probes interpreters for version (runs `tclsh -version`)
- Filters by supported versions
- Sorts by version (newest first)
- Persistent selection via workspace settings

#### **Package Manager** (`src/tools/packageManager.ts`)

**Purpose:** Catalog and manage TCL packages

**Package Sources:**
```
discoverPackages()
  ├─ Tcllib packages
  │   └─ Scans /usr/share/tcllib and other standard paths
  │
  ├─ Tklib packages
  │   └─ Parallel structure for Tk-specific packages
  │
  └─ Workspace packages
      └─ Scans workspace for Package.tcl and pkgIndex.tcl
```

**Package Index:**
```typescript
interface TclPackage {
    name: string;
    version: string;
    description?: string;
    location: string;
    type: 'tcllib' | 'tklib' | 'local' | 'system';
}
```

**Parsing Strategy:**
- Reads `pkgIndex.tcl` files
- Extracts package name, version, and file list
- Creates package index for quick lookup
- Tracks last update time for cache validation

**Integration Points:**
- Completion provider uses package names for `package require`
- Dependency manager queries packages for availability checking

#### **Dependency Manager** (`src/tools/dependencyManager.ts`)

**Purpose:** Track and manage project dependencies

**Dependency Discovery:**
```
discoverDependencies()
  ├─ Parse Package.tcl files
  │   └─ Look for package declarations and requirements
  │
  ├─ Scan TCL files for 'package require'
  │   └─ Extract package names and versions
  │
  └─ Check dependency status
      ├─ available - Package found in known locations
      ├─ missing - Package required but not found
      └─ outdated - Package found but version mismatch
```

**Functionality:**
- Generates dependency report (markdown)
- Checks for missing dependencies
- Offers installation suggestions
- Monitors workspace for changes

#### **Project Templates** (`src/tools/projectTemplates.ts`)

**Purpose:** Scaffold new TCL projects

**Template Types:**
- Basic TCL program
- TCL library/package
- Tk GUI application
- Tcl/Expect automation script
- TDD-oriented project (with test structure)

**Wizard Experience:**
- Prompts for project name
- Asks for template type
- Creates directory structure
- Generates starter files and configuration

#### **Task Provider Manager** (`src/tools/taskProvider.ts`)

**Purpose:** Integrate with VS Code Task system

**Built-in Tasks:**
- Run TCL file
- Run tests
- Generate coverage
- Format all TCL files

**Integration:**
- Registers as TaskProvider
- Provides task templates users can customize
- Supports running in terminal with proper environment

---

## 3. Important Data Flows

### 3.1 TCL Command Knowledge Flow

**Central Definition:** `src/data/tclCommands.ts`

```
TCL_BUILTIN_COMMANDS (single merged array)
  ├─ BASE_TCL_COMMANDS (string, list, control, file, variable, etc.)
  ├─ ADDITIONAL_TCL_COMMANDS (advanced features, OOP, coroutines)
  ├─ TK_WIDGET_COMMANDS (button, frame, text, etc.)
  ├─ TK_UTILITY_COMMANDS (bind, event, focus, etc.)
  └─ EXPECT_COMMANDS (spawn, expect, send, etc.)

DATA STRUCTURE:
  interface TclCommand {
      name: string;        // "append"
      signature: string;   // "append varName ?value ...?"
      description: string; // "Append to variable"
      category: string;    // "string"
  }
```

**Consumers:**
1. **Completion Provider**
   - Maps commands to CompletionItem objects
   - Adds command name, signature, and description
2. **Hover Provider**
   - Looks up word in command list
   - Returns formatted documentation
3. **Rename Provider**
   - Checks if identifier is built-in (prevents renaming)
4. **Diagnostic Provider**
   - Could validate command names (currently unused)

**Also Defined:**
- `STRING_SUBCOMMANDS` - Subcommands for `string` command
- `TCL_SNIPPETS` - Code templates (proc, if, foreach, etc.)
- `TCL_COMMAND_CATEGORIES` - Categorical grouping

### 3.2 Document Analysis Flow

**Shared Pattern:** Multiple providers parse documents independently

```
Document Content
  ├─ Completion Provider
  │   ├─ Extracts: procedure names, variable names
  │   └─ Uses: Regex for "proc name {args}"
  │
  ├─ Symbol Provider
  │   ├─ Extracts: procedures, namespaces, variables, packages
  │   ├─ Maintains: Namespace hierarchy stack
  │   └─ Uses: Line-by-line matching with regex
  │
  ├─ Definition Provider
  │   ├─ Finds: Procedure definitions
  │   └─ Returns: Location in document/workspace
  │
  ├─ Hover Provider
  │   ├─ Finds: Procedure arguments, comments
  │   └─ Returns: Formatted documentation
  │
  ├─ Diagnostic Provider
  │   ├─ Checks: Brace/bracket balance, syntax errors
  │   └─ Also runs: tclsh syntax validation if enabled
  │
  └─ Rename Provider
      ├─ Finds: All references to renamed symbol
      └─ Returns: WorkspaceEdit with replacements
```

**Optimization:** Caching Strategy
- Completion provider caches procedures per document URI
- Single workspace listener invalidates all caches on change
- Prevents listener leaks in event-driven architecture

### 3.3 Configuration Flow

**Settings Definition:** `package.json` → `contributes.configuration`

**Usage Pattern:**
```typescript
// Get configuration
const config = vscode.workspace.getConfiguration('tcl');

// Read values with defaults
const tclPath = config.get<string>('interpreter.path', 'tclsh');
const formatOnSave = config.get<boolean>('format.enable', false);
const alignBraces = config.get<boolean>('format.alignBraces', true);
```

**Providers Using Configuration:**
- **Formatter:** Read formatting options (alignBraces, spacesAroundOperators, etc.)
- **Diagnostic Provider:** Read tcl.diagnostics.enable, tcl.diagnostics.useTclsh
- **Interpreter Manager:** Read tcl.interpreters.customPaths
- **REPL:** Read tcl.repl.tclPath
- **Test Provider:** Read tcl.test.tclPath
- **Package Manager:** Read tcl.packages.autoDiscovery

### 3.4 Diagnostic and Code Action Flow

**Two-Stage Process:**

```
Document Change Event
  ↓
TclDiagnosticProvider.provideDiagnostics(document)
  ├─ Reads config: diagnostics.enable
  ├─ Runs basic syntax validation (brace/bracket balance)
  ├─ Optionally runs tclsh validation (if enabled)
  └─ Creates Diagnostic objects
       └─ Stored in DiagnosticCollection (displayed in Problems panel)

User Triggers Quick Fix (Ctrl+.)
  ↓
TclCodeActionProvider.provideCodeActions()
  ├─ Receives context.diagnostics from active range
  ├─ Maps diagnostic message to fix logic
  ├─ Creates CodeAction with WorkspaceEdit
  └─ Returns action list to UI
```

**Supported Fixes:**
- Missing space after keywords (if, for, while)
- Backticks to bracket conversion
- Brace/bracket mismatch suggestions

---

## 4. Non-Obvious Architectural Decisions and Patterns

### 4.1 Language Server Protocol (LSP) without Language Server

**Decision:** Implement all language features as direct VS Code providers instead of separate language server process.

**Rationale:**
- TCL syntax is lightweight enough for in-process analysis
- Avoids overhead of inter-process communication
- Simpler deployment (single extension, no separate executable)
- Faster iteration during development

**Trade-off:**
- Cannot share language analysis with other editors
- All features must run in VS Code's main thread
- Performance depends on file size (no lazy parsing implemented)

### 4.2 Regex-Based Code Analysis

**Decision:** Use regex patterns to identify procedures, namespaces, variables instead of building AST.

**Examples:**
```typescript
// Procedure discovery
const procRegex = /\bproc\s+([a-zA-Z_][a-zA-Z0-9_:]*)\s*{([^}]*)}/g;

// Namespace tracking
const nsMatch = line.match(/^\s*namespace\s+eval\s+((?:::)?[a-zA-Z_][a-zA-Z0-9_:]*)\s*{/);

// Package provide
const packageMatch = line.match(/^\s*package\s+provide\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+([\d.]+)/);
```

**Rationale:**
- TCL's syntax is complex and context-dependent
- Regex avoids building full parser infrastructure
- Sufficient for feature extraction (don't need full AST)
- Fast and simple to implement

**Limitations:**
- Cannot handle nested structures perfectly
- Regex patterns must be carefully crafted to avoid false positives
- No deep semantic understanding

### 4.3 Inline Debug Adapter vs. Executable Adapter

**Decision:** Implement debug session inline as `DebugAdapterInlineImplementation` rather than spawning separate process.

```typescript
createDebugAdapterDescriptor() {
    return new vscode.DebugAdapterInlineImplementation(new TclDebugSession());
}
```

**Rationale:**
- Simpler implementation for proof-of-concept
- Shared memory with extension context
- Easier debugging of adapter itself

**Trade-off:**
- Debug adapter runs on extension's main thread
- May block other extension operations during debugging
- Different from production-quality debuggers

### 4.4 Terminal-Based REPL vs. Direct TCL Integration

**Decision:** Use VS Code Terminal running native `tclsh` instead of embedding TCL interpreter.

```typescript
this._terminal = vscode.window.createTerminal({
    name: 'TCL REPL',
    shellPath: tclPath,
});
this._terminal.sendText(userCode);
```

**Rationale:**
- No need to embed/bundle TCL interpreter
- User sees actual TCL output
- Works with any TCL installation on user's system
- Familiar terminal experience

**Trade-off:**
- Cannot capture and parse output programmatically
- Cannot provide structured result feedback
- Cannot integrate with debugger

### 4.5 Per-Document Procedure Cache with Single Listener

**Decision:** Cache parsed procedures per document, invalidate with single workspace listener.

```typescript
// In constructor
this.changeSubscription = vscode.workspace.onDidChangeTextDocument(e => {
    const uri = e.document.uri.toString();
    if (this.procedureCache.has(uri)) this.procedureCache.delete(uri);
    this.packageCache = null;
});
```

**Rationale:**
- Avoids creating new listener per completion invocation (prevents leak)
- Single listener handles all cache invalidation
- Balances performance (caching) with correctness (invalidation)

**Pattern:**
- Each provider implementation creates listener once in constructor
- Implements `dispose()` to clean up
- Extension's subscription management calls dispose

### 4.6 Lazy Initialization of Phase 6 Features

**Decision:** Only initialize interpreter, package, and dependency managers when user invokes first command.

```typescript
const ensurePhase6Initialized = async () => {
    if (phase6Initialized) return;
    interpreterManager = new TclInterpreterManager();
    await interpreterManager.initialize();  // Discovers interpreters
    phase6Initialized = true;
};

vscode.commands.registerCommand('tcl.selectInterpreter', async () => {
    await ensurePhase6Initialized();
    interpreterManager?.selectInterpreter();
});
```

**Rationale:**
- These managers perform filesystem scans and subprocess calls
- Most users don't need these features
- Reduces extension startup time significantly
- Initialized on-demand when first command is triggered

**Trade-off:**
- First invocation has slight delay for initialization
- More complex code to manage initialization state

### 4.7 Symbol Hierarchy Maintained in Memory

**Decision:** Build namespace hierarchy only when needed (in symbol provider), don't persist.

```typescript
// In provideDocumentSymbols
const namespaceStack: vscode.DocumentSymbol[] = [];
let currentNamespace: vscode.DocumentSymbol | null = null;

// As we parse, maintain stack to nest children
if (currentNamespace) {
    currentNamespace.children.push(procSymbol);
} else {
    symbols.push(procSymbol);
}
```

**Rationale:**
- Namespace structure only needed for outline display
- Simpler than building and maintaining separate symbol table
- Recalculated fresh on each document change

**Trade-off:**
- Cannot use cached namespace info in other providers
- Each symbol query rebuilds structure
- Providers are somewhat independent (less shared state)

### 4.8 Formatter: Pure Function Design

**Decision:** Separate VS Code integration (`formattingProvider.ts`) from pure formatting logic (`tclFormatter.ts`).

```typescript
// formattingProvider.ts - VS Code integration
class TclDocumentFormattingEditProvider {
    formatter = new TclFormatter(formatterOptions);
    return [vscode.TextEdit.replace(range, this.formatter.format(text))];
}

// tclFormatter.ts - Pure function
class TclFormatter {
    format(text: string): string {
        // No VS Code dependencies
        return formatted;
    }
}
```

**Rationale:**
- Formatter logic testable without VS Code API
- Can apply formatting programmatically (e.g., in CLI tool)
- Clear separation of concerns
- Easier to understand formatting algorithm

### 4.9 Capability Negotiation in Debug Adapter

**Decision:** Explicitly set all debug capabilities to false except subset we support.

```typescript
response.body.supportsEvaluateForHovers = true;
response.body.supportsConfigurationDoneRequest = true;
// All others default to false
```

**Rationale:**
- Honest about implementation level
- VS Code doesn't offer UI for unsupported capabilities
- Prevents user confusion or crashes from unsupported operations
- Allows future enhancement without client changes

---

## 5. Extension Lifecycle and Cleanup

### 5.1 Subscription Management

```typescript
export function activate(context: vscode.ExtensionContext) {
    // All registrations added to context.subscriptions
    context.subscriptions.push(
        vscode.languages.registerDocumentFormattingEditProvider(...),
        vscode.workspace.onDidChangeTextDocument(...),
        vscode.commands.registerCommand(...),
        // ... more subscriptions
    );
}

// Cleanup happens automatically when extension deactivates
// Each subscription's dispose() is called by VS Code
```

### 5.2 Resource Management

**Disposable Objects:**
- Diagnostic collection - Created once, disposed at deactivate
- Text editor decorations - Created once per decoration type
- Output channels - Created per feature, auto-managed by VS Code
- Terminals (REPL) - Created on-demand, persist until closed by user
- File watchers - Created for test discovery, auto-disposed

**Listener Management:**
- Single workspace change listener per provider with caching
- Event listener disposed when provider is disposed
- Prevents listener proliferation from repeated invocations

---

## 6. Configuration System

### Available Settings

```typescript
// Formatting
tcl.format.alignBraces               // boolean (default: true)
tcl.format.spacesAroundOperators     // boolean (default: true)
tcl.format.spacesInsideBraces        // boolean (default: true)
tcl.format.spacesInsideBrackets      // boolean (default: false)
tcl.format.enable                    // boolean (default: false) - format on save

// Diagnostics
tcl.diagnostics.enable               // boolean (default: true)
tcl.diagnostics.useTclsh             // boolean (default: true) - validate with tclsh

// REPL and Testing
tcl.repl.tclPath                     // string (default: "tclsh")
tcl.test.tclPath                     // string (default: "tclsh")

// Interpreter Management
tcl.interpreter.path                 // string (default: "tclsh") - default interpreter
tcl.interpreters.customPaths         // array (default: []) - custom interpreter paths

// Package Management
tcl.packages.autoDiscovery           // boolean (default: true)
```

**Reading Configuration:**
```typescript
const config = vscode.workspace.getConfiguration('tcl');
const value = config.get<Type>('section.key', defaultValue);
```

---

## 7. Testing and Development Notes

### Running Tests
```bash
npm run test
# Runs VS Code test environment with test files from src/test/
```

### Key Test Files
- `src/test/completion.test.ts` - Tests completion provider
- `src/test/formatter.test.ts` - Tests formatting
- `src/test/rename.test.ts` - Tests rename refactoring
- `src/test/extension.test.ts` - Integration tests

### Building and Packaging
```bash
npm run compile      # Compile TypeScript
npm run watch        # Watch mode
npm run package      # Create .vsix package for distribution
```

---

## 8. Extending the Architecture

### Adding a New Provider

1. Create file in `src/providers/newProvider.ts`
2. Implement appropriate VS Code interface (e.g., `HoverProvider`)
3. Register in `extension.ts`'s `activate()` function
4. Add to context.subscriptions
5. Consider caching strategy for performance

**Example Pattern:**
```typescript
export class TclNewProvider implements vscode.SomeProvider {
    private cache = new Map();
    private listener: vscode.Disposable;
    
    constructor() {
        this.listener = vscode.workspace.onDidChangeTextDocument(e => {
            this.cache.clear();
        });
    }
    
    provideSomething(...) {
        // Implementation
    }
    
    dispose() {
        this.listener.dispose();
    }
}
```

### Adding a New Tool Manager

1. Create file in `src/tools/newManager.ts`
2. Implement async `initialize()` method
3. Register in `ensurePhase6Initialized()` in extension.ts
4. Implement `dispose()` for cleanup
5. Add command handlers that call `ensurePhase6Initialized()`

### Modifying TCL Command Knowledge

1. Edit `src/data/tclCommands.ts`
2. Add/modify entries in appropriate command group (BASE_TCL_COMMANDS, etc.)
3. The merged `TCL_BUILTIN_COMMANDS` is automatically updated
4. Changes immediately available to all providers

---

## 9. Key Files Reference

| File | Purpose |
|------|---------|
| `src/extension.ts` | Main entry point, orchestrates all providers |
| `src/languageServer/client.ts` | Language Server Protocol client integration |
| `src/data/tclCommands.ts` | Central TCL language knowledge base |
| `src/providers/completionProvider.ts` | IntelliSense completions |
| `src/providers/symbolProvider.ts` | Document outline and workspace symbols |
| `src/providers/definitionProvider.ts` | Go to definition and find references |
| `src/providers/hoverProvider.ts` | Hover documentation |
| `src/providers/diagnosticProvider.ts` | Syntax checking and error reporting |
| `src/providers/codeActionProvider.ts` | Quick fixes and code actions |
| `src/formatter/tclFormatter.ts` | Formatting algorithm |
| `src/formatter/formattingProvider.ts` | VS Code formatting integration |
| `src/debug/tclDebugAdapter.ts` | Debug session implementation |
| `src/debug/debugAdapterFactory.ts` | Debug adapter factory |
| `src/debug/tclREPL.ts` | REPL terminal integration |
| `src/testing/testProvider.ts` | Test discovery and execution |
| `src/testing/coverageProvider.ts` | Test coverage analysis |
| `src/refactoring/renameProvider.ts` | Rename refactoring |
| `src/refactoring/extractProvider.ts` | Extract refactoring |
| `src/tools/interpreterManager.ts` | TCL interpreter discovery |
| `src/tools/packageManager.ts` | Package discovery and management |
| `src/tools/dependencyManager.ts` | Project dependency tracking |
| `src/tools/projectTemplates.ts` | Project scaffolding |
| `src/tools/taskProvider.ts` | VS Code task integration |

---

## 10. Summary: Key Architectural Principles

1. **LSP Integration with Fallback:** Language Server Protocol provides enhanced features when available, with graceful fallback to built-in providers
2. **Separation of Concerns:** Each provider handles one language feature
3. **Single Source of Truth:** TCL commands defined once, used by multiple providers
4. **Performance through Caching:** Document content cached per provider, invalidated on change
5. **Lazy Initialization:** Heavy features only initialized when first needed
6. **Configuration-Driven:** User preferences configure formatting, paths, and feature flags
7. **Terminal-Based Execution:** REPL, testing, and debugging use system processes
8. **Workspace Awareness:** All analysis functions operate on entire workspace, not just current file
9. **Error Handling:** Graceful degradation (e.g., if tclsh or language server unavailable, still basic functionality works)
10. **Extensibility:** Clear patterns for adding providers, tools, and command handlers
11. **Event-Driven:** Responds to document changes, user actions, configuration updates

This architecture allows the extension to provide comprehensive TCL language support while remaining maintainable and performant.
