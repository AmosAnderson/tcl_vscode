# TCL VS Code Extension Roadmap

This document tracks the major milestones for the TCL language extension. It mirrors the phased plan used during development and clarifies what is available today versus what is scheduled next.

## ✅ Completed Milestones

### Phase 1 – Core Language Support
- Basic extension activation and language configuration
- Syntax highlighting with namespaces, Tcl/Tk/Expect commands, and embedded script support
- Comment toggling, bracket matching, auto-closing pairs, and folding markers

### Phase 2 – Formatter
- Document and range formatting commands
- Configurable rules for indentation, brace alignment, operator spacing, and spacing inside braces/brackets
- Format-on-save toggle via `tcl.format.enable`

### Phase 3 – IntelliSense & Navigation
- Completion items for 150+ Tcl, Tk, and Expect commands
- String subcommand completions and user-defined procedure snippets
- Variable suggestions scoped to the current procedure/frame
- Package and namespace completion based on workspace analysis
- Document/workspace symbol providers, definition lookup, and reference search
- Hover tooltips showing signatures, documentation, and inline variable info

### Phase 4 – Diagnostics & Code Actions
- Structural syntax checks (brace/bracket pairing, unclosed strings)
- Optional validation via `tclsh`
- Quick fixes for common issues surfaced through the diagnostic provider

### Phase 5 – Testing & Debugging
- Debug adapter with full breakpoints, stepping (step in/out/over), call stack, variable inspection, and expression evaluation via TCP socket protocol and source-level instrumentation
- REPL commands (`tcl.startREPL`, `tcl.evaluateSelection`, etc.)
- Integrated test explorer wiring with coverage commands (`tcl.generateCoverage`, `tcl.clearCoverage`)
- Refactoring helpers (rename, extract procedure/variable, inline variable)

### Phase 6 – Tooling Integration
- Interpreter discovery (system, TclKit, ActiveTcl, custom)
- Dependency manager with real package installation (teacup + manual fallback)
- Package tasks and project templates
- Task provider that surfaces common Tcl build scripts

### Phase 7 – Linting & Snippets
- Lint provider with 6 style rules (expr bracing, switch default, catch variable, line length, deprecated commands, global variable shorthand)
- Quick fixes for fixable lint warnings
- 25+ snippets for Tk widgets, Expect automation, TclOO, and common patterns

## 🔜 Planned Enhancements

### High Priority
- **Enhanced formatter** for better handling of complex nested structures and edge cases
- **Improved semantic analysis** for rename and refactoring operations

### Future Features
- **Workspace-wide symbol indexing** optimization for very large codebases
- **Additional refactorings**, including inline procedure and namespace extraction helpers
- **Command palette utilities** for quickly running Tcl scripts with different interpreters
- **Conditional breakpoints** and **logpoints** in the debug adapter
- **Array variable expansion** in the debug variables panel

Have suggestions or feature requests? Please open an issue or contribute via pull requests—community input drives the roadmap.
