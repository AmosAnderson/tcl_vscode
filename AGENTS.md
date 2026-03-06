# Repository Guidelines

## Project Structure & Module Organization
Core TypeScript lives in `src/`, where `extension.ts` wires formatter, provider, debug, refactoring, testing, and tool layers. Shared language data is in `src/data/`; grammars live in `syntaxes/`, defaults in `language-configuration.json`, and compiled JS in `out/`. TCL fixtures (`test.tcl`, `test_formatting.tcl`, `comprehensive_test.tcl`) mimic user scripts, while docs and assets stay under `docs/` and `images/`.

## Build, Test, and Development Commands
- `npm install`: Install dependencies before any build.
- `npm run compile`: TypeScript build via `tsc -p ./` followed by `copy-scripts` (copies `.tcl` debug server files to `out/`); run before shipping or tests.
- `npm run watch`: Persistent compiler for fast feedback.
- `npm run lint`: ESLint (`eslint.config.cjs`) on `src/**/*.ts`.
- `npm test`: Invokes `pretest` (compile) and VS Code integration tests via `out/test/runTest.js`.
- `npm run package`: Wraps `vsce package` to emit a `.vsix`; bump versions first.

## Architecture & Activation Flow
Version 0.6.0 targets VS Code 1.109+ and follows a layered architecture: data → providers → feature modules → entry point. Activation relies solely on built-in providers, so new language features should continue to integrate with those layers. Interpreter, package, dependency, template, and task managers boot lazily via `ensurePhase6Initialized()`; reuse that helper when adding commands to keep startup lean. The debug adapter communicates with a TCL-side debug server (`src/debug/scripts/debugServer.tcl`) over TCP sockets for breakpoints, stepping, and variable inspection. A separate lint provider (`src/providers/lintProvider.ts`) handles style checks independently from the structural diagnostic provider.

## Coding Style & Naming Conventions
Use 4-space indentation, `camelCase` for functions/variables, `PascalCase` for classes/providers, and kebab-case branches (`feat/language-server`). Keep provider registration centralized in `extension.ts`, prefer early returns, and rely on `eslint.config.cjs` + TypeScript ESLint rules for formatting, imports, and VS Code API usage.

## Testing Guidelines
Tests live in `src/test/` and use Mocha + @vscode/test-electron (`*.test.ts`). Mirror feature layout, pull deterministic TCL samples from `suite/` or root fixtures, and reference them via workspace paths. Expand coverage for provider fallbacks and lazy-tool flows, and reuse `runTest.ts` helpers for activation.

## Commit & Pull Request Guidelines
History favors conventional commits (`feat:`, `chore:`, etc.); keep subjects under ~70 chars and ensure each commit compiles, lints, and tests. PRs need a concise summary, linked issue (`Fixes #123`), verification notes (`npm test`, manual repro), and screenshots/GIFs for visible UX changes. Call out breaking changes and update `README.md`, `CHANGELOG.md`, or `ARCHITECTURE_GUIDE.md` when behavior shifts.

## Security & Configuration Tips
Document custom `tclsh` paths in `README.md` and gate risky features behind existing `tcl.*` settings. Never commit secrets; rely on local VS Code settings for interpreter paths. When editing interpreter discovery, test on machines with and without `tclsh` available to verify fallback logic in `interpreterManager`.
