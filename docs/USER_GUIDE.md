# TCL Language Support - User Guide

This guide describes TCL Syntax **0.8.0**.

## Table of Contents
1. [Getting Started](#getting-started)
2. [Features Overview](#features-overview)
3. [Basic Usage](#basic-usage)
4. [Advanced Features](#advanced-features)
5. [Tips and Tricks](#tips-and-tricks)

## Getting Started

### Requirements
- Visual Studio Code **1.136.0** or higher
- Node.js **22.12+** (only required for local development workflows such as cloning and running `npm ci`)
- A TCL interpreter (`tclsh`) on your PATH or configured in settings for execution, debugging, REPL, tests, package tools, and interpreter completeness checks. Debugging, coverage, and Inline Procedure require Tcl 8.5+. Static editing features work without Tcl installed.

### Installation
1. Download `tcl-syntax-0.8.0.vsix` from [GitHub Releases](https://github.com/AmosAnderson/tcl_vscode/releases).
2. In VS Code, open the Command Palette (Ctrl+Shift+P / Cmd+Shift+P).
3. Run **Extensions: Install from VSIX...** and choose the downloaded file.

You can also install **TCL Syntax** from the Extensions Marketplace. Marketplace publication is separate, so its available version can differ from GitHub Releases.

### First Steps
After installation, the extension automatically activates when you open any TCL file (`.tcl`, `.tk`, `.tm`, `.test`).

### Quick Start
1. Create a new file with `.tcl` extension
2. Start typing TCL code - notice the syntax highlighting
3. Press Ctrl+Space for code completion
4. Use Ctrl+Shift+P to access TCL commands

## Features Overview

### 🎨 Syntax Highlighting
- Tcl command, variable, comment, string, and substitution highlighting
- Namespace and package highlighting
- Tk widget commands
- Expect commands
- String interpolation and escape sequences

### ✨ IntelliSense
- **Auto-completion**: 800+ command/subcommand metadata entries, workspace procedures, variables, namespaces, and package names
- **Hover Information**: Command documentation, procedure arguments, and statically known variable previews
- **Signature Help**: Parameter hints while typing, with active-argument highlighting
- **Go to Definition**: Navigate to procedure definitions (F12)
- **Find References**: Find all usages of procedures (Shift+F12)

### 📝 Code Formatting
- Format entire document (Shift+Alt+F)
- Format selection (Ctrl+K Ctrl+F)
- Configurable formatting options

### 🔍 Code Analysis
- Structural checks for malformed commands and missing delimiters
- Optional `tclsh` command-completeness checks that do not execute document code
- Separate style linting with configurable rule severity and next-line suppression
- Quick fixes for supported expression-bracing and `catch` result-variable cases

### 🐛 Debugging
- Breakpoints (including conditional breakpoints and logpoints)
- Step in, over, and out; frame-aware locals/globals, array inspection, variable editing, and watches
- Authenticated attach to the bundled server locally or through an SSH tunnel
- Optional debugging of newly created Tcl Thread workers in launch sessions
- Separate REPL and run commands for interactive or task-based execution

### 🧪 Testing
- Test discovery and execution
- Test results in Test Explorer
- Native VS Code command coverage, source decorations, and HTML/JSON reports
- Matching selected-case behavior for Run, Debug, and Coverage, with cancellation

### 🔧 Refactoring
- Rename symbols (F2)
- Extract procedure
- Extract variable
- Inline variable
- Inline procedure
- Extract to namespace

## Basic Usage

### Working with TCL Files

#### Creating and Opening Files
The extension supports these file types:
- `.tcl` - Standard TCL scripts
- `.tk` - Tk GUI scripts
- `.tm` - TCL modules
- `.test` - Test files

#### Code Completion
1. Start typing a command name
2. Press Ctrl+Space to trigger completion
3. Use arrow keys to navigate suggestions
4. Press Tab or Enter to accept

Example:
```tcl
# Type 'pu' and press Ctrl+Space
puts "Hello World"  # Auto-completes to 'puts'
```

#### Hover Information
Hover over any TCL command to see:
- Command signature
- Brief description
- Parameter information

#### Code Navigation
- **Go to Definition** (F12): Jump to procedure definitions
- **Peek Definition** (Alt+F12): View definition inline
- **Find All References** (Shift+F12): Find all procedure calls
- **Go to Symbol** (Ctrl+Shift+O): Navigate file symbols

### Using the REPL

#### Starting the REPL
1. Open Command Palette (Ctrl+Shift+P)
2. Run "TCL: Start REPL"
3. A terminal opens using the active folder’s selected interpreter, unless `tcl.repl.tclPath` explicitly overrides it. Its working directory is the workspace folder, or the script’s directory outside a workspace.

Close and restart the REPL to begin a fresh session. Changing folders or interpreter settings also starts a REPL in the new context.

#### REPL Commands
- **Evaluate Selection**: Select code and run "TCL: Evaluate Selection in REPL"
- **Run Current File**: Run "TCL: Run Current File in REPL"

### Signature Help (Parameter Hints)

Type a recognized command and a space to request parameter hints, or run **Trigger Parameter Hints** from the Command Palette. The default shortcut is **Ctrl+Shift+Space** on Windows/Linux and **Shift+Cmd+Space** on macOS.

Hints include built-in commands and resolved workspace procedures. Optional defaults and variadic `args` appear in the signature; multiline calls and command substitutions retain the active argument. No external language server is required.

### Code Formatting

The formatter preserves literal data, comments, and newline style, and formats both argument-form and list-form `switch` bodies. Incomplete syntax is left unchanged. Selection formatting requires complete commands within a known script body and retains their surrounding indentation.


#### Format Entire Document
1. Open a TCL file
2. Press Shift+Alt+F
3. Or run "Format Document" from Command Palette

#### Format Selection
1. Select code to format
2. Press Ctrl+K Ctrl+F
3. Or right-click and select "Format Selection"

#### Configuration Options
Configure formatting in settings:
- `tcl.format.alignBraces`: Align opening and closing braces
- `tcl.format.spacesAroundOperators`: Add spaces around operators
- `tcl.format.spacesInsideBraces`: Add spaces inside braces
- `tcl.format.spacesInsideBrackets`: Add spaces inside brackets

## Advanced Features

### Debugging TCL Scripts

#### Setting Up Debug Configuration
1. Click "Run and Debug" in Activity Bar
2. Click "create a launch.json file"
3. Select "TCL Debug"

Example `launch.json`:
```json
{
    "version": "0.2.0",
    "configurations": [
        {
            "type": "tcl",
            "request": "launch",
            "name": "Launch TCL",
            "program": "${file}",
            "stopOnEntry": true,
            "args": [],
            "cwd": "${workspaceFolder}"
        }
    ]
}
```

#### Using Breakpoints
1. Click in the gutter next to line numbers, or press F9, to set breakpoints on executable commands
2. Right-click a breakpoint to add a condition or log message (logpoint)
3. Run debug configuration (F5)
4. Use debug controls to step through code and select a Call Stack frame to inspect its variables

See [Debugging Tcl](DEBUGGING.md) for attach, source mapping, Thread workers, and runtime limits.

### Testing

#### Running and Debugging Selected Tests

1. Open Test Explorer in the Activity Bar. Use Refresh to rescan when needed.
2. Expand a file to see literal `tcltest` declarations or `test_*` procedures. Imported `test` commands and namespace-qualified procedure tests are supported; comments and literal data are ignored.
3. Choose a case, a file, or all tests, then use **Run TCL Tests**, **Debug TCL Tests**, or **Coverage TCL Tests**. All three profiles respect the same selection and exclusions.

Run/Debug CodeLens actions above discovered tests target the same cases. Dirty test files are saved before execution; a cancelled save skips the case. For debugging, place breakpoints in the original test or implementation source. Procedure tests enter their selected bodies rather than only loading their definitions. Stop cancels the active test process or owned debug session, and subsequent runs can start normally.

Use `tcl.test.tclPath` for an explicit testing interpreter override. When unset, all three profiles use the test file’s project interpreter.

#### Code Coverage

1. Choose **Coverage TCL Tests** for the selected cases in Test Explorer, or run **TCL: Generate Test Coverage** for discovered tests.
2. Inspect native VS Code coverage totals and the extension’s editor decorations.
3. Run **TCL: Export Coverage Report** for HTML or JSON, or **TCL: Clear Coverage Data** to remove the displayed results.

Coverage runs selected test entry points and records their loaded source files. It does not independently launch ordinary application scripts. Assertion failures retain completed coverage reports, and overlapping runs keep their own native totals. Coverage records commands with original source locations and includes unvisited branches. Dynamically generated code without source locations and nested procedure bodies whose declarations never execute may be omitted from totals.

### Refactoring

#### Rename Symbol (F2)
1. Place cursor on a procedure or variable name
2. Press F2
3. Type new name and press Enter
4. Resolved declarations and references are updated across analyzed workspace files

Procedures, variables, namespaces, classes, and methods are supported when their bindings can be resolved. Built-in commands and dynamic or ambiguous bindings cannot be renamed.

#### Extract Procedure
1. Select code block
2. Right-click → "Refactor" → "Extract Procedure"
3. Enter procedure name
4. Code is extracted to new procedure

#### Extract Variable
1. Select expression
2. Right-click → "Refactor" → "Extract Variable"
3. Enter variable name
4. Expression is assigned to variable

#### Inline Procedure
1. Place cursor on a procedure call
2. Run "TCL: Inline Procedure"
3. The call is replaced with a Tcl lambda that preserves arguments, local variables, and return behavior (Tcl 8.5+).

#### Extract to Namespace
1. Select complete supported procedure definitions
2. Run "TCL: Extract to Namespace"
3. Enter a namespace name
4. Definitions move into `namespace eval`, and resolved callers are updated

Refactoring commands preserve literal values and decline cases whose scope or evaluation behavior cannot be safely represented. Inline Procedure uses `apply`, which requires Tcl 8.5+.

### Running Scripts

Use **TCL: Run with Interpreter...** to choose an interpreter for one invocation, or **TCL: Run with Arguments...** to run with the project interpreter. Both save the file first and execute a process task; a cancelled or failed save prevents launch.

The argument prompt accepts a JSON array for exact argument values:

```json
["input with spaces.txt", "", "日本語"]
```

Quoted arguments such as `one "two three" ""` are also accepted. Shell substitutions and glob patterns remain literal arguments. Configure `tcl.run.args`, `tcl.run.cwd`, and `tcl.run.env` for defaults; enable `tcl.run.rememberArgs` to save entered arguments to the active folder’s settings. The default working directory is the source file’s workspace folder, or its directory outside a workspace. A cwd override can use `${workspaceFolder}` or `${fileDirname}`.

### Project Management

#### Creating a Project or Package

Run **TCL: New Project**, select Basic TCL Application, Tk GUI Application, TCL Package, Test Suite, or Web Server, then choose a location and project name. The generated project uses that name. Package templates include a matching package index and runnable `run_tests.tcl`/`build.tcl` entry points.

**TCL: Create Package** asks for a package name and version and creates it beneath the active workspace folder. Both creation commands require a new or empty destination and preserve existing files. For generated packages, the source, namespace, tests, index, and documentation use matching names; hyphens in project names become underscores in Tcl namespaces.

#### Managing Interpreters

1. Open a file in the project to configure.
2. Run **TCL: Select Interpreter** and choose a discovered interpreter.
3. Use **TCL: Add Custom Interpreter** if the executable is elsewhere.

Selection applies to the active workspace folder, or to user settings when no folder is open. Each folder in a workspace can use a different `tcl.interpreter.path`. Explicit REPL/test settings and debug/task executable overrides still take precedence. Settings changes take effect without reloading the extension.

#### Packages and Dependencies

With `tcl.packages.autoDiscovery` enabled, the extension lazily catalogs package indexes, workspace package metadata, and discoverable modules for the selected interpreter. Package names appear in completion after `package require`, including multiple registrations from one index. Run **TCL: Update Package Index** to force a refresh; explicit refresh/install/update actions remain available when automatic discovery is disabled.

Dependency scanning understands static Tcl requirements, including exact and range constraints:

```tcl
package require Example 1.0
package require -exact ExactPackage 2.3
package require RangePackage 1.0-2.0
```

Tcl compatibility rules apply: a numerically larger major version does not automatically satisfy a requirement. All requirements for a package in one folder must agree. Dynamic requirements such as `package require $name` remain unknown; conflicts and source locations appear in **TCL: Create Dependency Report**.

Use **TCL: Install Dependencies** to install missing or incompatible dependencies, and **TCL: Update Dependencies** to look for newer compatible versions from available sources. With `teacup` available, installation uses it. Otherwise, select a local package directory or a `.tar`, `.tar.gz`, or `.tgz` archive containing the declared package and a working index. Manual installation requires a writable destination on the selected interpreter’s `auto_path`; `tcl.packages.installDirectory` can choose that destination in advance. Existing destinations are preserved, and successful installation must pass an interpreter load check.

The local archive reader accepts regular files and directories in ustar-compatible archives. Links, special entries, and PAX extensions are unsupported; archives are limited to 64 MiB and 128 MiB after decompression. For other archive formats, extract the package yourself and select its directory.

#### Build and Test Tasks

Use VS Code’s **Tasks: Run Task** or **Tasks: Run Build Task** directly. Tcl tasks are discovered for each workspace folder, including available `build.tcl`, `run_tests.tcl`, Makefile, and package actions. The Install Dependencies task uses the same installer as the command palette. Package archiving requires the system `tar` command.

Custom `type: "tcl"` tasks support `script` or `command`, argument arrays, `cwd`, `env`, and an optional `interpreter` override. The `$tcl` problem matcher links Tcl errors to source locations. See [Run Settings and Tasks](CONFIGURATION.md#run-settings-and-tasks) for a complete `tasks.json` example.

## Tips and Tricks

### Productivity Tips

1. **Quick Command Access**: Type "TCL:" in Command Palette to see all TCL commands

2. **Code Snippets**: Use these built-in snippets:
   - `proc` → Procedure definition
   - `if` → If statement
   - `foreach` → Foreach loop
   - `while` → While loop
   - `switch` → Switch statement

3. **Multi-cursor Editing**: Hold Alt and click to add multiple cursors

4. **Symbol Search**: Press Ctrl+T to search symbols across workspace

### Performance Tips

1. **Disable Unused Features**: 
   - Set `tcl.diagnostics.enable: false` if not needed
   - Set `tcl.diagnostics.useTclsh: false` for faster editing

2. **Workspace Settings**: Create `.vscode/settings.json` for project-specific settings

3. **Exclude Large Directories**: Add to settings:
   ```json
   "tcl.analysis.exclude": [
       "**/node_modules/**",
       "**/.git/**",
       "**/large_data/**"
   ]
   ```

### Common Patterns

#### Error Handling
```tcl
if {[catch {
    # Your code here
    set result [some_operation]
} err]} {
    puts "Error: $err"
} else {
    puts "Success: $result"
}
```

#### Namespace Best Practices
```tcl
namespace eval myapp {
    variable version 1.0
    
    proc init {} {
        variable version
        puts "MyApp version $version"
    }
}
```

#### Package Structure
```tcl
# mypackage.tcl
package provide mypackage 1.0

namespace eval ::mypackage {
    # Package implementation
}
```

### Keyboard Shortcuts

| Action | Windows/Linux | macOS |
|--------|--------------|-------|
| Trigger IntelliSense | Ctrl+Space | Ctrl+Space |
| Parameter Hints | Ctrl+Shift+Space | Shift+Cmd+Space |
| Go to Definition | F12 | F12 |
| Find References | Shift+F12 | Shift+F12 |
| Rename Symbol | F2 | F2 |
| Format Document | Shift+Alt+F | Shift+Option+F |
| Quick Fix | Ctrl+. | Cmd+. |
| Toggle Comment | Ctrl+/ | Cmd+/ |
| Command Palette | Ctrl+Shift+P | Cmd+Shift+P |

### Integration with Other Tools

#### Using with Tcllib
1. Install Tcllib on your system
2. Ensure the selected interpreter can find Tcllib, then use **TCL: Update Package Index** if needed
3. Package-name completion includes discovered Tcllib packages

#### Using with Tk
- Highlighting and metadata completion for recognized Tk commands
- Tk widget and layout snippets prefixed with `tk`
- Running GUI scripts requires an interpreter with Tk and a graphical display; arbitrary widget-instance options and methods are not inferred

#### Using with Expect
- Syntax highlighting for Expect commands
- Auto-completion for `spawn`, `expect`, `send`

### Best Practices

1. **Use Consistent Indentation**: Enable format on save:
   ```json
   "tcl.format.enable": true
   ```

2. **Document Your Code**: Use comments before procedures:
   ```tcl
   # Calculate the factorial of a number
   # Arguments:
   #   n - positive integer
   # Returns:
   #   factorial of n
   proc factorial {n} {
       if {$n <= 1} {
           return 1
       }
       return [expr {$n * [factorial [expr {$n - 1}]]}]
   }
   ```

3. **Organize with Namespaces**: Group related procedures:
   ```tcl
   namespace eval math {
       proc add {a b} {
           return [expr {$a + $b}]
       }
       
       proc multiply {a b} {
           return [expr {$a * $b}]
       }
   }
   ```

4. **Use Source Control**: The extension works great with Git
   - `.tcl` files are text-based and diff-friendly
   - Use `.gitignore` for generated files

5. **Test Your Code**: Create test files with `.test` extension
   ```tcl
   # math.test
   package require tcltest
   namespace import ::tcltest::*
   source [file join [file dirname [info script]] math.tcl]
   
   test math-add-1 {Test addition} {
       math::add 2 3
   } 5
   ```

## Next Steps

- Read the [Configuration Reference](CONFIGURATION.md) for detailed settings
- Check the [FAQ](FAQ.md) for common questions
- Report issues on [GitHub](https://github.com/AmosAnderson/tcl_vscode/issues)
- Contribute to the project - see [Contributing Guide](../CONTRIBUTING.md)
