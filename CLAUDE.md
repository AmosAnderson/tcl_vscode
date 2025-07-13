# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
This is a VS Code extension providing comprehensive TCL (Tool Command Language) support including syntax highlighting, code formatting, and IntelliSense features.

## Architecture

### Core Components
- **Extension Entry Point**: `src/extension.ts` - Registers all providers and commands
- **Syntax Highlighting**: `syntaxes/tcl.tmLanguage.json` - TextMate grammar for TCL
- **Language Configuration**: `language-configuration.json` - Brackets, comments, indentation rules
- **Formatter**: `src/formatter/` - Code formatting implementation
- **IntelliSense Providers**: `src/providers/` - Code completion, hover, navigation, diagnostics
- **Debug Support**: `src/debug/` - Debug adapter, REPL integration
- **Testing**: `src/testing/` - Test runner and coverage providers
- **Refactoring**: `src/refactoring/` - Extract and rename operations
- **Tools**: `src/tools/` - Interpreter, package, dependency, and project management
- **TCL Data**: `src/data/tclCommands.ts` - Built-in command definitions and snippets

### Key Features Implemented
1. **Phase 1**: ✅ Basic extension structure and syntax highlighting
2. **Phase 2**: ✅ Advanced syntax highlighting (namespaces, packages, Tk, Expect) and code formatting
3. **Phase 3**: ✅ Complete IntelliSense suite (completion, hover, navigation, symbols)
4. **Phase 4**: ✅ Code analysis and diagnostics with syntax checking
5. **Phase 5**: ✅ Debugging support, testing integration, and refactoring tools
6. **Phase 6**: ✅ External tool integration and project management

## Common Development Commands

### Build and Test
```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch for changes
npm run watch

# Run linter
npm run lint

# Launch extension in development mode
code . 
# Then press F5 to open Extension Development Host
```

### Testing the Extension
1. Open VS Code in the project directory
2. Press F5 to launch Extension Development Host
3. Open a `.tcl` file to test features
4. Use `test.tcl` or `comprehensive_test.tcl` in the root directory for testing
5. Access debugging features through Run and Debug panel
6. Test REPL with Command Palette: "Start TCL REPL"

## Code Structure

### Provider Pattern
All IntelliSense features follow VS Code's provider pattern:
- Implement specific interfaces (e.g., `CompletionItemProvider`)
- Register with `vscode.languages.register*` methods
- Handle document analysis and provide structured results

### TCL Command Database
`src/data/tclCommands.ts` contains:
- Built-in command definitions with signatures
- Command categories for organization
- Code snippets for common patterns
- String subcommands for context-aware completion

### Syntax Highlighting
`syntaxes/tcl.tmLanguage.json` uses TextMate grammar with:
- Comprehensive pattern matching for TCL constructs
- Proper scoping for theme compatibility
- Support for embedded commands and variable interpolation
- Special handling for namespaces, packages, Tk, and Expect

## Development Guidelines

### Adding New Features
1. Follow the existing provider pattern for IntelliSense features
2. Add comprehensive TypeScript types and proper error handling
3. Update package.json contributions for new commands or configuration
4. Test with provided test files (`test.tcl`, `comprehensive_test.tcl`)
5. Update ROADMAP.md and CHANGELOG.md
6. For new tools, add to `src/tools/` directory following existing patterns

### Code Quality
- Use TypeScript strict mode
- Follow VS Code extension best practices
- Implement proper error handling
- Add caching for performance where appropriate

### File Extensions Supported
- `.tcl` - Standard TCL files
- `.tk` - Tk GUI files
- `.tm` - TCL modules
- `.test` - TCL test files

## Current Status
- **Phase 1**: ✅ COMPLETED - Foundation
- **Phase 2**: ✅ COMPLETED - Enhanced Language Features  
- **Phase 3**: ✅ COMPLETED - IntelliSense and Navigation
- **Phase 4**: ✅ COMPLETED - Code Analysis and Diagnostics
- **Phase 5**: ✅ COMPLETED - Advanced Features (Debugging, Testing, Refactoring)
- **Phase 6**: ✅ COMPLETED - Integration and Tools
- **Phase 7**: 🔲 PLANNED - Documentation and Polish

## Available Commands
The extension provides numerous commands accessible via Command Palette (Ctrl+Shift+P):
- **TCL REPL**: `tcl.startREPL`, `tcl.evaluateSelection`, `tcl.runCurrentFile`
- **Testing**: `tcl.runTests`, `tcl.generateCoverage`, `tcl.clearCoverage`
- **Refactoring**: `tcl.extractProcedure`, `tcl.extractVariable`, `tcl.inlineVariable`
- **Tools**: `tcl.selectInterpreter`, `tcl.createPackage`, `tcl.newProject`
- **Build**: `tcl.runBuild`, `tcl.installDependencies`

## Testing Notes
The `test.tcl` file contains examples of all major TCL constructs to verify:
- Syntax highlighting accuracy
- Code completion functionality
- Navigation features (go to definition, find references)
- Hover information display
- Symbol outline generation