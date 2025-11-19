import * as vscode from 'vscode';
import * as path from 'path';
import { spawn } from 'child_process';
import * as fs from 'fs';

interface CoverageData {
    file: string;
    lines: Map<number, { count: number; covered: boolean }>;
    totalLines: number;
    coveredLines: number;
    percentage: number;
}

export class TclCoverageProvider {
    private _outputChannel: vscode.OutputChannel;
    private _coverageData = new Map<string, CoverageData>();
    private _decorationType: vscode.TextEditorDecorationType;
    private _uncoveredDecorationType: vscode.TextEditorDecorationType;

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
    vscode.window.onDidChangeActiveTextEditor(this.updateCoverageDisplay.bind(this));
    }

    public async generateCoverage(testFiles: string[]): Promise<void> {
        try {
            this._outputChannel.appendLine('Starting coverage analysis...');
            
            // Create a coverage script that instruments TCL code
            const coverageScript = this.createCoverageScript(testFiles);
            
            // Run the instrumented tests
            const coverageResults = await this.runCoverageAnalysis(coverageScript);
            const fileData = await this.readCoverageFile();
            const combined = coverageResults + '\n' + fileData;
            // Parse combined results
            this.parseCoverageResults(combined);
            
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
        // Create a TCL script that instruments code for coverage
        return `
# Simple coverage instrumentation for TCL
set coverage_data [dict create]
set coverage_files [list]

if {[info commands original_proc] eq ""} {rename proc original_proc}
proc proc {name args body} {
    global coverage_data coverage_files
    set file [info script]
    if {$file eq ""} { set file "<interactive>" }
    if {$file ni $coverage_files} { lappend coverage_files $file }
    set instrumented_body ""
    set __cov_line 1
    foreach line [split $body "\n"] {
        if {[string trim $line] ne ""} {
            append instrumented_body "dict incr coverage_data $file line_$__cov_line\n"
        }
        append instrumented_body "$line\n"
        incr __cov_line
    }
    original_proc $name $args $instrumented_body
}

# Function to save coverage data
proc save_coverage_data {filename} {
    global coverage_data coverage_files
    
    set fp [open $filename w]
    puts $fp "# TCL Coverage Data"
    
    foreach file $coverage_files {
        puts $fp "FILE:$file"
        foreach key [dict keys $coverage_data] {
            if {[string match "*_line_*" $key]} {
                set parts [split $key "_"]
                set line_num [lindex $parts end]
                set count [dict get $coverage_data $key]
                puts $fp "LINE:$line_num:$count"
            }
        }
    }
    close $fp
}

# Source each test file
${testFiles.map(file => `
if {[catch {source "${file}"} error]} {
    puts stderr "Error sourcing ${file}: $error"
}
`).join('\n')}

# Run all test procedures
foreach proc_name [info procs test_*] {
    if {[catch {$proc_name} error]} {
        puts stderr "Test $proc_name failed: $error"
    }
}

# Run tcltest tests if available
if {[catch {package require tcltest} error] == 0} {
    ::tcltest::runAllTests
}

# Save coverage data & echo summary for parser
save_coverage_data "coverage.dat"
foreach file $coverage_files {
    puts "FILE:$file"
    foreach key [dict keys $coverage_data] {
        if {[string match "$file line_*" $key]} {
            set ln [string range $key [expr {[string last _ $key] + 1}] end]
            puts "LINE:$ln:[dict get $coverage_data $key]"
        }
    }
}
puts "Coverage data saved"
`;
    }

    private async runCoverageAnalysis(script: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const config = vscode.workspace.getConfiguration('tcl');
            const tclPath = config.get<string>('test.tclPath', 'tclsh');
            
            const process = spawn(tclPath, ['-c', script], {
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
                if (code === 0) {
                    resolve(output);
                } else {
                    reject(new Error(errorOutput || 'Coverage analysis failed'));
                }
            });

            process.on('error', (error) => {
                reject(error);
            });
        });
    }

    private parseCoverageResults(results: string): void {
        this._coverageData.clear();
        
        const lines = results.split('\n');
        let currentFile = '';
        
        for (const line of lines) {
            if (line.startsWith('FILE:')) {
                currentFile = line.substring(5);
                if (!this._coverageData.has(currentFile)) {
                    this._coverageData.set(currentFile, {
                        file: currentFile,
                        lines: new Map(),
                        totalLines: 0,
                        coveredLines: 0,
                        percentage: 0
                    });
                }
            } else if (line.startsWith('LINE:') && currentFile) {
                const parts = line.substring(5).split(':');
                if (parts.length >= 2) {
                    const lineNum = parseInt(parts[0]);
                    const count = parseInt(parts[1]);
                    
                    const coverage = this._coverageData.get(currentFile)!;
                    coverage.lines.set(lineNum, {
                        count: count,
                        covered: count > 0
                    });
                }
            }
        }

        // Calculate coverage percentages
        for (const coverage of this._coverageData.values()) {
            coverage.totalLines = coverage.lines.size;
            coverage.coveredLines = Array.from(coverage.lines.values())
                .filter(line => line.covered).length;
            coverage.percentage = coverage.totalLines > 0 
                ? (coverage.coveredLines / coverage.totalLines) * 100 
                : 0;
        }
    }

    private async readCoverageFile(): Promise<string> {
        try {
            const data = await fs.promises.readFile('coverage.dat', 'utf8');
            return data;
        } catch {
            return '';
        }
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

        this._outputChannel.clear();
        this._outputChannel.appendLine(summaryLines.join('\n'));
        this._outputChannel.show();

        // Show status bar message
        vscode.window.setStatusBarMessage(
            `Coverage: ${overallPercentage.toFixed(1)}%`,
            5000
        );
    }

    public clearCoverage(): void {
        this._coverageData.clear();
        
        // Clear decorations from all editors
        vscode.window.visibleTextEditors.forEach(editor => {
            editor.setDecorations(this._decorationType, []);
            editor.setDecorations(this._uncoveredDecorationType, []);
        });

        this._outputChannel.clear();
        vscode.window.setStatusBarMessage('Coverage cleared', 2000);
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
        this._outputChannel.dispose();
        this._decorationType.dispose();
        this._uncoveredDecorationType.dispose();
    }
}