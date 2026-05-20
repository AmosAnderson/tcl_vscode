# OpenCode Notes

## Commands
- `npm install` restores the lockfile-pinned VS Code extension toolchain.
- `npm run compile` runs `tsc -p ./` and then `copy-scripts`; use it before tests or packaging because it copies `src/debug/scripts/*.tcl` into `out/debug/scripts/`.
- `npm run watch` only watches TypeScript; it does not run `copy-scripts`.
- `npm run lint` is `eslint src --ext ts` using the flat config in `eslint.config.cjs`.
- `npm test` runs `pretest` first, then `node ./out/test/runTest.js`, which launches VS Code through `@vscode/test-electron`.
- There is no package script for a single test file. The suite runner loads every compiled `**/*.test.js` under `out/test/` and uses Mocha's TDD API (`suite`/`test`).
- `npm run package` invokes `vsce package --allow-package-all-secrets --allow-package-env-file`; review what is included before using it.

## Extension Shape
- `package.json` is both the npm manifest and VS Code contribution manifest; update it when adding commands, settings, languages, snippets, or debug contributions.
- Runtime entrypoint is `src/extension.ts`; compiled output goes to ignored `out/` with `main` set to `./out/extension.js`.
- Provider registration is centralized in `src/extension.ts`. New language features should follow the existing provider classes instead of adding registration elsewhere.
- Expensive tool integrations belong behind `ensurePhase6Initialized()` in `src/extension.ts`; interpreter, package, dependency, template, task, and run-command features are intentionally lazy.
- TCL command metadata is centralized in `src/data/tclCommands.ts`; IntelliSense providers should consume it rather than duplicating command definitions.
- Formatter logic is split: VS Code integration in `src/formatter/formattingProvider.ts`, pure formatting in `src/formatter/tclFormatter.ts`.
- Diagnostics and style linting are separate: `TclDiagnosticProvider` handles structural checks, while `TclLintProvider` owns the `tcl-lint` diagnostic collection and code actions live in `TclCodeActionProvider`.
- Debugging uses `src/debug/tclDebugAdapter.ts` plus the TCL-side server in `src/debug/scripts/debugServer.tcl` over TCP; keep the compile copy step in mind for any script changes.

## Environment And Tests
- Development expects Node 18+ and VS Code 1.120+; TypeScript is strict, CommonJS, target ES2020.
- Many runtime features shell out to `tclsh`; settings include `tcl.interpreter.path`, `tcl.repl.tclPath`, and `tcl.test.tclPath`.
- `.vscode/launch.json` currently contains TCL debug configs only, not an Extension Development Host config; add/use an extension-host launch config before relying on F5 for TypeScript extension debugging.
- Test files live in `src/test/`; root TCL fixtures such as `test.tcl`, `test_formatting.tcl`, and `comprehensive_test.tcl` are user-script samples.

## Repo Conventions
- Keep 4-space indentation in TypeScript to match existing code.
- Do not edit generated `out/` output directly; regenerate with `npm run compile`.
- Recent history mostly uses conventional commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).
