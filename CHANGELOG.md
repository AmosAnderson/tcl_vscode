# Change Log

All notable changes to the "tcl-language-support" extension will be documented in this file.

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
# Changelog (Simplified)

This project is still in internal pre-release. Versions listed below have not yet been published to the VS Code Marketplace. Historical phased development notes have been condensed for clarity.

## 0.2.1 (Unreleased)
### Fixes
- Procedure rename: now updates calls appearing immediately after an opening brace or bracket (e.g. `catch {need2 1}`) and works in unsaved/untitled documents.

### Internal
- Added targeted rename test.
- Added minimal ESLint config (previously missing).

## 0.2.0 (Internal)
Initial complete feature pass (aggregated from earlier phased milestones):
- Syntax highlighting (core Tcl, Tk, Expect, namespaces, packages, numbers, command substitutions).
- Basic formatter (indentation + spacing options; still experimental).
- IntelliSense: completions, hovers, document/workspace symbols, go to definition, references.
- Diagnostics: Syntax validation (including optional tclsh integration) & basic quick fixes.
- Debugging: Breakpoints, stepping, call stack, variables.
- REPL integration (evaluate selection / run file).
- Testing: Test discovery, execution, coverage scaffolding.
- Refactoring: Rename (with built-in command protection), extract proc/variable, inline variable.
- Interpreter & package management utilities; project templates & tasks.
- Documentation: User guide, configuration reference, FAQ, contributing guide.

## 0.0.x (Internal prototypes)
Early incremental prototypes leading up to 0.2.0 (bootstrapping extension structure, initial highlighting, formatter stub, and incremental feature layering). Details omitted.

---
Planned before first public release:
- Improve formatter (spacing + block expansion accuracy).
- Broaden rename/refactor semantic analysis.
- Harden diagnostics & add more quick fixes.
- Expand automated test coverage.