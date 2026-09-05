# Copilot Instructions

TCL Syntax 0.8.0 is a VS Code extension for Tcl/Tk/Expect editing, debugging, testing, and project tools. Follow [AGENTS.md](../AGENTS.md) for repository commands and conventions and [ARCHITECTURE_GUIDE.md](../ARCHITECTURE_GUIDE.md) for implementation details.

- Keep provider and command registration in `src/extension.ts`. Register the lightweight task provider at activation; expensive interpreter, package, dependency, template, and run services use `ensurePhase6Initialized()`.
- Reuse parsed document/workspace analysis for semantic features and `src/data/tclCommands.ts` for builtin command metadata. Preserve conservative handling of dynamic Tcl.
- Keep VS Code formatting integration separate from pure formatting/edit logic. Validate behavior-preserving source edits with real Tcl comparisons.
- Structural diagnostics and style lint have separate collections. Interpreter completeness checks must not execute document code.
- The debugger uses execution traces in `src/debug/scripts/debugServer.tcl`, without rewriting user source, and exchanges frame/thread-aware requests through `tclDebugAdapter.ts`. Compile copies Tcl scripts into `out/`; never edit generated output.
- Use resource-aware interpreter/cwd resolution and explicit process ownership. Preserve selected Test Explorer cases across Run, Debug, and Coverage.
- Use four-space TypeScript indentation, strict types, CommonJS/ES2020, and Oxlint. Development needs Node 22.12+ and VS Code 1.136+; CI uses Node 26.
- Run `npm run compile`, `npm run lint`, and relevant tests. `npm run test:unit` runs standalone suites; `npm test` runs all suites in a VS Code host. Both support `TCL_TEST_GREP` and use Mocha TDD `suite`/`test`.
- Run release guard tests with `node --test .github/scripts/prepare-release.test.mjs`. Packaging uses `npm run package`; tagged GitHub Releases follow the process in [CONTRIBUTING.md](../CONTRIBUTING.md).
