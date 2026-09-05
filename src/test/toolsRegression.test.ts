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
import { TclPackageManager } from '../tools/packageManager';
import { TclDependencyManager, Dependency } from '../tools/dependencyManager';
import { executeTclDataScript, satisfiesPackageVersion, tclLiteral } from '../tools/tclProcess';
import { parsePackageRequirements } from '../tools/packageModel';
import { TclREPLProvider } from '../debug/tclREPL';

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
        const constraint = execute('package require tcltest\nputs [::tcltest::testConstraint unix]\n');
        assert.strictEqual(constraint.status, 0, constraint.stderr);
        const skipped = constraint.stdout.trim() === '1' ? 0 : 1;
        const runner = path.join(directory, 'run_tests.tcl');
        const passing = spawnSync('tclsh', [runner], { cwd: os.tmpdir(), encoding: 'utf8', timeout: 5000 });
        assert.strictEqual(passing.status, 0, passing.stderr);
        assert.match(passing.stdout, new RegExp(`Total\\s+4\\s+Passed\\s+${4 - skipped}\\s+Skipped\\s+${skipped}\\s+Failed\\s+0`));
        const file = path.join(directory, 'tests', 'example.test');
        fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('} -result "test value"', '} -result "incorrect result"'));
        const failing = spawnSync('tclsh', [runner], { cwd: os.tmpdir(), encoding: 'utf8', timeout: 5000 });
        assert.strictEqual(failing.status, 1, failing.stdout + failing.stderr);
        assert.match(failing.stdout, new RegExp(`Total\\s+4\\s+Passed\\s+${3 - skipped}\\s+Skipped\\s+${skipped}\\s+Failed\\s+1`));
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
            'require extra 1.0', 'source main.tcl', 'error packaging_must_not_execute_metadata'
        ].join('\n'));
        fs.writeFileSync(path.join(directory, 'main.tcl'), 'set initialized [dependencyReady]\npackage provide example 1.2\n');
        const provider = new TclTaskProvider(directory) as unknown as {
            createPackageTasks(): vscode.Task[];
        };
        const tasks = provider.createPackageTasks();
        assert.ok(tasks[0].execution instanceof vscode.CustomExecution);
        const pack = tasks[1].execution as vscode.ProcessExecution;
        scripts.push(...pack.args);
        for (const execution of [pack]) {
            assert.strictEqual(execution.options?.cwd, directory);
            const result = spawnSync('tclsh', execution.args, { cwd: directory, encoding: 'utf8', timeout: 5000 });
            assert.strictEqual(result.status, 0, result.stdout + result.stderr);
        }
        assert.ok(fs.existsSync(path.join(directory, 'example-1.2.tar')));
    });

    test('named package scaffold loads, builds and runs its generated suite', async function () {
        requireTcl(this);
        await new TclProjectTemplates().createProject('package', directory, { name: 'named-package', namespace: 'Named', version: '2.3' });
        const loaded = execute(`lappend auto_path "${escapeTclString(directory)}"\npackage require -exact named-package 2.3\nputs [::Named::hello World]\n`);
        assert.strictEqual(loaded.status, 0, loaded.stderr);
        assert.match(loaded.stdout, /Hello, World from named-package/);
        const tests = spawnSync('tclsh', [path.join(directory, 'run_tests.tcl')], { cwd: os.tmpdir(), encoding: 'utf8', timeout: 5000 });
        assert.strictEqual(tests.status, 0, tests.stderr + tests.stdout);
        assert.match(tests.stdout, /Total\s+3\s+Passed\s+3/);
        const build = spawnSync('tclsh', [path.join(directory, 'build.tcl')], { cwd: os.tmpdir(), encoding: 'utf8', timeout: 5000 });
        assert.strictEqual(build.status, 0, build.stderr);
        assert.ok(fs.existsSync(path.join(directory, 'build', 'pkgIndex.tcl')));
    });

    test('task discovery omits missing runners and preserves configured task customizations', async () => {
        const provider = new TclTaskProvider(directory);
        const initial = await provider.provideTasks();
        assert.ok(initial);
        assert.ok(!initial.some(task => task.definition.command === 'run_tests' || task.definition.command === 'build_package'));
        fs.writeFileSync(path.join(directory, 'run_tests.tcl'), 'exit 0');
        const discovered = await provider.provideTasks();
        assert.ok(discovered?.some(task => task.definition.command === 'run_tests'));
        const custom = new vscode.Task({ type: 'tcl', script: 'main.tcl', args: ['', '日本語', 'two words'], interpreter: '/chosen/tcl', cwd: directory, env: { TEST_VALUE: 'true' } },
            vscode.TaskScope.Workspace, 'Custom label', 'tcl');
        custom.detail = 'Custom detail'; custom.group = vscode.TaskGroup.Test; custom.presentationOptions = { focus: true };
        const resolved = provider.resolveTask(custom)!;
        assert.strictEqual(resolved.name, custom.name);
        assert.strictEqual(resolved.detail, custom.detail);
        assert.strictEqual(resolved.group, custom.group);
        assert.strictEqual(resolved.presentationOptions.focus, true);
        const execution = resolved.execution as vscode.ProcessExecution;
        assert.strictEqual(execution.process, '/chosen/tcl');
        assert.deepStrictEqual(execution.args, ['main.tcl', '', '日本語', 'two words']);
        assert.deepStrictEqual(execution.options?.env, { TEST_VALUE: 'true' });
    });

    test('local installer loads a missing package and never overwrites an existing destination', async function () {
        requireTcl(this);
        const source = path.join(directory, 'source'), target = path.join(directory, 'target');
        await new TclProjectTemplates().createProject('package', source, { name: 'LocalFixture', version: '1.2' });
        fs.mkdirSync(target);
        const manager = Object.assign(Object.create(TclPackageManager.prototype), {
            outputChannel: { appendLine: () => {} }, getAutoPath: async () => [target], ensurePackages: async () => {},
            verifyInstalled: async (name: string, version: string) => {
                const result = await executeTclDataScript('tclsh', `lappend auto_path ${tclLiteral(target)}\nputs [package require -exact ${tclLiteral(name)} ${tclLiteral(version)}]`);
                return result === version;
            }
        }) as TclPackageManager;
        assert.strictEqual(await manager.installFromDirectory(source, 'LocalFixture', '1.2', target), true);
        await assert.rejects(manager.installFromDirectory(source, 'LocalFixture', '1.2', target), /already exists/);
        await assert.rejects(manager.installFromDirectory(source, 'LocalFixture', '2.0', target), /requested package and version/);
        assert.match(fs.readFileSync(path.join(target, 'LocalFixture-1.2', 'pkgIndex.tcl'), 'utf8'), /LocalFixture 1.2/);
    });

    test('dependency resolution reports incompatible requirements and discovers compatible updates', async function () {
        requireTcl(this);
        const resource = vscode.Uri.file(directory);
        const dependency = (text: string): Dependency => ({ name: 'Example', version: '', source: 'fixture.tcl', status: 'missing', resource,
            requirements: parsePackageRequirements(text, 'fixture.tcl') });
        const conflicting = dependency('package require Example 1.0\npackage require Example 2.0');
        const available = dependency('package require Example 1.0');
        const packageManager = {
            getPackages: () => [{ name: 'Example', version: '1.2', location: 'fixture' }],
            getAvailableVersions: async () => ['2.0', '1.8', '1.2'],
            isCompatible: (version: string, required: string[], exact: boolean) => satisfiesPackageVersion('tclsh', version, required, exact)
        };
        const manager = Object.assign(Object.create(TclDependencyManager.prototype), { packageManager, outputChannel: { appendLine: () => {} },
            dependencies: { dependencies: [conflicting, available], devDependencies: [], lastChecked: new Date() }
        }) as TclDependencyManager;
        await (manager as unknown as { checkDependencyStatus(): Promise<void> }).checkDependencyStatus();
        assert.strictEqual(conflicting.status, 'conflict');
        assert.strictEqual(available.status, 'available');
        const updates = await (manager as TclDependencyManager).findUpdates();
        assert.deepStrictEqual(updates.map(item => item.updateVersion), ['1.8']);
    });

    test('REPL startup coalesces concurrent calls and resets after terminal close or context change', async () => {
        let onClose: (terminal: vscode.Terminal) => void = () => {};
        const terminals: vscode.Terminal[] = [];
        const contexts: vscode.TerminalOptions[] = [];
        let interpreter = 'first-tcl';
        const provider = new TclREPLProvider({
            interpreter: () => interpreter, cwd: () => directory, which: async command => command,
            onDidCloseTerminal: listener => { onClose = listener; return { dispose: () => {} }; },
            createTerminal: options => {
                const terminal = { show: () => {}, dispose: () => onClose(terminal) } as unknown as vscode.Terminal;
                terminals.push(terminal); contexts.push(options); return terminal;
            }
        });
        try {
            await Promise.all([provider.startREPL(), provider.startREPL(), provider.startREPL()]);
            assert.strictEqual(terminals.length, 1);
            onClose(terminals[0]);
            await provider.startREPL();
            assert.strictEqual(terminals.length, 2);
            interpreter = 'second-tcl';
            await provider.startREPL();
            assert.strictEqual(terminals.length, 3);
            assert.strictEqual(contexts[2].shellPath, 'second-tcl');
            assert.strictEqual(contexts[2].cwd, directory);
        } finally { provider.dispose(); }
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
            controller,
            data: new WeakMap(),
            output,
            changed: { fire: () => {} }
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
