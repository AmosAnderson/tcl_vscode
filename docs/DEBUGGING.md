# Debugging Tcl

TCL Syntax **0.8.0** can launch Tcl scripts, attach to an independently started debug server, and debug newly created Tcl Thread workers. Debugging requires Tcl 8.5 or newer. Thread debugging also requires the Tcl `Thread` package in the interpreter used to launch the program.

## Launch a script

Add a configuration to `.vscode/launch.json`, set breakpoints on executable Tcl command lines, and start it from **Run and Debug**:

```json
{
    "version": "0.2.0",
    "configurations": [
        {
            "name": "Launch Tcl",
            "type": "tcl",
            "request": "launch",
            "program": "${workspaceFolder}/main.tcl",
            "cwd": "${workspaceFolder}",
            "args": ["input with spaces.txt", "--verbose"],
            "env": {
                "APP_MODE": "development"
            },
            "stopOnEntry": true
        }
    ]
}
```

Use `"program": "${file}"` to debug the active file. Arguments are individual array elements; an element containing spaces remains one argument. The target receives its normal `argv`, `argc`, and `argv0` values.

| Launch option | Behavior |
| --- | --- |
| `program` | Required script path. |
| `tclPath` | Optional interpreter override. Without it, the extension uses the applicable `tcl.interpreter.path` setting, then `tclsh`. |
| `cwd` | Working directory. A workspace launch defaults to that folder; outside a workspace, the adapter uses the target script's directory. |
| `args` | Arguments passed to the script. Defaults to an empty array. |
| `env` | Environment overrides added to the inherited environment. |
| `stopOnEntry` | Pause before the first traced command. Defaults to `true` for launch. |
| `debugThreads` | Discover newly created Tcl Thread workers. Defaults to `false`. |

Each launch creates its own authentication token and loopback connection. The adapter owns the launched process and terminates it when the launch session is stopped or disconnected.

## Inspect a paused program

The debugger supports line breakpoints through the editor gutter or F9, conditional breakpoints, logpoints, step in/over/out, call stacks, local and global variables, array expansion, and variable editing. Stops distinguish breakpoints, stepping, explicit pause, and entry. A whole-value substitution such as `set sum [expr {$sum + $v}]` is treated as one stop when its scalar assignment follows the traced command; other nested commands and separate commands on a shared line can still produce multiple stops.

Select a frame in **Call Stack** to inspect that procedure's locals. Evaluation and watches use the selected frame. Editing a value in **Global** updates the global variable even when a local has the same name. Array elements retain their frame and scope when expanded or edited.

Debug Console evaluation accepts Tcl code, for example `set count`, `list $name $count`, or `expr {$count + 1}`. Conditional breakpoints use Tcl expressions such as `$count == 3`. Logpoint placeholders also use Tcl expressions: `count = {$count}` prints the current value without pausing.

Inspection references expire when their thread resumes. If a request refers to an expired frame or variable, select a current frame after the next stop. Evaluation and variable editing require a paused thread.

## Attach to a local server

Attach connects to a target started through the supplied `debugServer.tcl`. The independently started process waits for authentication and breakpoint configuration before running the target. Attaching does not inject a debugger into an arbitrary existing `tclsh` process.

Use `out/debug/scripts/debugServer.tcl` from the same extension build as the client. In a development checkout, `npm run compile` copies the server there. Set the working directory before starting the server if the target uses relative paths.

For example, in a POSIX shell with OpenSSL installed:

```sh
cd /path/to/application
export TCL_DEBUG_TOKEN="$(openssl rand -hex 32)"
export TCL_DEBUG_PORT=5678
printf 'Attach token: %s\n' "$TCL_DEBUG_TOKEN"
tclsh /path/to/extension/out/debug/scripts/debugServer.tcl ./main.tcl "input with spaces.txt"
```

Copy the generated token for the attach prompt. Use a fresh random token for each server session. The server requires at least 16 characters and binds to `127.0.0.1`. It prints `DEBUG_PORT:5678` when ready. Omitting `TCL_DEBUG_PORT`, or setting it to `0`, selects an available port; use the printed port in the attach configuration.

This configuration prompts for the token without saving it in `launch.json`:

```json
{
    "version": "0.2.0",
    "configurations": [
        {
            "name": "Attach Tcl",
            "type": "tcl",
            "request": "attach",
            "host": "127.0.0.1",
            "port": 5678,
            "token": "${input:tclDebugToken}",
            "stopOnEntry": false,
            "connectTimeout": 10000
        }
    ],
    "inputs": [
        {
            "id": "tclDebugToken",
            "type": "promptString",
            "description": "Token printed when starting the Tcl debug server",
            "password": true
        }
    ]
}
```

| Attach option | Behavior |
| --- | --- |
| `host` | Loopback address; defaults to `127.0.0.1`. The bundled server listens on IPv4 loopback. |
| `port` | Required port, from 1 through 65535. |
| `token` | Required secret matching the server's `TCL_DEBUG_TOKEN`. |
| `stopOnEntry` | Pause before the first traced command. Defaults to `false` for attach. |
| `sourceFileMap` | Maps target-side source path prefixes to local source path prefixes. Defaults to an empty object. |
| `connectTimeout` | Connection and protocol-request timeout in milliseconds. Defaults to 10000; the adapter bounds the effective value to 100–60000. |

The client and server authenticate with protocol version 1. A mismatched token or protocol version fails the connection. An unsuccessful authentication does not prevent a subsequent valid client from connecting.

Disconnecting an attached session detaches and lets the target continue. An explicit terminate request ends the target. A server accepts one debugging session: after detaching, start a fresh server process to debug again. Ordinary target stdout/stderr stays with the terminal or service that started the server; the attached Debug Console receives debugger messages and logpoints.

## Attach through an SSH tunnel

Start the matching server on the remote machine using the same procedure, for example from `/srv/myapp`, with remote port `5678`. The remote machine needs Tcl and the matching server script. Keep that server bound to loopback.

On the local machine, open a tunnel and leave it running:

```sh
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:5679:127.0.0.1:5678 developer@example-host
```

Use local port `5679` in the attach configuration. For a remote checkout at `/srv/myapp` and a matching local workspace, add:

```json
{
    "name": "Attach Tcl through SSH",
    "type": "tcl",
    "request": "attach",
    "host": "127.0.0.1",
    "port": 5679,
    "token": "${input:tclDebugToken}",
    "sourceFileMap": {
        "/srv/myapp": "${workspaceFolder}"
    }
}
```

Add this entry to the previous example's `configurations` array and retain its `inputs` entry. Enter the token generated on the remote machine.

Mapping keys are target-side paths; values are local paths. The adapter maps reported source locations to local files and maps local breakpoints back to the target. Longer matching prefixes take precedence, and matches respect directory boundaries. Keep the local source contents aligned with the target files so line numbers agree. The adapter rejects direct non-loopback hosts; remote connections use the SSH tunnel.

## Debug Tcl Thread workers

Enable workers on a launch configuration:

```json
{
    "name": "Launch Tcl with workers",
    "type": "tcl",
    "request": "launch",
    "program": "${workspaceFolder}/main.tcl",
    "cwd": "${workspaceFolder}",
    "stopOnEntry": false,
    "debugThreads": true
}
```

The extension discovers workers created through `thread::create` during that launch. Each worker appears separately in **Call Stack**, with its own frames, variables, and current location. Breakpoints are distributed to the workers, and worker exits remove their entries.

Stopping or stepping one worker leaves the others in their current state. Ordinary Continue resumes all known threads; clients can request single-thread Continue. Inspecting a paused worker remains possible while another worker is running. A thread blocked in a native call, including a join, reaches debugger commands when Tcl execution becomes available again.

Literal worker startup bodies map back to their original file and line numbers. Sourced worker files retain their own locations. Startup scripts run through temporary source files, which the extension cleans up. Dynamically constructed scripts may appear as generated source; code that examines `info script` can observe the temporary startup file.

Worker discovery currently applies to launch sessions. Attach sessions do not discover workers, and already-created workers or existing thread pools are not adopted. If the selected interpreter cannot load `Thread`, the Debug Console reports that worker debugging is unavailable and ordinary debugging continues.

## Debug a selected test

Use the Testing view's **Debug TCL Tests** profile or **Debug Test** CodeLens above a discovered test. A case selection executes that case; file and workspace selections execute their discovered cases. Set source breakpoints with the gutter or F9 in the original test or implementation file. Locals, watches, stepping, and Call Stack work as they do for a launched script.

Debug tests use `tcl.test.tclPath` when explicitly configured, then the test file's `tcl.interpreter.path`, then `tclsh`. Dirty test files are saved first; cancelling a save skips that case. Stopping the test run ends the debug sessions it started. Internal result markers are kept out of test output and the Debug Console.

## Limits and verification

Debugging follows Tcl execution traces and their source metadata. Dynamically generated code without file/line information may not offer source breakpoints or stack locations. Breakpoints should be placed on executable commands. Pause-on-error, data breakpoints, and reverse execution are not implemented. The launched process does not have an interactive input terminal.

The debugger regression suite was exercised on macOS with Tcl 8.5.9 / Thread 2.6.6 and Tcl 9.0.4 / Thread 3.0.6. Its 20 tests cover source/argument preservation, selected-frame inspection and edits, conditional breakpoints and logpoints, stepping, authenticated attach and failure handling, source mapping, detach, independent workers, and generated-source cleanup. Remote path mapping was tested through local fixtures; a live connection to a remote host through SSH was not exercised. Other Tcl/Thread/platform combinations require their own runtime validation.

VS Code Insiders **1.137.0-insider** was also tested through its UI with the supplied sample workspace: gutter/F9 breakpoints, selected-test debugging, local-variable inspection, and stepping were exercised. See the [UI test report](INSIDERS_UI_TEST_REPORT.md) for the exact evidence and remaining limits.

From a development checkout, run:

```sh
npm run compile
node node_modules/mocha/bin/mocha --ui tdd out/test/debug.test.js
```

These tests start local Tcl processes and open loopback sockets. A sandbox that prevents local socket binding must allow those fixture operations for the integration tests to run.
