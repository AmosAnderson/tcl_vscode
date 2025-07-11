# Change Log

All notable changes to the "tcl-language-support" extension will be documented in this file.

## [0.0.1] - Initial Release

### Phase 1 Features (Completed)
- Basic VS Code extension structure
- TCL syntax highlighting for keywords, strings, numbers, and operators
- Language configuration with auto-closing pairs and bracket matching

### Phase 2 Features (Completed)
#### Enhanced Syntax Highlighting
- Added namespace command support with dedicated highlighting
- Added package command support (provide, require, etc.)
- Added Tk widget and function highlighting
- Added Expect command highlighting for automation scripts
- Added custom procedure name highlighting
- Improved regex patterns:
  - Better escape sequence handling in strings
  - Support for embedded commands with `[...]`
  - Binary number literals (0b...)
  - More comprehensive escape sequences

#### Code Formatting
- Implemented basic TCL code formatter
- Configurable formatting options:
  - Indent size and tab/space preference
  - Brace alignment
  - Operator spacing
  - Spaces inside braces and brackets
- Format document command
- Format selection support
- Format on save functionality
- Integration with VS Code's built-in formatting commands

### Known Issues
- Formatter may not handle all edge cases in complex TCL scripts
- Nested brace handling in formatter could be improved

### Phase 3 Features (Completed)
#### IntelliSense and Navigation
- **Code Completion**: Comprehensive auto-completion system
  - 150+ TCL built-in commands with detailed signatures
  - User-defined procedure completion from current file
  - Variable name completion (set, global, variable declarations)
  - Package and namespace completion
  - Code snippets for common patterns (proc, if, for, etc.)
  - String subcommand completion
  - Context-aware completion with trigger characters (., :, $)

- **Symbol Navigation**: Complete navigation support
  - Document symbols provider (procedures, namespaces, variables, packages)
  - Go to definition for procedures and namespaces
  - Find all references for procedure calls
  - Workspace-wide symbol search across all TCL files
  - Peek definition support

- **Hover Information**: Rich hover experience
  - Built-in command documentation with signatures and categories
  - Variable type and value preview
  - User-defined procedure signatures with argument information
  - Comment extraction for procedure documentation

### Next Steps (Phase 4 - Not Started)
- Code analysis and diagnostics
- Linting with TCL syntax checking
- Error detection and quick fixes