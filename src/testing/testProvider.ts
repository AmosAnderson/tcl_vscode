import * as vscode from 'vscode';
import * as path from 'path';
import { spawn } from 'child_process';

interface TclTestResult {
    name: string;
    file: string;
    line: number;
    status: 'passed' | 'failed' | 'skipped';
    message?: string;
    duration?: number;
}

interface TclTestSuite {
    name: string;
    file: string;
    tests: TclTestResult[];
    passed: number;
    failed: number;
    skipped: number;
    duration: number;
}

export class TclTestProvider {
    private _outputChannel: vscode.OutputChannel;
    private _testController: vscode.TestController;
    private _testData = new WeakMap<vscode.TestItem, { file: string; line: number }>();
    private _fileWatcher: vscode.FileSystemWatcher | undefined;

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
                this._testData.set(testItem, { file: uri.fsPath, line: i + 1 });
                
                testFile.children.add(testItem);
            }
        }
    }

    private discoverTclTestCases(testFile: vscode.TestItem, lines: string[], uri: vscode.Uri): void {
        // Look for tcltest::test calls
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const testMatch = line.match(/(?:::)?tcltest::test\s+([^\s]+)/);

            if (testMatch) {
                const testName = testMatch[1].replace(/['"{}]/g, '');
                const testId = `${uri.toString()}::${testName}`;

                const testItem = this._testController.createTestItem(
                    testId,
                    testName,
                    uri
                );

                testItem.range = new vscode.Range(i, 0, i, line.length);
                this._testData.set(testItem, { file: uri.fsPath, line: i + 1 });

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

        // Collect tests to run
        if (request.include) {
            request.include.forEach(test => queue.push(test));
        } else {
            this._testController.items.forEach(test => queue.push(test));
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
        token: vscode.CancellationToken
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
            const result = await this.executeTest(data.file, test.label);
            
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

    private async executeTest(file: string, testName: string): Promise<TclTestResult> {
        return new Promise((resolve, reject) => {
            const config = vscode.workspace.getConfiguration('tcl');
            const tclPath = config.get<string>('test.tclPath', 'tclsh');
            
            // Create a test execution script
            const testScript = this.createTestExecutionScript(file, testName);
            
            const startTime = Date.now();
            const process = spawn(tclPath, ['-c', testScript], {
                cwd: path.dirname(file),
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let output = '';
            let errorOutput = '';

            process.stdout?.on('data', (data) => {
                output += data.toString();
            });

            process.stderr?.on('data', (data) => {
                errorOutput += data.toString();
            });

            process.on('close', (code) => {
                const duration = Date.now() - startTime;
                
                // Parse the test result
                const result: TclTestResult = {
                    name: testName,
                    file: file,
                    line: 0,
                    status: code === 0 ? 'passed' : 'failed',
                    duration: duration
                };

                if (code !== 0) {
                    result.message = errorOutput || output || 'Test failed';
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

            process.on('error', (error) => {
                reject(error);
            });
        });
    }

    private escapeTclString(str: string): string {
        // Escape special characters for TCL strings
        // Replace backslashes first, then other special characters
        return str
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\$/g, '\\$')
            .replace(/\[/g, '\\[')
            .replace(/\]/g, '\\]');
    }

    private createTestExecutionScript(file: string, testName: string): string {
        // Escape file path and test name for safe TCL execution
        const escapedFile = this.escapeTclString(file);
        const escapedTestName = testName.replace(/[^a-zA-Z0-9_:]/g, '_');

        // Create a script that runs a specific test
        return `
# Source the test file
if {[catch {source "${escapedFile}"} error]} {
    puts stderr "Error sourcing test file: $error"
    exit 1
}

# Try to run the specific test
if {[info procs ${escapedTestName}] ne ""} {
    # It's a test procedure
    if {[catch {${escapedTestName}} error]} {
        puts stderr "Test ${escapedTestName} failed: $error"
        exit 1
    } else {
        puts "Test ${escapedTestName} passed"
        exit 0
    }
} else {
    # Try to run with tcltest if available
    if {[catch {package require tcltest} error] == 0} {
        # Run specific test if it exists
        if {[catch {::tcltest::test ${escapedTestName}} error]} {
            puts stderr "tcltest failed: $error"
            exit 1
        } else {
            puts "Test ${escapedTestName} completed"
            exit 0
        }
    } else {
        puts stderr "Test ${escapedTestName} not found and tcltest not available"
        exit 1
    }
}
`;
    }

    public dispose(): void {
        this._outputChannel.dispose();
        this._testController.dispose();
        this._fileWatcher?.dispose();
    }
}