import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { createTempTclPath } from '../utils/tclUtils';
import { createTestExecutionScript, TclTestKind, TEST_RESULT_PREFIX } from './testExecution';
import { createCoverageExecutionScript, COVERAGE_END } from './coverageExecution';
import { TclCoverageProvider } from './coverageProvider';
import { parseCoverageReports } from './coverageResults';
import { stripTestProtocolOutput } from './testOutput';
import { discoverTclTests } from './testDiscovery';
import { executeTclScript, TclProcessResult } from './testProcess';
import { resolveTclCwd, resolveTclInterpreter } from '../tools/executionContext';

type RunMode = 'run' | 'debug' | 'coverage';
interface TestData { file: string; name: string; line: number; kind: TclTestKind; }

export class TclTestProvider implements vscode.Disposable {
    private readonly controller = vscode.tests.createTestController('tclTests', 'TCL Tests');
    private readonly output = vscode.window.createOutputChannel('TCL Tests');
    private readonly data = new WeakMap<vscode.TestItem, TestData>();
    private readonly disposables: vscode.Disposable[] = [];
    private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly discoveryVersions = new Map<string, number>();
    private refreshVersion = 0;
    private disposed = false;
    private readonly runs = new Set<AbortController>();
    private readonly details = new WeakMap<vscode.FileCoverage, vscode.StatementCoverage[]>();
    private readonly changed = new vscode.EventEmitter<void>();
    public readonly onDidChangeTests = this.changed.event;

    constructor(private readonly coverage?: TclCoverageProvider) {
        for (const [mode, kind] of [['run', vscode.TestRunProfileKind.Run], ['debug', vscode.TestRunProfileKind.Debug], ['coverage', vscode.TestRunProfileKind.Coverage]] as const) {
            const profile = this.controller.createRunProfile(`${mode[0].toUpperCase() + mode.slice(1)} TCL Tests`, kind,
                (request, token) => this.execute(request, token, mode), true);
            if (mode === 'coverage') profile.loadDetailedCoverage = async (_run, file) => this.details.get(file) ?? [];
        }
        this.controller.refreshHandler = () => this.discoverAllTests();
        const watcher = vscode.workspace.createFileSystemWatcher('**/*.{tcl,tk,tm,test}');
        this.disposables.push(watcher,
            watcher.onDidCreate(uri => this.schedule(uri)), watcher.onDidChange(uri => this.schedule(uri)),
            watcher.onDidDelete(uri => {
                const key = uri.toString();
                clearTimeout(this.pending.get(key)); this.pending.delete(key);
                this.discoveryVersions.set(key, (this.discoveryVersions.get(key) ?? 0) + 1);
                this.controller.items.delete(key); this.changed.fire();
            }),
            vscode.workspace.onDidChangeTextDocument(event => { if (event.document.languageId === 'tcl') this.schedule(event.document.uri); }),
            vscode.workspace.onDidCloseTextDocument(document => { if (document.languageId === 'tcl') this.schedule(document.uri); }),
            vscode.workspace.onDidChangeWorkspaceFolders(() => this.discoverAllTests()));
    }

    private schedule(uri: vscode.Uri): void {
        if (this.disposed) return;
        this.discoveryVersions.set(uri.toString(), (this.discoveryVersions.get(uri.toString()) ?? 0) + 1);
        clearTimeout(this.pending.get(uri.toString()));
        this.pending.set(uri.toString(), setTimeout(() => {
            this.pending.delete(uri.toString());
            void this.discoverTests(uri);
        }, 200));
    }

    public async discoverAllTests(): Promise<void> {
        if (this.disposed) return;
        const version = ++this.refreshVersion;
        const files = await vscode.workspace.findFiles('**/*.{tcl,tk,tm,test}', '**/{node_modules,.git}/**');
        if (this.disposed || version !== this.refreshVersion) return;
        const keys = new Set(files.map(uri => uri.toString()));
        for (const key of this.discoveryVersions.keys()) {
            if (!keys.has(key)) this.discoveryVersions.set(key, this.discoveryVersions.get(key)! + 1);
        }
        this.controller.items.forEach(item => { if (!keys.has(item.id)) this.controller.items.delete(item.id); });
        await Promise.all(files.map(uri => this.discoverTests(uri)));
    }

    private async discoverTests(uri: vscode.Uri): Promise<void> {
        if (this.disposed) return;
        const version = this.discoveryVersions?.get(uri.toString()) ?? 0;
        this.discoveryVersions?.set(uri.toString(), version);
        try {
            const document = await vscode.workspace.openTextDocument(uri);
            if (this.disposed || version !== (this.discoveryVersions?.get(uri.toString()) ?? 0)) return;
            const declarations = discoverTclTests(document.getText());
            if (!declarations.length) { this.controller.items.delete(uri.toString()); this.changed.fire(); return; }
            const file = this.controller.items.get(uri.toString()) ?? this.controller.createTestItem(uri.toString(), path.basename(uri.fsPath), uri);
            this.controller.items.add(file);
            const items = declarations.map(declaration => {
                const id = `${uri.toString()}::${declaration.kind}::${declaration.name}`;
                const item = file.children.get(id) ?? this.controller.createTestItem(id, declaration.name, uri);
                item.range = new vscode.Range(document.positionAt(declaration.start), document.positionAt(declaration.end));
                this.data.set(item, { file: uri.fsPath, name: declaration.name, line: item.range.start.line + 1, kind: declaration.kind });
                return item;
            });
            file.children.replace(items);
            this.changed.fire();
        } catch (error) { if (!this.disposed) this.output.appendLine(`Test discovery: ${error}`); }
    }

    public getTestLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        const lenses: vscode.CodeLens[] = [];
        this.controller.items.get(document.uri.toString())?.children.forEach(item => {
            if (!item.range) return;
            for (const mode of ['run', 'debug'] as const) lenses.push(new vscode.CodeLens(item.range, {
                title: mode === 'run' ? 'Run Test' : 'Debug Test', command: 'tcl.runTestItem', arguments: [item.id, mode]
            }));
        });
        return lenses;
    }

    public async runTestItem(id?: string, mode: RunMode = 'run'): Promise<void> {
        await this.discoverAllTests();
        let selected: vscode.TestItem | undefined;
        this.controller.items.forEach(file => { if (file.id === id) selected = file; file.children.forEach(item => { if (item.id === id) selected = item; }); });
        if (id && !selected) { vscode.window.showInformationMessage('This test no longer exists. Refresh Test Explorer.'); return; }
        const cancellation = new vscode.CancellationTokenSource();
        try { await this.execute(new vscode.TestRunRequest(selected ? [selected] : undefined), cancellation.token, mode); }
        finally { cancellation.dispose(); }
    }

    private select(request: vscode.TestRunRequest): vscode.TestItem[] {
        const excluded = new Set(request.exclude?.map(item => item.id));
        const queue = new Map<string, vscode.TestItem>();
        const add = (item: vscode.TestItem): void => {
            for (let ancestor: vscode.TestItem | undefined = item; ancestor; ancestor = ancestor.parent) {
                if (excluded.has(ancestor.id)) return;
            }
            if (this.data.has(item)) queue.set(item.id, item);
            else item.children.forEach(add);
        };
        if (request.include) request.include.forEach(add); else this.controller.items.forEach(add);
        return [...queue.values()];
    }

    private async execute(request: vscode.TestRunRequest, token: vscode.CancellationToken, mode: RunMode): Promise<void> {
        const run = this.controller.createTestRun(request);
        const abort = new AbortController();
        const cancel = token.onCancellationRequested(() => abort.abort());
        const cancelRun = run.token.onCancellationRequested(() => abort.abort());
        this.runs.add(abort);
        if (token.isCancellationRequested || run.token.isCancellationRequested) abort.abort();
        const queue = this.select(request);
        queue.forEach(item => run.enqueued(item));
        const coverageReports: string[] = [];
        try {
            for (const item of queue) {
                if (abort.signal.aborted) { run.skipped(item); continue; }
                const data = this.data.get(item)!;
                run.started(item);
                try {
                    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(data.file));
                    if (document.isDirty && !await document.save()) { run.skipped(item); continue; }
                    const result = mode === 'debug' ? await this.debugTest(data, abort.signal) : await this.runTest(data, mode, abort.signal);
                    if (mode === 'coverage' && result.stdout.includes(COVERAGE_END)) coverageReports.push(result.stdout);
                    const displayedOutput = stripTestProtocolOutput(result.stdout);
                    run.appendOutput((displayedOutput + result.stderr).replace(/\r?\n/g, '\r\n'), undefined, item);
                    const reported = result.stdout.split(/\r?\n/).filter(line => line.startsWith(TEST_RESULT_PREFIX)).pop()?.slice(TEST_RESULT_PREFIX.length);
                    if (result.code === 0 && reported === 'passed') run.passed(item, result.duration);
                    else if (result.code === 0 && reported === 'skipped') run.skipped(item);
                    else run.failed(item, new vscode.TestMessage(result.stderr || displayedOutput || 'Test exited without a result'), result.duration);
                } catch (error) {
                    if (abort.signal.aborted) run.skipped(item);
                    else run.errored(item, new vscode.TestMessage(String(error)));
                }
            }
        } finally {
            try {
                if (mode === 'coverage') {
                    const entries = parseCoverageReports(coverageReports);
                    for (const entry of entries) {
                        const file = new vscode.FileCoverage(vscode.Uri.file(entry.file), { covered: entry.coveredLines, total: entry.totalLines });
                        this.details.set(file, [...entry.lines].map(([line, hit]) => new vscode.StatementCoverage(hit.count, new vscode.Position(line - 1, 0))));
                        run.addCoverage(file);
                    }
                    this.coverage?.clearCoverage();
                    for (const report of coverageReports) this.coverage?.recordCoverage(report);
                }
            } catch (error) {
                run.appendOutput(`Could not publish coverage: ${error}\r\n`);
            } finally { cancel.dispose(); cancelRun.dispose(); this.runs.delete(abort); run.end(); }
        }
    }

    private async runTest(data: TestData, mode: RunMode, signal: AbortSignal): Promise<TclProcessResult> {
        const uri = vscode.Uri.file(data.file);
        let script = createTestExecutionScript(data.file, data.name, data.kind, { exit: mode !== 'coverage' });
        if (mode === 'coverage') script = createCoverageExecutionScript([], [
            vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath ?? path.dirname(data.file)
        ], script);
        const result = await executeTclScript(resolveTclInterpreter(uri, 'test'), script, resolveTclCwd(uri), signal);
        return result;
    }

    private async debugTest(data: TestData, signal: AbortSignal): Promise<TclProcessResult> {
        const runner = createTempTclPath('debug_test');
        const resultFile = createTempTclPath('debug_test_result');
        await fs.promises.writeFile(runner, createTestExecutionScript(data.file, data.name, data.kind, { resultFile }));
        const start = Date.now();
        let session: vscode.DebugSession | undefined;
        let output = '';
        const tracker = vscode.debug.registerDebugAdapterTrackerFactory('tcl', {
            createDebugAdapterTracker(candidate) {
                if (candidate.configuration.__tclTestRunner !== runner) return;
                return { onDidSendMessage(message) { if (message.event === 'output') output += message.body?.output ?? ''; } };
            }
        });
        const started = vscode.debug.onDidStartDebugSession(candidate => {
            if (candidate.configuration.__tclTestRunner === runner) { session = candidate; if (signal.aborted) void vscode.debug.stopDebugging(session); }
        });
        const abort = () => { if (session) void vscode.debug.stopDebugging(session); };
        signal.addEventListener('abort', abort, { once: true });
        let ended: vscode.Disposable | undefined;
        try {
            if (signal.aborted) throw new Error('Test run cancelled');
            const done = new Promise<void>(resolve => {
                ended = vscode.debug.onDidTerminateDebugSession(candidate => { if (candidate.configuration.__tclTestRunner === runner) resolve(); });
            });
            const uri = vscode.Uri.file(data.file);
            const launched = await vscode.debug.startDebugging(vscode.workspace.getWorkspaceFolder(uri), {
                type: 'tcl', request: 'launch', name: `Debug ${data.name}`, program: runner,
                tclPath: resolveTclInterpreter(uri, 'test'), cwd: resolveTclCwd(uri), stopOnEntry: false, __tclTestRunner: runner
            });
            if (!launched) throw new Error('Could not start test debugger');
            await done;
            if (signal.aborted) throw new Error('Test run cancelled');
            const status = (await fs.promises.readFile(resultFile, 'utf8').catch(() => 'failed')).trim();
            return { stdout: output + `\n${TEST_RESULT_PREFIX}${status}\n`, stderr: '', code: status === 'failed' ? 1 : 0, duration: Date.now() - start };
        } finally {
            ended?.dispose(); started.dispose(); tracker.dispose(); signal.removeEventListener('abort', abort);
            await Promise.all([runner, resultFile].map(file => fs.promises.unlink(file).catch(() => {})));
        }
    }

    public dispose(): void {
        this.disposed = true;
        this.runs.forEach(run => run.abort());
        this.pending.forEach(timer => clearTimeout(timer));
        this.disposables.forEach(disposable => disposable.dispose());
        this.changed.dispose(); this.controller.dispose(); this.output.dispose();
    }
}
