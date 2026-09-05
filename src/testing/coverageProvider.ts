import * as vscode from 'vscode';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import { createTempTclPath } from '../utils/tclUtils';
import { createCoverageExecutionScript, COVERAGE_BEGIN, COVERAGE_END } from './coverageExecution';

import { CoverageData, parseCoverageReports } from './coverageResults';
export { CoverageData } from './coverageResults';

export class TclCoverageProvider {
    private _outputChannel: vscode.OutputChannel;
    private _coverageData = new Map<string, CoverageData>();
    private _decorationType: vscode.TextEditorDecorationType;
    private _uncoveredDecorationType: vscode.TextEditorDecorationType;
    private _disposables: vscode.Disposable[] = [];
    private _runningProcesses = new Set<ChildProcess>();
    private _testErrors = '';
    private _statusMessage: vscode.Disposable | undefined;

    constructor() {
        this._outputChannel = vscode.window.createOutputChannel('TCL Coverage');

        // Create decoration types for coverage visualization
        this._decorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(0, 255, 0, 0.1)',
            border: '1px solid green'
        });

        this._uncoveredDecorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(255, 0, 0, 0.1)',
            border: '1px solid red'
        });

        // Listen for active editor changes to update coverage display
        this._disposables.push(
            vscode.window.onDidChangeActiveTextEditor(this.updateCoverageDisplay.bind(this))
        );
    }

    public async generateCoverage(testFiles: string[]): Promise<void> {
        try {
            this._outputChannel.appendLine('Starting coverage analysis...');
            
            // Create a coverage script that instruments TCL code
            const coverageScript = this.createCoverageScript(testFiles);
            
            // Run the instrumented tests
            const coverageResults = await this.runCoverageAnalysis(coverageScript);
            this.parseCoverageResults(coverageResults);
            
            // Update display
            this.updateCoverageDisplay();
            
            // Show coverage summary
            this.showCoverageSummary();
            
        } catch (error) {
            this._outputChannel.appendLine(`Coverage analysis failed: ${error}`);
            vscode.window.showErrorMessage(`Coverage analysis failed: ${error}`);
        }
    }

    private createCoverageScript(testFiles: string[]): string {
        const roots = [
            ...(vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) || []),
            ...testFiles.map(file => path.dirname(file))
        ];
        return createCoverageExecutionScript(testFiles, roots);
    }

    private async runCoverageAnalysis(script: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const config = vscode.workspace.getConfiguration('tcl');
            const tclPath = config.get<string>('test.tclPath', 'tclsh');

            // Write script to temp file — tclsh does not support a -c flag
            const tmpFile = createTempTclPath('coverage');
            try {
                fs.writeFileSync(tmpFile, script, 'utf8');
            } catch (err) {
                reject(err);
                return;
            }

            const process = spawn(tclPath, [tmpFile], {
                cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
                stdio: ['pipe', 'pipe', 'pipe']
            });

            this._runningProcesses.add(process);
            let timedOut = false;
            const timer = setTimeout(() => {
                timedOut = true;
                process.kill('SIGKILL');
            }, 60000);
            const cleanup = () => {
                clearTimeout(timer);
                this._runningProcesses.delete(process);
                try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
            };
            process.stdin?.end();
            let output = '';
            let errorOutput = '';

            process.stdout?.on('data', (data) => {
                output += data.toString();
            });

            process.stderr?.on('data', (data) => {
                errorOutput += data.toString();
            });

            process.on('close', (code) => {
                cleanup();
                if (timedOut) {
                    reject(new Error('Coverage analysis timed out after 60 seconds'));
                } else if (code === 0 || output.includes(COVERAGE_END)) {
                    this._testErrors = code === 0 ? '' :
                        [errorOutput, output.split(COVERAGE_BEGIN)[0]].filter(Boolean).join('\n') ||
                        'One or more TCL tests failed.';
                    resolve(output);
                } else {
                    reject(new Error(errorOutput || 'Coverage analysis failed'));
                }
            });

            process.on('error', (error) => {
                cleanup();
                reject(error);
            });
        });
    }

    public recordCoverage(results: string, append = true): void {
        this.parseCoverageResults(results, append);
        this.updateCoverageDisplay();
        const entries = this.getCoverageData();
        const total = entries.reduce((sum, entry) => sum + entry.totalLines, 0);
        const covered = entries.reduce((sum, entry) => sum + entry.coveredLines, 0);
        this.setCoverageStatus(`Coverage: ${(total ? covered / total * 100 : 0).toFixed(1)}%`, 5000);
    }

    public getCoverageData(): CoverageData[] { return [...this._coverageData.values()]; }

    private parseCoverageResults(results: string, append = false): void {
        const parsed = parseCoverageReports([results], append ? this.getCoverageData() : []);
        this._coverageData = new Map(parsed.map(entry => [entry.file, entry]));
    }

    private updateCoverageDisplay(): void {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'tcl') {
            return;
        }

        const filePath = editor.document.fileName;
        const coverage = this._coverageData.get(filePath);
        
        if (!coverage) {
            // Clear decorations if no coverage data
            editor.setDecorations(this._decorationType, []);
            editor.setDecorations(this._uncoveredDecorationType, []);
            return;
        }

        const coveredRanges: vscode.Range[] = [];
        const uncoveredRanges: vscode.Range[] = [];

        for (const [lineNum, lineData] of coverage.lines) {
            const lineIndex = lineNum - 1;
            if (lineIndex >= editor.document.lineCount) { continue; }
            const lineText = editor.document.lineAt(lineIndex).text;
            const range = new vscode.Range(lineIndex, 0, lineIndex, lineText.length);
            
            if (lineData.covered) {
                coveredRanges.push(range);
            } else {
                uncoveredRanges.push(range);
            }
        }

        editor.setDecorations(this._decorationType, coveredRanges);
        editor.setDecorations(this._uncoveredDecorationType, uncoveredRanges);
    }

    private showCoverageSummary(): void {
        if (this._coverageData.size === 0) {
            vscode.window.showInformationMessage('No coverage data available');
            return;
        }

        let totalLines = 0;
        let totalCovered = 0;

        const summaryLines: string[] = ['Coverage Summary:', ''];

        for (const coverage of this._coverageData.values()) {
            totalLines += coverage.totalLines;
            totalCovered += coverage.coveredLines;
            
            const fileName = path.basename(coverage.file);
            const percentage = coverage.percentage.toFixed(1);
            summaryLines.push(
                `${fileName}: ${coverage.coveredLines}/${coverage.totalLines} (${percentage}%)`
            );
        }

        const overallPercentage = totalLines > 0 ? (totalCovered / totalLines) * 100 : 0;
        summaryLines.unshift(
            `Overall: ${totalCovered}/${totalLines} (${overallPercentage.toFixed(1)}%)`,
            ''
        );

        if (this._testErrors) {
            summaryLines.push('', 'Test errors:', this._testErrors);
            vscode.window.showWarningMessage('Coverage collected with test failures. See the TCL Coverage output.');
        }
        this._outputChannel.clear();
        this._outputChannel.appendLine(summaryLines.join('\n'));
        this._outputChannel.show();

        // Show status bar message
        this.setCoverageStatus(
            `Coverage: ${overallPercentage.toFixed(1)}%`,
            5000
        );
    }

    private setCoverageStatus(message: string, timeout: number): void {
        this._statusMessage?.dispose();
        this._statusMessage = vscode.window.setStatusBarMessage(message, timeout);
    }

    public clearCoverage(): void {
        this._coverageData.clear();
        this._testErrors = '';
        
        // Clear decorations from all editors
        vscode.window.visibleTextEditors.forEach(editor => {
            editor.setDecorations(this._decorationType, []);
            editor.setDecorations(this._uncoveredDecorationType, []);
        });

        this._outputChannel.clear();
        this.setCoverageStatus('Coverage cleared', 2000);
    }

    public async exportCoverageReport(): Promise<void> {
        if (this._coverageData.size === 0) {
            vscode.window.showInformationMessage('No coverage data to export');
            return;
        }

        const reportPath = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file('coverage-report.html'),
            filters: {
                'HTML': ['html'],
                'JSON': ['json']
            }
        });

        if (!reportPath) {
            return;
        }

        try {
            const extension = path.extname(reportPath.fsPath).toLowerCase();
            let content: string;

            if (extension === '.html') {
                content = this.generateHTMLReport();
            } else {
                content = this.generateJSONReport();
            }

            await vscode.workspace.fs.writeFile(reportPath, Buffer.from(content));
            vscode.window.showInformationMessage(`Coverage report exported to ${reportPath.fsPath}`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to export coverage report: ${error}`);
        }
    }

    private generateHTMLReport(): string {
        let html = `
<!DOCTYPE html>
<html>
<head>
    <title>TCL Coverage Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .summary { background: #f0f0f0; padding: 10px; margin-bottom: 20px; }
        .file { margin-bottom: 20px; border: 1px solid #ccc; }
        .file-header { background: #e0e0e0; padding: 10px; font-weight: bold; }
        .covered { background: #d4edda; }
        .uncovered { background: #f8d7da; }
        .line { padding: 2px 5px; border-bottom: 1px solid #eee; }
    </style>
</head>
<body>
    <h1>TCL Coverage Report</h1>
`;

        // Add summary
        let totalLines = 0;
        let totalCovered = 0;
        for (const coverage of this._coverageData.values()) {
            totalLines += coverage.totalLines;
            totalCovered += coverage.coveredLines;
        }
        const overallPercentage = totalLines > 0 ? (totalCovered / totalLines) * 100 : 0;

        html += `
    <div class="summary">
        <h2>Summary</h2>
        <p>Overall Coverage: ${totalCovered}/${totalLines} lines (${overallPercentage.toFixed(1)}%)</p>
    </div>
`;

        // Add file details
        for (const coverage of this._coverageData.values()) {
            const fileName = path.basename(coverage.file);
            html += `
    <div class="file">
        <div class="file-header">
            ${fileName} - ${coverage.coveredLines}/${coverage.totalLines} (${coverage.percentage.toFixed(1)}%)
        </div>
        <div class="file-content">
`;
            
            for (const [lineNum, lineData] of coverage.lines) {
                const cssClass = lineData.covered ? 'covered' : 'uncovered';
                html += `            <div class="line ${cssClass}">Line ${lineNum}: ${lineData.count} hits</div>\n`;
            }

            html += `        </div>
    </div>
`;
        }

        html += `
</body>
</html>
`;
        return html;
    }

    private generateJSONReport(): string {
        const report = {
            timestamp: new Date().toISOString(),
            files: Array.from(this._coverageData.values()).map(coverage => ({
                file: coverage.file,
                totalLines: coverage.totalLines,
                coveredLines: coverage.coveredLines,
                percentage: coverage.percentage,
                lines: Array.from(coverage.lines.entries()).map(([lineNum, lineData]) => ({
                    line: lineNum,
                    count: lineData.count,
                    covered: lineData.covered
                }))
            }))
        };

        return JSON.stringify(report, null, 2);
    }

    public dispose(): void {
        for (const process of this._runningProcesses) {
            try { process.kill('SIGKILL'); } catch { /* already exited */ }
        }
        this._runningProcesses.clear();
        this._statusMessage?.dispose();
        this._statusMessage = undefined;
        this._disposables.forEach(d => d.dispose());
        this._disposables = [];
        this._outputChannel.dispose();
        this._decorationType.dispose();
        this._uncoveredDecorationType.dispose();
    }
}
