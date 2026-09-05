# TCL Language Support - Configuration Reference

This reference describes the settings contributed by TCL Syntax **0.8.0**. VS Code **1.136.0** or newer is required. Launch and attach options are documented separately in [Debugging Tcl](DEBUGGING.md).

## Table of Contents
1. [General Settings](#general-settings)
2. [Formatting Settings](#formatting-settings)
3. [Diagnostics Settings](#diagnostics-settings)
4. [REPL Settings](#repl-settings)
5. [Interpreter Settings](#interpreter-settings)
6. [Linting Settings](#linting-settings)
7. [Package Settings](#package-settings)
8. [Test Settings](#test-settings)
9. [Editor Integration](#editor-integration)
10. [Per-Project Configuration](#per-project-configuration)
11. [Environment Variables](#environment-variables)
12. [Configuration Precedence](#configuration-precedence)
13. [Performance Optimization](#performance-optimization)
14. [Run Settings and Tasks](#run-settings-and-tasks)

## General Settings

These settings control the overall behavior of the TCL extension.

### Extension Activation
The extension activates for TCL files, TCL commands, debug sessions, and requests for `tcl` tasks. Task discovery is available from the standard VS Code Tasks UI; interpreter and package discovery initialize when needed.

Supported file extensions:
- `.tcl` - Standard TCL files
- `.tk` - Tk GUI files  
- `.tm` - TCL modules
- `.test` - Test files

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
- **Description**: Align closing braces of formatted script bodies with their enclosing command

When `false`, a body's closing brace may remain beside the closing brace of its final nested block. This setting does not compact every script body onto one line or rewrite literal braces.

### `tcl.format.spacesAroundOperators`
- **Type**: `boolean`
- **Default**: `true`
- **Description**: Add spaces around operators

**Example:**
```tcl
# Given: set x [expr {$a+$b*$c}]
# true adds spacing around recognized expression operators.
# With spacesInsideBraces also at its default true:
set x [expr { $a + $b * $c }]

# false preserves existing operator spacing:
set x [expr { $a+$b*$c }]
```

### `tcl.format.spacesInsideBraces`
- **Type**: `boolean`
- **Default**: `true`
- **Description**: Add spaces inside braces for control-flow statements

**Note**: Padding applies to recognized expression arguments, procedure parameter lists, and supported inline script bodies. Multiline bodies use indentation. Regex patterns (for example `{\d{3}}`), list literals, and other value contexts remain unchanged.

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

# When false (spacesInsideBraces remains true):
set result [expr { $x + 1 }]
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
- Parser errors for malformed commands and unclosed braces, brackets, or quotes
- Checks inside recognized Tcl script bodies and command substitutions
- Warnings for a missing space between a control command and its opening brace

These are structural checks. The extension does not execute the document to validate command availability, argument values, or variable initialization. Style checks are configured separately under `tcl.lint.*`.

### `tcl.diagnostics.useTclsh`
- **Type**: `boolean`
- **Default**: `true`
- **Description**: Use tclsh to check command completeness without executing document code

```json
"tcl.diagnostics.useTclsh": true
```

**Note**: Uses `tcl.interpreter.path` (default: `tclsh`). The interpreter reads the document as data and calls `info complete`; diagnostics never source or evaluate the document. Static syntax checks run independently.

### `tcl.diagnostics.debounceMs`

Delay interpreter completeness checks after editing, in milliseconds. The default is `200`; accepted values are `0`–`5000`. Static checks remain immediate, and superseded interpreter checks are cancelled.

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

An explicitly configured `tcl.repl.tclPath` overrides the project interpreter. If this setting is unset, the REPL uses `tcl.interpreter.path`; its displayed default of `tclsh` does not override a project selection. The REPL starts in the active file’s workspace folder, or its directory when no folder is open. Closing the terminal permits a fresh REPL; changing the interpreter or folder starts a REPL in that context.

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

Selection applies to the active file’s workspace folder when one is open, otherwise to user settings. Put a different `tcl.interpreter.path` in each folder’s `.vscode/settings.json` to use different interpreters in one workspace. Run commands, tests, coverage, diagnostics, packages, and the REPL resolve settings using their source file or folder; changes take effect without a reload.

## Linting Settings

Control style linting behavior. Lint warnings appear separately from structural syntax diagnostics.

### `tcl.lint.enable`
- **Type**: `boolean`
- **Default**: `true`
- **Description**: Enable TCL linting for style issues

```json
"tcl.lint.enable": true
```

When enabled, checks for:
- Unbraced `expr` arguments (double substitution risk)
- Missing `default` clause in `switch` statements
- `catch` without result variable
- Line length exceeding configured maximum
- Deprecated commands (`string bytelength`, `string wordend`, `string wordstart`)
- Repeated `$::varName` usage in procs (suggests `global`)

### `tcl.lint.maxLineLength`
- **Type**: `number`
- **Default**: `120`
- **Description**: Maximum line length before warning (0 to disable)

```json
"tcl.lint.maxLineLength": 100
```

### `tcl.lint.exprBracing`
- **Type**: `boolean`
- **Default**: `true`
- **Description**: Warn when expr arguments are not braced

```json
"tcl.lint.exprBracing": true
```

**Example:**
```tcl
# Warning:
set result [expr $a + $b]

# OK:
set result [expr {$a + $b}]
```

### `tcl.lint.rules`

Override individual rule severities; the default is `{}`. Supported rules are `expr-bracing`, `catch-no-var`, `switch-default`, `deprecated`, `line-length`, and `global-shorthand`. Values are `off`, `error`, `warning`, `information`, or `hint`.

```json
"tcl.lint.rules": {
    "line-length": "information",
    "catch-no-var": "off"
}
```

For a targeted suppression, place a comment such as `# tcl-lint-disable-next-line expr-bracing` before the affected line. Use `all` to suppress all lint rules on that next line.

## Package Settings

Control TCL package management features.

### `tcl.packages.autoDiscovery`
- **Type**: `boolean`
- **Default**: `true`
- **Description**: Automatically discover TCL packages in workspace

```json
"tcl.packages.autoDiscovery": true
```

Discovery is lazy and cached by workspace folder and interpreter. The catalog includes static registrations in `pkgIndex.tcl` and `Package.tcl`, discoverable `.tm` modules, and packages found through the interpreter’s search paths. Multiple packages and versions in one index are retained. Package names are offered after `package require`, `package provide`, and `package present`; catalog discovery does not supply every package’s exported commands.

Setting this to `false` suppresses automatic catalog scans. Explicit **TCL: Update Package Index**, dependency refresh, and install/update commands can still request a scan. Relevant file, workspace-folder, and interpreter-setting changes invalidate the catalog.

### `tcl.packages.installDirectory`
- **Type**: `string`
- **Default**: `""`
- **Description**: Default directory to install TCL packages to (must be on auto_path)

```json
"tcl.packages.installDirectory": "/usr/local/lib/tcl8.6"
```

This is the destination for manual local installation. It must be on the selected interpreter’s `auto_path`. When empty, choose from writable directories on that path. The installer preserves existing destinations and verifies that the selected interpreter can load the requested package version. A failed local verification removes only the newly created destination.

When `teacup` is available, installation uses it. Otherwise, choose a local package directory or `.tar`, `.tar.gz`, or `.tgz` archive. A local source must declare the requested package/version and contain a loadable package index. The archive reader accepts regular files and directories in ustar-compatible archives; links, special entries, and PAX extensions are unsupported. Archives are limited to 64 MiB, with a 128 MiB decompressed limit. Extract an unsupported archive yourself and select its package directory.

### Dependency requirements and updates

Static requirements are read from Tcl commands and `Package.tcl` metadata without executing the source. For example:

```tcl
package require Example 1.0
package require -exact ExactPackage 2.3
package require RangePackage 1.0-2.0
```

The first example requests a Tcl-compatible version; the third requests a version at least `1.0` and below `2.0`. `Package.tcl` also supports `require` and `test-require`. The selected interpreter’s version rules determine compatibility. Requirements retain their source locations, and all requirements for the same package in a folder must be satisfied. Comments and literal data are ignored. Dynamic requirements such as `package require $name`, unsupported constraints, and conflicting requirements appear as unknown or conflicting in dependency reports.

**TCL: Install Dependencies** repairs missing or incompatible dependencies. **TCL: Update Dependencies** separately looks for newer compatible versions in supported available sources; it does not mean “ignore the declared version constraint.” **TCL: Create Dependency Report** exports the required versions, installed catalog versions, statuses, and source paths as Markdown or JSON. Projects in different workspace folders are evaluated separately.

## Test Settings

Configure test runner behavior.

### `tcl.test.tclPath`
- **Type**: `string`
- **Default**: `"tclsh"`
- **Description**: Path to TCL interpreter for running tests

```json
"tcl.test.tclPath": "/usr/local/bin/tclsh8.6"
```

When explicitly configured, `tcl.test.tclPath` applies to Test Explorer Run, Debug, and Coverage. Otherwise all three use the source file’s `tcl.interpreter.path`.

### Test discovery and profiles

Discovery scans `.tcl`, `.tk`, `.tm`, and `.test` files for literal `tcltest::test` declarations, imported `test` declarations, and procedures whose final name starts with `test_`. Merely requiring `tcltest` does not create a test. Comments, literal data, and declarations inside unexecuted procedure definitions do not become test items. Use Test Explorer’s Refresh action after external changes; document edits also schedule discovery.

Test Explorer provides **Run TCL Tests**, **Debug TCL Tests**, and **Coverage TCL Tests** profiles. They use the same selected cases, file expansion, and exclusions. Dirty test documents are saved before execution; cancelled saves skip that case. Debugging uses a generated selected-case runner while breakpoints remain in the original source file. Stop cancels the active process or owned debug session, and later runs remain available.

Coverage appears in VS Code’s native coverage UI and the extension’s editor decorations/exports. It executes selected tests as entry points and records their loaded source files; ordinary application files are not independently launched. Completed reports remain available when an assertion fails. Dynamic code without source locations and nested procedure bodies whose declarations never execute can be absent from totals.

## Run Settings and Tasks

These resource-scoped settings apply to **TCL: Run with Interpreter...** and **TCL: Run with Arguments...**:

| Setting | Default | Behavior |
| --- | --- | --- |
| `tcl.run.args` | `[]` | Default argument strings |
| `tcl.run.cwd` | `""` | Workspace folder, or script directory outside a workspace; an override can use `${workspaceFolder}` or `${fileDirname}` |
| `tcl.run.env` | `{}` | Environment overrides for the launched process |
| `tcl.run.rememberArgs` | `false` | Save arguments entered in Run with Arguments to the active folder’s settings, or user settings outside a workspace |

```json
{
    "tcl.run.args": ["input with spaces.txt", "", "日本語"],
    "tcl.run.cwd": "${workspaceFolder}",
    "tcl.run.env": {"APP_MODE": "development"},
    "tcl.run.rememberArgs": true
}
```

The argument prompt accepts a JSON array of strings for exact arguments, or quoted arguments such as `one "two three" ""`. Execution uses a process task, so shell substitutions, globs, and pipelines are not expanded. A failed or cancelled file save prevents launch. REPL commands, debug configurations, and custom task definitions use their own execution options rather than these run-command defaults.

### Tasks

Use **Tasks: Run Task** or **Tasks: Run Build Task** without first invoking another TCL command. Discovery follows the current workspace folders and offers test/build/package actions when their required project files exist. The Install Dependencies task uses the same service as the command palette.

A `.vscode/tasks.json` example:

```json
{
    "version": "2.0.0",
    "tasks": [
        {
            "label": "Run project script",
            "type": "tcl",
            "script": "${workspaceFolder}/main.tcl",
            "args": ["input with spaces.txt", ""],
            "cwd": "${workspaceFolder}",
            "env": {"APP_MODE": "test"},
            "problemMatcher": "$tcl"
        }
    ]
}
```

Set `interpreter` on a task to override the folder interpreter. A task must specify `script` or `command`; built-in commands are `run_tests`, `build_package`, `install_deps`, and `package`. `run_tests` executes the folder’s `run_tests.tcl`. Package archiving reads static `name`/`version` metadata and requires a system `tar` executable. Tcl source errors are linked through the `$tcl` problem matcher. Task labels, groups, presentation options, arguments, and environment values are retained during resolution.

## Editor Integration

These VS Code settings enhance the TCL editing experience.

### CodeLens and workspace analysis

`tcl.codeLens.enable`, `tcl.codeLens.references`, and `tcl.codeLens.tests` all default to `true`. Disable the first to remove all Tcl lenses, or disable reference counts/test actions separately.

`tcl.analysis.exclude` is an array of glob patterns excluded from semantic workspace analysis. Its defaults exclude `**/node_modules/**` and `**/.git/**`; custom values replace that array, so retain those entries if needed. Analysis also honors unconditional `files.exclude` entries. Exclusions, file changes, and workspace-folder changes refresh the index. Package and test discovery have their own scope.

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
    
    // Exclude generated sources from semantic analysis
    "tcl.analysis.exclude": ["**/node_modules/**", "**/.git/**", "**/generated/**"],
    
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

Launched Tcl processes inherit the environment of VS Code. `PATH` is used to find interpreter command names; configure `tcl.interpreter.path` for an explicit executable. These Tcl environment variables can affect the interpreter’s package/library search:

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

For resource-scoped settings, VS Code applies defaults, then user, workspace, and workspace-folder values. In a multi-folder workspace, shared values belong in the `.code-workspace` settings and folder overrides in each folder’s `.vscode/settings.json`.

Interpreter selection uses this precedence, from highest to lowest:

1. An explicit task `interpreter`, debug configuration `tclPath`, or interpreter chosen for a one-off run.
2. An explicitly configured feature override: `tcl.repl.tclPath` for REPL or `tcl.test.tclPath` for Test Explorer Run/Debug/Coverage.
3. The resource’s `tcl.interpreter.path`.
4. `tclsh` resolved through `PATH`.

An unset feature override does not mask the project interpreter even though its Settings UI default is `tclsh`. Inherited environment variables affect the chosen process; they do not supersede the interpreter setting.

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
    
    // Exclude generated and large directories from Tcl language analysis
    "tcl.analysis.exclude": [
        "**/node_modules/**",
        "**/.git/**",
        "**/large_data/**",
        "**/build/**"
    ]
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
Use **TCL Diagnostics**, **TCL Tests**, **TCL Interpreter**, or **TCL Package Manager** in the Output panel for the relevant feature. Channels appear when that feature creates them. Debug sessions write to the **Debug Console**; extension-host failures can be inspected with **Developer: Show Logs...** → **Extension Host**.

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
```
