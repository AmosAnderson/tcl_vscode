# TCL Language Support - User Guide

## Table of Contents
1. [Getting Started](#getting-started)
2. [Features Overview](#features-overview)
3. [Basic Usage](#basic-usage)
4. [Advanced Features](#advanced-features)
5. [Tips and Tricks](#tips-and-tricks)

## Getting Started

### Requirements
- Visual Studio Code **1.106.1** or higher
- Node.js **18 LTS** (only required for local development workflows such as cloning and running `npm install`)
- A TCL interpreter (`tclsh`) on your PATH for diagnostics, REPL, and testing commands

### Installation
1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X / Cmd+Shift+X)
3. Search for "TCL Syntax"
4. Click Install

### First Steps
After installation, the extension automatically activates when you open any TCL file (`.tcl`, `.tk`, `.tm`, `.test`).

### Quick Start
1. Create a new file with `.tcl` extension
2. Start typing TCL code - notice the syntax highlighting
3. Press Ctrl+Space for code completion
4. Use Ctrl+Shift+P to access TCL commands

## Features Overview

### 🎨 Syntax Highlighting
- Complete TCL language support
- Namespace and package highlighting
- Tk widget commands
- Expect commands
- String interpolation and escape sequences

### ✨ IntelliSense
- **Auto-completion**: 250+ built-in TCL commands with signatures
- **Hover Information**: Command documentation and variable values
- **Signature Help**: Parameter hints while typing, with active-argument highlighting
- **Go to Definition**: Navigate to procedure definitions (F12)
- **Find References**: Find all usages of procedures (Shift+F12)

### 📝 Code Formatting
- Format entire document (Shift+Alt+F)
- Format selection (Ctrl+K Ctrl+F)
- Configurable formatting options

### 🔍 Code Analysis
- Real-time syntax checking
- Integration with `tclsh` for validation
- Quick fixes for common issues

### 🐛 Debugging
- Breakpoints and stepping
- Variable inspection
- Call stack navigation
- Integrated REPL

### 🧪 Testing
- Test discovery and execution
- Test results in Test Explorer
- Code coverage analysis

### 🔧 Refactoring
- Rename symbols (F2)
- Extract procedure
- Extract variable
- Inline variable

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
3. A terminal opens with `tclsh` running

#### REPL Commands
- **Evaluate Selection**: Select code and run "TCL: Evaluate Selection in REPL"
- **Run Current File**: Run "TCL: Run Current File in REPL"

### Code Formatting
### Signature Help (Parameter Hints)

Signature Help appears automatically after you type a command name and the opening brace/space for its arguments. To use it effectively:

1. Begin typing a TCL command such as `string` or `file` and insert a space.
2. The parameter list pops up showing the active argument position. Use `Tab` or arrow keys to keep typing without dismissing the hint.
3. Press `Ctrl+Shift+Space` to re-open Signature Help if it closes while you edit.
4. The feature relies on the built-in command database that ships with the extension, so no external language server is required.


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
1. Click in the gutter next to line numbers to set breakpoints
2. Run debug configuration (F5)
3. Use debug controls to step through code

### Testing

#### Running Tests
1. Open Test Explorer in Activity Bar
2. TCL test files are automatically discovered
3. Click play button to run tests

#### Code Coverage
1. Run "TCL: Generate Test Coverage"
2. Coverage indicators appear in the editor
3. Run "TCL: Export Coverage Report" for detailed report

### Refactoring

#### Rename Symbol (F2)
1. Place cursor on a procedure or variable name
2. Press F2
3. Type new name and press Enter
4. All references are updated

Note: Built-in TCL commands cannot be renamed.

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

### Project Management

#### Creating a New Project
1. Run "TCL: New Project"
2. Select project template:
   - Basic TCL Application
   - Tk GUI Application
   - TCL Package
   - Test Suite
   - Web Server
3. Choose location and project name

#### Managing Interpreters
1. Run "TCL: Select Interpreter"
2. Choose from discovered interpreters
3. Or run "TCL: Add Custom Interpreter" to add custom path

#### Package Management
- **Create Package**: Run "TCL: Create Package"
- **Update Index**: Run "TCL: Update Package Index"
- **Install Dependencies**: Run "TCL: Install Dependencies"

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
   "files.exclude": {
       "**/large_data": true
   }
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
| Trigger IntelliSense | Ctrl+Space | Cmd+Space |
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
2. Extension automatically discovers Tcllib packages
3. Auto-completion includes Tcllib commands

#### Using with Tk
- Full support for Tk widget commands
- Syntax highlighting for widget options
- Auto-completion for widget methods

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
   source math.tcl
   
   test math-add-1 {Test addition} {
       math::add 2 3
   } 5
   ```

## Next Steps

- Read the [Configuration Reference](CONFIGURATION.md) for detailed settings
- Check the [FAQ](FAQ.md) for common questions
- Report issues on [GitHub](https://github.com/AmosAnderson/tcl_vscode/issues)
- Contribute to the project - see [Contributing Guide](CONTRIBUTING.md)