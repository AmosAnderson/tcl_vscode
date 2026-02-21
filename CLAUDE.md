# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TCL VS Code extension providing syntax highlighting, code formatting, IntelliSense, debugging, REPL, refactoring, and testing support for the TCL scripting language.

## Commands

```bash
npm run compile     # Transpile TypeScript (src/) → JavaScript (out/)
npm run watch       # Continuous compilation
npm run lint        # ESLint on src/
npm test            # Run VS Code integration tests (Mocha + @vscode/test-electron)
npm run package     # Build .vsix extension package
```

Tests use `@vscode/test-electron`, which launches a full VS Code instance — there is no way to run a single test file in isolation. Individual test files live in `src/test/` and are loaded by the suite runner at `src/test/suite/index.ts`.

Debugging the extension: press **F5** in VS Code with `.vscode/launch.json` configured — this opens an Extension Development Host window.

## Commit Convention

Follow conventional commits: `feat:`, `fix:`, `docs:`, `style:`, `refactor:`, `test:`, `chore:`.

## Architecture

The extension's `activate()` in `src/extension.ts` registers features in order:

1. **Formatting** — `TclFormattingProvider` (document + range formatting)
2. **Diagnostics & code actions** — `TclDiagnosticProvider`, `TclCodeActionProvider`
3. **IntelliSense** — seven providers: completion, hover, definition, reference, document symbol, workspace symbol, signature help
4. **Phase 5 (eager):** Debug adapter, REPL, testing (`TclTestProvider`, `TclCoverageProvider`), refactoring
5. **Phase 6 (lazy):** `ensurePhase6Initialized()` defers interpreter, package, dependency, template, and task managers until first command use

### Key Architectural Patterns

**Single source of truth for TCL commands:** `src/data/tclCommands.ts` contains 800+ TCL commands (base, Tk, Expect), organized by category. All IntelliSense providers read from this file — do not duplicate command definitions.

**Provider pattern:** Each language feature is a separate VS Code provider class registered in `extension.ts`. New IntelliSense features follow the existing provider pattern and are registered in the Phase 3 block.

**Lazy initialization:** The `ensurePhase6Initialized()` guard in `extension.ts` defers heavy tool managers until first use. Add new expensive features here.

**Dual-layer formatter:** `src/formatter/formattingProvider.ts` handles VS Code integration; `src/formatter/tclFormatter.ts` contains pure formatting logic with no VS Code dependency. Keep this separation when modifying formatting.

**TCL execution model:** The extension shells out to `tclsh` for diagnostics, REPL, testing, and debugging. The interpreter path is configurable via `tcl.interpreter.path` / `tcl.repl.tclPath` settings.

### Key Files

| File | Role |
|------|------|
| `src/extension.ts` | Activation entry point, provider registration, command handlers |
| `src/data/tclCommands.ts` | Central TCL command knowledge base (800+ commands) |
| `src/formatter/tclFormatter.ts` | Core formatting logic (no VS Code dependency) |
| `src/formatter/formattingProvider.ts` | VS Code formatting provider wrapper |
| `src/debug/tclDebugAdapter.ts` | Debug adapter protocol implementation |
| `src/debug/debugAdapterFactory.ts` | DAP factory + launch configuration provider |
| `src/debug/tclREPL.ts` | Interactive REPL commands |
| `src/tools/interpreterManager.ts` | Discovers system, TclKit, ActiveTcl interpreters |
| `syntaxes/tcl.tmLanguage.json` | TextMate grammar for syntax highlighting |

### Tech Stack

- TypeScript 5.x in strict mode, compiled to ES2020
- VS Code 1.109+, `@vscode/debugadapter` for DAP
- Tests: Mocha + `@vscode/test-electron` (full VS Code integration tests, not unit tests)
- ESLint with `@typescript-eslint` (flat config in `eslint.config.cjs`)
