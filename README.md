# TCL Language Support for VS Code

This extension provides TCL (Tool Command Language) support for Visual Studio Code, including syntax highlighting and code formatting.

## Features

### Syntax Highlighting
Comprehensive syntax highlighting for TCL files including:
- Keywords and control structures
- Built-in commands and functions
- Variables and string interpolation
- Comments and numbers
- Operators and expressions
- **Namespace support** with highlighting for namespace commands
- **Package commands** (provide, require, etc.)
- **Tk widget commands** and functions
- **Expect commands** for automation scripts
- **Custom procedure highlighting**
- Improved escape sequences and embedded commands

### Code Formatting
- Automatic code formatting with configurable options
- Format entire document or selected text
- Format on save (configurable)
- Customizable formatting rules:
  - Indentation (spaces/tabs)
  - Brace alignment
  - Operator spacing
  - Spaces inside braces and brackets

### IntelliSense and Navigation
- **Code Completion**: Smart auto-completion for:
  - 150+ TCL built-in commands with signatures
  - User-defined procedures from current file
  - Variables in scope (local, global, namespace)
  - Package and namespace names
  - Code snippets for common patterns
  - String subcommands
- **Symbol Navigation**:
  - Document outline with procedures, namespaces, variables
  - Go to definition for procedures and namespaces
  - Find all references for procedure calls
  - Workspace-wide symbol search
- **Hover Information**:
  - Command documentation with signatures
  - Variable type and value preview
  - Procedure argument information
  - Comment extraction for documentation

### Language Configuration
- Auto-closing pairs for brackets, braces, and quotes
- Comment toggling with `#`
- Bracket matching
- Code folding regions
- Smart indentation rules

## Installation

### Development
1. Clone this repository
2. Run `npm install` to install dependencies
3. Press `F5` to launch a new VS Code window with the extension loaded

### Building
```bash
npm run compile
```

## Usage

The extension automatically activates for files with the following extensions:
- `.tcl`
- `.tk`
- `.tm`
- `.test`

## Configuration

The extension provides several configuration options under `tcl.format.*`:

- `tcl.format.enable`: Enable/disable TCL formatting (default: `true`)
- `tcl.format.alignBraces`: Align opening and closing braces (default: `true`)
- `tcl.format.spacesAroundOperators`: Add spaces around operators (default: `true`)
- `tcl.format.spacesInsideBraces`: Add spaces inside braces (default: `true`)
- `tcl.format.spacesInsideBrackets`: Add spaces inside brackets (default: `false`)

## Development

### Project Structure
```
tcl_vscode/
├── src/
│   ├── extension.ts          # Extension entry point
│   ├── data/
│   │   └── tclCommands.ts    # TCL command definitions and snippets
│   ├── formatter/            # Formatting implementation
│   │   ├── tclFormatter.ts   # Core formatter logic
│   │   └── formattingProvider.ts # VS Code formatting providers
│   └── providers/            # IntelliSense providers
│       ├── completionProvider.ts # Code completion
│       ├── symbolProvider.ts # Document/workspace symbols
│       ├── definitionProvider.ts # Go to definition/references
│       └── hoverProvider.ts  # Hover information
├── syntaxes/
│   └── tcl.tmLanguage.json   # Syntax highlighting rules
├── language-configuration.json # Language configuration
├── package.json              # Extension manifest
├── tsconfig.json            # TypeScript configuration
└── ROADMAP.md               # Development roadmap
```

### Scripts
- `npm run compile` - Compile TypeScript to JavaScript
- `npm run watch` - Watch for changes and recompile
- `npm run lint` - Run ESLint
- `npm test` - Run tests

## Contributing

See ROADMAP.md for planned features and development phases.

## License

MIT License. See LICENSE for details.