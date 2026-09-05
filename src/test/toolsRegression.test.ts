import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { spawnSync } from 'child_process';
import { TclProjectTemplates } from '../tools/projectTemplates';
import { TclTaskProvider } from '../tools/taskProvider';
import { TclInterpreter, TclInterpreterManager } from '../tools/interpreterManager';
import { TclTestProvider } from '../testing/testProvider';
import { escapeTclString } from '../utils/tclUtils';

suite('Tcl project and tool regressions', () => {
    let directory: string;
    const scripts: string[] = [];

    setup(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tcl-tools-tests-'));
    });

    teardown(() => {
        fs.rmSync(directory, { recursive: true, force: true });
        for (const script of scripts.splice(0)) { fs.rmSync(script, { force: true }); }
    });

    function requireTcl(context: Mocha.Context) {
        if (spawnSync('tclsh', [], { input: 'exit 0\n', timeout: 5000 }).error) { context.skip(); }
    }

    function execute(script: string, cwd = directory) {
        const file = path.join(directory, 'verification.tcl');
        fs.writeFileSync(file, script);
        return spawnSync('tclsh', [file], { cwd, encoding: 'utf8', timeout: 5000 });
    }

    test('scaffolding rejects occupied targets without modifying any existing file', async () => {
        const templates = new TclProjectTemplates();
        const main = path.join(directory, 'main.tcl');
        fs.writeFileSync(main, 'puts valuable_existing_code');
        await assert.rejects(templates.createProject('basic-app', directory), /already exists/);
        assert.strictEqual(fs.readFileSync(main, 'utf8'), 'puts valuable_existing_code');
        assert.deepStrictEqual(fs.readdirSync(directory), ['main.tcl']);
    });

    test('scaffolding accepts an empty target and refuses to replace a prior scaffold', async () => {
        const templates = new TclProjectTemplates();
        await templates.createProject('basic-app', directory);
        assert.ok(fs.existsSync(path.join(directory, 'lib', 'utils.tcl')));
        await assert.rejects(templates.createProject('package', directory), /already exists/);
    });

    test('generated packages can be loaded through auto_path', async function () {
        requireTcl(this);
        await new TclProjectTemplates().createProject('package', directory);
        const result = execute(`lappend auto_path "${escapeTclString(directory)}"\npackage require mypackage\nputs [::mypackage::hello World]\n`);
        assert.strictEqual(result.status, 0, result.stderr);
        assert.match(result.stdout, /Hello, World from mypackage!/);
    });

    test('generated suite executes each test once and exits nonzero after a failure', async function () {
        requireTcl(this);
        await new TclProjectTemplates().createProject('test-suite', directory);
        const runner = path.join(directory, 'run_tests.tcl');
        const passing = spawnSync('tclsh', [runner], { cwd: os.tmpdir(), encoding: 'utf8', timeout: 5000 });
        assert.strictEqual(passing.status, 0, passing.stderr);
        assert.match(passing.stdout, /Total\s+4\s+Passed\s+4/);
        const file = path.join(directory, 'tests', 'example.test');
        fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('} -result "test value"', '} -result "incorrect result"'));
        const failing = spawnSync('tclsh', [runner], { cwd: os.tmpdir(), encoding: 'utf8', timeout: 5000 });
        assert.strictEqual(failing.status, 1, failing.stdout + failing.stderr);
        assert.match(failing.stdout, /Total\s+4\s+Passed\s+3\s+Skipped\s+0\s+Failed\s+1/);
        assert.match(failing.stdout, /Sourced 1 Test Files/);
    });

    test('generated package build index can load its implementation', function () {
        requireTcl(this);
        const packageName = path.basename(directory);
        fs.writeFileSync(path.join(directory, 'main.tcl'), `package provide ${packageName} 1.0\n`);
        const provider = new TclTaskProvider(directory) as unknown as {
            createBuildPackageExecution(): vscode.ProcessExecution;
        };
        const execution = provider.createBuildPackageExecution();
        scripts.push(...execution.args);
        const build = spawnSync('tclsh', execution.args, { cwd: directory, encoding: 'utf8', timeout: 5000 });
        assert.strictEqual(build.status, 0, build.stderr);
        const loaded = execute(`lappend auto_path "${escapeTclString(path.join(directory, 'build'))}"\nputs [package require ${packageName}]\n`);
        assert.strictEqual(loaded.status, 0, loaded.stderr);
        assert.strictEqual(loaded.stdout.trim(), '1.0');
    });

    test('package actions invoke distinct helpers and create the requested archive', function () {
        requireTcl(this);
        if (spawnSync('tar', ['--version'], { timeout: 5000 }).error) { this.skip(); }
        fs.writeFileSync(path.join(directory, 'Package.tcl'), [
            'name example', 'version 1.2', 'description Test package',
            'package ifneeded extra 1.0 {proc dependencyReady {} {return ready}; package provide extra 1.0}',
            'require extra 1.0', 'source main.tcl'
        ].join('\n'));
        fs.writeFileSync(path.join(directory, 'main.tcl'), 'set initialized [dependencyReady]\npackage provide example 1.2\n');
        const provider = new TclTaskProvider(directory) as unknown as {
            createPackageTasks(): vscode.Task[];
        };
        const tasks = provider.createPackageTasks();
        const [install, pack] = tasks.map(task => task.execution as vscode.ProcessExecution);
        scripts.push(...install.args, ...pack.args);
        assert.notDeepStrictEqual(install.args, pack.args);
        for (const execution of [install, pack]) {
            assert.strictEqual(execution.options?.cwd, directory);
            const result = spawnSync('tclsh', execution.args, { cwd: directory, encoding: 'utf8', timeout: 5000 });
            assert.strictEqual(result.status, 0, result.stdout + result.stderr);
        }
        assert.ok(fs.existsSync(path.join(directory, 'example-1.2.tar')));
    });

    test('an explicit interpreter outside discovery remains selected', async function () {
        requireTcl(this);
        const manager = Object.assign(Object.create(TclInterpreterManager.prototype), {
            interpreters: [], currentInterpreter: null,
            outputChannel: { appendLine: (_message: string) => {}, dispose: () => {} }
        }) as TclInterpreterManager;
        const internal = manager as unknown as {
            interpreters: TclInterpreter[];
            loadConfiguration(selectedPath: string): Promise<void>;
        };
        const candidate = 'a-configured-interpreter-not-on-path';
        internal.interpreters = [{ path: 'tclsh', name: 'System', version: '8.5', type: 'system', isDefault: true }];
        try {
            await internal.loadConfiguration(candidate);
            assert.strictEqual(manager.getInterpreterPath(), candidate);
            assert.strictEqual(manager.getCurrentInterpreter()?.isDefault, true);
            assert.strictEqual(internal.interpreters[0].isDefault, false);
            await internal.loadConfiguration('tclsh');
            assert.strictEqual(manager.getInterpreterPath(), 'tclsh');
        } finally {
            manager.dispose();
        }
    });

    test('test discovery recognizes all imported declarations in generated projects', async () => {
        await new TclProjectTemplates().createProject('test-suite', directory);
        const controller = vscode.tests.createTestController('tcl-regression-discovery', 'Regression discovery');
        const discoveryErrors: string[] = [];
        const output = { appendLine: (line: string) => discoveryErrors.push(line) };
        const provider = Object.assign(Object.create(TclTestProvider.prototype), {
            _testController: controller,
            _testData: new WeakMap(),
            _outputChannel: output
        }) as { discoverTests(uri: vscode.Uri): Promise<void> };
        try {
            const uri = vscode.Uri.file(path.join(directory, 'tests', 'example.test'));
            await provider.discoverTests(uri);
            assert.deepStrictEqual(discoveryErrors, []);
            const fileItem = controller.items.get(uri.toString());
            assert.ok(fileItem);
            assert.strictEqual(fileItem.children.size, 4);
            const labels: string[] = [];
            fileItem.children.forEach(test => labels.push(test.label));
            assert.deepStrictEqual(labels.sort(), ['example-1.0', 'example-2.0', 'example-3.0', 'example-4.0']);
        } finally {
            controller.dispose();
        }
    });
});
