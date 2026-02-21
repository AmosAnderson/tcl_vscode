# Change Log

All notable changes to the "TCL Syntax" extension will be documented in this file.

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
- Debug adapter has basic launch/output support; full stepping/variables inspection not yet implemented
- Formatter handles most cases but may need refinement for complex nested structures
