# TCL Language Support for VS Code

Comprehensive TCL (Tool Command Language) support for Visual Studio Code, including syntax highlighting, code formatting, signature help, IntelliSense, debugging, refactoring, and tooling—all without requiring an external language server.

## Requirements

- VS Code **1.109.0** or newer
- Node.js **18 LTS** or newer (for local development only)
- A TCL interpreter (`tclsh`) on your PATH for diagnostics, REPL, and testing

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
- Format entire document or selected text
- Format on save (configurable)
- Customizable options:
  - Indentation (spaces/tabs)
  - Brace alignment
  - Operator spacing
  - Spaces inside braces and brackets

### IntelliSense and Navigation
- **Code Completion**: 800+ TCL built-in commands with signatures, user-defined procedures, variables, packages, namespaces, and snippets
- **Symbol Navigation**: Document outline, go to definition, find references, workspace symbol search
- **Hover Information**: Command documentation, variable preview, procedure arguments
- **Signature Help**: Parameter hints while typing with active-argument highlighting

### Debugging and Testing
- **Debug Adapter**: Launch and debug TCL scripts with breakpoints, step in/out/over, call stack inspection, variable viewing, and expression evaluation via a TCP socket protocol
- **REPL Integration**: Interactive TCL console, evaluate selection, run current file
- **Testing Support**: Test discovery, execution, and coverage analysis scaffolding

### Linting
- Warns on unbraced `expr` arguments (double substitution risk)
- Missing `default` clause in `switch` statements
- `catch` without result variable (silently ignored errors)
- Line length limits (configurable, default 120)
- Deprecated commands (`string bytelength`, `string wordend`, `string wordstart`)
- Repeated `$::varName` usage in procs (suggests `global`)
- Quick fixes available for expr bracing and catch-without-variable warnings

### Snippets
- 25+ snippets for Tk widgets, Expect automation, TclOO classes, and common patterns
- Prefixed by category: `tk*`, `expect*`, `trycatch`, `oo_class`, `dict_iterate`, `file_read`, etc.

### Refactoring
- **Rename Symbol**: Rename procedures, variables, and namespaces across workspace
- **Extract Procedure**: Extract selected code into a new procedure
- **Extract Variable**: Extract expression into a variable
- **Inline Variable**: Replace variable uses with its value

### Advanced Features
- Interpreter management (system, ActiveTcl, TclKit, versions 8.4–9.0)
- Package discovery and management
- Dependency analysis and reporting
- Project templates for scaffolding new TCL projects
- VS Code task integration

## Supported Tcl Versions

The extension supports Tcl versions **8.4 through 9.0**. Interpreters outside this range can be added as custom paths, but some features may not function correctly.

## Installation

Search for "TCL Syntax" in the VS Code Extensions marketplace and click Install.

### Development Setup

```bash
git clone https://github.com/AmosAnderson/tcl_vscode
cd tcl_vscode
npm install
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
| `tcl.diagnostics.useTclsh` | `true` | Use tclsh for advanced validation |

### Linting Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `tcl.lint.enable` | `true` | Enable TCL linting for style issues |
| `tcl.lint.maxLineLength` | `120` | Maximum line length before warning (0 to disable) |
| `tcl.lint.exprBracing` | `true` | Warn when expr arguments are not braced |

### Package Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `tcl.packages.autoDiscovery` | `true` | Automatically discover TCL packages |
| `tcl.packages.installDirectory` | `""` | Default directory to install TCL packages to (must be on auto_path) |

### REPL Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `tcl.repl.tclPath` | `"tclsh"` | Path to TCL interpreter for REPL |

## Project Structure

```
tcl_vscode/
├── src/
│   ├── extension.ts          # Extension entry point
│   ├── data/                  # TCL command definitions
│   ├── formatter/             # Code formatting
│   ├── providers/             # IntelliSense, diagnostics, linting
│   ├── debug/                 # Debug adapter + TCL debug server
│   │   └── scripts/           # debugServer.tcl (shipped with extension)
│   ├── refactoring/           # Rename/extract providers
│   ├── testing/               # Test discovery/coverage
│   └── tools/                 # Interpreter/package/dependency management
├── snippets/
│   └── tcl.json               # TCL/Tk/Expect/TclOO snippets
├── syntaxes/
│   └── tcl.tmLanguage.json    # Syntax highlighting
├── language-configuration.json
└── package.json
```

## Scripts

- `npm run compile` - Compile TypeScript
- `npm run watch` - Watch and recompile
- `npm run lint` - Run ESLint
- `npm test` - Run tests

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines and [ROADMAP.md](ROADMAP.md) for planned features.

## License

MIT License. See [LICENSE](LICENSE) for details.
