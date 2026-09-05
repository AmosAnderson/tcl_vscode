# TCL Language Support for VS Code

**Version 0.8.0** — TCL (Tool Command Language) support for Visual Studio Code, including syntax highlighting, code formatting, signature help, IntelliSense, debugging, refactoring, and tooling—all without requiring an external language server.

## Requirements

- VS Code **1.136.0** or newer
- Node.js **22.12.0** or newer (for local development only)
- A TCL interpreter (`tclsh`) on your PATH or configured in settings for interpreter completeness checks, script execution, debugging, REPL, testing, and package tools

## Features

### Syntax Highlighting
- Keywords, control structures, and built-in commands
- Variables and string interpolation
- Comments, numbers, operators
- Namespace and package commands
- Tk widget commands
- Expect commands for automation scripts
- Improved escape sequences and embedded commands

### Code Formatting
- Format entire documents or complete selected commands with enclosing indentation and newline style
- Format both switch syntaxes, including list-form pattern/body pairs and fall-through
- Preserve literal values and comments; incomplete or malformed commands are left unchanged
- Format on save (configurable)
- Customizable options:
  - Indentation (spaces/tabs)
  - Brace alignment
  - Operator spacing
  - Spaces inside braces and brackets

### IntelliSense and Navigation
- **Code Completion**: 800+ command and subcommand metadata entries with signatures, user-defined procedures, variables, packages, namespaces, and snippets
- **Symbol Navigation**: Document outline, go to definition, find references, workspace symbol search
- **Hover Information**: Command documentation, variable preview, procedure arguments
- **Signature Help**: Built-in and user-procedure signatures, defaults, and multiline active arguments
- **Shared Analysis**: Case-sensitive namespace/import/path resolution and variable binding navigation
- **TclOO and Lambdas**: Static classes, methods, inheritance, literal lambdas, and object-variable scopes
- **CodeLens**: Procedure reference counts and selected-test Run/Debug actions

### Debugging and Testing
- **Debug Adapter**: Launch and debug TCL scripts with breakpoints, step in/out/over, call stack inspection, variable viewing, and expression evaluation via a TCP socket protocol
- **Conditional Breakpoints**: Attach boolean expressions to breakpoints — execution pauses only when the condition is true
- **Logpoints**: Breakpoints that log interpolated messages to the debug console without pausing
- **Frame Inspection**: Inspect and edit scalar/array values and evaluate watches in the selected frame
- **Attach**: Authenticated local or SSH-tunneled sessions with source mapping and detach
- **Thread Debugging**: Opt-in inspection and independent stepping of newly created Tcl Thread workers during launch
- **REPL Integration**: Interactive TCL console, evaluate selection, run current file
- **Run Commands**: Execute scripts with a chosen interpreter or custom arguments
- **Testing Support**: One selection model for Test Explorer Run, Debug, and native Coverage; cancellation stops owned runs

See [debugging setup and limitations](docs/DEBUGGING.md) and the [user guide](docs/USER_GUIDE.md).

### Linting
- Warns on unbraced `expr` arguments (double substitution risk)
- Missing `default` clause in `switch` statements
- `catch` without result variable (silently ignored errors)
- Line length limits (configurable, default 120)
- Deprecated commands (`string bytelength`, `string wordend`, `string wordstart`)
- Repeated `$::varName` usage in procs (suggests `global`)
- Per-rule severity/disable settings and targeted next-line suppressions
- Quick fixes for expression bracing when substitution semantics can be preserved, and missing catch result variables

### Snippets
- 26 snippets for Tk widgets, Expect automation, TclOO classes, and common patterns
- Prefixed by category: `tk*`, `expect*`, `trycatch`, `oo_class`, `dict_iterate`, `file_read`, etc.

### Refactoring
- **Rename Symbol**: Rename resolved procedures, variables, namespaces, classes, and methods
- **Extract Procedure**: Extract selected code into a new procedure
- **Extract Variable**: Extract expression into a variable
- **Inline Variable**: Replace variable uses with its value
- **Inline Procedure**: Replace a procedure call with a Tcl lambda that preserves argument evaluation and local scope
- **Extract to Namespace**: Move complete supported procedure definitions and update resolved callers

Source edits preserve literal values and decline dynamic or ambiguous cases with an explanation.

### Advanced Features
- Interpreter management (system, ActiveTcl, TclKit, versions 8.4–9.0)
- Cached package completion, native Tcl version constraints, and dependency conflict/update reporting
- Local directory/archive installation with version verification and overwrite protection
- Project/package templates parameterized by name, namespace, and version
- Native VS Code tasks, problem matching, and interpreter/cwd resolution per workspace folder

## Supported Tcl Versions

Interpreter discovery supports Tcl versions **8.4 through 9.0**. Debugging, coverage, and Inline Procedure require **Tcl 8.5 or newer**. Static editing features do not require an interpreter.

## Installation

Download `tcl-syntax-0.8.0.vsix` from [GitHub Releases](https://github.com/AmosAnderson/tcl_vscode/releases), then run **Extensions: Install from VSIX...** in VS Code and select the file. You can also search for **TCL Syntax** in the Extensions Marketplace; the Marketplace version is published separately from GitHub Releases.

Release tags must match the package version and point to a commit on `main`. GitHub Actions validates, builds, and attaches the versioned VSIX to the matching GitHub Release. See [the release procedure](CONTRIBUTING.md) before tagging a release.

### Development Setup

```bash
git clone https://github.com/AmosAnderson/tcl_vscode
cd tcl_vscode
npm ci
npm run compile
```

Press `F5` to launch a new VS Code window with the extension loaded.

## Configuration

### Formatting Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `tcl.format.enable` | `false` | Enable automatic formatting on save |
| `tcl.format.alignBraces` | `true` | Align opening and closing braces |
| `tcl.format.spacesAroundOperators` | `true` | Add spaces around operators |
| `tcl.format.spacesInsideBraces` | `true` | Add spaces inside braces |
| `tcl.format.spacesInsideBrackets` | `false` | Add spaces inside brackets |

### Diagnostics Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `tcl.diagnostics.enable` | `true` | Enable syntax diagnostics |
| `tcl.diagnostics.useTclsh` | `true` | Check command completeness without executing document code |
| `tcl.diagnostics.debounceMs` | `200` | Delay cancellable interpreter checks after edits |

### Linting Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `tcl.lint.enable` | `true` | Enable TCL linting for style issues |
| `tcl.lint.maxLineLength` | `120` | Maximum line length before warning (0 to disable) |
| `tcl.lint.exprBracing` | `true` | Warn when expr arguments are not braced |
| `tcl.lint.rules` | `{}` | Set severity or disable individual rules |

### Package Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `tcl.packages.autoDiscovery` | `true` | Automatically discover TCL packages |
| `tcl.packages.installDirectory` | `""` | Default directory to install TCL packages to (must be on auto_path) |

### REPL Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `tcl.repl.tclPath` | `"tclsh"` | Path to TCL interpreter for REPL |

Interpreter resolution uses an explicit launch/task override, then an explicitly configured feature override, then the folder’s `tcl.interpreter.path`, then `tclsh`. See the [configuration reference](docs/CONFIGURATION.md) for CodeLens, index exclusions, run arguments, environment, and per-folder examples.

## Project Structure

```
tcl_vscode/
├── src/
│   ├── extension.ts          # Extension entry point
│   ├── analysis/              # Semantic analysis
│   │   ├── documentAnalysis.ts # Parsed declarations, calls, and scopes
│   │   ├── procedures.ts     # Namespace and procedure resolution
│   │   ├── symbolTable.ts    # Scope-aware symbol table
│   │   └── workspaceIndex.ts # Workspace-wide symbol index
│   ├── data/                  # TCL command definitions
│   ├── formatter/             # Code formatting
│   ├── providers/             # IntelliSense, diagnostics, linting
│   ├── debug/                 # Debug adapter + TCL debug server
│   │   └── scripts/           # debugServer.tcl (shipped with extension)
│   ├── refactoring/           # Rename/extract/inline/namespace providers
│   ├── testing/               # Test discovery/coverage
│   ├── tools/                 # Interpreter/package/dependency/run management
│   └── utils/                 # Shared Tcl parser and runtime utilities
├── snippets/
│   └── tcl.json               # TCL/Tk/Expect/TclOO snippets
├── syntaxes/
│   └── tcl.tmLanguage.json    # Syntax highlighting
├── language-configuration.json
└── package.json
```

## Scripts

- `npm run compile` - Compile TypeScript 7 and copy TCL debug scripts
- `npm run watch` - Watch TypeScript; run `npm run compile` after changing Tcl debug scripts
- `npm run lint` - Run Oxlint
- `npm run test:unit` - Run standalone suites, including real Tcl process fixtures
- `npm test` - Run all suites in an isolated VS Code extension host
- `TCL_TEST_GREP="pattern" npm test` - Focus suites or test titles (POSIX shell)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and release instructions, [ROADMAP.md](ROADMAP.md) for implemented scope and follow-up work, and the [Insiders UI test report](docs/INSIDERS_UI_TEST_REPORT.md) for verified workflows and coverage limits.

## License

MIT License. See [LICENSE](LICENSE) for details.
