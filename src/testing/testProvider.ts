import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import { createTempTclPath } from '../utils/tclUtils';
import { createTestExecutionScript, TclTestKind, TEST_RESULT_PREFIX } from './testExecution';

interface TclTestResult {
    name: string;
    file: string;
    line: number;
    status: 'passed' | 'failed' | 'skipped';
    message?: string;
    duration?: number;
}

export class TclTestProvider {
    private _outputChannel: vscode.OutputChannel;
    private _testController: vscode.TestController;
    private _testData = new WeakMap<vscode.TestItem, { file: string; line: number; kind: TclTestKind }>();
    private _fileWatcher: vscode.FileSystemWatcher | undefined;
    private _runningProcesses = new Set<ChildProcess>();

    constructor() {
        this._outputChannel = vscode.window.createOutputChannel('TCL Tests');
        this._testController = vscode.tests.createTestController('tclTests', 'TCL Tests');

        // Set up test discovery and execution
        this._testController.createRunProfile(
            'Run TCL Tests',
            vscode.TestRunProfileKind.Run,
            this.runTests.bind(this),
            true
        );

        this._testController.createRunProfile(
            'Debug TCL Tests',
            vscode.TestRunProfileKind.Debug,
            this.debugTests.bind(this),
            true
        );

        // Watch for file changes to update tests
        this.setupFileWatcher();
    }

    private setupFileWatcher(): void {
        this._fileWatcher = vscode.workspace.createFileSystemWatcher('**/*.{test,tcl}');

        this._fileWatcher.onDidCreate(uri => this.discoverTests(uri));
        this._fileWatcher.onDidChange(uri => this.discoverTests(uri));
        this._fileWatcher.onDidDelete(uri => this.removeTests(uri));
    }

    public async discoverAllTests(): Promise<void> {
        // Find all TCL test files in the workspace
        const testFiles = await vscode.workspace.findFiles('**/*.test');
        const tclFiles = await vscode.workspace.findFiles('**/*.tcl');
        
        // Combine and filter for test files
        const allFiles = [...testFiles, ...tclFiles];
        
        for (const file of allFiles) {
            await this.discoverTests(file);
        }
    }

    private async discoverTests(uri: vscode.Uri): Promise<void> {
        try {
            const document = await vscode.workspace.openTextDocument(uri);
            
            // Check if this is a test file
            if (!this.isTestFile(document)) {
                this.removeTests(uri);
                return;
            }

            const content = document.getText();
            const lines = content.split('\n');
            
            // Create or get the test file item
            const testFile = this._testController.items.get(uri.toString()) || 
                this._testController.createTestItem(uri.toString(), path.basename(uri.fsPath), uri);
            
            if (!this._testController.items.get(uri.toString())) {
                this._testController.items.add(testFile);
            }

            // Clear existing tests for this file
            testFile.children.replace([]);

            // Discover test procedures
            this.discoverTestProcedures(testFile, lines, uri);
            
            // Discover test cases using tcltest package
            this.discoverTclTestCases(testFile, lines, uri);

        } catch (error) {
            this._outputChannel.appendLine(`Error discovering tests in ${uri.fsPath}: ${error}`);
        }
    }

    private isTestFile(document: vscode.TextDocument): boolean {
        const fileName = path.basename(document.fileName);
        const content = document.getText();
        
        // Check file extension
        if (fileName.endsWith('.test')) {
            return true;
        }

        // Check file content for test patterns
        return content.includes('package require tcltest') ||
               content.includes('::tcltest::test') ||
               /proc\s+test_\w+/.test(content) ||
               content.includes('tcltest::configure');
    }

    private discoverTestProcedures(testFile: vscode.TestItem, lines: string[], uri: vscode.Uri): void {
        // Look for procedures that start with "test_"
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const testProcMatch = line.match(/proc\s+(test_\w+)/);
            
            if (testProcMatch) {
                const testName = testProcMatch[1];
                const testId = `${uri.toString()}::${testName}`;
                
                const testItem = this._testController.createTestItem(
                    testId,
                    testName,
                    uri
                );
                
                testItem.range = new vscode.Range(i, 0, i, line.length);
                this._testData.set(testItem, { file: uri.fsPath, line: i + 1, kind: 'procedure' });
                
                testFile.children.add(testItem);
            }
        }
    }

    private discoverTclTestCases(testFile: vscode.TestItem, lines: string[], uri: vscode.Uri): void {
        // Bare test declarations are valid after importing tcltest's exported command.
        const importsTest = lines.some(line => /^\s*namespace\s+import\s+(?:-force\s+)?(?:::)?tcltest::(?:\*|test)(?:\s|$)/.test(line));
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const testMatch = line.match(/^\s*((?:::)?tcltest::test|test)\s+(?:"((?:\\.|[^"])*)"|\{([^}]*)\}|([^\s]+))/);
            if (testMatch?.[1] === 'test' && !importsTest) { continue; }

            if (testMatch) {
                const testName = testMatch[2] ?? testMatch[3] ?? testMatch[4];
                const testId = `${uri.toString()}::${testName}`;

                const testItem = this._testController.createTestItem(
                    testId,
                    testName,
                    uri
                );

                testItem.range = new vscode.Range(i, 0, i, line.length);
                this._testData.set(testItem, { file: uri.fsPath, line: i + 1, kind: 'tcltest' });

                testFile.children.add(testItem);
            }
        }
    }

    private removeTests(uri: vscode.Uri): void {
        this._testController.items.delete(uri.toString());
    }

    private async runTests(
        request: vscode.TestRunRequest,
        token: vscode.CancellationToken
    ): Promise<void> {
        const run = this._testController.createTestRun(request);
        const queue: vscode.TestItem[] = [];
        const excluded = new Set<string>(request.exclude?.map(test => test.id) ?? []);

        const enqueueRunnableTests = (test: vscode.TestItem): void => {
            if (excluded.has(test.id)) {
                return;
            }

            if (this._testData.has(test)) {
                queue.push(test);
                return;
            }

            test.children.forEach(child => enqueueRunnableTests(child));
        };

        // Collect runnable child tests rather than queuing file/container items.
        if (request.include) {
            request.include.forEach(enqueueRunnableTests);
        } else {
            this._testController.items.forEach(enqueueRunnableTests);
        }

        // Execute tests
        for (const test of queue) {
            if (token.isCancellationRequested) {
                run.end();
                return;
            }

            await this.runTest(test, run);
        }

        run.end();
    }

    private async debugTests(
        request: vscode.TestRunRequest,
        _token: vscode.CancellationToken
    ): Promise<void> {
        // For debugging, we'll run the test with the debugger
        if (request.include && request.include.length > 0) {
            const test = request.include[0];
            const data = this._testData.get(test);
            
            if (data) {
                // Launch debugger for the test file
                await vscode.debug.startDebugging(undefined, {
                    type: 'tcl',
                    name: 'Debug Test',
                    request: 'launch',
                    program: data.file,
                    stopOnEntry: true
                });
            }
        }
    }

    private async runTest(test: vscode.TestItem, run: vscode.TestRun): Promise<void> {
        const data = this._testData.get(test);
        if (!data) {
            run.skipped(test);
            return;
        }

        run.started(test);
        
        try {
            const result = await this.executeTest(data.file, test.label, data.kind);
            
            if (result.status === 'passed') {
                run.passed(test, result.duration);
            } else if (result.status === 'failed') {
                const message = new vscode.TestMessage(result.message || 'Test failed');
                run.failed(test, message, result.duration);
            } else {
                run.skipped(test);
            }
            
        } catch (error) {
            const message = new vscode.TestMessage(`Test execution error: ${error}`);
            run.failed(test, message);
        }
    }

    private async executeTest(file: string, testName: string, kind: TclTestKind): Promise<TclTestResult> {
        return new Promise((resolve, reject) => {
            const config = vscode.workspace.getConfiguration('tcl');
            const tclPath = config.get<string>('test.tclPath', 'tclsh');
            
            // Create a test execution script and write to temp file
            // (tclsh does not support a -c flag for inline script execution)
            const testScript = createTestExecutionScript(file, testName, kind);
            const tmpFile = createTempTclPath('test');
            fs.writeFileSync(tmpFile, testScript, 'utf8');

            const startTime = Date.now();
            const testProcess = spawn(tclPath, [tmpFile], {
                cwd: path.dirname(file),
                stdio: ['pipe', 'pipe', 'pipe']
            });

            this._runningProcesses.add(testProcess);
            let settled = false;
            let output = '';
            let errorOutput = '';
            let forceKillTimer: ReturnType<typeof setTimeout> | undefined;

            const settle = () => {
                this._runningProcesses.delete(testProcess);
                try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
            };

            // Timeout: kill test process after 60 seconds
            const timeoutTimer = setTimeout(() => {
                if (settled) { return; }
                settled = true;
                testProcess.kill('SIGTERM');
                forceKillTimer = setTimeout(() => {
                    try { testProcess.kill('SIGKILL'); } catch { /* already dead */ }
                }, 2000);
                settle();
                reject(new Error(`Test '${testName}' timed out after 60 seconds`));
            }, 60000);

            testProcess.stdout?.on('data', (data) => {
                output += data.toString();
            });

            testProcess.stderr?.on('data', (data) => {
                errorOutput += data.toString();
            });

            testProcess.on('close', (code) => {
                clearTimeout(timeoutTimer);
                if (forceKillTimer) { clearTimeout(forceKillTimer); }
                if (settled) { return; }
                settled = true;
                settle();
                const duration = Date.now() - startTime;

                const reported = output.split(/\r?\n/)
                    .filter(line => line.startsWith(TEST_RESULT_PREFIX)).pop()?.slice(TEST_RESULT_PREFIX.length);
                const status = code === 0 && (reported === 'passed' || reported === 'skipped')
                    ? reported : 'failed';
                const result: TclTestResult = {
                    name: testName,
                    file: file,
                    line: 0,
                    status,
                    duration: duration
                };

                if (status === 'failed') {
                    result.message = errorOutput || output || 'Test exited without reporting a result';
                }

                // Log test output
                this._outputChannel.appendLine(`Test: ${testName}`);
                this._outputChannel.appendLine(`Status: ${result.status}`);
                this._outputChannel.appendLine(`Duration: ${duration}ms`);
                if (output) {
                    this._outputChannel.appendLine(`Output: ${output}`);
                }
                if (errorOutput) {
                    this._outputChannel.appendLine(`Error: ${errorOutput}`);
                }
                this._outputChannel.appendLine('---');

                resolve(result);
            });

            testProcess.on('error', (error) => {
                clearTimeout(timeoutTimer);
                if (forceKillTimer) { clearTimeout(forceKillTimer); }
                if (settled) { return; }
                settled = true;
                settle();
                reject(error);
            });
        });
    }

    public dispose(): void {
        for (const proc of this._runningProcesses) {
            try { proc.kill('SIGKILL'); } catch { /* already dead */ }
        }
        this._runningProcesses.clear();
        this._outputChannel.dispose();
        this._testController.dispose();
        this._fileWatcher?.dispose();
    }
}