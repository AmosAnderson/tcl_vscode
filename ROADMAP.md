# TCL Syntax roadmap

Version 0.8.0 completes the feature packages identified in the September 2026 audit. The [implementation record](docs/FEATURE_IMPLEMENTATION_PLAN.md) describes the supported scope and evidence; the [changelog](CHANGELOG.md) records version history.

## Available in 0.8.0

- Syntax highlighting for Tcl/Tk/Expect, snippets, language configuration, and document/range formatting with contextual switch-body handling.
- Shared parsed analysis for declarations, bindings, definitions, references, hover, completion, procedure signatures with defaults, and reference/test CodeLens.
- Static namespace imports/paths, TclOO classes/methods/known receivers, and literal lambda scopes; ambiguous dynamic constructs remain unresolved.
- Syntax/binding-based variable and namespace edits, guarded extraction/inlining, class/method rename, and supported lint quick fixes.
- Immediate structural diagnostics plus cancellable interpreter completeness checks that do not execute source; configurable style rules and targeted suppression comments.
- Test Explorer Run, Debug, and native Coverage using the same case selection, with failure status, owned-process cancellation, original-source breakpoints, and clean output.
- Native editor breakpoints, conditional breakpoints/logpoints, selected-frame variables/evaluation/edits, arrays, correct stop reasons, and conservative coalescing of assignment substitutions.
- Authenticated loopback attach and SSH-forwarded remote use with source maps, plus opt-in debugging of newly created Thread workers in launched sessions.
- Resource-aware interpreter/cwd/run configuration, REPL restart, native task contributions, dependency constraints, verified local package installation, and parameterized project/package scaffolds.
- Reusable three-platform CI and GitHub Release automation that packages version tags reachable from main.

The [Insiders UI report](docs/INSIDERS_UI_TEST_REPORT.md) records representative verification. Local extension-host checks passed 185 tests, with 101 also runnable standalone. CI and release workflows are configured; remote runner/publication results require a pushed workflow and tag. See [debugging](docs/DEBUGGING.md) and [configuration](docs/CONFIGURATION.md) for operational limits.

## Future candidates

These are candidates rather than committed delivery dates:

- Semantic tokens and call hierarchy using the shared analysis model.
- Parser-based folding.
- Pause-on-error support that preserves an inspectable error frame.
- Attach-mode worker discovery and preexisting Thread pools.
- Broader static receiver resolution and source-level stepping for other dynamic/nested Tcl forms.

Feature requests and contributions can be discussed in repository issues and pull requests. [CONTRIBUTING.md](CONTRIBUTING.md) covers development and the tagged-release process.
