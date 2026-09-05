# Repository Development Notes

## Commands
- `npm ci` restores the lockfile-pinned VS Code extension toolchain.
- `npm run compile` runs `tsc -p ./` and then `copy-scripts`; use it before tests or packaging because it copies `src/debug/scripts/*.tcl` into `out/debug/scripts/`.
- `npm run watch` only watches TypeScript; it does not run `copy-scripts`.
- `npm run lint` is `oxlint src` using `.oxlintrc.json`.
- `npm test` runs `pretest` first, then `node ./out/test/runTest.js`, which launches VS Code through `@vscode/test-electron`.
- `npm run test:unit` compiles and runs suites that do not require the VS Code API (including real Tcl debugger fixtures). `npm test` runs all suites in a VS Code host with an isolated two-folder workspace. Set `TCL_TEST_GREP` to a Mocha title pattern to focus either runner. Tests use the TDD API (`suite`/`test`).
- `npm run package` invokes `vsce package` with normal checks; review the file list with `npm exec -- vsce ls` before packaging changes. `vscode:prepublish` compiles and copies the Tcl server.

- `node --test .github/scripts/prepare-release.test.mjs` checks release eligibility and notes using temporary Git fixtures.
- `.github/workflows/release.yml` accepts `vX.Y.Z` or `X.Y.Z` tags reachable from `main`, verifies manifest/lock/changelog versions, reuses all CI checks, packages the tagged commit, and publishes its VSIX to GitHub Releases. See `CONTRIBUTING.md` for the process.

## Extension Shape
- `package.json` is both the npm manifest and VS Code contribution manifest; update it when adding commands, settings, languages, snippets, or debug contributions.
- Runtime entrypoint is `src/extension.ts`; compiled output goes to ignored `out/` with `main` set to `./out/extension.js`.
- Provider registration is centralized in `src/extension.ts`. New language features should follow the existing provider classes instead of adding registration elsewhere.
- Expensive tool integrations belong behind `ensurePhase6Initialized()` in `src/extension.ts`; interpreter, package, dependency, template, and run-command features are intentionally lazy. Register the lightweight task provider during activation so native Tasks requests work before tools initialize.
- TCL command metadata is centralized in `src/data/tclCommands.ts`; IntelliSense providers should consume it rather than duplicating command definitions.
- Formatter logic is split: VS Code integration in `src/formatter/formattingProvider.ts`, pure formatting in `src/formatter/tclFormatter.ts`.
- Diagnostics and style linting are separate: `TclDiagnosticProvider` handles structural checks, while `TclLintProvider` owns the `tcl-lint` diagnostic collection and code actions live in `TclCodeActionProvider`.
- Debugging uses `src/debug/tclDebugAdapter.ts` plus the TCL-side server in `src/debug/scripts/debugServer.tcl` over TCP; keep the compile copy step in mind for any script changes.

## Environment And Tests
- Development expects Node 22.12+ and VS Code 1.136+; TypeScript 7 is strict, CommonJS, target ES2020.
- `.github/workflows/ci.yml` runs lint, standalone suites, and VS Code integration on Linux, macOS, and Windows. Set `VSCODE_TEST_VERSION` or `VSCODE_EXECUTABLE_PATH` to override the pinned test host.
- Many runtime features shell out to `tclsh`; settings include `tcl.interpreter.path`, `tcl.repl.tclPath`, and `tcl.test.tclPath`.
- `.vscode/launch.json` includes a Run Extension configuration for F5 development, alongside TCL launch configurations.
- Test files live in `src/test/`; root TCL fixtures such as `test.tcl`, `test_formatting.tcl`, and `comprehensive_test.tcl` are user-script samples.

## Repo Conventions
- Keep 4-space indentation in TypeScript to match existing code.
- Do not edit generated `out/` output directly; regenerate with `npm run compile`.
- Recent history mostly uses conventional commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).
