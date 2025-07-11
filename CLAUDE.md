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
- **IntelliSense Providers**: `src/providers/` - Code completion, hover, navigation features
- **TCL Data**: `src/data/tclCommands.ts` - Built-in command definitions and snippets

### Key Features Implemented
1. **Phase 1**: Basic extension structure and syntax highlighting
2. **Phase 2**: Advanced syntax highlighting (namespaces, packages, Tk, Expect) and code formatting
3. **Phase 3**: Complete IntelliSense suite (completion, hover, navigation, symbols)

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
4. Use `test.tcl` in the root directory for comprehensive testing

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
1. Follow the existing provider pattern
2. Add comprehensive TypeScript types
3. Update package.json contributions if needed
4. Test with the provided test.tcl file
5. Update ROADMAP.md and CHANGELOG.md

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
- **Phase 4**: 🔲 NOT STARTED - Code Analysis and Diagnostics

## Next Development Phase
Phase 4 would focus on:
- Syntax error detection
- Integration with `tclsh -n` for validation
- Real-time diagnostics
- Quick fixes for common issues

## Testing Notes
The `test.tcl` file contains examples of all major TCL constructs to verify:
- Syntax highlighting accuracy
- Code completion functionality
- Navigation features (go to definition, find references)
- Hover information display
- Symbol outline generation