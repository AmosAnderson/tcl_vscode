import * as assert from 'assert';
import { execFileSync, spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
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
    stdout = '';
    stderr = '';
    private child?: ChildProcessWithoutNullStreams;
    private socket?: net.Socket;
    private messages: string[] = [];
    private listeners = new Set<() => void>();

    async start(source: string, args: string[] = []): Promise<void> {
        fs.writeFileSync(this.file, source);
        const server = path.join(__dirname, '..', 'debug', 'scripts', 'debugServer.tcl');
        this.child = spawn('tclsh', [server, this.file, ...args], { cwd: this.directory });
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
        if (this.child!.exitCode === null) {
            await new Promise<void>(resolve => this.child!.once('exit', () => resolve()));
        }
        assert.strictEqual(this.stderr, '');
        assert.deepStrictEqual(this.messages.filter(message => message.startsWith('ERROR')), []);
        assert.deepStrictEqual(this.messages.filter(message => message.startsWith('PAUSED')), []);
    }

    dispose(): void {
        this.socket?.destroy();
        this.child?.kill();
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
            server.dispose();
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
            assert.strictEqual(await server.waitFor('PAUSED '), `PAUSED ${fs.realpathSync(server.file)} 4`);
            const variables = await server.request('VARS local', 'VARS');
            assert.ok(variables.includes('localValue\x1F11'), variables);
            const stack = await server.request('STACK', 'STACK');
            assert.ok(stack.includes(`::work\x1F${fs.realpathSync(server.file)}\x1F4`), stack);
            assert.strictEqual(await server.request(`EVAL ${tclWord('list $localValue $::globalValue {hello world}')}`, 'EVALRESULT'), 'EVALRESULT OK 11 7 {hello world}');
            assert.strictEqual(await server.request(`EVAL ${tclWord('set text "line one\\nline two"')}`, 'EVALRESULT'), 'EVALRESULT OK line one\nline two');
            await server.request(`CLEARFILE ${tclWord(server.file)}`, 'OK CLEARFILE');
            await server.request('CONTINUE', 'OK CONTINUE');
            await server.finish();
            assert.strictEqual(server.stdout.replace(/^DEBUG_PORT:\d+\r?\n/, ''), '11\n11\n');
        } finally {
            server.dispose();
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
            server.dispose();
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
            server.dispose();
        }
    });
});

interface AdapterInternals {
    _connected: boolean;
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

    replaceBreakpoints(file: string, lines: number[]): void {
        this.setBreakPointsRequest({ seq: 0, type: 'response', request_seq: 1, command: 'setBreakpoints', success: true, body: { breakpoints: [] } }, {
            source: { path: file },
            breakpoints: lines.map(line => ({ line })),
        });
    }
}

suite('Tcl debug adapter protocol', () => {
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
