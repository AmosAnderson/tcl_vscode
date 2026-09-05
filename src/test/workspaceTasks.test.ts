import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { resolveTclCwd, resolveTclInterpreter } from '../tools/executionContext';

suite('Workspace context and native tasks', function () {
    this.timeout(20000);
    test('folder settings and explicit feature overrides select the correct interpreter', async () => {
        const folders = vscode.workspace.workspaceFolders!;
        assert.strictEqual(folders.length, 2, 'The integration launcher provides an isolated two-folder workspace');
        for (const folder of folders) {
            const resource = vscode.Uri.joinPath(folder.uri, 'task-fixture.tcl');
            const expected = path.join(folder.uri.fsPath, 'configured-tclsh');
            assert.strictEqual(resolveTclInterpreter(resource), expected);
            assert.strictEqual(resolveTclInterpreter(resource, 'repl'), expected, 'Manifest defaults do not mask the general interpreter');
            assert.strictEqual(resolveTclInterpreter(resource, 'test'), expected);
            assert.strictEqual(resolveTclCwd(resource), folder.uri.fsPath);
        }
        const resource = folders[1].uri;
        const config = vscode.workspace.getConfiguration('tcl', resource);
        try {
            await config.update('test.tclPath', 'explicit-test-interpreter', vscode.ConfigurationTarget.WorkspaceFolder);
            assert.strictEqual(resolveTclInterpreter(resource, 'test'), 'explicit-test-interpreter');
            assert.strictEqual(resolveTclInterpreter(resource, 'test', 'task-override'), 'task-override');
            assert.strictEqual(resolveTclInterpreter(folders[0].uri, 'test'), path.join(folders[0].uri.fsPath, 'configured-tclsh'));
        } finally { await config.update('test.tclPath', undefined, vscode.ConfigurationTarget.WorkspaceFolder); }
    });

    test('native task resolution runs in the second folder and publishes a source diagnostic', async () => {
        const tasks = await vscode.tasks.fetchTasks({ type: 'tcl' });
        const task = tasks.find(item => item.name === 'Fixture second');
        assert.ok(task, 'Saved Tcl tasks resolve without a TCL tooling command');
        assert.strictEqual((task.scope as vscode.WorkspaceFolder).name, 'second');
        assert.ok(task.execution instanceof vscode.ProcessExecution);
        assert.strictEqual(task.execution.options?.cwd, vscode.workspace.workspaceFolders![1].uri.fsPath);
        assert.strictEqual(task.presentationOptions.reveal, vscode.TaskRevealKind.Never);
        let timeout: ReturnType<typeof setTimeout>;
        let subscription: vscode.Disposable | undefined;
        try {
            const ended = new Promise<number | undefined>((resolve, reject) => {
                timeout = setTimeout(() => reject(new Error('Native Tcl task did not finish')), 15000);
                subscription = vscode.tasks.onDidEndTaskProcess(event => {
                    if (event.execution.task.name === task.name) resolve(event.exitCode);
                });
            });
            await vscode.tasks.executeTask(task);
            assert.strictEqual(await ended, 1);
            const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![1].uri, 'task-fixture.tcl');
            const deadline = Date.now() + 2000;
            while (!vscode.languages.getDiagnostics(uri).some(item => item.range.start.line === 0) && Date.now() < deadline) {
                await new Promise(resolve => setTimeout(resolve, 20));
            }
            assert.ok(vscode.languages.getDiagnostics(uri).some(item => item.range.start.line === 0), 'The $tcl matcher publishes a clickable file and line');
        } finally { clearTimeout(timeout!); subscription?.dispose(); }
    });
});
