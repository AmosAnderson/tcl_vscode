# Contributing to TCL Syntax

This guide describes development and releases for the 0.8.0 codebase. See [README.md](README.md) for features, [ARCHITECTURE_GUIDE.md](ARCHITECTURE_GUIDE.md) for design, and [ROADMAP.md](ROADMAP.md) for remaining candidates.

## Development setup

Use Node.js 22.12 or newer, npm, Git, VS Code 1.136.0 or newer, and a Tcl interpreter on `PATH`. CI uses Node 26. TclOO runtime tests need Tcl 8.6+ (or another interpreter providing `oo::class`); worker-debugging tests also need the Thread package. The TypeScript 7 compiler targets ES2020/CommonJS with strict checking. Oxlint is configured in `.oxlintrc.json`.

```sh
git clone https://github.com/AmosAnderson/tcl_vscode.git
cd tcl_vscode
npm ci
npm run compile
```

Open the project in VS Code and launch **Run Extension** with F5. The Extension Development Host loads the extension from this checkout. `npm run watch` watches TypeScript only; run `npm run compile` again after changing Tcl debug scripts so they are copied into `out/debug/scripts/`.

## Source layout and conventions

| Location | Responsibility |
| --- | --- |
| `src/extension.ts` | Activation, provider registration, commands, and shared service lifetimes |
| `src/analysis/`, `src/utils/tclParser.ts` | Parsed declarations, bindings, references, document caches, and workspace index |
| `src/providers/` | Completion, navigation, signatures, CodeLens, diagnostics, lint, and code actions |
| `src/formatter/` | VS Code formatting integration and pure formatting logic |
| `src/refactoring/` | Syntax/binding-based edits with conservative safety checks |
| `src/debug/` | Debug adapter, Tcl trace server, attach/Thread support, and REPL |
| `src/testing/` | Test discovery, selected execution, cancellation, output, and coverage |
| `src/tools/` | Interpreter/cwd resolution, tasks, packages, dependencies, scaffolds, and run commands |
| `src/test/` | Mocha TDD suites and standalone/VS Code launchers |
| `.github/` | CI, tag release workflow, and release validation scripts/tests |
| `package.json` | Extension contribution manifest, scripts, and dependencies |

Use four-space indentation in TypeScript and retain the existing newline convention. Keep provider registration in `extension.ts`, share command metadata from `src/data/tclCommands.ts`, and regenerate `out/` instead of editing it. The lightweight native task provider registers during activation; expensive interpreter/package/dependency/template/run services remain behind the shared `ensurePhase6Initialized()` promise.

Resource-dependent operations should use the document/workspace-folder context. Dispose listeners, timers, processes, terminals, and handles according to ownership. Diagnostics must never source or evaluate the user's document. Static analysis and refactoring should return a clear limitation when dynamic Tcl prevents a safe result.

## Validation

```sh
npm run lint
npm run test:unit
npm test
node --test .github/scripts/prepare-release.test.mjs
```

`npm run test:unit` compiles and runs suites that do not need the VS Code API, including real Tcl debugger fixtures. `npm test` also compiles, then runs all extension suites in an isolated two-folder VS Code workspace. The standalone suites are included in the full host run. Tests use Mocha's TDD `suite`/`test` interface. Runtime tests need `tclsh`; capability-specific TclOO and Thread cases skip when unavailable.

The integration launcher defaults to VS Code 1.136.1. Override it with `VSCODE_TEST_VERSION` or `VSCODE_EXECUTABLE_PATH`. To focus either Mocha runner in a POSIX shell:

```sh
TCL_TEST_GREP='Contextual formatting' npm test
```

On Linux, use `xvfb-run -a npm test` when no display is available. `.github/workflows/ci.yml` installs Tcl and runs lint, release validation tests, standalone tests, and VS Code integration on Linux, macOS, and Windows. It also exposes the same checks as a reusable workflow for tagged releases.

Add meaningful tests for changed behavior. Source edits should compare before/after Tcl execution when applicable. Debugger and test-runner changes need real process fixtures; folder-specific tools need workspace integration checks. The [Insiders UI report](docs/INSIDERS_UI_TEST_REPORT.md) records the separate manual UI pass and its limits.

Before opening a pull request, run the relevant checks, update affected documentation and the changelog, and inspect the diff. Explain the behavior change and validation in the PR. Use conventional commit prefixes such as `feat:`, `fix:`, `docs:`, `test:`, and `chore:`.

## Packaging

```sh
npm exec -- vsce ls
npm run package
```

Packaging runs `vscode:prepublish`, which compiles TypeScript and copies the Tcl server. The resulting file is `tcl-syntax-0.8.0.vsix` for this version. `.vscodeignore` excludes source tests, generated tests, and GitHub workflow files; review the file list when packaging rules or dependencies change. Normal VSCE secret/environment checks remain enabled.

Install the VSIX using **Extensions: Install from VSIX...**. For a custom output path, use `npm run package -- --out /path/to/tcl-syntax-0.8.0.vsix`.

## GitHub Releases

The release workflow accepts stable version tags such as `v0.8.0` or `0.8.0`. A tag must point to a commit reachable from `origin/main`; an earlier main commit is valid, so later main development cannot change the tagged build. Tags outside main skip the release jobs. Push the main commit before pushing its tag.

For a release:

1. Update the version in `package.json` and both root version fields in `package-lock.json`. `npm version 0.8.0 --no-git-tag-version` performs the manifest/lock update without creating a tag.
2. Add a dated `## [0.8.0] - YYYY-MM-DD` changelog section with the release notes, and update affected documentation. Commit the changes and merge them into `main`.
3. After main checks pass, tag that commit and push the tag:

```sh
git switch main
git pull --ff-only origin main
git tag -a v0.8.0 -m 'TCL Syntax 0.8.0'
git push origin v0.8.0
```

`.github/workflows/release.yml` then:

- Validates tag/checkout identity, main ancestry, manifest/lock versions, and the dated changelog entry.
- Runs the shared Linux/macOS/Windows checks against the tag's source.
- Installs the lockfile dependencies and compiles/packages the exact validated commit.
- Creates a GitHub Release for the existing tag, uses that version's changelog section as release notes, and attaches `tcl-syntax-0.8.0.vsix`.

The workflow uses the repository's automatic `GITHUB_TOKEN`; only the publishing job requests `contents: write`. No personal token or Marketplace token is needed. GitHub Actions must be enabled and organization/repository policy must allow the publishing job's write permission. The workflow file must exist in the tagged commit. A changed tag is rejected before publication.

To retry a failed release, rerun its Actions run. An existing matching VSIX asset is left unchanged; a missing asset can be uploaded to an existing release. Keep published version tags immutable and use a new version for changes. If a tag was pushed before its commit reached main, rerun the complete workflow after merging that commit. GitHub does not automatically retry it on the later main push.

Marketplace publication remains a separate maintainer action; this automation publishes to [GitHub Releases](https://github.com/AmosAnderson/tcl_vscode/releases).

For the underlying platform behavior, see [GitHub tag filters](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onpushbranchestagsbranches-ignoretags-ignore), [reusable workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows), and [the release CLI](https://cli.github.com/manual/gh_release_create).
