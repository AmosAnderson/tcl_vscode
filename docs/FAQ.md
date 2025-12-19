# TCL Language Support - FAQ & Troubleshooting

## Table of Contents
1. [Frequently Asked Questions](#frequently-asked-questions)
2. [Troubleshooting Guide](#troubleshooting-guide)
3. [Common Issues](#common-issues)
4. [Performance Issues](#performance-issues)
5. [Getting Help](#getting-help)

## Frequently Asked Questions

### General Questions

**Q: What versions of TCL are supported?**
A: The extension supports TCL versions **8.4 through 9.0**. It's tested primarily with TCL 8.5 and 8.6, which are the most common versions. Interpreters outside this range can be configured manually, but some features may not function correctly.

**Q: Does this extension support Tk?**
A: Yes! The extension provides full support for Tk including:
- Syntax highlighting for Tk commands
- Auto-completion for widget commands
- Widget option completion

**Q: Can I use this with Expect scripts?**
A: Yes, Expect commands are fully supported with syntax highlighting and auto-completion for commands like `spawn`, `expect`, `send`, and `interact`.

**Q: Is there support for Tcllib packages?**
A: Yes, if Tcllib is installed on your system, the extension will discover and provide auto-completion for Tcllib packages.

### Installation & Setup

**Q: The extension doesn't activate. What should I check?**
A: 
1. Ensure your file has a supported extension (`.tcl`, `.tk`, `.tm`, `.test`)
2. Verify VS Code is **1.106.1 or newer** (Help → About)
3. Look for errors in Output panel → "TCL Language Support"
4. Try reloading VS Code window (Ctrl+Shift+P → "Developer: Reload Window")
5. If you just cloned the repo for local development, run `npm install` once so the VS Code APIs resolve

**Q: How do I configure the TCL interpreter path?**
A: Set the path in settings:
```json
"tcl.interpreter.path": "/path/to/tclsh"
```
Or use the command "TCL: Select Interpreter" to choose from discovered interpreters.

**Q: Can I use different TCL versions for different projects?**
A: Yes! Create a `.vscode/settings.json` in your project with:
```json
{
    "tcl.interpreter.path": "/path/to/project-specific/tclsh"
}
```

### Features

**Q: Why doesn't IntelliSense show my custom procedures?**
A: IntelliSense discovers procedures in:
- The current file (updated as you type)
- All open TCL files in the workspace
- Files that have been analyzed since opening the workspace

To improve discovery:
1. Ensure procedures use standard `proc` syntax
2. Save files after defining procedures
3. Use "Go to Symbol in Workspace" (Ctrl+T) to verify discovery

**Q: Can I rename built-in TCL commands?**
A: No, built-in commands like `set`, `puts`, `if`, etc. are protected from renaming to prevent breaking TCL scripts. You can only rename user-defined procedures and variables.

**Q: How do I enable format on save?**
A: Add to your settings:
```json
"tcl.format.enable": true
```

**Q: Why isn't the debugger working?**
A: The debugger requires:
1. A `launch.json` configuration (see User Guide)
2. TCL interpreter that supports debugging
3. The file must be saved before debugging

**Q: Signature Help / parameter hints are missing. How do I enable them?**
A: Signature Help now ships with the extension. Make sure:
1. `editor.parameterHints.enabled` is `true` (default)
2. You trigger it manually with `Ctrl+Shift+Space` inside a command call to verify it loads
3. The first token on the line is a TCL command recognized by the built-in data

### REPL Questions

**Q: The REPL won't start. What's wrong?**
A: Check:
1. `tclsh` is in your PATH or configure `tcl.repl.tclPath`
2. Try running `tclsh` directly in terminal
3. On Windows, ensure `.exe` extension is included

**Q: Can I use a custom TCL shell for the REPL?**
A: Yes, configure:
```json
"tcl.repl.tclPath": "/path/to/custom/tclsh"
```

## Troubleshooting Guide

### Extension Not Working

#### Symptoms
- No syntax highlighting
- No IntelliSense
- Commands not available

#### Solutions
1. **Check activation**:
   - Open a `.tcl` file
   - Check Extensions view → TCL Syntax shows as activated
   
2. **Check for errors**:
   - View → Output → Select "TCL Language Support"
   - Look for error messages
   
3. **Verify installation**:
   ```
   code --list-extensions | grep tcl-syntax
   ```
   
4. **Reinstall extension**:
   - Uninstall TCL Syntax extension
   - Restart VS Code
   - Install again

### IntelliSense Issues

#### Auto-completion Not Working

**Problem**: No suggestions appear when typing

**Solutions**:
1. Ensure file is saved with `.tcl` extension
2. Trigger manually with Ctrl+Space
3. Check settings:
   ```json
   "editor.quickSuggestions": {
       "other": true,
       "comments": false,
       "strings": true
   }
   ```

#### Wrong or Missing Suggestions

**Problem**: IntelliSense shows incorrect commands

**Solutions**:
1. Clear IntelliSense cache:
   - Restart VS Code
   - Or reload window (Ctrl+Shift+P → "Developer: Reload Window")
   
2. Check for conflicting extensions
3. Ensure TCL file syntax is valid

### Formatting Issues

#### Formatter Not Working

**Problem**: Format command does nothing

**Solutions**:
1. Check for syntax errors (formatter won't run on invalid syntax)
2. Try selecting specific text and formatting selection
3. Check formatter settings are not all disabled

#### Unexpected Formatting

**Problem**: Code formatted differently than expected

**Solutions**:
Review formatting settings:
```json
{
    "tcl.format.alignBraces": true,  // or false
    "tcl.format.spacesAroundOperators": true,  // or false
    "tcl.format.spacesInsideBraces": true,  // or false
    "tcl.format.spacesInsideBrackets": false  // or true
}
```

### Diagnostics Issues

#### False Positive Errors

**Problem**: Valid TCL code marked as error

**Solutions**:
1. Disable tclsh validation if using TCL extensions:
   ```json
   "tcl.diagnostics.useTclsh": false
   ```
   
2. Or disable diagnostics entirely:
   ```json
   "tcl.diagnostics.enable": false
   ```

#### No Error Detection

**Problem**: Obvious errors not detected

**Solutions**:
1. Enable diagnostics:
   ```json
   "tcl.diagnostics.enable": true
   ```
   
2. Ensure `tclsh` is available:
   ```bash
   which tclsh  # Unix/macOS
   where tclsh  # Windows
   ```

## Common Issues

### Issue: "Cannot find TCL interpreter"

**Solution**:
1. Install TCL:
   - **Windows**: Download from ActiveState or Magicsplat
   - **macOS**: `brew install tcl-tk`
   - **Linux**: `sudo apt-get install tcl` or equivalent

2. Add to PATH or configure explicitly:
   ```json
   "tcl.interpreter.path": "C:\\Tcl\\bin\\tclsh.exe"
   ```

### Issue: "Extension host terminated unexpectedly"

**Solution**:
1. Check for conflicting extensions
2. Disable all extensions except TCL Syntax
3. Re-enable extensions one by one to find conflict
4. Report issue with extension IDs that conflict

### Issue: "Go to Definition not working"

**Causes & Solutions**:
1. **Procedure in different file**: Ensure file is open or in workspace
2. **Namespace procedures**: Use fully qualified names
3. **Dynamic procedures**: Static analysis cannot resolve `eval` or dynamic proc creation

### Issue: "Debugger immediately exits"

**Solutions**:
1. Add `stopOnEntry: true` to launch configuration
2. Ensure script has executable code (not just proc definitions)
3. Check script for early `exit` commands
4. Verify script path is correct

### Issue: "Test discovery not finding tests"

**Solutions**:
1. Ensure test files use `.test` extension
2. Or use standard test commands (`test`, `tcltest::test`)
3. Save test files
4. Refresh test explorer

## Performance Issues

### Slow Extension Startup

**Solutions**:
1. Reduce workspace size (exclude unnecessary folders)
2. Disable auto-discovery:
   ```json
   "tcl.packages.autoDiscovery": false
   ```

### High CPU Usage

**Solutions**:
1. Disable real-time diagnostics:
   ```json
   "tcl.diagnostics.enable": false
   ```
   
2. Exclude large directories:
   ```json
   "files.watcherExclude": {
       "**/large_data": true,
       "**/temp": true
   }
   ```

### Memory Issues

**Solutions**:
1. Close unused files
2. Restart VS Code periodically
3. Limit workspace scope
4. Report issue with memory profile

### Slow IntelliSense

**Solutions**:
1. Reduce workspace size
2. Disable workspace-wide symbol search:
   ```json
   "tcl.enableWorkspaceSymbols": false
   ```
3. Close unnecessary files

## Getting Help

### Before Reporting Issues

1. **Check this FAQ**
2. **Update to latest version**
3. **Try with minimal setup**:
   - Disable other extensions
   - Use simple test file
   - Default settings

### Information to Include

When reporting issues, include:

1. **VS Code version**: Help → About
2. **Extension version**: Extensions → TCL Syntax → version
3. **TCL version**: Run `puts $tcl_version`
4. **Operating System**: Windows/macOS/Linux version
5. **Error messages**: From Output panel
6. **Sample code**: Minimal reproduction
7. **Settings**: Relevant TCL settings

### Where to Get Help

1. **GitHub Issues**: [github.com/AmosAnderson/tcl_vscode/issues](https://github.com/AmosAnderson/tcl_vscode/issues)
2. **VS Code TCL Community**: Search or ask in VS Code forums
3. **TCL Community**: 
   - [TCL Wiki](https://wiki.tcl-lang.org)
   - [TCL Forums](https://core.tcl-lang.org/tcl/forum)

### Reporting Bugs

Good bug report example:
```markdown
**Description**: Auto-completion not working for namespace procedures

**Steps to Reproduce**:
1. Create file with namespace proc
2. Type namespace:: and press Ctrl+Space
3. No suggestions appear

**Expected**: Show procedures in namespace
**Actual**: Empty suggestion list

**Environment**:
- VS Code: 1.85.0
- Extension: 0.0.3
- TCL: 8.6.13
- OS: Ubuntu 22.04

**Sample Code**:
\```tcl
namespace eval myns {
    proc test {} {
        puts "test"
    }
}

myns:: # <-- No completion here
\```
```

### Feature Requests

When requesting features:
1. Check if already requested
2. Explain use case
3. Provide examples
4. Consider contributing!

## Quick Fixes

### Reset All Settings
```json
{
    // In settings.json, remove all tcl.* entries
}
```

### Clean Reinstall
```bash
# Uninstall
code --uninstall-extension amos-anderson.tcl-syntax

# Clear extension data
# Windows: %USERPROFILE%\.vscode\extensions
# macOS/Linux: ~/.vscode/extensions
# Remove any tcl-syntax folders

# Reinstall
code --install-extension amos-anderson.tcl-syntax
```

### Enable Debug Logging
```json
{
    "tcl.debug.enable": true,
    "tcl.debug.logLevel": "verbose"
}
```
Then check Output panel for detailed logs.

## Known Limitations

1. **Dynamic code**: Cannot analyze `eval`, `uplevel`, or dynamically created procedures
2. **Binary files**: `.tm` files in binary format not supported
3. **Large files**: Performance may degrade on files > 10,000 lines
4. **Recursive includes**: Deep source chains may not be fully analyzed
5. **Unicode**: Some Unicode identifiers may not be recognized

These limitations are being addressed in future updates.