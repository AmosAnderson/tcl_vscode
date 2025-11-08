# Change Log

All notable changes to the "tcl-language-support" extension will be documented in this file.

## [0.3.8] - 2025-01-10

### Added
- Augmented the formatter registration so the built-in formatter reports `TCL Formatter (Built-in)` in the VS Code picker and sits alongside the language-server formatter.
- Documented formatter selection in the README to highlight the LSP vs. built-in choice.

### Internal
- Version bump to 0.3.8 to capture formatter metadata changes.
- Double-quoted string patterns now ignore escaped quotes at both the start and end, fixing highlighting of regex literals such as `\"([^\"]+)\"`.

## [0.3.7] - 2025-01-09

### Fixed
- Resolved runaway string scopes by ensuring double-quoted strings only terminate on unescaped quotes.
- Corrected brace/bracket/embedded command regions to ignore escaped delimiters, preventing large sections from mis-highlighting.
- Tightened line-comment detection so literal `#` characters inside brace-quoted blocks (e.g., regexes) no longer swallow the rest of the document.
- Built-in formatter now registers with the display name **TCL Formatter (Built-in)** so it’s easy to distinguish from the language-server formatter when using “Format Document With…”.

### Internal
- Updated `package.json`/`package-lock.json` version metadata for the 0.3.7 build.

## [0.3.6] - 2025-01-08

### Added
- **Language Server Integration**: Full support for TCL Language Server (tcl-language-server)
  - Automatic detection and activation of language server when available
  - Graceful fallback to built-in providers when language server is not installed
  - New configuration settings:
    - `tcl.languageServer.enable` - Enable/disable language server
    - `tcl.languageServer.path` - Path to language server executable
    - `tcl.languageServer.trace.server` - Trace LSP communication
  - New commands:
    - `tcl.restartLanguageServer` - Restart the language server
    - `tcl.showLanguageServerOutput` - Show language server output channel
    - `tcl.languageServerStatus` - Display current language server status
  - Enhanced IntelliSense when language server is available
  - Install from: https://github.com/AmosAnderson/tcl_languageserver

### Internal
- Added vscode-languageclient dependency (^9.0.1)
- Added skipLibCheck to TypeScript configuration for better compatibility
- Created src/languageServer/client.ts for LSP integration
- Updated extension activation to initialize language server

## [0.3.5] - 2024-11-05

### Fixed
- **Critical**: Fixed invalid tclsh validation flag (was using non-existent `-n` flag)
- **Critical**: Fixed broken multi-line procedure parsing in completion provider
- **Critical**: Fixed shell injection vulnerability in test execution
- **Major**: Fixed memory leaks from missing disposal registration
- **Major**: Fixed string literal corruption in formatter (now properly skips content inside quotes)
- **Major**: Fixed duplicate edits in variable renaming
- **Major**: Fixed regex issues in hover provider, symbol provider, and code action provider
- **Minor**: Replaced deprecated `.substr()` with `.substring()`
- **Minor**: Fixed test name regex to replace all special characters (added missing 'g' flag)
- **Minor**: Fixed file watcher disposal in test provider
- **Minor**: Improved Phase 6 initialization error handling and cleanup

### Improved
- Enhanced diagnostic provider with proper backslash escape handling
- Improved debug adapter with better error reporting and stack traces
- Added TCL string escaping helper for safe command execution
- Better procedure argument parsing with brace matching
- Updated all procedure/namespace detection patterns to handle multi-line definitions

### Internal
- Updated all development dependencies to latest versions:
  - TypeScript 5.9.3
  - ESLint 9.39.1
  - @typescript-eslint packages 8.46.3
  - @types/node 24.10.0
  - Mocha 11.7.5
- All code passes compilation and linting with zero errors
- Zero security vulnerabilities
- Updated VS Code engine requirement to ^1.105.0

## [0.3.0] - 2025-08-23

### Added / Improved
- Explicit interpreter discovery coverage for Tcl versions 8.4 through 9.0

### Internal

## [0.2.1] - 2025-08-09

### Fixed / Improved
- Procedure rename now correctly updates calls that occur immediately after an opening brace or bracket (e.g. inside `catch {need2 1}` blocks) and in unsaved/untitled documents.

### Internal
- Added test covering brace-group procedure call rename scenario.
- Added minimal ESLint configuration (previously lint step failed due to missing config).
- Adjusted test setup (temporarily removed lint from pretest) to ensure rename tests run; formatter improvements remain a future task.

## [0.0.1] - Initial Release

### Phase 1 Features (Completed)
- Basic VS Code extension structure
- TCL syntax highlighting for keywords, strings, numbers, and operators
- Language configuration with auto-closing pairs and bracket matching

### Phase 2 Features (Completed)
#### Enhanced Syntax Highlighting
# Changelog (Detailed)

This project is in active development. Versions are for internal tracking and have not yet been published to the VS Code Marketplace.

## 0.2.1 (Unreleased)
### Fixes
- Procedure rename: now updates calls appearing immediately after an opening brace or bracket (e.g. `catch {need2 1}`) and works in unsaved/untitled documents.

### Internal
- Added targeted rename test.
- Added minimal ESLint config (previously missing).

## 0.2.0 (Internal)
Initial complete feature pass (aggregated from earlier phased milestones):
- Syntax highlighting (core Tcl, Tk, Expect, namespaces, packages, numbers, command substitutions).
- Basic formatter (indentation + spacing options).
- IntelliSense: 250+ command completions, hovers, document/workspace symbols, go to definition, references.
- Diagnostics: Syntax validation (including optional tclsh integration) & basic quick fixes.
- Debugging: Basic launch support with script execution and output capture (breakpoint support limited).
- REPL integration (evaluate selection / run file).
- Testing: Test discovery, execution, coverage scaffolding.
- Refactoring: Rename (with built-in command protection), extract proc/variable, inline variable.
- Interpreter & package management utilities; project templates & tasks.
- Documentation: Architecture guides, configuration reference.

## 0.0.x (Internal prototypes)
Early incremental prototypes leading up to 0.2.0 (bootstrapping extension structure, initial highlighting, formatter stub, and incremental feature layering). Details omitted.

---
**Known Limitations:**
- Debug adapter has basic launch/output support; full stepping/variables inspection not yet implemented.
- Formatter handles most cases but may need refinement for complex nested structures.

**Planned before first public release:**
- Full debug adapter implementation with stepping and variable inspection.
- Enhanced formatter accuracy for edge cases.
- Broaden rename/refactor semantic analysis.
- Expand automated test coverage.
