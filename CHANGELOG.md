# Change Log

All notable changes to the "TCL Syntax" extension will be documented in this file.

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
