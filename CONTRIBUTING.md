# Contributing to TCL Language Support

Thank you for your interest in contributing to the TCL Language Support extension! This guide will help you get started.

## Table of Contents
1. [Code of Conduct](#code-of-conduct)
2. [Getting Started](#getting-started)
3. [Development Setup](#development-setup)
4. [Project Structure](#project-structure)
5. [Making Contributions](#making-contributions)
6. [Coding Guidelines](#coding-guidelines)
7. [Testing](#testing)
8. [Submitting Pull Requests](#submitting-pull-requests)
9. [Release Process](#release-process)

## Code of Conduct

We are committed to providing a welcoming and inclusive environment. Please:
- Be respectful and constructive in discussions
- Welcome newcomers and help them get started
- Focus on what is best for the community
- Show empathy towards other community members

## Getting Started

### Prerequisites
- Node.js (v16 or higher)
- npm (v7 or higher)
- VS Code (latest stable version)
- Git
- TCL interpreter (for testing)

### First-Time Contributors
1. Fork the repository
2. Clone your fork
3. Create a feature branch
4. Make your changes
5. Submit a pull request

Look for issues labeled `good first issue` or `help wanted`.

## Development Setup

### 1. Clone the Repository
```bash
git clone https://github.com/AmosAnderson/tcl_vscode.git
cd tcl-vscode
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Build the Extension
```bash
npm run compile
```

### 4. Watch for Changes
```bash
npm run watch
```

### 5. Launch Development Instance
1. Open project in VS Code
2. Press `F5` to launch Extension Development Host
3. Open a `.tcl` file in the new window to test

## Project Structure

```
tcl-vscode/
├── src/                    # Source code
│   ├── extension.ts        # Extension entry point
│   ├── data/              # TCL command definitions
│   │   └── tclCommands.ts
│   ├── debug/             # Debugging support
│   │   ├── debugAdapterFactory.ts
│   │   ├── tclDebugAdapter.ts
│   │   └── tclREPL.ts
│   ├── formatter/         # Code formatting
│   │   ├── formattingProvider.ts
│   │   └── tclFormatter.ts
│   ├── providers/         # Language features
│   │   ├── completionProvider.ts
│   │   ├── definitionProvider.ts
│   │   ├── diagnosticProvider.ts
│   │   ├── hoverProvider.ts
│   │   └── symbolProvider.ts
│   ├── refactoring/       # Refactoring features
│   │   ├── extractProvider.ts
│   │   └── renameProvider.ts
│   ├── testing/           # Test support
│   │   ├── coverageProvider.ts
│   │   └── testProvider.ts
│   └── tools/             # External tools
│       ├── interpreterManager.ts
│       ├── packageManager.ts
│       └── projectTemplates.ts
├── syntaxes/              # Syntax definitions
│   └── tcl.tmLanguage.json
├── docs/                  # Documentation
├── test/                  # Test files
├── package.json           # Extension manifest
└── tsconfig.json          # TypeScript config
```

## Making Contributions

### Types of Contributions

#### 1. Bug Fixes
- Fix reported issues
- Improve error handling
- Fix edge cases

#### 2. New Features
- Add new language features
- Enhance existing functionality
- Improve performance

#### 3. Documentation
- Improve user guides
- Add code examples
- Fix typos and clarity

#### 4. Tests
- Add test coverage
- Fix failing tests
- Improve test quality

### Development Workflow

1. **Create an Issue** (if one doesn't exist)
   - Describe the problem or feature
   - Discuss approach with maintainers

2. **Create a Branch**
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/issue-description
   ```

3. **Make Changes**
   - Write clean, readable code
   - Add tests for new functionality
   - Update documentation

4. **Test Your Changes**
   ```bash
   npm run compile
   npm run lint
   npm test
   ```

5. **Commit Your Changes**
   ```bash
   git add .
   git commit -m "feat: add new TCL command completion"
   ```

   Follow conventional commits:
   - `feat:` New feature
   - `fix:` Bug fix
   - `docs:` Documentation
   - `style:` Code style changes
   - `refactor:` Code refactoring
   - `test:` Test changes
   - `chore:` Build/tooling changes

## Coding Guidelines

### TypeScript Style

1. **Use TypeScript Strict Mode**
   ```typescript
   // Good
   const getName = (user: User): string => {
       return user.name;
   };
   ```

2. **Prefer Const and Let**
   ```typescript
   // Good
   const MAX_ITEMS = 100;
   let count = 0;
   
   // Avoid
   var items = [];
   ```

3. **Use Async/Await**
   ```typescript
   // Good
   async function loadFile(path: string): Promise<string> {
       try {
           const content = await fs.readFile(path, 'utf8');
           return content;
       } catch (error) {
           throw new Error(`Failed to load file: ${error}`);
       }
   }
   ```

4. **Type Everything**
   ```typescript
   // Good
   interface TclSymbol {
       name: string;
       kind: vscode.SymbolKind;
       range: vscode.Range;
   }
   
   // Avoid
   const symbol: any = { name: 'test' };
   ```

### VS Code Extension Guidelines

1. **Dispose Resources**
   ```typescript
   class MyProvider implements vscode.Disposable {
       private disposables: vscode.Disposable[] = [];
       
       constructor() {
           this.disposables.push(
               vscode.workspace.onDidChangeTextDocument(this.onDocumentChange)
           );
       }
       
       dispose() {
           this.disposables.forEach(d => d.dispose());
       }
   }
   ```

2. **Handle Errors Gracefully**
   ```typescript
   try {
       const result = await riskyOperation();
       return result;
   } catch (error) {
       console.error('Operation failed:', error);
       vscode.window.showErrorMessage('Operation failed. See output for details.');
       return undefined;
   }
   ```

3. **Use Configuration Properly**
   ```typescript
   const config = vscode.workspace.getConfiguration('tcl');
   const enabled = config.get<boolean>('feature.enable', true); // with default
   ```

### TCL-Specific Guidelines

1. **Command Definitions**
   ```typescript
   // In tclCommands.ts
   {
       name: 'newcommand',
       signature: 'newcommand ?options? arg ?arg ...?',
       description: 'Clear description of what command does',
       category: 'category'
   }
   ```

2. **Syntax Patterns**
   ```json
   // In tcl.tmLanguage.json
   {
       "name": "keyword.control.tcl",
       "match": "\\b(if|else|elseif|then)\\b"
   }
   ```

## Testing

### Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

### Writing Tests

1. **Unit Tests** (in `src/test/`)
   ```typescript
   import * as assert from 'assert';
   import { TclFormatter } from '../formatter/tclFormatter';
   
   suite('TCL Formatter Tests', () => {
       test('should format braces correctly', () => {
           const formatter = new TclFormatter();
           const input = 'if {$x>0}{puts "yes"}';
           const expected = 'if {$x > 0} {\n    puts "yes"\n}';
           assert.strictEqual(formatter.format(input), expected);
       });
   });
   ```

2. **Integration Tests**
   ```typescript
   test('completion should work in namespace context', async () => {
       const doc = await vscode.workspace.openTextDocument({
           content: 'namespace eval test { }',
           language: 'tcl'
       });
       
       const position = new vscode.Position(0, 21);
       const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
           'vscode.executeCompletionItemProvider',
           doc.uri,
           position
       );
       
       assert.ok(completions.items.length > 0);
   });
   ```

### Test Guidelines
- Test edge cases
- Test error conditions
- Use meaningful test names
- Keep tests focused and small
- Mock external dependencies

## Submitting Pull Requests

### Before Submitting

1. **Update from main**
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Run all checks**
   ```bash
   npm run compile
   npm run lint
   npm test
   ```

3. **Update documentation**
   - Add/update relevant docs
   - Update CHANGELOG.md
   - Update README if needed

### PR Description Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] Unit tests pass
- [ ] Manual testing completed
- [ ] Added new tests

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] No new warnings

## Related Issues
Fixes #123
```

### Review Process

1. Automated checks must pass
2. At least one maintainer review
3. Address review feedback
4. Maintainer merges PR

## Release Process

### Version Numbering
We follow semantic versioning (MAJOR.MINOR.PATCH):
- MAJOR: Breaking changes
- MINOR: New features (backward compatible)
- PATCH: Bug fixes

### Release Steps
1. Update version in `package.json`
2. Update CHANGELOG.md
3. Create git tag
4. Build and package extension
5. Publish to marketplace

### Publishing (Maintainers Only)
```bash
# Package extension
npx vsce package

# Publish to marketplace
npx vsce publish
```

## Getting Help

### Resources
- [VS Code Extension API](https://code.visualstudio.com/api)
- [TCL Documentation](https://www.tcl.tk/doc/)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)

### Communication
- GitHub Issues for bugs/features
- GitHub Discussions for questions
- Pull Request comments for code review

## Recognition

Contributors are recognized in:
- CHANGELOG.md (for significant contributions)
- GitHub contributors page
- Extension marketplace page

Thank you for contributing to make TCL development in VS Code better!