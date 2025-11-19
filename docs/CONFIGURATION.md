# TCL Language Support - Configuration Reference

This document provides a comprehensive reference for all configuration options available in the TCL Language Support extension.

## Table of Contents
1. [General Settings](#general-settings)
2. [Language Server Settings](#language-server-settings)
3. [Formatting Settings](#formatting-settings)
4. [Diagnostics Settings](#diagnostics-settings)
5. [REPL Settings](#repl-settings)
6. [Interpreter Settings](#interpreter-settings)
7. [Package Settings](#package-settings)
8. [Test Settings](#test-settings)
9. [Editor Integration](#editor-integration)
10. [Per-Project Configuration](#per-project-configuration)
11. [Environment Variables](#environment-variables)
12. [Configuration Precedence](#configuration-precedence)
13. [Performance Optimization](#performance-optimization)

## General Settings

These settings control the overall behavior of the TCL extension.

### Extension Activation
The extension automatically activates when you open a TCL file. No configuration needed.

Supported file extensions:
- `.tcl` - Standard TCL files
- `.tk` - Tk GUI files  
- `.tm` - TCL modules
- `.test` - Test files

## Language Server Settings

Control how the extension connects to the optional TCL Language Server. When the server is unavailable, the extension automatically falls back to the built-in providers.

### `tcl.languageServer.enable`
- **Type**: `boolean`
- **Default**: `true`
- **Description**: Enable or disable the TCL Language Server integration globally.

```json
"tcl.languageServer.enable": true
```

### `tcl.languageServer.path`
- **Type**: `string`
- **Default**: `"tcl-language-server"`
- **Description**: Path to the language server executable. Set an absolute path if the binary is not on your PATH.

```json
"tcl.languageServer.path": "/usr/local/bin/tcl-language-server"
```

### `tcl.languageServer.trace.server`
- **Type**: `string` (`"off" | "messages" | "verbose"`)
- **Default**: `"off"`
- **Description**: Controls protocol logging between VS Code and the language server, useful when diagnosing IntelliSense issues.

```json
"tcl.languageServer.trace.server": "messages"
```

## Formatting Settings

Control how the code formatter behaves.

### `tcl.format.enable`
- **Type**: `boolean`
- **Default**: `false`
- **Description**: Enable automatic TCL formatting on save

```json
"tcl.format.enable": true
```

### `tcl.format.alignBraces`
- **Type**: `boolean`
- **Default**: `true`
- **Description**: Align opening and closing braces vertically

**Example:**
```tcl
# When true:
if {$x > 0} {
    puts "positive"
}

# When false:
if {$x > 0} {
    puts "positive"}
```

### `tcl.format.spacesAroundOperators`
- **Type**: `boolean`
- **Default**: `true`
- **Description**: Add spaces around operators

**Example:**
```tcl
# When true:
set x [expr {$a + $b * $c}]

# When false:
set x [expr {$a+$b*$c}]
```

### `tcl.format.spacesInsideBraces`
- **Type**: `boolean`
- **Default**: `true`
- **Description**: Add spaces inside braces

**Example:**
```tcl
# When true:
if { $x > 0 } {
    puts "positive"
}

# When false:
if {$x > 0} {
    puts "positive"
}
```

### `tcl.format.spacesInsideBrackets`
- **Type**: `boolean`
- **Default**: `false`
- **Description**: Add spaces inside brackets

**Example:**
```tcl
# When true:
set result [ expr { $x + 1 } ]

# When false:
set result [expr {$x + 1}]
```

## Diagnostics Settings

Control syntax checking and error detection.

### `tcl.diagnostics.enable`
- **Type**: `boolean`
- **Default**: `true`
- **Description**: Enable TCL syntax diagnostics

```json
"tcl.diagnostics.enable": true
```

When enabled, provides:
- Syntax error detection
- Missing bracket/brace detection
- Command validation
- Variable usage checking

### `tcl.diagnostics.useTclsh`
- **Type**: `boolean`
- **Default**: `true`
- **Description**: Use tclsh for advanced syntax validation

```json
"tcl.diagnostics.useTclsh": true
```

**Note**: Requires `tclsh` to be available in your system PATH. When enabled, provides more accurate syntax checking using the TCL interpreter.

## REPL Settings

Configure the TCL REPL (Read-Eval-Print Loop).

### `tcl.repl.tclPath`
- **Type**: `string`
- **Default**: `"tclsh"`
- **Description**: Path to TCL interpreter for REPL

```json
"tcl.repl.tclPath": "/usr/local/bin/tclsh8.6"
```

**Platform-specific examples:**
- **Windows**: `"C:\\Tcl\\bin\\tclsh.exe"`
- **macOS**: `"/usr/local/bin/tclsh"`
- **Linux**: `"/usr/bin/tclsh"`

## Interpreter Settings

Configure TCL interpreter discovery and selection.

### `tcl.interpreter.path`
- **Type**: `string`
- **Default**: `"tclsh"`
- **Description**: Path to the default TCL interpreter

```json
"tcl.interpreter.path": "/opt/tcl8.6/bin/tclsh"
```

### `tcl.interpreters.customPaths`
- **Type**: `array`
- **Default**: `[]`
- **Description**: Custom TCL interpreter paths

```json
"tcl.interpreters.customPaths": [
    "/usr/local/bin/tclsh8.6",
    "/opt/activetcl/bin/tclsh",
    "C:\\Tcl\\bin\\tclsh.exe"
]
```

The extension will:
1. Auto-discover system interpreters
2. Check these custom paths
3. Allow selection via "TCL: Select Interpreter"

## Package Settings

Control TCL package management features.

### `tcl.packages.autoDiscovery`
- **Type**: `boolean`
- **Default**: `true`
- **Description**: Automatically discover TCL packages in workspace

```json
"tcl.packages.autoDiscovery": true
```

When enabled:
- Scans workspace for `pkgIndex.tcl` files
- Discovers package dependencies
- Provides auto-completion for package commands

## Test Settings

Configure test runner behavior.

### `tcl.test.tclPath`
- **Type**: `string`
- **Default**: `"tclsh"`
- **Description**: Path to TCL interpreter for running tests

```json
"tcl.test.tclPath": "/usr/local/bin/tclsh8.6"
```

### Test Discovery Patterns

The extension automatically discovers test files matching:
- `*.test` files
- Files containing `test` commands
- Files with `tcltest` package usage

## Editor Integration

These VS Code settings enhance the TCL editing experience.

### File Associations
```json
"files.associations": {
    "*.tcl": "tcl",
    "*.tk": "tcl",
    "*.tm": "tcl",
    "*.test": "tcl",
    "tclIndex": "tcl",
    "pkgIndex.tcl": "tcl"
}
```

### Editor Settings for TCL
```json
"[tcl]": {
    "editor.tabSize": 4,
    "editor.insertSpaces": true,
    "editor.autoIndent": "full",
    "editor.quickSuggestions": {
        "other": true,
        "comments": false,
        "strings": true
    },
    "editor.formatOnSave": true,
    "editor.formatOnPaste": true,
    "editor.wordSeparators": "`~!@#$%^&*()-=+[{]}\\|;:'\",.<>/?",
    "editor.suggestSelection": "first"
}
```

### Bracket Matching
```json
"editor.bracketPairColorization.enabled": true,
"editor.guides.bracketPairs": true,
"editor.autoClosingBrackets": "languageDefined"
```

### IntelliSense Configuration
```json
"editor.suggestOnTriggerCharacters": true,
"editor.acceptSuggestionOnCommitCharacter": true,
"editor.snippetSuggestions": "inline",
"editor.wordBasedSuggestions": "matchingDocuments"
```

## Per-Project Configuration

Create project-specific settings by adding `.vscode/settings.json` to your project:

### Example Project Settings
```json
{
    // Use specific TCL version for this project
    "tcl.interpreter.path": "/opt/tcl8.6/bin/tclsh",
    
    // Project-specific formatting
    "tcl.format.enable": true,
    "tcl.format.alignBraces": true,
    "tcl.format.spacesAroundOperators": true,
    
    // Disable diagnostics for performance
    "tcl.diagnostics.enable": false,
    
    // Custom file associations
    "files.associations": {
        "*.tcl.in": "tcl",
        "configure": "tcl"
    },
    
    // Exclude directories from search
    "files.exclude": {
        "**/build": true,
        "**/dist": true,
        "**/.tclsh_history": true
    },
    
    // Search exclude patterns
    "search.exclude": {
        "**/vendor": true,
        "**/generated": true
    }
}
```

### Workspace Configuration

For multi-root workspaces, use `.code-workspace` file:

```json
{
    "folders": [
        {
            "path": "packages/core",
            "name": "Core Package"
        },
        {
            "path": "packages/gui",
            "name": "GUI Package"
        }
    ],
    "settings": {
        "tcl.format.enable": true,
        "tcl.packages.autoDiscovery": true
    }
}
```

## Environment Variables

The extension respects these environment variables:

### `TCLSH`
Path to TCL interpreter
```bash
export TCLSH=/usr/local/bin/tclsh8.6
```

### `TCLLIBPATH`
Additional paths for TCL package discovery
```bash
export TCLLIBPATH="/opt/tcllib /home/user/tcl-packages"
```

### `TCL_LIBRARY`
Path to TCL library directory
```bash
export TCL_LIBRARY=/usr/local/lib/tcl8.6
```

## Configuration Precedence

Settings are applied in this order (later overrides earlier):
1. Default extension settings
2. User settings (`~/.config/Code/User/settings.json`)
3. Workspace settings (`.vscode/settings.json`)
4. Workspace file settings (`.code-workspace`)
5. Environment variables

## Performance Optimization

For large projects, consider these settings:

### Disable Features for Performance
```json
{
    // Disable real-time diagnostics
    "tcl.diagnostics.enable": false,
    
    // Or just disable tclsh validation
    "tcl.diagnostics.useTclsh": false,
    
    // Disable auto-discovery in large workspaces
    "tcl.packages.autoDiscovery": false,
    
    // Limit file watching
    "files.watcherExclude": {
        "**/large_data/**": true,
        "**/node_modules/**": true,
        "**/build/**": true
    }
}
```

### Optimize Search and Indexing
```json
{
    // Exclude from quick open
    "files.exclude": {
        "**/*.log": true,
        "**/*.tmp": true,
        "**/temp": true
    },
    
    // Exclude from search
    "search.exclude": {
        "**/build": true,
        "**/output": true,
        "**/*.min.tcl": true
    },
    
    // Limit search scope
    "search.useIgnoreFiles": true,
    "search.followSymlinks": false
}
```

## Troubleshooting Configuration

### Verify Current Configuration
1. Open Command Palette (Ctrl+Shift+P)
2. Run "Preferences: Open Settings (JSON)"
3. Search for "tcl" to see all TCL-related settings

### Reset to Defaults
Remove TCL settings from your settings.json to use defaults.

### Configuration Not Working?
1. Check for typos in setting names
2. Ensure JSON syntax is valid
3. Restart VS Code after major changes
4. Check Output panel for extension errors

### Debug Configuration Loading
```json
{
    // Enable extension debug output
    "tcl.debug.enable": true
}
```

## Migration from Other Editors

### From Vim
```json
{
    "editor.lineNumbers": "relative",
    "vim.useSystemClipboard": true,
    "tcl.format.enable": true
}
```

### From Emacs
```json
{
    "editor.emptySelectionClipboard": false,
    "editor.find.seedSearchStringFromSelection": "never",
    "tcl.format.spacesInsideBraces": true
}
```

### From Sublime Text
```json
{
    "editor.minimap.enabled": true,
    "editor.renderWhitespace": "selection",
    "tcl.format.alignBraces": true
}