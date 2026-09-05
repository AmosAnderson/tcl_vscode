import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { runTests } from '@vscode/test-electron';

async function main() {
    const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), 'tcl-host-workspace-'));
    try {
        const folders = ['first', 'second'].map(name => {
            const root = path.join(fixtures, name);
            fs.mkdirSync(path.join(root, '.vscode'), { recursive: true });
            fs.writeFileSync(path.join(root, '.vscode', 'settings.json'), JSON.stringify({
                'tcl.interpreter.path': path.join(root, 'configured-tclsh'),
                'tcl.packages.autoDiscovery': false
            }));
            fs.writeFileSync(path.join(root, 'task-fixture.tcl'), 'error intentional_task_failure\n');
            fs.writeFileSync(path.join(root, '.vscode', 'tasks.json'), JSON.stringify({ version: '2.0.0', tasks: [{
                type: 'tcl', label: `Fixture ${name}`, script: 'task-fixture.tcl', interpreter: 'tclsh',
                problemMatcher: '$tcl', presentation: { reveal: 'never', panel: 'dedicated' }
            }] }));
            return { path: root, name };
        });
        const workspace = path.join(fixtures, 'integration.code-workspace');
        fs.writeFileSync(workspace, JSON.stringify({ folders }));
        // The folder containing the Extension Manifest package.json
        // Passed to `--extensionDevelopmentPath`
        const extensionDevelopmentPath = path.resolve(__dirname, '../../');

        // The path to test runner
        // Passed to --extensionTestsPath
        const extensionTestsPath = path.resolve(__dirname, './suite/index');

        // Download VS Code, unzip it and run the integration test
        await runTests({ extensionDevelopmentPath, extensionTestsPath,
            version: process.env.VSCODE_TEST_VERSION || '1.136.1',
            vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH,
            extensionTestsEnv: { TCL_TEST_PATH: process.env.PATH },
            launchArgs: [workspace, '--disable-extensions', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust'] });
    } catch (error) {
        console.error('Failed to run tests', error);
        process.exitCode = 1;
    } finally {
        fs.rmSync(fixtures, { recursive: true, force: true });
    }
}

main();
