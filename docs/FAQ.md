# TCL Language Support - FAQ & Troubleshooting

This document describes TCL Syntax **0.8.0**. See the [user guide](USER_GUIDE.md), [configuration reference](CONFIGURATION.md), and [debugging guide](DEBUGGING.md) for complete examples.

## Installation and setup

### Which VS Code and Tcl versions do I need?

VS Code **1.136.0** or newer is required. Node.js **22.12+** is needed only when building the extension from source.

Interpreter discovery recognizes Tcl **8.4 through 9.0**. Debugging, coverage, and Inline Procedure require **Tcl 8.5+**. Static editing features do not require an interpreter. TclOO, Tk, Expect, and Thread programs also require the corresponding capabilities in the interpreter used to execute them. Interpreter discovery does not imply that every feature has been runtime-tested on every Tcl version and platform.

### How do I install version 0.8.0?

Download `tcl-syntax-0.8.0.vsix` from [GitHub Releases](https://github.com/AmosAnderson/tcl_vscode/releases), then run **Extensions: Install from VSIX...** in VS Code. Marketplace publication is separate from the GitHub release workflow; the Marketplace version may differ.

### The extension does not activate. What should I check?

1. Check **Help → About** for a supported VS Code version.
2. Open a `.tcl`, `.tk`, `.tm`, or `.test` file and check that its language mode is **TCL**.
3. Ensure **TCL Syntax** is enabled in the Extensions view.
4. Run **Developer: Reload Window**.
5. For a development checkout, run `npm ci` and `npm run compile`, then use the **Run Extension** launch configuration.
6. Inspect **Developer: Show Logs... → Extension Host** for activation errors.

### How do I choose an interpreter for each project?

Open a file in the project and run **TCL: Select Interpreter**, or configure its `.vscode/settings.json`:

```json
{
    "tcl.interpreter.path": "/path/to/tclsh"
}
```

Each workspace folder can have its own interpreter. Use **TCL: Add Custom Interpreter** if the executable is outside the discovered locations. Explicit `tcl.repl.tclPath`, `tcl.test.tclPath`, launch `tclPath`, or task `interpreter` values override the project selection for their feature. An unset feature setting does not mask the project interpreter despite its displayed `tclsh` default.

### What does “Cannot find TCL interpreter” mean?

The executable is unavailable to the VS Code process. Verify the path by running it in a terminal, then configure `tcl.interpreter.path` with its absolute path. Windows paths in JSON must escape backslashes, for example `"C:\\Tcl\\bin\\tclsh.exe"`. If an executable works in your shell but not VS Code, compare their `PATH` environments or use an absolute path.

## Editing and language features

### Why are my custom procedures missing from IntelliSense or navigation?

The extension indexes supported Tcl files across workspace folders and overlays unsaved editor contents. Check that:

- The declaration uses a statically readable `proc`, namespace, or supported TclOO form.
- The file is in the workspace and is not excluded by `tcl.analysis.exclude` or an unconditional `files.exclude` entry.
- The call's spelling and case agree with the declaration. Resolution understands literal namespace imports, exports, and paths.
- The declaration can be found with **Go to Symbol in Workspace**.

Dynamically constructed commands, aliases, and ambiguous object receivers cannot always be resolved. Opening a file is not required for ordinary workspace indexing. Reloading the window triggers a new scan if the index appears stale.

### How do I trigger completion or parameter hints?

Use **Trigger Suggest** from the Command Palette, or **Ctrl+Space** on Windows, Linux, and macOS. On macOS, **Cmd+Space** usually opens Spotlight.

For signatures, keep `editor.parameterHints.enabled` enabled and run **Trigger Parameter Hints** inside a recognized call. Default shortcuts are **Ctrl+Shift+Space** on Windows/Linux and **Shift+Cmd+Space** on macOS. Signatures include built-in commands and resolved user procedures, optional defaults, variadic arguments, and multiline active-argument positions.

### Does the extension support Tk, Expect, and Tcllib?

Tk and Expect command metadata, syntax highlighting, and snippets are included. The extension does not infer every arbitrary widget instance's methods or options. Running these scripts still requires an interpreter with the relevant package and, for Tk, a graphical display.

Package-name completion includes Tcllib and other packages discoverable by the selected interpreter or workspace package catalog. Discovery supplies package names and versions, not every package's exported commands.

### Which symbols can I rename or refactor?

Rename supports resolved procedures, variables, namespaces, TclOO classes, and methods. Built-in commands are protected. Extract Procedure, Extract Variable, Inline Variable, Inline Procedure, and Extract to Namespace are available through **TCL:** commands or applicable refactor actions.

Refactoring preserves literal values and declines dynamic or ambiguous cases when it cannot establish binding or evaluation behavior. Inline Procedure uses a Tcl lambda and requires Tcl 8.5+. Extract to Namespace expects complete supported procedure definitions and updates their resolved callers.

### Why does formatting leave a selection unchanged?

Selection formatting requires complete commands inside a known script body. Partial commands, literal data, and incomplete or malformed syntax are left unchanged. Document formatting preserves string/list/regex values and comments, and understands both argument-form and list-form `switch` bodies.

If another formatter is selected, use **Format Document With...** and choose **TCL Formatter (Built-in)**. Indentation follows the editor's tab size and spaces/tabs settings. Enable the extension's save formatting with `"tcl.format.enable": true`, or use VS Code's language-scoped `editor.formatOnSave` setting.

### Why are some errors not reported while I type?

Diagnostics check structure and known script bodies. Optional interpreter validation calls `info complete` on document data; it does not source or evaluate the document. Undefined variables, missing runtime packages, unknown commands, and invalid argument values may therefore appear only when the program runs.

For a false positive, reduce it to a small example and include the exact diagnostic source and message in an issue. Style diagnostics come from the separate `tcl-lint` collection. Use `tcl.lint.rules` to change a rule's severity or disable it, for example:

```json
{
    "tcl.lint.rules": {
        "line-length": "information",
        "catch-no-var": "off"
    }
}
```

A comment such as `# tcl-lint-disable-next-line expr-bracing` suppresses that rule on the next line. Disabling `tcl.diagnostics.useTclsh` leaves static syntax checks active.

### Why do procedure counts or test actions not appear above my code?

Ensure `editor.codeLens`, `tcl.codeLens.enable`, and the relevant `tcl.codeLens.references` or `tcl.codeLens.tests` setting are enabled. Procedure counts use resolved workspace references. Test actions appear above discovered test declarations; **Run Test** and **Debug Test** target that case.

## Running and debugging

### The REPL will not start, or has stale variables. What should I do?

Check the selected interpreter and any explicit `tcl.repl.tclPath` override. Run **TCL: Start REPL**. Closing its terminal and starting it again creates a fresh session; changing the interpreter or workspace-folder context also starts a REPL in that context. The working directory is the active file's workspace folder, or its directory outside a workspace.

**TCL: Evaluate Selection in REPL** evaluates the selection. **TCL: Run Current File in REPL** sources the active file. Both execute user code in the interactive session.

### How do I run a script with spaces or empty arguments?

Use **TCL: Run with Arguments...** and enter a JSON array:

```json
["input with spaces.txt", "", "日本語"]
```

Quoted argument syntax is also accepted. Arguments are passed directly to a process task; shell substitutions and glob patterns stay literal. Configure `tcl.run.args`, `tcl.run.cwd`, and `tcl.run.env` for defaults. **TCL: Run with Interpreter...** selects an interpreter for one run. The file is saved before these run commands launch; a failed or cancelled save prevents execution.

### The debugger exits immediately or does not stop at my breakpoint.

Check the script path and interpreter, and use `"stopOnEntry": true` in the launch configuration. Put the breakpoint on an executable Tcl command using the gutter or F9. A script that only declares procedures may finish without entering their bodies. Dynamically generated code may lack an original source location.

Use **Debug TCL Tests** when debugging a selected test so its body is invoked. Check the Debug Console for launch errors. See [Debugging Tcl](DEBUGGING.md) for launch configuration, stepping, selected-frame variables, arrays, watches, conditional breakpoints, and logpoints.

### Can I attach to an existing process or debug threads?

Attach connects to a process started using the matching bundled `debugServer.tcl` and an authentication token; it cannot inject into an arbitrary existing `tclsh`. Remote targets use a loopback SSH tunnel with optional `sourceFileMap` mappings. Disconnect detaches and lets the target continue.

Set `"debugThreads": true` in a launch configuration to discover newly created `thread::create` workers. Tcl's `Thread` package must be loadable. Attach-mode workers and preexisting thread pools are not adopted. Pause-on-error, data breakpoints, reverse execution, and an interactive input terminal for launched debug programs are not implemented.

## Tests, coverage, packages, and tasks

### Why are tests missing from the Testing view?

Discovery scans `.tcl`, `.tk`, `.tm`, and `.test` files. It recognizes literal `tcltest::test` declarations, imported `test` commands after `namespace import ::tcltest::*` or `::tcltest::test`, and procedure names whose last namespace component starts with `test_`. Comments and literal data are ignored; dynamically generated declarations inside procedures are not discovered.

Save the file and refresh the Testing view if needed. Check **TCL Tests** in the Output panel for discovery errors. A file need not use the `.test` extension to contain tests.

### Does selecting one test run the whole file?

**Run TCL Tests**, **Debug TCL Tests**, and **Coverage TCL Tests** share the same case selection and exclusions. Selecting a case runs that case's body. Loading the test file still executes its top-level setup code. File or workspace selections include their discovered cases. Dirty test files are saved first, and stopping a run cancels its owned process or debug session.

### What does the coverage percentage measure?

Coverage records Tcl command execution with source locations for selected tests and their loaded sources. It is command/statement coverage, not branch coverage. Native VS Code coverage totals, source decorations, and **TCL: Export Coverage Report** show the recorded results. The export supports HTML and JSON; **TCL: Clear Coverage Data** removes displayed coverage.

Assertion failures retain completed coverage reports. Dynamically generated code without source locations and nested procedure bodies whose declarations never execute may be omitted from totals. Ordinary application scripts are not launched independently to collect test coverage.

### Why is a package unavailable or an update not offered?

Check the active folder's interpreter and its package search paths. Use **TCL: Update Package Index** or **TCL: Refresh Dependencies** to refresh discovery, and **TCL: Create Dependency Report** to see requirements, source locations, conflicts, and unknown dynamic requirements.

Compatibility uses Tcl version rules, including exact and range constraints. A larger major version does not automatically satisfy a requirement. Installation uses `teacup` when available; otherwise it prompts for a local package directory or supported `.tar`, `.tar.gz`, or `.tgz` archive. There is no universal remote package registry. The installer preserves existing destinations and verifies the requested package/version with the selected interpreter. See [Package Settings](CONFIGURATION.md#package-settings) for archive and destination limits.

### How do Tcl tasks differ from Test Explorer?

Native tasks are available through **Tasks: Run Task** as soon as the extension activates. A `type: "tcl"` task uses a script or a supported package action, with optional interpreter, arguments, working directory, and environment. The `run_tests` action executes the project's `run_tests.tcl`; Test Explorer discovers and selects individual test cases. The `$tcl` problem matcher links Tcl source errors to the editor. See [Run Settings and Tasks](CONFIGURATION.md#run-settings-and-tasks).

## Performance and logs

### How do I reduce analysis work in a large workspace?

Exclude generated or vendor sources from semantic analysis:

```json
{
    "tcl.analysis.exclude": [
        "**/node_modules/**",
        "**/.git/**",
        "**/generated/**",
        "**/vendor/**"
    ]
}
```

Custom arrays replace the defaults. Package and test discovery have their own scope. To reduce background interpreter work, increase `tcl.diagnostics.debounceMs`, disable `tcl.diagnostics.useTclsh`, or disable automatic package discovery with `tcl.packages.autoDiscovery`.

### Where are the logs, and what should I include in a bug report?

Use the Debug Console for debugger messages and the **TCL Diagnostics**, **TCL Tests**, **TCL Interpreter**, and **TCL Package Manager** Output channels for the relevant feature. Some channels appear only after that feature runs. For extension-host errors, use **Developer: Show Logs... → Extension Host**.

Report issues on [GitHub](https://github.com/AmosAnderson/tcl_vscode/issues) with:

- Extension version and VS Code version from Help → About.
- Tcl version (`puts [info patchlevel]`), interpreter path, and operating system.
- Exact command or UI action, expected result, and actual result.
- Relevant settings, diagnostic/log messages, and a minimal Tcl example.

The [Insiders UI test report](INSIDERS_UI_TEST_REPORT.md) records tested workflows and remaining coverage limits. Static analysis cannot fully model runtime `eval`, `uplevel`, generated definitions, or arbitrary dynamic TclOO dispatch. Refactorings decline unsupported cases instead of guessing their bindings.
