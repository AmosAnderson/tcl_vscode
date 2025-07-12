import { DebugSession, InitializedEvent, TerminatedEvent, StoppedEvent, BreakpointEvent, OutputEvent, Thread, StackFrame, Source, Handles, Breakpoint } from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

interface TclLaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
    program: string;
    tclPath?: string;
    args?: string[];
    cwd?: string;
    env?: { [key: string]: string };
    stopOnEntry?: boolean;
}

export class TclDebugSession extends DebugSession {
    private static THREAD_ID = 1;
    private _variableHandles = new Handles<string>();
    private _tclProcess: ChildProcess | null = null;
    private _breakpoints = new Map<string, DebugProtocol.Breakpoint[]>();
    private _currentLine = 0;
    private _currentFile = '';
    private _isRunning = false;
    private _callStack: StackFrame[] = [];

    public constructor() {
        super();
        this.setDebuggerLinesStartAt1(true);
        this.setDebuggerColumnsStartAt1(false);
    }

    protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
        response.body = response.body || {};
        
        // Capabilities of this debug adapter
        response.body.supportsConfigurationDoneRequest = true;
        response.body.supportsEvaluateForHovers = true;
        response.body.supportsStepBack = false;
        response.body.supportsDataBreakpoints = false;
        response.body.supportsCompletionsRequest = false;
        response.body.completionTriggerCharacters = [];
        response.body.supportsCancelRequest = false;
        response.body.supportsBreakpointLocationsRequest = false;
        response.body.supportsStepInTargetsRequest = false;
        response.body.supportsGotoTargetsRequest = false;
        response.body.supportsModulesRequest = false;
        response.body.supportsRestartRequest = false;
        response.body.supportsExceptionOptions = false;
        response.body.supportsValueFormattingOptions = false;
        response.body.supportsExceptionInfoRequest = false;
        response.body.supportTerminateDebuggee = true;
        response.body.supportsDelayedStackTraceLoading = false;
        response.body.supportsLoadedSourcesRequest = false;
        response.body.supportsLogPoints = false;
        response.body.supportsTerminateThreadsRequest = false;
        response.body.supportsSetVariable = false;
        response.body.supportsSetExpression = false;
        response.body.supportsDisassembleRequest = false;
        response.body.supportsSteppingGranularity = false;
        response.body.supportsInstructionBreakpoints = false;

        this.sendResponse(response);
        this.sendEvent(new InitializedEvent());
    }

    protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
        super.configurationDoneRequest(response, args);
    }

    protected async launchRequest(response: DebugProtocol.LaunchResponse, args: TclLaunchRequestArguments) {
        try {
            // Validate the program file exists
            if (!fs.existsSync(args.program)) {
                this.sendErrorResponse(response, 2001, `Program file does not exist: ${args.program}`);
                return;
            }

            // Create a wrapper script that enables debugging
            const debugScript = this.createDebugScript(args.program);
            
            // Launch TCL interpreter with debug wrapper
            const tclPath = args.tclPath || 'tclsh';
            const tclArgs = [debugScript];
            if (args.args) {
                tclArgs.push(...args.args);
            }

            this._tclProcess = spawn(tclPath, tclArgs, {
                cwd: args.cwd || path.dirname(args.program),
                env: { ...process.env, ...args.env },
                stdio: ['pipe', 'pipe', 'pipe']
            });

            if (!this._tclProcess.pid) {
                this.sendErrorResponse(response, 2002, 'Failed to start TCL process');
                return;
            }

            // Set up process event handlers
            this._tclProcess.stdout?.on('data', (data) => {
                this.handleStdout(data.toString());
            });

            this._tclProcess.stderr?.on('data', (data) => {
                this.sendEvent(new OutputEvent(data.toString(), 'stderr'));
            });

            this._tclProcess.on('exit', (code) => {
                this.sendEvent(new TerminatedEvent());
            });

            this._currentFile = args.program;
            this._isRunning = true;

            // If stopOnEntry is true, break at the first line
            if (args.stopOnEntry) {
                this._currentLine = 1;
                this._isRunning = false;
                this.sendEvent(new StoppedEvent('entry', TclDebugSession.THREAD_ID));
            }

            this.sendResponse(response);
        } catch (error) {
            this.sendErrorResponse(response, 2003, `Launch failed: ${error}`);
        }
    }

    private createDebugScript(programPath: string): string {
        const debugScriptPath = path.join(path.dirname(programPath), '.tcl_debug_wrapper.tcl');
        
        // Create a simple debug wrapper that adds some basic debugging capabilities
        const debugScript = `
# TCL Debug Wrapper
set debug_program "${programPath}"
set debug_line 1
set debug_breakpoints [list]
set debug_variables [dict create]

# Procedure to handle breakpoints
proc debug_check_breakpoint {line} {
    global debug_breakpoints debug_line
    set debug_line $line
    if {$line in $debug_breakpoints} {
        puts "BREAKPOINT:$line"
        flush stdout
        # Wait for debugger command
        gets stdin debug_cmd
        return $debug_cmd
    }
    return "continue"
}

# Enhanced puts that reports line numbers
rename puts original_puts
proc puts {args} {
    global debug_line
    if {[llength $args] == 1} {
        original_puts "OUTPUT:$debug_line:[lindex $args 0]"
    } else {
        original_puts {*}$args
    }
}

# Source the actual program
if {[catch {source $debug_program} error]} {
    original_puts "ERROR:$error"
}
`;

        fs.writeFileSync(debugScriptPath, debugScript);
        return debugScriptPath;
    }

    private handleStdout(data: string): void {
        const lines = data.split('\n');
        for (const line of lines) {
            if (line.startsWith('BREAKPOINT:')) {
                const lineNum = parseInt(line.split(':')[1]);
                this._currentLine = lineNum;
                this._isRunning = false;
                this.sendEvent(new StoppedEvent('breakpoint', TclDebugSession.THREAD_ID));
            } else if (line.startsWith('OUTPUT:')) {
                const parts = line.split(':');
                const output = parts.slice(2).join(':');
                this.sendEvent(new OutputEvent(output + '\n', 'stdout'));
            } else if (line.startsWith('ERROR:')) {
                const error = line.substring(6);
                this.sendEvent(new OutputEvent(error + '\n', 'stderr'));
                this.sendEvent(new TerminatedEvent());
            } else if (line.trim()) {
                this.sendEvent(new OutputEvent(line + '\n', 'stdout'));
            }
        }
    }

    protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {
        const path = args.source.path as string;
        const clientLines = args.lines || [];

        // Clear existing breakpoints for this file
        this._breakpoints.delete(path);

        // Create breakpoint objects
        const breakpoints: Breakpoint[] = clientLines.map(line => {
            const bp = new Breakpoint(true, line);
            return bp;
        });

        // Store breakpoints
        this._breakpoints.set(path, breakpoints);

        // Send breakpoints to TCL process if running
        if (this._tclProcess && this._tclProcess.stdin) {
            const bpLines = clientLines.join(' ');
            this._tclProcess.stdin.write(`set debug_breakpoints [list ${bpLines}]\n`);
        }

        response.body = {
            breakpoints: breakpoints
        };
        this.sendResponse(response);
    }

    protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
        response.body = {
            threads: [
                new Thread(TclDebugSession.THREAD_ID, "main")
            ]
        };
        this.sendResponse(response);
    }

    protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {
        const startFrame = typeof args.startFrame === 'number' ? args.startFrame : 0;
        const maxLevels = typeof args.levels === 'number' ? args.levels : 1000;
        const endFrame = Math.min(startFrame + maxLevels, this._callStack.length);

        const frames = this._callStack.slice(startFrame, endFrame);
        
        // If no call stack, create a simple frame for current position
        if (frames.length === 0 && this._currentFile) {
            const frame = new StackFrame(
                1,
                'main',
                new Source(path.basename(this._currentFile), this._currentFile),
                this._currentLine,
                0
            );
            frames.push(frame);
        }

        response.body = {
            stackFrames: frames,
            totalFrames: Math.max(frames.length, 1)
        };
        this.sendResponse(response);
    }

    protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {
        response.body = {
            scopes: [
                {
                    name: "Local",
                    variablesReference: this._variableHandles.create("local"),
                    expensive: false
                },
                {
                    name: "Global",
                    variablesReference: this._variableHandles.create("global"),
                    expensive: false
                }
            ]
        };
        this.sendResponse(response);
    }

    protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): void {
        const variables: DebugProtocol.Variable[] = [];
        const id = this._variableHandles.get(args.variablesReference);

        if (id === "local") {
            // Add some mock local variables
            variables.push({
                name: "debug_line",
                value: this._currentLine.toString(),
                variablesReference: 0
            });
        } else if (id === "global") {
            // Add some mock global variables
            variables.push({
                name: "debug_program",
                value: this._currentFile,
                variablesReference: 0
            });
        }

        response.body = {
            variables: variables
        };
        this.sendResponse(response);
    }

    protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
        if (this._tclProcess && this._tclProcess.stdin) {
            this._tclProcess.stdin.write('continue\n');
        }
        this._isRunning = true;
        response.body = { allThreadsContinued: true };
        this.sendResponse(response);
    }

    protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
        if (this._tclProcess && this._tclProcess.stdin) {
            this._tclProcess.stdin.write('step\n');
        }
        this.sendResponse(response);
    }

    protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments): void {
        if (this._tclProcess && this._tclProcess.stdin) {
            this._tclProcess.stdin.write('step\n');
        }
        this.sendResponse(response);
    }

    protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments): void {
        if (this._tclProcess && this._tclProcess.stdin) {
            this._tclProcess.stdin.write('continue\n');
        }
        this.sendResponse(response);
    }

    protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {
        if (this._tclProcess && this._tclProcess.stdin) {
            // Send the expression to TCL for evaluation
            this._tclProcess.stdin.write(`puts "EVAL:[catch {${args.expression}} result]; puts "RESULT:$result"\n`);
        }
        
        // For now, return a simple response
        response.body = {
            result: `Evaluating: ${args.expression}`,
            variablesReference: 0
        };
        this.sendResponse(response);
    }

    protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments): void {
        if (this._tclProcess) {
            this._tclProcess.kill();
            this._tclProcess = null;
        }
        this.sendResponse(response);
    }

    protected terminateRequest(response: DebugProtocol.TerminateResponse, args: DebugProtocol.TerminateArguments): void {
        if (this._tclProcess) {
            this._tclProcess.kill();
            this._tclProcess = null;
        }
        this.sendResponse(response);
    }
}