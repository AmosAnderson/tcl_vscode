# Copilot Instructions

VS Code extension providing TCL language support: syntax highlighting, formatting, IntelliSense, debugging, REPL, linting, refactoring, and testing.

## Commands

```bash
npm run compile     # TypeScript build + copies .tcl debug scripts to out/
npm run watch       # Continuous compilation
npm run lint        # ESLint on src/
npm test            # Full VS Code integration tests (Mocha + @vscode/test-electron)
npm run package     # Build .vsix extension package
```

Tests launch a full VS Code instance via `@vscode/test-electron` — there is no way to run a single test file in isolation. All test files in `src/test/` are loaded by the suite runner at `src/test/suite/index.ts`. Tests use Mocha's **TDD** interface (`suite()`/`test()`), not BDD (`describe()`/`it()`).

Debug the extension by pressing **F5** in VS Code to open an Extension Development Host window.

## Architecture

The extension activates in `src/extension.ts`, registering features in phases:

1. **Formatting** — `TclFormattingProvider` (document + range)
2. **Diagnostics & linting** — `TclDiagnosticProvider`, `TclLintProvider` (separate `DiagnosticCollection`), `TclCodeActionProvider`
3. **IntelliSense** — completion, hover, definition, reference, document symbol, workspace symbol, signature help
4. **Phase 5 (eager):** Debug adapter, REPL, testing, refactoring
5. **Phase 6 (lazy):** `ensurePhase6Initialized()` defers interpreter, package, dependency, template, and task managers until first command use — add new expensive features here

### Key Patterns

- **Single source of truth for TCL commands:** `src/data/tclCommands.ts` has 800+ commands (base, Tk, Expect). All IntelliSense providers read from this — never duplicate command definitions.
- **Dual-layer formatter:** `src/formatter/formattingProvider.ts` handles VS Code integration; `src/formatter/tclFormatter.ts` is pure formatting logic with no VS Code dependency. Preserve this separation.
- **Debug adapter:** `src/debug/tclDebugAdapter.ts` communicates with `src/debug/scripts/debugServer.tcl` over TCP. The TCL server instruments scripts with `::debug::checkpoint` calls. The `compile` step copies `.tcl` scripts to `out/`.
- **Lint vs diagnostics:** `TclLintProvider` runs style checks (expr bracing, line length, etc.) independently from `TclDiagnosticProvider`, using its own `DiagnosticCollection` (`'tcl-lint'`). Quick fixes live in `TclCodeActionProvider`.
- **TCL execution:** The extension shells out to `tclsh` for diagnostics, REPL, testing, and debugging. Path is configurable via `tcl.interpreter.path` / `tcl.repl.tclPath` settings.

## Conventions

- 4-space indentation, `camelCase` for functions/variables, `PascalCase` for classes/providers
- Conventional commits: `feat:`, `fix:`, `docs:`, `style:`, `refactor:`, `test:`, `chore:`
- Provider registration stays centralized in `extension.ts`
- New language features follow the existing provider pattern and register in the appropriate phase block
- TypeScript strict mode, compiled to ES2020, targeting VS Code 1.125+
- Oxlint with the TypeScript plugin configured in `.oxlintrc.json`
