import { DebugSession, InitializedEvent, TerminatedEvent, StoppedEvent, OutputEvent, Thread, StackFrame, Source, Breakpoint, ThreadEvent } from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import { spawn, ChildProcess } from 'child_process';
import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { randomBytes } from 'crypto';
import { toForwardSlashes } from '../utils/tclUtils';

interface TclLaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
    program: string;
    tclPath?: string;
    args?: string[];
    cwd?: string;
    env?: { [key: string]: string };
    stopOnEntry?: boolean;
    debugThreads?: boolean;
    __tclTestRunner?: string;
}

interface VariableHandle {
    frameId: number;
    scope: 'local' | 'global';
    arrayName?: string;
}

interface TclAttachRequestArguments extends DebugProtocol.AttachRequestArguments {
    host?: string;
    port: number;
    token: string;
    stopOnEntry?: boolean;
    sourceFileMap?: Record<string, string>;
    connectTimeout?: number;
}

interface PendingRequest {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    command: string;
    timer: ReturnType<typeof setTimeout>;
}

export class TclDebugSession extends DebugSession {
    private readonly _threadId: number;
    private readonly _parent?: TclDebugSession;
    private readonly _threadName: string;
    private _workers = new Map<number, TclDebugSession>();
    private _nextThreadId = 2;
    private _frameOwners = new Map<number, TclDebugSession>();
    private _variableOwners = new Map<number, TclDebugSession>();
    private _serverFrames = new Map<number, number>();
    private _nextFrameId = 1;
    private _lastStoppedThread = 1;
    private _programOutputBuffer = '';
    private _debugThreads = false;
    private _workerDirectory?: string;
    private _variableHandles = new Map<number, VariableHandle>();
    private _nextVariableHandle = 1;
    private _tclProcess: ChildProcess | null = null;
    private _socket: net.Socket | null = null;
    private _breakpoints = new Map<string, DebugProtocol.Breakpoint[]>();
    private _pendingBreakpoints = new Map<string, Array<{line: number; condition: string; logMessage: string}>>();
    private _currentLine = 0;
    private _currentFile = '';
    private _isRunning = false;
    private _stopOnEntry = false;
    private _pendingStopReason = 'breakpoint';
    private _configDone = false;
    private _configurationSent = false;
    private _breakpointUpdates: Promise<void> = Promise.resolve();
    private _connected = false;
    private _handshakeComplete = false;
    private _authToken = '';
    private _ownsProcess = true;
    private _sourceFileMap: Record<string, string> = {};
    private _connectTimeout = 10000;
    private _debugRequests: PendingRequest[] = [];
    private _responseBuffer = '';
    private _cachedVariables = new Map<string, DebugProtocol.Variable[]>();
    private _cachedStack: StackFrame[] = [];

    public constructor(threadId = 1, parent?: TclDebugSession, name = 'main') {
        super();
        this._threadId = threadId;
        this._parent = parent;
        this._threadName = name;
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
        response.body.supportsSingleThreadExecutionRequests = true;
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
            if (workspaceFolders.length > 0 && args.__tclTestRunner !== args.program) {
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

            this._ownsProcess = true;
            this._debugThreads = args.debugThreads === true;
            this._authToken = randomBytes(32).toString('hex');
            if (this._debugThreads) this._workerDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'tcl-debug-workers-'));
            const tclPath = args.tclPath || 'tclsh';
            const tclArgs = [debugServerPath, resolvedProgram];
            if (args.args) {
                tclArgs.push(...args.args);
            }

            this._tclProcess = spawn(tclPath, tclArgs, {
                cwd: args.cwd || path.dirname(resolvedProgram),
                env: { ...process.env, ...args.env, TCL_DEBUG_TOKEN: this._authToken, TCL_DEBUG_PORT: '0', TCL_DEBUG_THREADS: this._debugThreads ? '1' : '0', TCL_DEBUG_TMPDIR: this._workerDirectory || os.tmpdir() },
                stdio: ['pipe', 'pipe', 'pipe']
            });

            this._tclProcess.on('error', (error) => {
                this.sendEvent(new OutputEvent(`Failed to start TCL process: ${error.message}\n`, 'stderr'));
                this.cleanup();
                this.removeWorkerDirectory();
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
                    const portMatch = stdoutBuffer.match(/DEBUG_PORT:(\d+)\r?\n/);
                    if (portMatch) {
                        portResolved = true;
                        clearTimeout(portTimeout);
                        const port = parseInt(portMatch[1], 10);
                        const afterMarker = stdoutBuffer.substring(stdoutBuffer.indexOf(portMatch[0]) + portMatch[0].length);
                        if (afterMarker) this.handleProgramOutput(afterMarker);

                        // Output any text before the port marker
                        const before = stdoutBuffer.substring(0, stdoutBuffer.indexOf('DEBUG_PORT:'));
                        if (before.trim()) {
                            this.sendEvent(new OutputEvent(before, 'stdout'));
                        }

                        void this.connectToDebugServer(port).catch(error => {
                            this.sendEvent(new OutputEvent(`Debug connection failed: ${error.message}\n`, 'stderr'));
                            this.cleanup();
                            this.sendEvent(new TerminatedEvent());
                        });
                    }
                } else {
                    // After connection, stdout from the TCL process is program output
                    this.handleProgramOutput(text);
                }
            });

            this._tclProcess.stderr?.on('data', (data) => {
                this.sendEvent(new OutputEvent(data.toString(), 'stderr'));
            });

            this._tclProcess.on('close', () => {
                if (this._programOutputBuffer) this.sendEvent(new OutputEvent(this._programOutputBuffer, 'stdout'));
                this._programOutputBuffer = '';
                if (!portResolved) {
                    portResolved = true;
                    clearTimeout(portTimeout);
                }
                this._isRunning = false;
                this._socket = null;
                this._tclProcess = null;
                this.removeWorkerDirectory();
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

    private handleProgramOutput(text: string): void {
        this._programOutputBuffer += text;
        let newline: number;
        while ((newline = this._programOutputBuffer.indexOf('\n')) >= 0) {
            const line = this._programOutputBuffer.substring(0, newline + 1);
            this._programOutputBuffer = this._programOutputBuffer.substring(newline + 1);
            const worker = this._debugThreads && /^DEBUG_THREAD:([^:]+):(\d+):([a-f0-9]+):([a-f0-9]*)\r?\n$/.exec(line);
            if (worker) {
                void this.connectWorker(worker[1], Number(worker[2]), Buffer.from(worker[3], 'hex').toString('utf8'),
                    Buffer.from(worker[4], 'hex').toString('utf8'));
            } else this.sendEvent(new OutputEvent(line, 'stdout'));
        }
        if (this._programOutputBuffer && !'DEBUG_THREAD:'.startsWith(this._programOutputBuffer) && !this._programOutputBuffer.startsWith('DEBUG_THREAD:')) {
            this.sendEvent(new OutputEvent(this._programOutputBuffer, 'stdout'));
            this._programOutputBuffer = '';
        }
    }

    private async connectWorker(nativeId: string, port: number, runner: string, original: string): Promise<void> {
        const id = this._nextThreadId++;
        const worker = new TclDebugSession(id, this, `Tcl ${nativeId}`);
        worker._ownsProcess = false;
        worker._authToken = this._authToken;
        worker._isRunning = true;
        worker._configDone = true;
        worker._pendingBreakpoints = new Map(this._pendingBreakpoints);
        worker._sourceFileMap = { ...this._sourceFileMap, ...(original ? { [runner]: original } : {}) };
        worker.onDidSendMessage(message => {
            const item = message as DebugProtocol.ProtocolMessage;
            if (item.type === 'response') this.sendResponse({ ...item, seq: 0 } as DebugProtocol.Response);
            if (item.type === 'event') {
                const event = item as DebugProtocol.Event;
                if (event.event === 'terminated') {
                    if (this._workers.delete(id)) this.sendEvent(new ThreadEvent('exited', id));
                } else {
                    if (event.event === 'stopped') this._lastStoppedThread = id;
                    this.sendEvent(event);
                }
            }
        });
        this._workers.set(id, worker);
        this.sendEvent(new ThreadEvent('started', id));
        try { await worker.connectToDebugServer(port); }
        catch (error) {
            worker.cleanup(false);
            if (this._workers.delete(id)) this.sendEvent(new ThreadEvent('exited', id));
            this.sendEvent(new OutputEvent(`Cannot debug ${worker._threadName}: ${(error as Error).message}\n`, 'stderr'));
        }
    }

    private get root(): TclDebugSession { return this._parent || this; }

    private frameId(serverId: number): number {
        for (const [id, existing] of this._serverFrames) if (existing === serverId) return id;
        const id = this.root._nextFrameId++;
        this._serverFrames.set(id, serverId);
        this.root._frameOwners.set(id, this);
        return id;
    }

    protected async attachRequest(response: DebugProtocol.AttachResponse, args: TclAttachRequestArguments): Promise<void> {
        if (!['127.0.0.1', 'localhost', '::1'].includes(args.host || '127.0.0.1')) {
            this.sendErrorResponse(response, 2020, 'Attach accepts loopback hosts only. Forward the remote port with an SSH tunnel.');
            return;
        }
        if (!Number.isInteger(args.port) || args.port < 1 || args.port > 65535 || typeof args.token !== 'string' || args.token.length < 16) {
            this.sendErrorResponse(response, 2021, 'Attach requires a valid port and a token of at least 16 characters');
            return;
        }
        this._ownsProcess = false;
        this._authToken = args.token;
        this._stopOnEntry = args.stopOnEntry === true;
        this._sourceFileMap = args.sourceFileMap || {};
        this._connectTimeout = Math.min(60000, Math.max(100, args.connectTimeout || 10000));
        this._isRunning = true;
        try {
            await this.connectToDebugServer(args.port, args.host);
            this.sendResponse(response);
        } catch (error) {
            this.cleanup(false);
            this.sendErrorResponse(response, 2022, `Attach failed: ${(error as Error).message}`);
        }
    }

    private connectToDebugServer(port: number, host = '127.0.0.1'): Promise<void> {
        return new Promise((resolve, reject) => {
            const socket = net.createConnection({ port, host });
            this._socket = socket;
            const timeout = setTimeout(() => {
                reject(new Error('Timed out connecting to the Tcl debug server'));
                socket.destroy();
            }, this._connectTimeout);
            socket.setEncoding('utf8');
            socket.on('data', data => this.handleSocketData(data as string));
            socket.on('error', error => {
                clearTimeout(timeout);
                reject(error);
                this.rejectPendingRequests(error);
            });
            socket.on('close', () => {
                clearTimeout(timeout);
                this._connected = false;
                this._handshakeComplete = false;
                this._socket = null;
                this.invalidateInspection();
                this.rejectPendingRequests(new Error('Debug connection closed'));
                if (!this._ownsProcess) this.sendEvent(new TerminatedEvent());
            });
            socket.once('connect', () => {
                this._connected = true;
                void this.sendDebugCommand(`HELLO 1 ${this.quoteWord(this._authToken)}`).then(message => {
                    if (message !== 'OK HELLO 1') throw new Error('Incompatible debug protocol handshake');
                    clearTimeout(timeout);
                    this._handshakeComplete = true;
                    void this.completeConfiguration();
                    resolve();
                }).catch(error => { clearTimeout(timeout); reject(error); socket.destroy(); });
            });
        });
    }

    private mapSource(file: string, toRemote = false): string {
        const candidates = [toForwardSlashes(file)];
        if (toRemote) {
            try { candidates.push(toForwardSlashes(fs.realpathSync(file))); } catch { /* A breakpoint may name a file not created yet. */ }
        }
        const mappings = Object.entries(this._sourceFileMap).map(([remote, local]) =>
            [toForwardSlashes(toRemote ? local : remote).replace(/\/$/, ''),
                toForwardSlashes(toRemote ? remote : local).replace(/\/$/, '')]);
        mappings.sort((a, b) => b[0].length - a[0].length);
        for (const normalized of candidates) {
            for (const [from, to] of mappings) {
                if (normalized === from || normalized.startsWith(from + '/')) return to + normalized.substring(from.length);
            }
        }
        return candidates[0];
    }

    private async completeConfiguration(): Promise<void> {
        if (!this._connected || !this._handshakeComplete || !this._configDone || this._configurationSent) return;
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
        if (message.startsWith('STOPREASON ')) {
            const reason = message.substring(11);
            this._pendingStopReason = ['breakpoint', 'step', 'pause', 'entry'].includes(reason) ? reason : 'breakpoint';
        } else if (message.startsWith('PAUSED ')) {
            const separator = message.lastIndexOf(' ');
            this._currentFile = this.mapSource(message.substring(7, separator));
            this._currentLine = parseInt(message.substring(separator + 1), 10);
            this._isRunning = false;

            // Clear cached variables on pause
            this._cachedVariables.clear();
            this.invalidateInspection();
            this._cachedStack = [];

            this.root._lastStoppedThread = this._threadId;
            const stopped: DebugProtocol.StoppedEvent = new StoppedEvent(this._pendingStopReason, this._threadId);
            this._pendingStopReason = 'breakpoint';
            stopped.body.allThreadsStopped = false;
            this.sendEvent(stopped);
        } else if (message.startsWith('VARS')) {
            this.handleVarsResponse(message);
        } else if (message.startsWith('ARRAY')) {
            this.handleArrayElemsResponse(message);
        } else if (message.startsWith('STACK')) {
            this.handleStackResponse(message);
        } else if (message.startsWith('EVALRESULT ')) {
            this.handleEvalResponse(message);
        } else if (message.startsWith('FAIL ')) {
            const [, command] = message.split(' ', 2);
            const index = this._debugRequests.findIndex(request => request.command.split(' ', 1)[0] === command);
            if (index >= 0) {
                const pending = this._debugRequests.splice(index, 1)[0];
                clearTimeout(pending.timer);
                pending.reject(new Error(message.substring(command.length + 6)));
            }
        } else if (message.startsWith('ERROR ')) {
            const errorMsg = message.substring(6);
            this.sendEvent(new OutputEvent('Error: ' + errorMsg + '\n', 'stderr'));
        } else if (message.startsWith('ERRORINFO ')) {
            const errorInfo = message.substring(10);
            this.sendEvent(new OutputEvent('Stack trace:\n' + errorInfo + '\n', 'stderr'));
        } else if (message === 'TERMINATED') {
            this._isRunning = false;
            if (!this._ownsProcess) this.sendEvent(new TerminatedEvent());
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
                const file = this.mapSource(fields[1]);
                const line = parseInt(fields[2], 10);

                frames.push(new StackFrame(
                    this.frameId(i),
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

            const pending: PendingRequest = {
                resolve: resolve as (value: unknown) => void, reject, command,
                timer: setTimeout(() => {
                    const index = this._debugRequests.indexOf(pending);
                    if (index >= 0) this._debugRequests.splice(index, 1);
                    reject(new Error(`Debug command timed out: ${command.split(' ', 1)[0]}`));
                }, this._connectTimeout)
            };
            this._debugRequests.push(pending);
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
            clearTimeout(pending.timer);
            pending.resolve(data !== undefined ? data : message);
        }
    }

    private async sendPendingBreakpoints(): Promise<void> {
        for (const [filePath, breakpoints] of this._pendingBreakpoints) {
            await this.replaceServerBreakpoints(filePath, breakpoints);
        }
    }

    private replaceServerBreakpoints(filePath: string, breakpoints: Array<{line: number; condition: string; logMessage: string}>): Promise<void> {
        const file = this.quoteWord(this.mapSource(filePath, true));
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
        for (const worker of this._workers.values()) {
            worker._pendingBreakpoints.set(filePath, pending);
            if (worker._handshakeComplete && worker._configurationSent) {
                void worker.replaceServerBreakpoints(filePath, pending).catch(error =>
                    this.sendEvent(new OutputEvent(`Failed to update worker breakpoints: ${error.message}\n`, 'stderr')));
            }
        }

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
                new Thread(this._threadId, this._threadName),
                ...Array.from(this._workers, ([id, worker]) => new Thread(id, worker._threadName))
            ]
        };
        this.sendResponse(response);
    }

    protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {
        const worker = this._workers.get(args.threadId);
        if (worker) { worker.stackTraceRequest(response, args); return; }
        if (args.threadId !== this._threadId) {
            this.sendErrorResponse(response, 2017, 'Thread is no longer available');
            return;
        }
        if (!this._connected || this._isRunning) {
            // Return current position as single frame
            const frames = this._currentFile ? [
                new StackFrame(this.frameId(1), '<main>', new Source(path.basename(this._currentFile), this._currentFile), this._currentLine, 0)
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
                sliced.push(new StackFrame(this.frameId(1), '<main>', new Source(path.basename(this._currentFile), this._currentFile), this._currentLine, 0));
            }

            response.body = { stackFrames: sliced, totalFrames: Math.max(frames.length, sliced.length) };
            this.sendResponse(response);
        }).catch(() => {
            const frames = this._currentFile ? [
                new StackFrame(this.frameId(1), '<main>', new Source(path.basename(this._currentFile), this._currentFile), this._currentLine, 0)
            ] : [];
            response.body = { stackFrames: frames, totalFrames: frames.length };
            this.sendResponse(response);
        });
    }

    private createVariableHandle(value: VariableHandle): number {
        const id = this.root._nextVariableHandle++;
        this._variableHandles.set(id, value);
        this.root._variableOwners.set(id, this);
        return id;
    }

    protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {
        const owner = this._frameOwners.get(args.frameId);
        if (owner && owner !== this) { owner.scopesRequest(response, args); return; }
        if (!this._connected || this._isRunning || !this._serverFrames.has(args.frameId)) {
            this.sendErrorResponse(response, 2012, 'Stack frame is no longer available');
            return;
        }
        response.body = { scopes: (['local', 'global'] as const).map(scope => ({
            name: scope === 'local' ? 'Local' : 'Global',
            variablesReference: this.createVariableHandle({ frameId: args.frameId, scope }),
            expensive: false
        })) };
        this.sendResponse(response);
    }

    protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): void {
        const owner = this._variableOwners.get(args.variablesReference);
        if (owner && owner !== this) { owner.variablesRequest(response, args); return; }
        const handle = this._variableHandles.get(args.variablesReference);
        if (!handle || !this._connected || this._isRunning) {
            this.sendErrorResponse(response, 2013, 'Variables are no longer available; pause and select a stack frame again');
            return;
        }
        const key = JSON.stringify(handle);
        const cached = this._cachedVariables.get(key);
        if (cached) {
            response.body = { variables: cached };
            this.sendResponse(response);
            return;
        }
        const command = handle.arrayName === undefined
            ? `VARS ${handle.scope} ${this._serverFrames.get(handle.frameId)}`
            : `ARRAY ${this.quoteWord(handle.arrayName)} ${handle.scope} ${this._serverFrames.get(handle.frameId)}`;
        this.sendDebugCommand<DebugProtocol.Variable[]>(command).then(variables => {
            for (const variable of variables) {
                if (variable.type === 'array') {
                    variable.variablesReference = this.createVariableHandle({ ...handle, arrayName: variable.name });
                }
            }
            this._cachedVariables.set(key, variables);
            response.body = { variables };
            this.sendResponse(response);
        }).catch(error => this.sendErrorResponse(response, 2014, `Cannot inspect variables: ${error.message}`));
    }

    protected setVariableRequest(response: DebugProtocol.SetVariableResponse, args: DebugProtocol.SetVariableArguments): void {
        const owner = this._variableOwners.get(args.variablesReference);
        if (owner && owner !== this) { owner.setVariableRequest(response, args); return; }
        const handle = this._variableHandles.get(args.variablesReference);
        if (!handle || !this._connected || this._isRunning) {
            this.sendErrorResponse(response, 2010, 'Variable is no longer available');
            return;
        }
        this.sendDebugCommand(`SETVAR ${this.quoteWord(args.name)} ${this.quoteWord(args.value)} ${handle.scope} ${this._serverFrames.get(handle.frameId)}`).then(() => {
            this._cachedVariables.clear();
            response.body = { value: args.value };
            this.sendResponse(response);
        }).catch(error => this.sendErrorResponse(response, 2011, `Failed to set variable: ${error.message}`));
    }

    private invalidateInspection(): void {
        for (const id of this._variableHandles.keys()) this.root._variableOwners.delete(id);
        for (const id of this._serverFrames.keys()) this.root._frameOwners.delete(id);
        this._serverFrames.clear();
        this._variableHandles.clear();
        this._cachedVariables.clear();
        this._cachedStack = [];
    }

    protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
        if (args.singleThread !== true && this._workers.size > 0) {
            if (args.threadId !== this._threadId && !this._workers.has(args.threadId)) {
                this.sendErrorResponse(response, 2017, 'Thread is no longer available');
                return;
            }
            for (const session of [this, ...this._workers.values()]) {
                session._isRunning = true;
                session.invalidateInspection();
                if (session._connected) void session.sendDebugCommand('CONTINUE').catch(() => {});
            }
            response.body = { allThreadsContinued: true };
            this.sendResponse(response);
            return;
        }
        const worker = this._workers.get(args.threadId);
        if (worker) { worker.continueRequest(response, args); return; }
        if (args.threadId !== this._threadId) {
            this.sendErrorResponse(response, 2017, 'Thread is no longer available');
            return;
        }
        this._isRunning = true;
        this.invalidateInspection();
        this._cachedStack = [];

        if (this._connected) {
            void this.sendDebugCommand('CONTINUE').catch(() => {});
        }

        response.body = { allThreadsContinued: this.root._workers.size === 0 };
        this.sendResponse(response);
    }

    protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
        const worker = this._workers.get(args.threadId);
        if (worker) { worker.nextRequest(response, args); return; }
        if (args.threadId !== this._threadId) {
            this.sendErrorResponse(response, 2017, 'Thread is no longer available');
            return;
        }
        this._isRunning = true;
        this.invalidateInspection();

        if (this._connected) {
            void this.sendDebugCommand('STEP').catch(() => {});
        }

        this.sendResponse(response);
    }

    protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments): void {
        const worker = this._workers.get(args.threadId);
        if (worker) { worker.stepInRequest(response, args); return; }
        if (args.threadId !== this._threadId) {
            this.sendErrorResponse(response, 2017, 'Thread is no longer available');
            return;
        }
        this._isRunning = true;
        this.invalidateInspection();

        if (this._connected) {
            void this.sendDebugCommand('STEPIN').catch(() => {});
        }

        this.sendResponse(response);
    }

    protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments): void {
        const worker = this._workers.get(args.threadId);
        if (worker) { worker.stepOutRequest(response, args); return; }
        if (args.threadId !== this._threadId) {
            this.sendErrorResponse(response, 2017, 'Thread is no longer available');
            return;
        }
        this._isRunning = true;
        this.invalidateInspection();

        if (this._connected) {
            void this.sendDebugCommand('STEPOUT').catch(() => {});
        }

        this.sendResponse(response);
    }

    protected pauseRequest(response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments): void {
        const worker = this._workers.get(args.threadId);
        if (worker) { worker.pauseRequest(response, args); return; }
        if (args.threadId !== this._threadId) {
            this.sendErrorResponse(response, 2017, 'Thread is no longer available');
            return;
        }
        this.sendDebugCommand('PAUSE').then(() => this.sendResponse(response))
            .catch(error => this.sendErrorResponse(response, 2016, `Cannot pause: ${error.message}`));
    }

    protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {
        const owner = args.frameId === undefined ? this._workers.get(this._lastStoppedThread) : this._frameOwners.get(args.frameId);
        if (owner && owner !== this) { owner.evaluateRequest(response, args); return; }
        if (args.frameId !== undefined && !this._serverFrames.has(args.frameId)) {
            this.sendErrorResponse(response, 2015, 'Stack frame is no longer available');
            return;
        }
        if (!this._connected || this._isRunning) {
            response.body = {
                result: 'Cannot evaluate while running',
                variablesReference: 0
            };
            this.sendResponse(response);
            return;
        }

        this.sendDebugCommand<{ status: string; result: string }>(`EVAL ${this.quoteWord(args.expression)} ${args.frameId === undefined ? 0 : this._serverFrames.get(args.frameId)}`).then(evalResult => {
            response.body = {
                result: evalResult.status === 'OK' ? evalResult.result : `Error: ${evalResult.result}`,
                variablesReference: 0
            };
            this.sendResponse(response);
        }).catch(error => this.sendErrorResponse(response, 2015, `Evaluation failed: ${error.message}`));
    }

    protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments): void {
        this.cleanup(args.terminateDebuggee ?? this._ownsProcess);
        this.sendResponse(response);
    }

    protected terminateRequest(response: DebugProtocol.TerminateResponse, _args: DebugProtocol.TerminateArguments): void {
        this.cleanup(true);
        this.sendResponse(response);
    }

    private cleanup(terminate = this._ownsProcess): void {
        for (const worker of this._workers.values()) worker.cleanup(terminate);
        this._workers.clear();
        if (this._socket && this._connected) {
            try {
                this._socket.end(terminate ? 'TERMINATE\n' : 'DETACH\n');
            } catch {
                // Ignore write errors during cleanup
            }
            this._socket = null;
            this._connected = false;
        }

        if (this._tclProcess && terminate) {
            const proc = this._tclProcess;
            this._tclProcess = null;
            proc.kill('SIGTERM');
            const forceKillTimer = setTimeout(() => {
                try { proc.kill('SIGKILL'); } catch { /* already dead */ }
            }, 2000);
            proc.once('exit', () => clearTimeout(forceKillTimer));
        }

        this.rejectPendingRequests(new Error('Debug session ended'));
        this.invalidateInspection();
    }

    private removeWorkerDirectory(): void {
        if (this._workerDirectory) {
            try { fs.rmSync(this._workerDirectory, { recursive: true, force: true }); } catch { /* Process may still hold a file on Windows. */ }
            this._workerDirectory = undefined;
        }
    }

    private rejectPendingRequests(error: Error): void {
        for (const request of this._debugRequests.splice(0)) {
            clearTimeout(request.timer);
            request.reject(error);
        }
    }
}
