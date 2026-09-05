import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { spawnSync } from 'child_process';
import { TclTestProvider } from '../testing/testProvider';
import { TclCoverageProvider } from '../testing/coverageProvider';
import { discoverTclTests } from '../testing/testDiscovery';

type Mode = 'run' | 'debug' | 'coverage';
interface TestProviderAccess {
    discoverTests(uri: vscode.Uri): Promise<void>;
    execute(request: vscode.TestRunRequest, token: vscode.CancellationToken, mode: Mode): Promise<void>;
}
interface RecordedRun {
    states: Map<string, string>;
    output: string;
    files: vscode.FileCoverage[];
    ends: number;
    cancellation: vscode.CancellationTokenSource;
}

suite('Test provider integration', function () {
    this.timeout(20000);
    let directory: string;
    let controller: vscode.TestController;
    let coverage: TclCoverageProvider;
    let provider: TestProviderAccess;
    let latest: RecordedRun;
    let changes: vscode.EventEmitter<void>;
    const cleanup: vscode.Disposable[] = [];

    suiteSetup(async function () {
        if (spawnSync('tclsh', [], { input: 'exit 0\n', timeout: 5000 }).error) this.skip();
        const extension = vscode.extensions.getExtension('amos-anderson.tcl-syntax');
        assert.ok(extension, 'The development extension is available');
        await extension.activate();
        coverage = new TclCoverageProvider();
    });
    suiteTeardown(() => coverage?.dispose());
    setup(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tcl-provider-integration-'));
        controller = vscode.tests.createTestController(`fixture-${path.basename(directory)}`, 'Selected fixture tests');
        coverage.clearCoverage();
        changes = new vscode.EventEmitter<void>();
        provider = Object.assign(Object.create(TclTestProvider.prototype), {
            controller: {
                items: controller.items, createTestItem: controller.createTestItem.bind(controller),
                createTestRun: () => {
                    const record: RecordedRun = { states: new Map(), output: '', files: [], ends: 0, cancellation: new vscode.CancellationTokenSource() };
                    latest = record; cleanup.push(record.cancellation);
                    const set = (state: string) => (item: vscode.TestItem) => record.states.set(item.id, state);
                    return { token: record.cancellation.token, enqueued: set('enqueued'), started: set('started'), passed: set('passed'),
                        skipped: set('skipped'), failed: set('failed'), errored: set('errored'),
                        appendOutput: (value: string) => { record.output += value; },
                        addCoverage: (file: vscode.FileCoverage) => record.files.push(file), end: () => record.ends++ };
                }
            },
            data: new WeakMap(), runs: new Set(), details: new WeakMap(), coverage,
            output: { appendLine: () => {} }, changed: changes
        }) as TestProviderAccess;
    });
    teardown(async () => {
        cleanup.splice(0).forEach(disposable => disposable.dispose());
        changes.dispose(); controller.dispose();
        await fs.promises.rm(directory, { recursive: true, force: true });
    });

    async function fixture(name: string, source: string): Promise<vscode.TestItem> {
        const file = path.join(directory, name);
        await fs.promises.writeFile(file, source);
        const uri = vscode.Uri.file(file);
        await provider.discoverTests(uri);
        const item = controller.items.get(uri.toString());
        assert.ok(item, `Discovered ${name}`);
        return item;
    }
    function children(file: vscode.TestItem): vscode.TestItem[] {
        const items: vscode.TestItem[] = []; file.children.forEach(item => items.push(item)); return items;
    }
    async function execute(mode: Mode, request: vscode.TestRunRequest): Promise<void> {
        const cancellation = new vscode.CancellationTokenSource(); cleanup.push(cancellation);
        await provider.execute(request, cancellation.token, mode);
        assert.strictEqual(latest.ends, 1, 'Every run ends exactly once');
    }
    const cases = [
        'package require tcltest', 'namespace import ::tcltest::*',
        'test chosen {} -body {puts CHOSEN_BODY; expr {1 + 1}} -result 2',
        'test excluded {} -body {puts EXCLUDED_BODY; expr 3} -result 3', 'cleanupTests'
    ].join('\n');

    test('Run, Debug and Coverage execute the same leaf and honor file exclusions', async () => {
        const file = await fixture('selected.test', cases);
        const [chosen, excluded] = children(file);
        await fs.promises.writeFile(path.join(directory, 'ordinary-app.tcl'), 'puts UNRELATED_APPLICATION_RAN');
        for (const mode of ['run', 'debug', 'coverage'] as const) {
            await execute(mode, new vscode.TestRunRequest([file], [excluded]));
            assert.strictEqual(latest.states.get(chosen.id), 'passed', `${mode}: ${latest.output}`);
            assert.strictEqual(latest.states.has(excluded.id), false);
            assert.match(latest.output, /CHOSEN_BODY/);
            assert.ok(!latest.output.includes('EXCLUDED_BODY'), `${mode} must skip excluded bodies`);
            assert.ok(!latest.output.includes('UNRELATED_APPLICATION_RAN'), `${mode} must not source unrelated applications`);
            if (mode === 'coverage') {
                assert.ok(latest.files.length > 0);
                const native = latest.files.reduce((sum, entry) => sum + entry.statementCoverage.covered, 0);
                const exported = coverage.getCoverageData().reduce((sum, entry) => sum + entry.coveredLines, 0);
                assert.strictEqual(native, exported);
            }
        }
        await execute('run', new vscode.TestRunRequest([chosen], [file]));
        assert.strictEqual(latest.states.size, 0, 'An excluded ancestor also excludes explicitly included children');
    });

    test('overlapping Coverage requests publish only their own source files and totals', async () => {
        const slow = await fixture('slow.tcl', 'proc test_slow {} {after 200; puts SLOW}\n');
        const fast = await fixture('fast.tcl', 'proc test_fast {} {puts FAST}\n');
        const cancellation = new vscode.CancellationTokenSource(); cleanup.push(cancellation);
        const slowRun = provider.execute(new vscode.TestRunRequest([slow]), cancellation.token, 'coverage');
        const slowRecord = latest;
        const fastRun = provider.execute(new vscode.TestRunRequest([fast]), cancellation.token, 'coverage');
        const fastRecord = latest;
        await Promise.all([slowRun, fastRun]);
        for (const [record, item] of [[slowRecord, slow], [fastRecord, fast]] as const) {
            assert.strictEqual(record.ends, 1);
            assert.strictEqual(record.states.get(children(item)[0].id), 'passed', record.output);
            assert.ok(record.files.length > 0);
            assert.ok(record.files.every(file => fs.realpathSync(file.uri.fsPath) === fs.realpathSync(item.uri!.fsPath)));
        }
    });

    test('Debug procedure tests stop at breakpoints in the original selected body', async () => {
        const file = await fixture('procedure.tcl', 'proc test_chosen {} {\n    set value 42\n    puts "PROCEDURE_BODY:$value"\n}\nproc test_excluded {} {puts EXCLUDED_PROCEDURE}\n');
        const selected = children(file).find(item => item.label === '::test_chosen')!;
        const breakpoint = new vscode.SourceBreakpoint(new vscode.Location(file.uri!, new vscode.Position(1, 0)));
        vscode.debug.addBreakpoints([breakpoint]);
        cleanup.push({ dispose: () => vscode.debug.removeBreakpoints([breakpoint]) });
        let stoppedAtOriginal = false;
        let inspectionError: unknown;
        const tracker = vscode.debug.registerDebugAdapterTrackerFactory('tcl', {
            createDebugAdapterTracker(session) {
                if (!session.configuration.__tclTestRunner) return;
                return { onDidSendMessage(message) {
                    if (message.event !== 'stopped') return;
                    void (async () => {
                        try {
                            const stack = await session.customRequest('stackTrace', { threadId: message.body.threadId });
                            const frame = stack.stackFrames[0];
                            assert.strictEqual(fs.realpathSync(frame.source.path), fs.realpathSync(file.uri!.fsPath));
                            assert.strictEqual(frame.line, 2);
                            stoppedAtOriginal = true;
                        } catch (error) { inspectionError = error; }
                        finally { await session.customRequest('continue', { threadId: message.body.threadId }); }
                    })();
                } };
            }
        });
        cleanup.push(tracker);
        await execute('debug', new vscode.TestRunRequest([selected]));
        if (inspectionError) throw inspectionError;
        assert.strictEqual(stoppedAtOriginal, true, 'Debugger reaches the selected procedure in its original source');
        assert.strictEqual(latest.states.get(selected.id), 'passed', latest.output);
        assert.match(latest.output, /PROCEDURE_BODY:42/);
        assert.ok(!latest.output.includes('EXCLUDED_PROCEDURE'));
    });

    test('Run and Coverage cancellation stop the active child and allow the next run', async () => {
        const file = await fixture('cancel.tcl', 'proc test_forever {} {while {1} {}}\nproc test_next {} {puts NEXT_RUN}\n');
        const [forever, next] = children(file);
        for (const mode of ['run', 'coverage'] as const) {
            const cancellation = new vscode.CancellationTokenSource(); cleanup.push(cancellation);
            const started = Date.now();
            const pending = provider.execute(new vscode.TestRunRequest([forever]), cancellation.token, mode);
            const timer = setTimeout(() => mode === 'coverage' ? latest.cancellation.cancel() : cancellation.cancel(), 150);
            try { await pending; } finally { clearTimeout(timer); }
            assert.ok(Date.now() - started < 3000, `${mode} cancellation settles promptly`);
            assert.strictEqual(latest.states.get(forever.id), 'skipped');
            assert.strictEqual(latest.ends, 1);
            await execute(mode, new vscode.TestRunRequest([next]));
            assert.strictEqual(latest.states.get(next.id), 'passed', latest.output);
        }
    });

    test('Debug cancellation stops its owned session and a subsequent selected debug run succeeds', async () => {
        const file = await fixture('cancel-debug.tcl', 'proc test_forever {} {while {1} {}}\nproc test_next {} {puts NEXT_DEBUG_RUN}\n');
        const [forever, next] = children(file);
        const cancellation = new vscode.CancellationTokenSource(); cleanup.push(cancellation);
        let cancelled = false;
        cleanup.push(vscode.debug.onDidStartDebugSession(session => {
            if (session.configuration.__tclTestRunner && !cancelled) { cancelled = true; setTimeout(() => cancellation.cancel(), 100); }
        }));
        const started = Date.now();
        await provider.execute(new vscode.TestRunRequest([forever]), cancellation.token, 'debug');
        assert.ok(Date.now() - started < 10000, 'Debug cancellation settles promptly');
        assert.strictEqual(latest.states.get(forever.id), 'skipped');
        assert.strictEqual(latest.ends, 1);
        await execute('debug', new vscode.TestRunRequest([next]));
        assert.strictEqual(latest.states.get(next.id), 'passed', latest.output);
    });

    test('a missing discovered source errors only that item and the remaining queue runs', async () => {
        const broken = await fixture('deleted.tcl', 'proc test_missing {} {}\n');
        const valid = await fixture('valid.tcl', 'proc test_valid {} {puts SURVIVED}\n');
        await fs.promises.unlink(broken.uri!.fsPath);
        await execute('run', new vscode.TestRunRequest([broken, valid]));
        assert.notStrictEqual(latest.states.get(children(broken)[0].id), 'passed');
        assert.strictEqual(latest.states.get(children(valid)[0].id), 'passed', latest.output);
    });

    test('discovery finishing after disposal does not repopulate the controller', async () => {
        const file = path.join(directory, 'late.tcl');
        await fs.promises.writeFile(file, 'proc test_late {} {}\n');
        const pending = provider.discoverTests(vscode.Uri.file(file));
        (provider as unknown as { disposed: boolean }).disposed = true;
        await pending;
        assert.strictEqual(controller.items.size, 0);
    });

    test('discovery retains imports in reopened namespaces without leaking parent namespace imports', () => {
        const tests = discoverTclTests('namespace eval A {namespace import ::tcltest::*}\nnamespace eval A {test reopened {} -body {} -result {}}\nnamespace eval A::B {test unrelated {} -body {} -result {}}\n');
        assert.deepStrictEqual(tests.map(item => item.name), ['reopened']);
    });
});
