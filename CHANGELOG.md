# Change Log

All notable changes to the "TCL Syntax" extension will be documented in this file.

## [0.7.1] - 2026-05-20

### Changed
- **Dependencies**: Updated development tooling, including TypeScript 6.0.3, ESLint 10.4.0, `@typescript-eslint` 8.59.4, `@types/vscode` 1.120.0, and `@vscode/vsce` 3.9.1.
- **Engine**: Minimum VS Code version updated to 1.120.0 to match the extension API typings.
- **Testing**: Updated the Mocha suite runner import for compatibility with current TypeScript and Mocha typings.
- **Documentation**: Replaced Claude Code-specific workspace guidance with compact OpenCode instructions and removed `CLAUDE.md`.

### Security
- **Dependencies**: Refreshed the lockfile and resolved reported npm audit vulnerabilities.

## [0.7.0] - 2026-03-31

### Added
- **Debugging**: Conditional breakpoint support — attach boolean expressions to breakpoints; execution pauses only when the condition evaluates to true
- **Debugging**: Logpoint support — breakpoints that log interpolated messages (with `{expression}` placeholders) to the debug console without pausing
- **Debugging**: Array variable expansion in the debug variables panel
- **Analysis**: Workspace-wide symbol index (`src/analysis/workspaceIndex.ts`) — scans all `.tcl/.tk/.tm/.test` files at startup, watches for file changes, and debounces live re-indexing (500ms)
- **Analysis**: Scope-aware symbol table (`src/analysis/symbolTable.ts`) — parses documents to build a scope tree with proper variable scoping (local, global, namespace, parameter, upvar)
- **Refactoring**: Extract to Namespace — move selected code into a new `namespace eval` block (`src/refactoring/namespaceProvider.ts`)
- **Refactoring**: Inline Procedure — replace a procedure call with the body of its definition, safely handling brace quoting and parameter substitution
- **Commands**: Run with Interpreter — execute the current file with a selected TCL interpreter (`tcl.runWithInterpreter`)
- **Commands**: Run with Args — execute the current file with custom arguments (`tcl.runWithArgs`)
- **Snippets**: Added `proc` and `namespace_eval` snippets (24 → 26 total)

### Improved
- **Formatter**: Continuation line handling — lines ending with `\` (odd backslash count) indent subsequent continuation lines by one extra level
- **Formatter**: Multi-line `expr` block tracking — detects `expr {` spanning multiple lines, preserves expression body without reformatting, and maintains consistent indentation
- **Formatter**: Improved switch body alignment for both brace-style and dash-style (`switch -- $x`), with patterns at +1 indent and bodies at +2
- **IntelliSense**: Completion provider now includes workspace procedure completions from the index and merges namespace completions from both the index and the current document
- **IntelliSense**: Definition and workspace symbol providers query the workspace index instead of scanning files on every request
- **Hover**: Shows scope information (parameter, upvar alias, etc.) when the symbol table has a match
- **Rename**: Uses scoped references from the symbol table for variable renames, with graceful fallback to text-based matching
- **Linting**: Refined lint checks for expression bracing, missing switch defaults, catch statements without variables, line length, deprecated commands, and global variable shorthand usage; improved diagnostic messages

### Fixed
- **Security**: Fixed command injection in `interpreterManager` by replacing `execAsync` with `execFileAsync`
- **Security**: Fixed command injection in `runWithArgs` — all arguments are now shell-quoted
- **Security**: REPL now warns on `exec`/`open|` in `evaluateSelection` and escapes file paths
- **Robustness**: Fixed socket leak when `sendPendingBreakpoints` fails in the debug adapter
- **Robustness**: Added 10-second timeout for debug port detection to prevent hanging
- **Robustness**: Added workspace scoping warning for debug targets outside the workspace
- **Robustness**: Orphaned temp TCL files are now cleaned up on activation and deactivation
- **Robustness**: Implemented `deactivate()` to dispose providers holding child processes
- **Robustness**: Validated `tclPath` exists before passing to REPL terminal
- **Robustness**: SIGKILL fallback for orphaned test processes on timeout
- **Robustness**: Fixed race condition in test provider timeout/close promise settlement
- **Robustness**: Debug adapter cleanup now uses SIGTERM with SIGKILL fallback; nested force-kill timers cleared on all exit paths
- **Cleanup**: Extracted shared `escapeTclString` utility to `tclUtils.ts`
- **Cleanup**: Removed duplicate `tcl.runBuildTask` from `taskProvider`
- **Cleanup**: Wired `tcl.runTests` to `testing.runAll` instead of a stub message
- **Correctness**: Fixed multiline strings being incorrectly flagged as "Unclosed string literal" — string state now persists across lines in both diagnostic and lint providers

### Changed
- **Commands**: Expanded TCL command database from 251 to 827 unique commands covering core subcommands, math functions, Tk operations, TclOO, Tcllib, thread, TDBC, and Expect extended commands
- **Engine**: Minimum VS Code version updated to 1.110.0

## [0.6.1] - 2026-03-12

### Fixed
- **Security**: Replaced all `exec` shell-string calls with `execFile` array-based invocation to prevent command injection (diagnosticProvider, packageManager, debug adapter)
- **Security**: Switched to TCL brace-quoting (`source {path}`) for file paths in generated scripts to prevent substitution attacks
- **Correctness**: Fixed debug server response ordering — OK acknowledgments now sent before resuming `vwait` to prevent race conditions
- **Correctness**: Fixed naive single-backslash escape detection in lintProvider, diagnosticProvider, and formatter with proper `countBackslashes` utility
- **Correctness**: Fixed `findMatchingBrace` incorrectly treating single-quotes as string delimiters (TCL only uses double-quotes)
- **Correctness**: Guarded all `indexOf` results in symbolProvider with `Math.max(0, ...)` to prevent negative column values
- **Robustness**: Replaced `Date.now()` with `crypto.randomUUID()` for temp file names to avoid collisions
- **Robustness**: Added 60-second timeout to test process execution
- **Robustness**: Added try-catch to formatting providers to prevent unhandled exceptions
- **Robustness**: Added proper disposal of lintProvider via `context.subscriptions`
- **Cleanup**: Extracted shared `createTempTclPath`, `toForwardSlashes`, `countBackslashes`, `escapeRegex`, and `findMatchingBrace` into `src/utils/tclUtils.ts` to deduplicate code across 8 files
- **Cleanup**: Removed duplicate `proc` and `close` entries from `tclCommands.ts`
- **Cleanup**: Removed dead `tasks` field from `TclTaskProvider`
- **Cleanup**: Ensured all `CancellationTokenSource` instances are disposed in tests

### Dependencies
- Updated `@eslint/eslintrc` to 3.3.5
- Updated `@types/node` to 25.5.0
- Updated `@types/vscode` to 1.110.0
- Updated `@typescript-eslint/eslint-plugin` to 8.57.0
- Updated `@typescript-eslint/parser` to 8.57.0
- Updated `eslint` to 10.0.3
- Added overrides for `diff` (8.0.3) and `serialize-javascript` (7.0.4) to resolve transitive vulnerabilities

## [0.6.0] - 2026-03-05

### Added
- **Debugging**: Full debug adapter with breakpoints, stepping (step in/out/over), call stack inspection, variable viewing, expression evaluation, and set-variable support via TCP socket protocol and source-level instrumentation
- **Linting**: New `TclLintProvider` with 6 lint rules: unbraced `expr` arguments, missing `switch` default clause, `catch` without result variable, line length limits, deprecated commands, and repeated `$::varName` shorthand in procs
- **Quick Fixes**: Code actions for lint warnings — brace expr arguments and add result variable to catch
- **Snippets**: 25 snippets for Tk widgets, Expect automation, TclOO classes, and common patterns (dict iteration, file I/O, package provide, test case)
- **Package Installation**: `installPackage()` now works via teacup auto-detection with manual fallback (copy to auto_path + `pkg_mkIndex`)
- **Dependency Management**: `installDependencies` and `updateDependencies` commands now perform real package installation with success/failure tracking
- **Settings**: `tcl.lint.enable`, `tcl.lint.maxLineLength`, `tcl.lint.exprBracing`, `tcl.packages.installDirectory`

### Dependencies
- Updated `@eslint/eslintrc` to 3.3.4
- Updated `@types/node` to 25.3.5
- Updated `@typescript-eslint/eslint-plugin` to 8.56.1
- Updated `@typescript-eslint/parser` to 8.56.1
- Updated `eslint` to 10.0.2
- Updated `glob` to 13.0.6

## [0.5.2] - 2026-02-20

### Fixed
- **Testing**: Fixed non-functional test execution and coverage analysis — `tclsh` does not accept a `-c` flag; scripts are now written to a temp file and passed as a filename argument
- **Testing**: Fixed coverage data never being read — `coverage.dat` is now resolved relative to the workspace root instead of the process working directory
- **Testing**: Fixed event listener leak in coverage provider — `onDidChangeActiveTextEditor` subscription is now stored and disposed with the provider
- **Debugger**: Fixed `.tcl_debug_wrapper.tcl` being left behind in the user's source directory after a debug session ends — it is now deleted on disconnect/terminate
- **Debugger**: Fixed local variable `path` shadowing the `path` module import in `setBreakPointsRequest`
- **Diagnostics**: Removed incorrect single-quote string tracking — TCL does not treat `'` as a string delimiter, causing false "unclosed string" errors
- **Diagnostics**: Fixed `parseTclshErrors` using a hardcoded end-column of `100`; it now uses the actual line length
- **Formatter**: Fixed inline block expansion (`if`, `while`, `for`, `foreach`, `proc`) incorrectly rewriting content inside comment lines
- **Symbols**: Fixed namespace stack being incorrectly popped by proc-body closing braces — provider now tracks brace depth to determine when each namespace block actually closes
- **Tools**: Fixed `TclTaskProviderManager.register` throwing when `workspaceFolders` is an empty array
- **Tools**: Replaced `process.env.HOME` (undefined on Windows) with `os.homedir()` in interpreter discovery paths
- **REPL**: Added missing `await` to async REPL command handlers
- **Refactoring**: Removed dead `beforeWord.endsWith('\n')` branch in rename provider (`.trim()` already strips newlines)
- **Formatter**: Comment lines (starting with `#`) no longer affect indentation — braces inside comments were previously counted, causing subsequent lines to be incorrectly indented
- **Formatter**: Inline comments (`; # ...`) no longer affect indentation
- **Formatter**: Comment content is now preserved unchanged (spacing rules no longer applied inside comments)
- **Syntax**: Replaced unreliable `(?<=^|\\s|;)` lookbehind in comment pattern with two explicit patterns — line-start (`^\s*#`) and semicolon-separated (`(?<=;)\s*#`) — for correct Oniguruma matching
- **Syntax**: Fixed string end-quote pattern so that `\\"` (escaped backslash followed by closing quote) correctly terminates a string

### Improved
- **Formatter**: Inline block forms for `while`, `foreach`, and `for` are now expanded to multi-line, consistent with existing `proc` and `if` handling
- **Syntax**: Removed `[+\-*/%]` arithmetic operator pattern that was incorrectly highlighting option flags (`-text`, `-width`), glob patterns (`*`), and format strings (`%d`)
- **Syntax**: Added boolean/boolean-like constants: `true`, `false`, `yes`, `no`, `on`, `off`
- **Syntax**: Added missing TCL 8.6 built-in commands: `apply`, `chan`, `lassign`, `socket`, `tailcall`, `coroutine`, `yield`, `yieldto`
- **Syntax**: Added TclOO keywords: `method` (highlighted as a named function), `constructor`, `destructor`
- **Syntax**: Added `**` exponentiation operator

### Dependencies
- Updated `@types/node` to 25.3.0
- Updated `@typescript-eslint/eslint-plugin` to 8.56.0
- Updated `@typescript-eslint/parser` to 8.56.0
- Updated `eslint` to 10.0.1
- Updated `glob` to 13.0.6

## [0.4.2] - 2026-01-06

### Dependencies
- Updated @eslint-community/eslint-utils to v4.9.1
- Updated @typescript-eslint/eslint-plugin to v8.52.0
- Updated @typescript-eslint/parser to v8.52.0
- Updated ts-api-utils to v2.4.0

## [0.4.1] - 2025-12-18

### Fixed
- **Critical**: Fixed incorrect `tclsh -c` flag usage in diagnostics and interpreter detection - tclsh doesn't support the `-c` flag, now uses echo pipe approach
- **Security**: Fixed regex injection vulnerabilities in rename provider, reference provider, and definition provider by properly escaping user input
- **Bug**: Fixed backslash escape detection in string parsing - now correctly handles consecutive backslashes (e.g., `\\"`)
- **Bug**: Fixed indentation inconsistency in definition provider

### Improved
- **Formatter**: Enhanced brace spacing logic to preserve regex patterns (e.g., `{\d{3}}`) and list values
- **Formatter**: Brace spacing now only applies to control-flow keywords (`if`, `while`, `for`, `foreach`, `switch`, `elseif`, `expr`, `catch`, `try`)

### Changed
- Removed redundant `onLanguage:tcl` activation event (VS Code auto-generates this)

### Dependencies
- Updated all dependencies to latest versions
- Fixed 1 high severity vulnerability (jws HMAC signature verification)
- Updated @types/node to v25

## [0.4.0] - 2025-11-18

### Added
- **Signature Help**: Built-in signature help provider for TCL commands
  - Provides parameter hints and documentation for built-in commands as you type
  - Ships entirely within the extension for consistent behavior across all environments

### Removed
- External TCL Language Server integration - the extension now uses built-in providers exclusively

## [0.3.8] - 2025-01-10

### Added
- Formatter now reports as `TCL Formatter (Built-in)` in the VS Code picker

### Fixed
- Double-quoted string patterns now ignore escaped quotes at both the start and end

## [0.3.7] - 2025-01-09

### Fixed
- Resolved runaway string scopes by ensuring double-quoted strings only terminate on unescaped quotes
- Corrected brace/bracket/embedded command regions to ignore escaped delimiters
- Tightened line-comment detection so literal `#` characters inside brace-quoted blocks no longer cause issues

## [0.3.6] - 2025-01-08

### Added
- Language Server Integration with automatic detection and graceful fallback to built-in providers

## [0.3.5] - 2024-11-05

### Fixed
- Fixed invalid tclsh validation flag
- Fixed broken multi-line procedure parsing in completion provider
- Fixed shell injection vulnerability in test execution
- Fixed memory leaks from missing disposal registration
- Fixed string literal corruption in formatter
- Fixed duplicate edits in variable renaming

### Improved
- Enhanced diagnostic provider with proper backslash escape handling
- Improved debug adapter with better error reporting

## [0.3.0] - 2025-08-23

### Added
- Interpreter discovery for Tcl versions 8.4 through 9.0

## [0.2.1] - 2025-08-09

### Fixed
- Procedure rename now correctly updates calls inside brace groups and unsaved documents

## [0.2.0] - Initial Feature-Complete Release

### Added
- Comprehensive syntax highlighting (Tcl, Tk, Expect, namespaces, packages)
- Code formatter with configurable options
- IntelliSense: 250+ command completions, hovers, symbols, go to definition, references
- Diagnostics: Syntax validation with optional tclsh integration and quick fixes
- Debugging: Basic launch support with script execution and output capture
- REPL integration (evaluate selection / run file)
- Testing: Test discovery, execution, coverage scaffolding
- Refactoring: Rename, extract procedure/variable, inline variable
- Interpreter & package management utilities
- Project templates & VS Code task integration

---

**Known Limitations:**
- Formatter handles most cases; complex nested structures, continuation lines, and multi-line `expr` are supported as of 0.7.0
