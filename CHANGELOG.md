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

### Phase 4 Features (Completed)
#### Code Analysis and Diagnostics
- Real-time syntax checking with error detection
- Integration with `tclsh -n` for advanced validation
- Common TCL anti-patterns detection
- Missing bracket/quote detection
- Command substitution validation
- Quick fixes for common issues
- Configurable diagnostic settings

### Phase 5 Features (Completed)
#### Advanced Features
- **Debugging Support**: Full TCL debugging capabilities
  - Debug adapter implementation with breakpoints
  - Variable inspection and call stack navigation
  - Step-through debugging support
- **REPL Integration**: Interactive TCL terminal
  - Simple terminal-based REPL using tclsh
  - Evaluate selection and run current file commands
- **Testing Support**: Comprehensive test integration
  - Test file discovery (.test files and tcltest patterns)
  - Test runner with VS Code Test Explorer
  - Code coverage analysis and reporting
- **Refactoring Tools**: Advanced code refactoring
  - Rename symbol with built-in command protection
  - Extract procedure and variable refactoring
  - Inline variable functionality

### Phase 6 Features (Completed)
#### Integration and Tools
- **Interpreter Management**: Multi-interpreter support
  - Auto-discovery of system interpreters
  - Custom interpreter configuration
  - TclKit and ActiveTcl integration
- **Package Management**: TCL package support
  - Auto-discovery of workspace packages
  - Package creation and index management
  - Tcllib/Tklib integration
- **Project Management**: Complete project support
  - 5 project templates (basic app, Tk GUI, package, test suite, web server)
  - Build task integration and auto-discovery
  - Dependency management and reporting

### Phase 7 Features (Completed)
#### Documentation and Polish
- Comprehensive user guide with examples
- Complete configuration reference
- FAQ and troubleshooting guide
- Contributing guidelines for developers
- Performance optimizations with lazy loading
- Basic test suite implementation
- CI/CD pipeline setup

## [0.1.0] - 2024-01-15 - First Stable Release

### Major Milestone
This release marks the completion of all planned development phases (1-7) and represents the first stable, production-ready version of the TCL Language Support extension.

### Fixed in 0.1.0
- Fixed debug activation issues - VS Code now properly recognizes TCL debugging capabilities
- Fixed refactoring commands (Extract Procedure, Extract Variable, Inline Variable) not working from Command Palette
- Enhanced debug configuration with proper activation events
- Added launch.json template for easier debug setup

### Completed Feature Set
- **Foundation**: Syntax highlighting and language configuration
- **Enhanced Features**: Advanced highlighting, code formatting
- **IntelliSense**: Auto-completion, navigation, hover information
- **Diagnostics**: Real-time syntax checking and validation
- **Advanced Features**: Debugging, testing, refactoring tools
- **Tool Integration**: Interpreter management, package support
- **Documentation**: Complete user guides and references

## [0.0.3] - Previous Release

### Added
- Complete Phases 4-7 implementation
- All advanced features now available
- Comprehensive documentation suite
- Performance optimizations
- Test infrastructure

### Changed
- Improved extension activation (onLanguage:tcl instead of *)
- Better performance with lazy initialization
- Enhanced error handling and user messages
- All commands now have "TCL:" prefix for organization

### Fixed
- Extension activation dependency issues
- REPL implementation simplified and stabilized
- Built-in command rename protection
- Various performance and stability improvements

### Documentation
- User guide with complete feature overview
- Configuration reference with all settings
- FAQ covering common issues and solutions
- Contributing guide for developers