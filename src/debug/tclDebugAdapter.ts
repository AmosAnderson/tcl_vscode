import { DebugSession, InitializedEvent, TerminatedEvent, StoppedEvent, OutputEvent, Thread, StackFrame, Source, Handles, Breakpoint } from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import { spawn, ChildProcess } from 'child_process';
import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs';
import { toForwardSlashes } from '../utils/tclUtils';

interface TclLaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
    program: string;
    tclPath?: string;
    args?: string[];
    cwd?: string;
    env?: { [key: string]: string };
    stopOnEntry?: boolean;
}

interface PendingRequest {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    command: string;
}

export class TclDebugSession extends DebugSession {
    private static THREAD_ID = 1;
    private _variableHandles = new Handles<string>();
    private _tclProcess: ChildProcess | null = null;
    private _socket: net.Socket | null = null;
    private _breakpoints = new Map<string, DebugProtocol.Breakpoint[]>();
    private _pendingBreakpoints = new Map<string, Array<{line: number; condition: string; logMessage: string}>>();
    private _currentLine = 0;
    private _currentFile = '';
    private _isRunning = false;
    private _stopOnEntry = false;
    private _configDone = false;
    private _configurationSent = false;
    private _breakpointUpdates: Promise<void> = Promise.resolve();
    private _connected = false;
    private _debugRequests: PendingRequest[] = [];
    private _responseBuffer = '';
    private _cachedVariables = new Map<string, DebugProtocol.Variable[]>();
    private _cachedStack: StackFrame[] = [];

    public constructor() {
        super();
        this.setDebuggerLinesStartAt1(true);
        this.setDebuggerColumnsStartAt1(false);
    }

    protected initializeRequest(response: DebugProtocol.InitializeResponse, _args: DebugProtocol.InitializeRequestArguments): void {
        response.body = response.body || {};

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
        response.body.supportsLogPoints = true;
        response.body.supportsTerminateThreadsRequest = false;
        response.body.supportsSetVariable = true;
        response.body.supportsSetExpression = false;
        response.body.supportsDisassembleRequest = false;
        response.body.supportsSteppingGranularity = false;
        response.body.supportsInstructionBreakpoints = false;
        response.body.supportsConditionalBreakpoints = true;

        this.sendResponse(response);
        this.sendEvent(new InitializedEvent());
    }

    protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
        this._configDone = true;

        void this.completeConfiguration();

        super.configurationDoneRequest(response, args);
    }

    protected async launchRequest(response: DebugProtocol.LaunchResponse, args: TclLaunchRequestArguments) {
        try {
            const resolvedProgram = path.resolve(args.cwd || '.', args.program);
            if (!fs.existsSync(resolvedProgram)) {
                this.sendErrorResponse(response, 2001, `Program file does not exist: ${resolvedProgram}`);
                return;
            }

            const workspaceFolders = args.cwd ? [args.cwd] : [];
            if (workspaceFolders.length > 0) {
                const inWorkspace = workspaceFolders.some(folder =>
                    resolvedProgram.startsWith(path.resolve(folder))
                );
                if (!inWorkspace) {
                    this.sendEvent(new OutputEvent(
                        `Warning: Debug target "${resolvedProgram}" is outside the workspace directory.\n`,
                        'console'
                    ));
                }
            }

            this._currentFile = resolvedProgram;
            this._stopOnEntry = args.stopOnEntry !== false;

            // Find the debug server script
            const debugServerPath = this.findDebugServerScript();
            if (!debugServerPath) {
                this.sendErrorResponse(response, 2004, 'Debug server script not found');
                return;
            }

            const tclPath = args.tclPath || 'tclsh';
            const tclArgs = [debugServerPath, resolvedProgram];
            if (args.args) {
                tclArgs.push(...args.args);
            }

            this._tclProcess = spawn(tclPath, tclArgs, {
                cwd: args.cwd || path.dirname(resolvedProgram),
                env: { ...process.env, ...args.env },
                stdio: ['pipe', 'pipe', 'pipe']
            });

            this._tclProcess.on('error', (error) => {
                this.sendEvent(new OutputEvent(`Failed to start TCL process: ${error.message}\n`, 'stderr'));
                this.cleanup();
                this.sendEvent(new TerminatedEvent());
            });
            if (!this._tclProcess.pid) {
                this.sendErrorResponse(response, 2002, 'Failed to start TCL process');
                return;
            }

            // Wait for the debug server to print its port
            let portResolved = false;
            let stdoutBuffer = '';

            // Timeout: fail if no port is detected within 10 seconds
            const portTimeout = setTimeout(() => {
                if (!portResolved) {
                    portResolved = true;
                    this.sendEvent(new OutputEvent('Debug server did not report a port within 10 seconds.\n', 'stderr'));
                    this.cleanup();
                    this.sendEvent(new TerminatedEvent());
                }
            }, 10000);

            this._tclProcess.stdout?.on('data', (data) => {
                const text = data.toString();

                if (!portResolved) {
                    stdoutBuffer += text;
                    const portMatch = stdoutBuffer.match(/DEBUG_PORT:(\d+)/);
                    if (portMatch) {
                        portResolved = true;
                        clearTimeout(portTimeout);
                        const port = parseInt(portMatch[1], 10);

                        // Output any text before the port marker
                        const before = stdoutBuffer.substring(0, stdoutBuffer.indexOf('DEBUG_PORT:'));
                        if (before.trim()) {
                            this.sendEvent(new OutputEvent(before, 'stdout'));
                        }

                        this.connectToDebugServer(port);
                    }
                } else {
                    // After connection, stdout from the TCL process is program output
                    this.sendEvent(new OutputEvent(text, 'stdout'));
                }
            });

            this._tclProcess.stderr?.on('data', (data) => {
                this.sendEvent(new OutputEvent(data.toString(), 'stderr'));
            });

            this._tclProcess.on('exit', () => {
                if (!portResolved) {
                    portResolved = true;
                    clearTimeout(portTimeout);
                }
                this._isRunning = false;
                this._socket = null;
                this.sendEvent(new TerminatedEvent());
            });

            this._isRunning = true;
            this.sendResponse(response);
        } catch (error) {
            this.sendErrorResponse(response, 2003, `Launch failed: ${error}`);
        }
    }

    private findDebugServerScript(): string | null {
        // Look for the debug server script relative to this file's compiled output
        const candidates = [
            path.join(__dirname, 'scripts', 'debugServer.tcl'),
            path.join(__dirname, '..', 'src', 'debug', 'scripts', 'debugServer.tcl'),
            path.join(__dirname, '..', 'debug', 'scripts', 'debugServer.tcl'),
        ];

        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }
        return null;
    }

    private connectToDebugServer(port: number): void {
        this._socket = net.createConnection({ port, host: '127.0.0.1' }, () => {
            this._connected = true;

            void this.completeConfiguration();
        });

        this._socket.setEncoding('utf8');
        this._socket.on('data', (data) => {
            this.handleSocketData(data as string);
        });

        this._socket.on('error', (err) => {
            this.sendEvent(new OutputEvent(`Debug connection error: ${err.message}\n`, 'stderr'));
        });

        this._socket.on('close', () => {
            this._connected = false;
            this._socket = null;
        });
    }

    private async completeConfiguration(): Promise<void> {
        if (!this._connected || !this._configDone || this._configurationSent) return;
        this._configurationSent = true;
        try {
            await this.sendPendingBreakpoints();
            // Set the initial stop before CONFIGDONE releases the Tcl event loop.
            if (this._stopOnEntry) await this.sendDebugCommand('STEPIN');
            await this.sendDebugCommand('CONFIGDONE');
        } catch (error) {
            this.sendEvent(new OutputEvent(`Failed to configure debug server: ${error}\n`, 'stderr'));
            this.cleanup();
        }
    }

    /** Encode one Tcl list element without allowing literal protocol newlines. */
    private quoteWord(value: string): string {
        if (value.length === 0) return '{}';
        return value.replace(/[\\\s{}[\]$";]/g, character => {
            if (character === '\n') return '\\n';
            if (character === '\r') return '\\r';
            if (character === '\t') return '\\t';
            return '\\' + character;
        });
    }

    private handleSocketData(data: string): void {
        this._responseBuffer += data;
        const lines = this._responseBuffer.split('\n');

        // Keep the last incomplete line in the buffer
        this._responseBuffer = lines.pop() || '';

        for (const line of lines) {
            if (line.trim() === '') continue;
            const message = line.startsWith('DATA ') ? Buffer.from(line.substring(5), 'hex').toString('utf8') : line;
            this.handleServerMessage(message);
        }
    }

    private handleServerMessage(message: string): void {
        if (message.startsWith('PAUSED ')) {
            const separator = message.lastIndexOf(' ');
            this._currentFile = message.substring(7, separator);
            this._currentLine = parseInt(message.substring(separator + 1), 10);
            this._isRunning = false;

            // Clear cached variables on pause
            this._cachedVariables.clear();
            this._variableHandles.reset();
            this._cachedStack = [];

            this.sendEvent(new StoppedEvent('breakpoint', TclDebugSession.THREAD_ID));
        } else if (message.startsWith('VARS')) {
            this.handleVarsResponse(message);
        } else if (message.startsWith('ARRAY')) {
            this.handleArrayElemsResponse(message);
        } else if (message.startsWith('STACK')) {
            this.handleStackResponse(message);
        } else if (message.startsWith('EVALRESULT ')) {
            this.handleEvalResponse(message);
        } else if (message.startsWith('ERROR ')) {
            const errorMsg = message.substring(6);
            this.sendEvent(new OutputEvent('Error: ' + errorMsg + '\n', 'stderr'));
        } else if (message.startsWith('ERRORINFO ')) {
            const errorInfo = message.substring(10);
            this.sendEvent(new OutputEvent('Stack trace:\n' + errorInfo + '\n', 'stderr'));
        } else if (message === 'TERMINATED') {
            this._isRunning = false;
            this.sendEvent(new TerminatedEvent());
        } else if (message.startsWith('OK ')) {
            // Acknowledgment — resolve pending request if any
            this.resolvePendingRequest(message);
        } else if (message.startsWith('LOG ')) {
            const logMsg = message.substring(4);
            this.sendEvent(new OutputEvent(logMsg + '\n', 'console'));
        } else if (message.startsWith('OUTPUT ')) {
            const outputMsg = message.substring(7);
            this.sendEvent(new OutputEvent(outputMsg + '\n', 'console'));
        }
    }

    private handleVarsResponse(message: string): void {
        const RS = '\x1E'; // Record separator
        const US = '\x1F'; // Unit separator
        const records = message.split(RS);

        // First record is "VARS" header
        const variables: DebugProtocol.Variable[] = [];

        for (let i = 1; i < records.length; i++) {
            const fields = records[i].split(US);
            if (fields.length >= 2) {
                const name = fields[0];
                if (fields.length === 3 && fields[1] === '(array)') {
                    // Array variable — display element count, mark type for expansion
                    const count = parseInt(fields[2], 10);
                    const displayValue = isNaN(count) ? 'Array' : `Array[${count}]`;
                    variables.push({
                        name,
                        value: displayValue,
                        type: 'array',
                        variablesReference: 0
                    });
                } else {
                    variables.push({
                        name,
                        value: fields[1],
                        variablesReference: 0
                    });
                }
            }
        }

        this.resolvePendingRequest(message, variables);
    }

    private handleArrayElemsResponse(message: string): void {
        const RS = '\x1E';
        const US = '\x1F';
        const records = message.split(RS);

        const variables: DebugProtocol.Variable[] = [];

        for (let i = 1; i < records.length; i++) {
            const fields = records[i].split(US);
            if (fields.length >= 2) {
                variables.push({
                    name: fields[0],
                    value: fields[1],
                    variablesReference: 0
                });
            }
        }

        this.resolvePendingRequest(message, variables);
    }

    private handleStackResponse(message: string): void {
        const RS = '\x1E';
        const US = '\x1F';
        const records = message.split(RS);

        const frames: StackFrame[] = [];

        for (let i = 1; i < records.length; i++) {
            const fields = records[i].split(US);
            if (fields.length >= 3) {
                const procName = fields[0];
                const file = fields[1];
                const line = parseInt(fields[2], 10);

                frames.push(new StackFrame(
                    i,
                    procName,
                    new Source(path.basename(file), file),
                    line,
                    0
                ));
            }
        }

        this.resolvePendingRequest(message, frames);
    }

    private handleEvalResponse(message: string): void {
        const rest = message.substring(11); // After "EVALRESULT "
        const spaceIdx = rest.indexOf(' ');
        const status = spaceIdx >= 0 ? rest.substring(0, spaceIdx) : rest;
        const result = spaceIdx >= 0 ? rest.substring(spaceIdx + 1) : '';

        this.resolvePendingRequest(message, { status, result });
    }

    private sendDebugCommand<T = string>(command: string): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            if (!this._socket || !this._connected) {
                reject(new Error('Not connected to debug server'));
                return;
            }

            this._debugRequests.push({
                resolve: resolve as (value: unknown) => void,
                reject,
                command
            });
            this._socket.write(command + '\n');
        });
    }

    private resolvePendingRequest(message: string, data?: unknown): void {
        const responseType = message.split(' ', 1)[0].split('\x1E', 1)[0];
        const commandType = responseType === 'OK'
            ? message.substring(3).split(' ', 1)[0]
            : responseType === 'EVALRESULT' ? 'EVAL' : responseType;
        const index = this._debugRequests.findIndex(request => request.command.split(' ', 1)[0] === commandType);
        if (index >= 0) {
            const pending = this._debugRequests.splice(index, 1)[0];
            pending.resolve(data !== undefined ? data : message);
        }
    }

    private async sendPendingBreakpoints(): Promise<void> {
        for (const [filePath, breakpoints] of this._pendingBreakpoints) {
            await this.replaceServerBreakpoints(filePath, breakpoints);
        }
    }

    private replaceServerBreakpoints(filePath: string, breakpoints: Array<{line: number; condition: string; logMessage: string}>): Promise<void> {
        const file = this.quoteWord(toForwardSlashes(filePath));
        // Serialize replacements so rapid edits cannot interleave CLEAR and BREAK.
        const update = this._breakpointUpdates.then(async () => {
            await this.sendDebugCommand(`CLEARFILE ${file}`);
            for (const breakpoint of breakpoints) {
                await this.sendDebugCommand(`BREAK ${file} ${breakpoint.line} ${this.quoteWord(breakpoint.condition)} ${this.quoteWord(breakpoint.logMessage)}`);
            }
        });
        this._breakpointUpdates = update.catch(() => {});
        return update;
    }

    protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {
        const filePath = args.source.path as string;
        const sourceBreakpoints = args.breakpoints || [];

        // Store breakpoints (with conditions and log messages) for sending when connected
        const pending = sourceBreakpoints.map(sbp => ({
            line: sbp.line,
            condition: sbp.condition || '',
            logMessage: sbp.logMessage || ''
        }));
        this._pendingBreakpoints.set(filePath, pending);

        // Create breakpoint objects (mark as verified)
        const breakpoints: Breakpoint[] = sourceBreakpoints.map(sbp => {
            return new Breakpoint(true, sbp.line);
        });

        this._breakpoints.set(filePath, breakpoints);

        if (this._connected && this._configurationSent) {
            void this.replaceServerBreakpoints(filePath, pending).catch(error => {
                this.sendEvent(new OutputEvent(`Failed to update breakpoints: ${error}\n`, 'stderr'));
            });
        }

        response.body = { breakpoints };
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
        if (!this._connected || this._isRunning) {
            // Return current position as single frame
            const frames = this._currentFile ? [
                new StackFrame(1, '<main>', new Source(path.basename(this._currentFile), this._currentFile), this._currentLine, 0)
            ] : [];

            response.body = { stackFrames: frames, totalFrames: frames.length };
            this.sendResponse(response);
            return;
        }

        // Request stack from debug server
        this.sendDebugCommand<StackFrame[]>('STACK').then(frames => {
            const startFrame = typeof args.startFrame === 'number' ? args.startFrame : 0;
            const maxLevels = typeof args.levels === 'number' ? args.levels : 1000;
            const endFrame = Math.min(startFrame + maxLevels, frames.length);
            const sliced = frames.slice(startFrame, endFrame);

            // If no frames returned, use current position
            if (sliced.length === 0 && this._currentFile) {
                sliced.push(new StackFrame(1, '<main>', new Source(path.basename(this._currentFile), this._currentFile), this._currentLine, 0));
            }

            response.body = { stackFrames: sliced, totalFrames: Math.max(frames.length, sliced.length) };
            this.sendResponse(response);
        }).catch(() => {
            const frames = this._currentFile ? [
                new StackFrame(1, '<main>', new Source(path.basename(this._currentFile), this._currentFile), this._currentLine, 0)
            ] : [];
            response.body = { stackFrames: frames, totalFrames: frames.length };
            this.sendResponse(response);
        });
    }

    protected scopesRequest(response: DebugProtocol.ScopesResponse, _args: DebugProtocol.ScopesArguments): void {
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
        const handleValue = this._variableHandles.get(args.variablesReference);

        if (!handleValue || !this._connected || this._isRunning) {
            response.body = { variables: [] };
            this.sendResponse(response);
            return;
        }

        // Array expansion request (handle value is "array:<scope>:<varName>")
        if (handleValue.startsWith('array:')) {
            this.handleArrayExpansion(handleValue, response);
            return;
        }

        // Scope variable request (local/global)
        const scope = handleValue;

        // Check cache
        if (this._cachedVariables.has(scope)) {
            response.body = { variables: this._cachedVariables.get(scope)! };
            this.sendResponse(response);
            return;
        }

        this.sendDebugCommand<DebugProtocol.Variable[]>(`VARS ${scope}`).then(variables => {
            // Post-process: create expandable handles for array variables
            for (const v of variables) {
                if (v.type === 'array') {
                    v.variablesReference = this._variableHandles.create(`array:${scope}:${v.name}`);
                }
            }
            this._cachedVariables.set(scope, variables);
            response.body = { variables };
            this.sendResponse(response);
        }).catch(() => {
            response.body = { variables: [] };
            this.sendResponse(response);
        });
    }

    private handleArrayExpansion(handleValue: string, response: DebugProtocol.VariablesResponse): void {
        // Parse "array:<scope>:<varName>"
        const colonIdx = handleValue.indexOf(':', 6); // after "array:"
        const scope = handleValue.substring(6, colonIdx);
        const varName = handleValue.substring(colonIdx + 1);

        // Check cache
        if (this._cachedVariables.has(handleValue)) {
            response.body = { variables: this._cachedVariables.get(handleValue)! };
            this.sendResponse(response);
            return;
        }

        this.sendDebugCommand<DebugProtocol.Variable[]>(`ARRAY ${this.quoteWord(varName)} ${scope}`).then(elements => {
            this._cachedVariables.set(handleValue, elements);
            response.body = { variables: elements };
            this.sendResponse(response);
        }).catch(() => {
            response.body = { variables: [] };
            this.sendResponse(response);
        });
    }

    protected setVariableRequest(response: DebugProtocol.SetVariableResponse, args: DebugProtocol.SetVariableArguments): void {
        if (!this._connected || this._isRunning) {
            this.sendErrorResponse(response, 2010, 'Cannot set variable while running');
            return;
        }

        this.sendDebugCommand(`SETVAR ${this.quoteWord(args.name)} ${this.quoteWord(args.value)}`).then(() => {
            // Clear variable cache
            this._cachedVariables.clear();
            response.body = { value: args.value };
            this.sendResponse(response);
        }).catch((err) => {
            this.sendErrorResponse(response, 2011, `Failed to set variable: ${err.message}`);
        });
    }

    protected continueRequest(response: DebugProtocol.ContinueResponse, _args: DebugProtocol.ContinueArguments): void {
        this._isRunning = true;
        this._cachedVariables.clear();
        this._cachedStack = [];

        if (this._connected) {
            void this.sendDebugCommand('CONTINUE').catch(() => {});
        }

        response.body = { allThreadsContinued: true };
        this.sendResponse(response);
    }

    protected nextRequest(response: DebugProtocol.NextResponse, _args: DebugProtocol.NextArguments): void {
        this._isRunning = true;
        this._cachedVariables.clear();

        if (this._connected) {
            void this.sendDebugCommand('STEP').catch(() => {});
        }

        this.sendResponse(response);
    }

    protected stepInRequest(response: DebugProtocol.StepInResponse, _args: DebugProtocol.StepInArguments): void {
        this._isRunning = true;
        this._cachedVariables.clear();

        if (this._connected) {
            void this.sendDebugCommand('STEPIN').catch(() => {});
        }

        this.sendResponse(response);
    }

    protected stepOutRequest(response: DebugProtocol.StepOutResponse, _args: DebugProtocol.StepOutArguments): void {
        this._isRunning = true;
        this._cachedVariables.clear();

        if (this._connected) {
            void this.sendDebugCommand('STEPOUT').catch(() => {});
        }

        this.sendResponse(response);
    }

    protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {
        if (!this._connected || this._isRunning) {
            response.body = {
                result: 'Cannot evaluate while running',
                variablesReference: 0
            };
            this.sendResponse(response);
            return;
        }

        this.sendDebugCommand<{ status: string; result: string }>(`EVAL ${this.quoteWord(args.expression)}`).then(evalResult => {
            response.body = {
                result: evalResult.status === 'OK' ? evalResult.result : `Error: ${evalResult.result}`,
                variablesReference: 0
            };
            this.sendResponse(response);
        }).catch(() => {
            response.body = {
                result: 'Evaluation failed',
                variablesReference: 0
            };
            this.sendResponse(response);
        });
    }

    protected disconnectRequest(response: DebugProtocol.DisconnectResponse, _args: DebugProtocol.DisconnectArguments): void {
        this.cleanup();
        this.sendResponse(response);
    }

    protected terminateRequest(response: DebugProtocol.TerminateResponse, _args: DebugProtocol.TerminateArguments): void {
        this.cleanup();
        this.sendResponse(response);
    }

    private cleanup(): void {
        if (this._socket && this._connected) {
            try {
                this._socket.write('DISCONNECT\n');
            } catch {
                // Ignore write errors during cleanup
            }
            try {
                this._socket.destroy();
            } catch {
                // Ignore
            }
            this._socket = null;
            this._connected = false;
        }

        if (this._tclProcess) {
            const proc = this._tclProcess;
            this._tclProcess = null;
            proc.kill('SIGTERM');
            const forceKillTimer = setTimeout(() => {
                try { proc.kill('SIGKILL'); } catch { /* already dead */ }
            }, 2000);
            proc.once('exit', () => clearTimeout(forceKillTimer));
        }

        for (const request of this._debugRequests.splice(0)) {
            request.reject(new Error('Debug session ended'));
        }
        this._cachedVariables.clear();
        this._cachedStack = [];
    }
}
