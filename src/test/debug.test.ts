import * as assert from 'assert';
import { execFileSync, spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { DebugProtocol } from '@vscode/debugprotocol';
import { TclDebugSession } from '../debug/tclDebugAdapter';

function tclWord(value: string): string {
    if (!value) return '{}';
    return value.replace(/[\\\s{}[\]$";]/g, character => {
        if (character === '\n') return '\\n';
        if (character === '\r') return '\\r';
        if (character === '\t') return '\\t';
        return '\\' + character;
    });
}

class ServerHarness {
    readonly directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tcl-debug-test-'));
    readonly file = path.join(this.directory, 'sample with spaces.tcl');
    readonly token = randomBytes(32).toString('hex');
    port = 0;
    stdout = '';
    stderr = '';
    private child?: ChildProcessWithoutNullStreams;
    private socket?: net.Socket;
    private closed?: Promise<void>;
    private messages: string[] = [];
    private listeners = new Set<() => void>();

    async start(source: string, args: string[] = [], connect = true): Promise<void> {
        fs.writeFileSync(this.file, source);
        const server = path.join(__dirname, '..', 'debug', 'scripts', 'debugServer.tcl');
        this.child = spawn('tclsh', [server, this.file, ...args], { cwd: this.directory, env: { ...process.env, TCL_DEBUG_TOKEN: this.token, TCL_DEBUG_PORT: '0' } });
        this.closed = new Promise(resolve => this.child!.once('close', () => resolve()));
        this.child.stdout.setEncoding('utf8');
        this.child.stderr.setEncoding('utf8');
        this.child.stdout.on('data', (data: string) => { this.stdout += data; });
        this.child.stderr.on('data', (data: string) => { this.stderr += data; });
        const child = this.child;
        const port = await new Promise<number>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error(`Debug server startup timed out: ${this.stderr}`)), 5000);
            const onData = () => {
                const match = this.stdout.match(/DEBUG_PORT:(\d+)/);
                if (match) {
                    clearTimeout(timeout);
                    child.stdout.off('data', onData);
                    resolve(Number(match[1]));
                }
            };
            child.stdout.on('data', onData);
            child.once('error', error => { clearTimeout(timeout); reject(error); });
            child.once('exit', code => {
                clearTimeout(timeout);
                reject(new Error(`Debug server exited ${code}: ${this.stderr}`));
            });
        });
        this.port = port;
        if (!connect) return;
        this.socket = net.createConnection({ port, host: '127.0.0.1' });
        this.socket.setEncoding('utf8');
        let buffer = '';
        this.socket.on('data', (data: string) => {
            buffer += data;
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                this.messages.push(line.startsWith('DATA ') ? Buffer.from(line.substring(5), 'hex').toString('utf8') : line);
            }
            for (const listener of this.listeners) listener();
        });
        await new Promise<void>((resolve, reject) => {
            this.socket!.once('connect', resolve);
            this.socket!.once('error', reject);
        });
        await this.request(`HELLO 1 ${this.token}`, 'OK HELLO 1');
    }

    send(command: string): void {
        this.socket!.write(command + '\n');
    }

    waitFor(prefix: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.listeners.delete(check);
                reject(new Error(`Waiting for ${prefix}; received ${JSON.stringify(this.messages)}; stderr ${this.stderr}`));
            }, 5000);
            const check = () => {
                const index = this.messages.findIndex(message => message.startsWith(prefix));
                if (index >= 0) {
                    clearTimeout(timeout);
                    this.listeners.delete(check);
                    resolve(this.messages.splice(index, 1)[0]);
                }
            };
            this.listeners.add(check);
            check();
        });
    }

    async request(command: string, prefix: string): Promise<string> {
        this.send(command);
        return this.waitFor(prefix);
    }

    async finish(): Promise<void> {
        await this.waitFor('TERMINATED');
        await this.waitForExit();
        assert.strictEqual(this.stderr, '');
        assert.deepStrictEqual(this.messages.filter(message => message.startsWith('ERROR')), []);
        assert.deepStrictEqual(this.messages.filter(message => message.startsWith('PAUSED')), []);
    }

    async waitForExit(): Promise<void> {
        if (!this.closed) return;
        let timeout: NodeJS.Timeout | undefined;
        try {
            await Promise.race([
                this.closed,
                new Promise<never>((_, reject) => {
                    timeout = setTimeout(() => reject(new Error(`Child did not close: ${this.stderr}`)), 5000);
                })
            ]);
        } finally { clearTimeout(timeout); }
    }

    async dispose(): Promise<void> {
        this.socket?.destroy();
        if (this.child && this.child.exitCode === null && this.child.signalCode === null) this.child.kill();
        // Windows keeps the working directory locked until the process and its
        // stdio handles close, even after an exit event has been delivered.
        await this.waitForExit();
        fs.rmSync(this.directory, { recursive: true, force: true });
    }
}

suite('Tcl debug server integration', function () {
    this.timeout(15000);

    suiteSetup(function () {
        try {
            execFileSync('tclsh', { input: 'puts [info patchlevel]\n' });
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') this.skip();
            else throw error;
        }
    });

    test('shipped server preserves literal data, switch bodies, global scope, arguments and source paths', async () => {
        const server = new ServerHarness();
        try {
            fs.writeFileSync(path.join(server.directory, 'sibling.tcl'), 'set sibling sibling-loaded\n');
            const source = [
                'set data {',
                '  first',
                '  second',
                '}',
                'set x 7',
                'proc report {} {',
                '    global x',
                '    puts $x',
                '}',
                'report',
                'switch $x {',
                '    7 {puts matched}',
                '    default {error "wrong switch branch"}',
                '}',
                'source [file join [file dirname [info script]] sibling.tcl]',
                'puts [list $data $sibling $argv $argc [file tail $argv0] [file tail [info script]]]',
                'puts [namespace which report]',
            ].join('\n');
            await server.start(source, ['hello world', '{literal}']);
            const expected = execFileSync('tclsh', [server.file, 'hello world', '{literal}'], { encoding: 'utf8', cwd: server.directory });
            await server.request('CONFIGDONE', 'OK CONFIGDONE');
            await server.finish();
            assert.strictEqual(server.stdout.replace(/^DEBUG_PORT:\d+\r?\n/, ''), expected);
        } finally {
            await server.dispose();
        }
    });

    test('breaks on original procedure lines, evaluates in that frame, and clears active breakpoints', async () => {
        const server = new ServerHarness();
        try {
            const source = [
                'set globalValue 7',
                'proc work {} {',
                '    set localValue 11',
                '    puts $localValue',
                '}',
                'work',
                'work',
            ].join('\n');
            await server.start(source);
            await server.request(`BREAK ${tclWord(server.file)} 4 {} {}`, 'OK BREAK');
            await server.request('CONFIGDONE', 'OK CONFIGDONE');
            assert.strictEqual(await server.waitFor('PAUSED '), `PAUSED ${fs.realpathSync.native(server.file).replace(/\\/g, '/')} 4`);
            const variables = await server.request('VARS local', 'VARS');
            assert.ok(variables.includes('localValue\x1F11'), variables);
            const stack = await server.request('STACK', 'STACK');
            assert.ok(stack.includes(`::work\x1F${fs.realpathSync.native(server.file).replace(/\\/g, '/')}\x1F4`), stack);
            assert.strictEqual(await server.request(`EVAL ${tclWord('list $localValue $::globalValue {hello world}')}`, 'EVALRESULT'), 'EVALRESULT OK 11 7 {hello world}');
            assert.strictEqual(await server.request(`EVAL ${tclWord('set text "line one\\nline two"')}`, 'EVALRESULT'), 'EVALRESULT OK line one\nline two');
            await server.request(`CLEARFILE ${tclWord(server.file)}`, 'OK CLEARFILE');
            await server.request('CONTINUE', 'OK CONTINUE');
            await server.finish();
            assert.strictEqual(server.stdout.replace(/^DEBUG_PORT:\d+\r?\n/, ''), ['11', '11', ''].join(os.EOL));
        } finally {
            await server.dispose();
        }
    });

    test('inspects caller frames and edits only the requested local/global/array scope', async () => {
        const server = new ServerHarness();
        try {
            await server.start([
                'set shared GLOBAL',
                'array set values {key GLOBAL}',
                'proc outer {} {',
                '    set shared OUTER',
                '    array set values {key OUTER}',
                '    inner',
                '    puts "outer:$shared:$values(key)"',
                '}',
                'proc inner {} {',
                '    set shared INNER',
                '    array set values {key INNER}',
                '    puts "inner:$shared:$values(key)"',
                '}',
                'outer',
                'puts "global:$shared:$values(key)"',
            ].join('\n'));
            await server.request(`BREAK ${tclWord(server.file)} 12 {} {}`, 'OK BREAK');
            await server.request('CONFIGDONE', 'OK CONFIGDONE');
            await server.waitFor('PAUSED ');
            const stack = await server.request('STACK', 'STACK');
            assert.ok(stack.indexOf('::inner') < stack.indexOf('::outer'), stack);
            assert.strictEqual(await server.request('EVAL {set shared} 1', 'EVALRESULT'), 'EVALRESULT OK INNER');
            assert.strictEqual(await server.request('EVAL {set shared} 2', 'EVALRESULT'), 'EVALRESULT OK OUTER');
            assert.ok((await server.request('VARS local 2', 'VARS')).includes('shared\x1FOUTER'));
            assert.ok((await server.request('ARRAY values local 2', 'ARRAY')).includes('values(key)\x1FOUTER'));
            await server.request('SETVAR shared EDITED_OUTER local 2', 'OK SETVAR');
            await server.request('SETVAR shared EDITED_GLOBAL global 1', 'OK SETVAR');
            await server.request('SETVAR values(key) ARRAY_OUTER local 2', 'OK SETVAR');
            await server.request('SETVAR values(key) ARRAY_GLOBAL global 1', 'OK SETVAR');
            assert.match(await server.request('EVAL {set shared} 99', 'FAIL EVAL'), /no longer available/);
            await server.request('CONTINUE', 'OK CONTINUE');
            await server.finish();
            assert.strictEqual(server.stdout.replace(/^DEBUG_PORT:\d+\r?\n/, ''),
                ['inner:INNER:INNER', 'outer:EDITED_OUTER:ARRAY_OUTER', 'global:EDITED_GLOBAL:ARRAY_GLOBAL', ''].join(os.EOL));
        } finally { await server.dispose(); }
    });

    test('retains conditional breakpoints and interpolated logpoints', async () => {
        const server = new ServerHarness();
        try {
            await server.start('set total 0\nfor {set i 0} {$i < 3} {incr i} {\n    incr total\n    set last $i\n}\n');
            await server.request(`BREAK ${tclWord(server.file)} 3 ${tclWord('$i == 1')} {}`, 'OK BREAK');
            await server.request(`BREAK ${tclWord(server.file)} 4 {} ${tclWord('iteration {$i}')}`, 'OK BREAK');
            assert.match(await server.request('HELLO 99 invalid', 'FAIL HELLO'), /Unsupported debug protocol/);
            await server.request('CONFIGDONE', 'OK CONFIGDONE');
            await server.waitFor('PAUSED ');
            assert.strictEqual(await server.request('EVAL {set i}', 'EVALRESULT'), 'EVALRESULT OK 1');
            await server.request('CONTINUE', 'OK CONTINUE');
            await server.finish();
            for (const i of [0, 1, 2]) assert.strictEqual(await server.waitFor(`LOG iteration ${i}`), `LOG iteration ${i}`);
        } finally { await server.dispose(); }
    });

    test('coalesces a numeric substitution into its assignment and preserves later loop breakpoints', async () => {
        const server = new ServerHarness();
        try {
            await server.start([
                'proc mean {values} {', '    set sum 0', '    foreach v $values {',
                '        if {![string is double -strict $v]} {error invalid}',
                '        set sum [expr {$sum + $v}]', '    }',
                '    return [expr {$sum / double([llength $values])}]', '}', 'puts [mean {1 2}]'
            ].join('\n'));
            await server.request(`BREAK ${tclWord(server.file)} 5 {} {}`, 'OK BREAK');
            await server.request('CONFIGDONE', 'OK CONFIGDONE');
            assert.strictEqual(await server.waitFor('PAUSED'), `PAUSED ${fs.realpathSync.native(server.file).replace(/\\/g, '/')} 5`);
            assert.strictEqual(await server.waitFor('STOPREASON'), 'STOPREASON breakpoint');
            assert.strictEqual(await server.request('EVAL {list $sum $v}', 'EVALRESULT'), 'EVALRESULT OK 0 1');
            await server.request('STEP', 'OK STEP');
            assert.strictEqual(await server.waitFor('PAUSED'), `PAUSED ${fs.realpathSync.native(server.file).replace(/\\/g, '/')} 4`);
            assert.strictEqual(await server.waitFor('STOPREASON'), 'STOPREASON step');
            assert.strictEqual(await server.request('EVAL {list $sum $v}', 'EVALRESULT'), 'EVALRESULT OK 1 2');
            await server.request('CONTINUE', 'OK CONTINUE');
            assert.strictEqual(await server.waitFor('PAUSED'), `PAUSED ${fs.realpathSync.native(server.file).replace(/\\/g, '/')} 5`);
            assert.strictEqual(await server.waitFor('STOPREASON'), 'STOPREASON breakpoint');
            assert.strictEqual(await server.request('EVAL {list $sum $v}', 'EVALRESULT'), 'EVALRESULT OK 1 2');
            await server.request('CLEARALL', 'OK CLEARALL');
            await server.request('CONTINUE', 'OK CONTINUE');
            await server.finish();
            assert.match(server.stdout, /1\.5/);
        } finally { await server.dispose(); }
    });

    test('same-line loop visits and separate semicolon commands remain observable', async () => {
        const server = new ServerHarness();
        try {
            await server.start('set sum 0\nforeach v {1 2} {set sum [expr {$sum + $v}]; set seen $v}\nputs $sum');
            await server.request(`BREAK ${tclWord(server.file)} 2 {} {}`, 'OK BREAK');
            await server.request('CONFIGDONE', 'OK CONFIGDONE');
            assert.strictEqual(await server.waitFor('PAUSED'), `PAUSED ${fs.realpathSync.native(server.file).replace(/\\/g, '/')} 2`);
            for (const expected of ['0 1', '1 1', '1 2', '3 2']) {
                await server.request('CONTINUE', 'OK CONTINUE');
                assert.strictEqual(await server.waitFor('PAUSED'), `PAUSED ${fs.realpathSync.native(server.file).replace(/\\/g, '/')} 2`);
                assert.strictEqual(await server.request('EVAL {list $sum $v}', 'EVALRESULT'), `EVALRESULT OK ${expected}`);
            }
            await server.request('CONTINUE', 'OK CONTINUE');
            await server.finish();
            assert.match(server.stdout, /3/);
        } finally { await server.dispose(); }
    });

    test('step in enters a substituted procedure and step out completes its assignment', async () => {
        const server = new ServerHarness();
        try {
            await server.start('proc inner {n} {\n    set local $n\n    return $local\n}\nset result [inner 7]\nputs $result');
            await server.request(`BREAK ${tclWord(server.file)} 5 {} {}`, 'OK BREAK');
            await server.request('CONFIGDONE', 'OK CONFIGDONE');
            assert.strictEqual(await server.waitFor('PAUSED'), `PAUSED ${fs.realpathSync.native(server.file).replace(/\\/g, '/')} 5`);
            await server.waitFor('STOPREASON');
            await server.request('CLEARALL', 'OK CLEARALL');
            await server.request('STEPIN', 'OK STEPIN');
            assert.strictEqual(await server.waitFor('PAUSED'), `PAUSED ${fs.realpathSync.native(server.file).replace(/\\/g, '/')} 2`);
            assert.strictEqual(await server.waitFor('STOPREASON'), 'STOPREASON step');
            assert.strictEqual(await server.request('EVAL {set n}', 'EVALRESULT'), 'EVALRESULT OK 7');
            await server.request('STEPOUT', 'OK STEPOUT');
            assert.strictEqual(await server.waitFor('PAUSED'), `PAUSED ${fs.realpathSync.native(server.file).replace(/\\/g, '/')} 6`);
            assert.strictEqual(await server.waitFor('STOPREASON'), 'STOPREASON step');
            assert.strictEqual(await server.request('EVAL {set result}', 'EVALRESULT'), 'EVALRESULT OK 7');
            await server.request('CONTINUE', 'OK CONTINUE');
            await server.finish();
        } finally { await server.dispose(); }
    });

    test('explicit pause and stop on entry publish their own stop reasons', async () => {
        for (const [command, reason] of [['PAUSE', 'pause'], ['STEPIN', 'entry']]) {
            const server = new ServerHarness();
            try {
                await server.start('set value 1\nputs $value');
                await server.request(command, `OK ${command}`);
                await server.request('CONFIGDONE', 'OK CONFIGDONE');
                assert.strictEqual(await server.waitFor('PAUSED'), `PAUSED ${fs.realpathSync.native(server.file).replace(/\\/g, '/')} 1`);
                assert.strictEqual(await server.waitFor('STOPREASON'), `STOPREASON ${reason}`);
                await server.request('CONTINUE', 'OK CONTINUE');
                await server.finish();
            } finally { await server.dispose(); }
        }
    });

    test('stops before entry and steps over a procedure without stopping in its body', async () => {
        const server = new ServerHarness();
        try {
            await server.start('proc work {} {\n    set inner 3\n}\nwork\nputs done\n');
            await server.request('STEPIN', 'OK STEPIN');
            await server.request('CONFIGDONE', 'OK CONFIGDONE');
            assert.ok((await server.waitFor('PAUSED ')).endsWith(' 1'));
            await server.request('STEP', 'OK STEP');
            assert.ok((await server.waitFor('PAUSED ')).endsWith(' 4'));
            await server.request('STEP', 'OK STEP');
            assert.ok((await server.waitFor('PAUSED ')).endsWith(' 5'));
            await server.request('CONTINUE', 'OK CONTINUE');
            await server.finish();
        } finally {
            await server.dispose();
        }
    });

    test('observes breakpoint removal while the program is running without an event loop', async () => {
        const server = new ServerHarness();
        try {
            await server.start('after 100\nputs done\n');
            await server.request(`BREAK ${tclWord(server.file)} 2 {} {}`, 'OK BREAK');
            await server.request('CONFIGDONE', 'OK CONFIGDONE');
            await server.request(`CLEARFILE ${tclWord(server.file)}`, 'OK CLEARFILE');
            await server.finish();
        } finally {
            await server.dispose();
        }
    });
});

interface AdapterInternals {
    _connected: boolean;
    _handshakeComplete: boolean;
    _workerDirectory?: string;
    _tclProcess?: ChildProcessWithoutNullStreams;
    _sourceFileMap: Record<string, string>;
    mapSource(file: string, toRemote?: boolean): string;
    _configurationSent: boolean;
    _configDone: boolean;
    _stopOnEntry: boolean;
    _socket: { write(command: string): void };
    _breakpointUpdates: Promise<void>;
    _debugRequests: Array<{command: string}>;
    handleSocketData(data: string): void;
    sendDebugCommand<T = string>(command: string): Promise<T>;
    completeConfiguration(): Promise<void>;
}

class AdapterHarness extends TclDebugSession {
    readonly internals = this as unknown as AdapterInternals;
    readonly events: DebugProtocol.Event[] = [];
    private sequence = 0;
    private readonly messageListeners = new Set<(message: DebugProtocol.ProtocolMessage) => void>();

    constructor() {
        super();
        this.onDidSendMessage(message => {
            if ((message as DebugProtocol.ProtocolMessage).type === 'event') this.events.push(message as DebugProtocol.Event);
            for (const listener of this.messageListeners) listener(message as DebugProtocol.ProtocolMessage);
        });
    }

    request(command: string, args: unknown = {}): Promise<DebugProtocol.Response> {
        const seq = ++this.sequence;
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => { this.messageListeners.delete(listener); reject(new Error(`DAP ${command} timed out`)); }, 5000);
            const listener = (message: DebugProtocol.ProtocolMessage) => {
                if ((message as DebugProtocol.ProtocolMessage).type === 'response' && (message as DebugProtocol.Response).request_seq === seq) {
                    clearTimeout(timeout);
                    this.messageListeners.delete(listener);
                    resolve(message as DebugProtocol.Response);
                }
            };
            this.messageListeners.add(listener);
            this.dispatchRequest({ seq, type: 'request', command, arguments: args });
        });
    }

    waitForEvent(event: string): Promise<DebugProtocol.Event> {
        const existing = this.events.findIndex(item => item.event === event);
        if (existing >= 0) return Promise.resolve(this.events.splice(existing, 1)[0]);
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => { this.messageListeners.delete(listener); reject(new Error(`DAP ${event} event timed out; events ${JSON.stringify(this.events)}`)); }, 5000);
            const listener = (message: DebugProtocol.ProtocolMessage) => {
                if ((message as DebugProtocol.ProtocolMessage).type === 'event' && (message as DebugProtocol.Event).event === event) {
                    clearTimeout(timeout);
                    this.messageListeners.delete(listener);
                    const index = this.events.indexOf(message as DebugProtocol.Event);
                    if (index >= 0) this.events.splice(index, 1);
                    resolve(message as DebugProtocol.Event);
                }
            };
            this.messageListeners.add(listener);
        });
    }

    async dispose(): Promise<void> {
        const child = this.internals._tclProcess;
        const closed = child ? new Promise<void>(resolve => child.once('close', () => resolve())) : Promise.resolve();
        await this.request('disconnect');
        await closed;
    }

    replaceBreakpoints(file: string, lines: number[]): void {
        this.setBreakPointsRequest({ seq: 0, type: 'response', request_seq: 1, command: 'setBreakpoints', success: true, body: { breakpoints: [] } }, {
            source: { path: file },
            breakpoints: lines.map(line => ({ line })),
        });
    }
}

suite('Tcl debug adapter protocol', () => {
    test('maps Windows drive and UNC paths without case sensitivity while preserving POSIX case', () => {
        const adapter = new AdapterHarness().internals;
        adapter._sourceFileMap = {
            'C:/Temp/worker.tcl': 'C:/Users/Runner/Project/main.tcl',
            '//Server/Share/sources': 'D:/Project',
            '/remote/CaseSensitive': '/local/Project'
        };
        assert.strictEqual(adapter.mapSource('c:\\users\\runner\\project\\main.tcl', true), 'C:/Temp/worker.tcl');
        assert.strictEqual(adapter.mapSource('c:/temp/WORKER.tcl'), 'C:/Users/Runner/Project/main.tcl');
        assert.strictEqual(adapter.mapSource('\\\\server\\share\\sources\\main.tcl'), 'D:/Project/main.tcl');
        assert.strictEqual(adapter.mapSource('/remote/CaseSensitive/main.tcl'), '/local/Project/main.tcl');
        assert.strictEqual(adapter.mapSource('/remote/casesensitive/main.tcl'), '/remote/casesensitive/main.tcl');
        assert.strictEqual(adapter.mapSource('/remote/CaseSensitiveOther/main.tcl'), '/remote/CaseSensitiveOther/main.tcl');
    });

    test('reports server stop reasons and accepts legacy pause messages', async () => {
        const adapter = new AdapterHarness();
        for (const reason of ['entry', 'step', 'pause', 'breakpoint']) {
            adapter.internals.handleSocketData(`STOPREASON ${reason}\nPAUSED /tmp/file with spaces.tcl 18\n`);
            const stopped = await adapter.waitForEvent('stopped');
            assert.strictEqual(stopped.body.reason, reason);
        }
        adapter.internals.handleSocketData('PAUSED /tmp/legacy.tcl 2\n');
        assert.strictEqual((await adapter.waitForEvent('stopped')).body.reason, 'breakpoint');
    });

    test('matches EVALRESULT independently of older requests and preserves multiline replies', async () => {
        const adapter = new AdapterHarness().internals;
        adapter._connected = true;
        adapter._socket = { write() {} };
        const configuration = adapter.sendDebugCommand('CONFIGDONE');
        const evaluation = adapter.sendDebugCommand<{status: string; result: string}>('EVAL expression');
        const result = 'first line\nsecond line  ';
        adapter.handleSocketData(`DATA ${Buffer.from(`EVALRESULT OK ${result}`).toString('hex')}\n`);
        assert.deepStrictEqual(await evaluation, { status: 'OK', result });
        assert.deepStrictEqual(adapter._debugRequests.map(request => request.command), ['CONFIGDONE']);
        adapter.handleSocketData('OK CONFIGDONE\n');
        await configuration;
    });

    test('initial configuration acknowledges entry stepping before releasing the server', async () => {
        const adapter = new AdapterHarness().internals;
        adapter._connected = true;
        adapter._configDone = true;
        adapter._handshakeComplete = true;
        adapter._stopOnEntry = true;
        const commands: string[] = [];
        adapter._socket = { write(command) {
            commands.push(command.trim());
            queueMicrotask(() => adapter.handleSocketData(`OK ${command.trim()}\n`));
        } };
        await adapter.completeConfiguration();
        assert.deepStrictEqual(commands, ['STEPIN', 'CONFIGDONE']);
        assert.deepStrictEqual(adapter._debugRequests, []);
    });

    test('serializes breakpoint replacement and clears an empty replacement list', async () => {
        const session = new AdapterHarness();
        const adapter = session.internals;
        adapter._connected = true;
        adapter._configurationSent = true;
        const commands: string[] = [];
        adapter._socket = { write(command) {
            commands.push(command.trim());
            queueMicrotask(() => adapter.handleSocketData(`OK ${command.split(' ', 1)[0]}\n`));
        } };
        session.replaceBreakpoints('/tmp/example.tcl', [3]);
        session.replaceBreakpoints('/tmp/example.tcl', []);
        await adapter._breakpointUpdates;
        assert.deepStrictEqual(commands, [
            'CLEARFILE /tmp/example.tcl',
            'BREAK /tmp/example.tcl 3 {} {}',
            'CLEARFILE /tmp/example.tcl',
        ]);
    });
});


suite('Tcl debugger attach integration', function () {
    this.timeout(15000);

    test('authenticates an independent server, maps source paths, and detaches without terminating it', async () => {
        const server = new ServerHarness();
        const adapter = new AdapterHarness();
        try {
            await server.start('set value 7\nputs $value\nafter 100\nputs DETACHED_FINISHED\n', [], false);
            const localRoot = path.join(server.directory, 'editor');
            const localFile = path.join(localRoot, path.basename(server.file));
            fs.mkdirSync(localRoot);
            fs.copyFileSync(server.file, localFile);
            await adapter.request('initialize', { adapterID: 'tcl' });
            await adapter.request('setBreakpoints', { source: { path: localFile }, breakpoints: [{ line: 2 }] });
            const attached = await adapter.request('attach', {
                port: server.port, token: server.token,
                sourceFileMap: { [fs.realpathSync.native(server.directory)]: localRoot }
            });
            assert.strictEqual(attached.success, true, JSON.stringify(attached));
            await adapter.request('configurationDone');
            await adapter.waitForEvent('stopped');
            const stack = await adapter.request('stackTrace', { threadId: 1 });
            assert.strictEqual(stack.body.stackFrames[0].source.path, localFile.replace(/\\/g, '/'));
            const scopes = await adapter.request('scopes', { frameId: stack.body.stackFrames[0].id });
            const reference = scopes.body.scopes[1].variablesReference;
            const variables = await adapter.request('variables', { variablesReference: reference });
            assert.strictEqual(variables.success, true, JSON.stringify({ variables, stack, scopes }));
            assert.ok(variables.body.variables.some((variable: DebugProtocol.Variable) => variable.name === 'value' && variable.value === '7'));
            await adapter.request('disconnect');
            const stale = await adapter.request('variables', { variablesReference: reference });
            assert.strictEqual(stale.success, false);
            await server.waitForExit();
            assert.match(server.stdout, /7\r?\nDETACHED_FINISHED/);
            assert.strictEqual(server.stderr, '');
        } finally {
            await adapter.dispose();
            await server.dispose();
        }
    });

    test('rejects authentication errors while allowing a later valid client', async () => {
        const server = new ServerHarness();
        const bad = new AdapterHarness();
        const good = new AdapterHarness();
        try {
            await server.start('puts CONNECTED\n', [], false);
            const denied = await bad.request('attach', { port: server.port, token: 'incorrect-token-123456' });
            assert.strictEqual(denied.success, false);
            assert.match(denied.message || '', /authentication failed/);
            const accepted = await good.request('attach', { port: server.port, token: server.token });
            assert.strictEqual(accepted.success, true, JSON.stringify(accepted));
            await good.request('configurationDone');
            await server.waitForExit();
            assert.match(server.stdout, /CONNECTED/);
        } finally {
            await bad.request('disconnect');
            await good.request('disconnect');
            await server.dispose();
        }
    });

    test('fails clearly on unreachable endpoints and rejects direct remote hosts', async () => {
        const adapter = new AdapterHarness();
        const remote = await adapter.request('attach', { host: '192.0.2.1', port: 1234, token: 'long-enough-test-token' });
        assert.strictEqual(remote.success, false);
        assert.match(remote.message || '', /SSH tunnel/);
        const server = net.createServer();
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const port = (server.address() as net.AddressInfo).port;
        await new Promise<void>(resolve => server.close(() => resolve()));
        const failed = await adapter.request('attach', { port, token: 'long-enough-test-token', connectTimeout: 100 });
        assert.strictEqual(failed.success, false);
        assert.match(failed.message || '', /Attach failed/);
    });
});

suite('Tcl Thread debugger integration', function () {
    this.timeout(20000);

    suiteSetup(function () {
        try {
            const available = execFileSync('tclsh', { input: 'if {[catch {package require Thread}]} {exit 1}\n' });
            assert.ok(available !== undefined);
        } catch { this.skip(); }
    });

    test('shows two workers with independent frames, stepping, values, and exit events', async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tcl-thread-debug-'));
        const adapter = new AdapterHarness();
        try {
            const first = path.join(directory, 'first.tcl');
            const second = path.join(directory, 'second.tcl');
            const worker = (name: string) => [
                'proc worker {name} {',
                '    set value $name',
                '    set count 0',
                '    incr count',
                '    puts "$value:$count"',
                '}',
                `worker ${name}`
            ].join('\n');
            fs.writeFileSync(first, worker('FIRST'));
            fs.writeFileSync(second, worker('SECOND'));
            const main = path.join(directory, 'main.tcl');
            fs.writeFileSync(main, [
                'package require Thread',
                `set first [thread::create -joinable [list source ${tclWord(first)}]]`,
                `set second [thread::create -joinable [list source ${tclWord(second)}]]`,
                'thread::join $first',
                'thread::join $second',
                'puts ALL_DONE'
            ].join('\n'));
            await adapter.request('initialize', { adapterID: 'tcl' });
            for (const file of [first, second]) {
                await adapter.request('setBreakpoints', { source: { path: file }, breakpoints: [{ line: 4 }] });
            }
            const launched = await adapter.request('launch', { program: main, stopOnEntry: false, debugThreads: true });
            assert.strictEqual(launched.success, true, JSON.stringify(launched));
            await adapter.request('configurationDone');
            const stoppedA = await adapter.waitForEvent('stopped');
            const stoppedB = await adapter.waitForEvent('stopped');
            assert.notStrictEqual(stoppedA.body.threadId, stoppedB.body.threadId);
            const threads = await adapter.request('threads');
            assert.strictEqual(threads.body.threads.length, 3, JSON.stringify(threads));
            const frames = [];
            for (const event of [stoppedA, stoppedB]) {
                const stack = await adapter.request('stackTrace', { threadId: event.body.threadId });
                assert.strictEqual(stack.body.stackFrames[0].line, 4);
                const frameId = stack.body.stackFrames[0].id;
                const evaluated = await adapter.request('evaluate', { frameId, expression: 'set value' });
                const scopes = await adapter.request('scopes', { frameId });
                frames.push({ threadId: event.body.threadId, frameId, value: evaluated.body.result,
                    reference: scopes.body.scopes[0].variablesReference });
            }
            assert.deepStrictEqual(frames.map(frame => frame.value).sort(), ['FIRST', 'SECOND']);
            await adapter.request('next', { threadId: frames[0].threadId, singleThread: true });
            const stepped = await adapter.waitForEvent('stopped');
            assert.strictEqual(stepped.body.threadId, frames[0].threadId);
            assert.strictEqual(stepped.body.reason, 'step');
            const moved = await adapter.request('stackTrace', { threadId: frames[0].threadId });
            assert.strictEqual(moved.body.stackFrames[0].line, 5);
            const stationary = await adapter.request('stackTrace', { threadId: frames[1].threadId });
            assert.strictEqual(stationary.body.stackFrames[0].line, 4);
            const stale = await adapter.request('variables', { variablesReference: frames[0].reference });
            assert.strictEqual(stale.success, false);
            const otherVariables = await adapter.request('variables', { variablesReference: frames[1].reference });
            assert.strictEqual(otherVariables.success, true, JSON.stringify(otherVariables));
            assert.ok(otherVariables.body.variables.some((variable: DebugProtocol.Variable) => variable.name === 'count' && variable.value === '0'));
            await adapter.request('continue', { threadId: frames[0].threadId, singleThread: true });
            let exited: DebugProtocol.Event;
            do { exited = await adapter.waitForEvent('thread'); } while (exited.body.reason !== 'exited');
            assert.strictEqual(exited.body.threadId, frames[0].threadId);
            const remaining = await adapter.request('threads');
            assert.strictEqual(remaining.body.threads.length, 2);
            await adapter.request('continue', { threadId: frames[1].threadId, singleThread: true });
            await adapter.waitForEvent('terminated');
            const output = adapter.events.filter(event => event.event === 'output').map(event => event.body.output).join('');
            assert.match(output, /FIRST:1/, JSON.stringify(adapter.events));
            assert.match(output, /SECOND:1/);
            assert.match(output, /ALL_DONE/);
        } finally {
            await adapter.dispose();
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });
    test('maps a literal worker body to its original file and removes generated sources at exit', async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tcl-inline-thread-'));
        const adapter = new AdapterHarness();
        try {
            const main = path.join(directory, 'inline.tcl');
            fs.writeFileSync(main, [
                'package require Thread',
                'set worker [thread::create -joinable {',
                '    proc run {} {',
                '        set value INLINE',
                '        puts $value',
                '    }',
                '    run',
                '}]',
                'thread::join $worker'
            ].join('\n'));
            await adapter.request('initialize', { adapterID: 'tcl' });
            await adapter.request('setBreakpoints', { source: { path: main }, breakpoints: [{ line: 5 }] });
            await adapter.request('launch', { program: main, debugThreads: true, stopOnEntry: false });
            const generatedDirectory = adapter.internals._workerDirectory!;
            assert.ok(fs.existsSync(generatedDirectory));
            await adapter.request('configurationDone');
            const stopped = await adapter.waitForEvent('stopped');
            assert.notStrictEqual(stopped.body.threadId, 1);
            const stack = await adapter.request('stackTrace', { threadId: stopped.body.threadId });
            assert.strictEqual(stack.body.stackFrames[0].source.path, fs.realpathSync.native(main).replace(/\\/g, '/'));
            assert.strictEqual(stack.body.stackFrames[0].line, 5);
            const evaluated = await adapter.request('evaluate', { frameId: stack.body.stackFrames[0].id, expression: 'set value' });
            assert.strictEqual(evaluated.body.result, 'INLINE');
            await adapter.request('continue', { threadId: stopped.body.threadId, singleThread: true });
            await adapter.waitForEvent('terminated');
            assert.strictEqual(fs.existsSync(generatedDirectory), false);
        } finally {
            await adapter.dispose();
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });

});
