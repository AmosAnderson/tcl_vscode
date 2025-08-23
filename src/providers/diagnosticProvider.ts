import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';
import * as path from 'path';

const execAsync = promisify(exec);

export class TclDiagnosticProvider {
    private diagnosticCollection: vscode.DiagnosticCollection;
    private outputChannel: vscode.OutputChannel;

    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('tcl');
        this.outputChannel = vscode.window.createOutputChannel('TCL Diagnostics');
    }

    public async provideDiagnostics(document: vscode.TextDocument): Promise<void> {
        if (document.languageId !== 'tcl') {
            return;
        }

        // Check if diagnostics are enabled
        const config = vscode.workspace.getConfiguration('tcl');
        const diagnosticsEnabled = config.get<boolean>('diagnostics.enable', true);
        
        if (!diagnosticsEnabled) {
            this.diagnosticCollection.clear();
            return;
        }

        const diagnostics: vscode.Diagnostic[] = [];
        
        // Basic syntax validation
        this.validateBasicSyntax(document, diagnostics);
        
        // Advanced validation with tclsh if available and enabled
        const useTclsh = config.get<boolean>('diagnostics.useTclsh', true);
        if (useTclsh) {
            await this.validateWithTclsh(document, diagnostics);
        }

        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    private validateBasicSyntax(document: vscode.TextDocument, diagnostics: vscode.Diagnostic[]): void {
        const text = document.getText();
        const lines = text.split('\n');

        let braceStack: number[] = [];
        let bracketStack: number[] = [];
        let inString = false;
        let stringChar = '';

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const line = lines[lineNum];
            
            for (let charPos = 0; charPos < line.length; charPos++) {
                const char = line[charPos];
                const prevChar = charPos > 0 ? line[charPos - 1] : '';

                // Handle string literals
                if ((char === '"' || char === "'") && prevChar !== '\\') {
                    if (!inString) {
                        inString = true;
                        stringChar = char;
                    } else if (char === stringChar) {
                        inString = false;
                        stringChar = '';
                    }
                    continue;
                }

                if (inString) continue;

                // Handle comments
                if (char === '#' && (charPos === 0 || /\s/.test(prevChar))) {
                    break; // Rest of line is comment
                }

                // Track braces and brackets
                if (char === '{') {
                    braceStack.push(lineNum);
                } else if (char === '}') {
                    if (braceStack.length === 0) {
                        this.addDiagnostic(diagnostics, lineNum, charPos, charPos + 1,
                            'Unmatched closing brace', vscode.DiagnosticSeverity.Error);
                    } else {
                        braceStack.pop();
                    }
                } else if (char === '[') {
                    bracketStack.push(lineNum);
                } else if (char === ']') {
                    if (bracketStack.length === 0) {
                        this.addDiagnostic(diagnostics, lineNum, charPos, charPos + 1,
                            'Unmatched closing bracket', vscode.DiagnosticSeverity.Error);
                    } else {
                        bracketStack.pop();
                    }
                }
            }

            // Check for unclosed strings at end of line
            if (inString && stringChar === '"') {
                this.addDiagnostic(diagnostics, lineNum, 0, line.length,
                    'Unclosed string literal', vscode.DiagnosticSeverity.Error);
                inString = false;
                stringChar = '';
            }
        }

        // Check for unclosed braces/brackets at end of file
        if (braceStack.length > 0) {
            const lastBraceLine = braceStack[braceStack.length - 1];
            this.addDiagnostic(diagnostics, lastBraceLine, 0, lines[lastBraceLine].length,
                'Unclosed brace', vscode.DiagnosticSeverity.Error);
        }

        if (bracketStack.length > 0) {
            const lastBracketLine = bracketStack[bracketStack.length - 1];
            this.addDiagnostic(diagnostics, lastBracketLine, 0, lines[lastBracketLine].length,
                'Unclosed bracket', vscode.DiagnosticSeverity.Error);
        }

        // Check for common TCL syntax issues
        this.checkCommonIssues(document, diagnostics);
    }

    private checkCommonIssues(document: vscode.TextDocument, diagnostics: vscode.Diagnostic[]): void {
        const text = document.getText();
        const lines = text.split('\n');

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const line = lines[lineNum].trim();
            
            // Skip comments and empty lines
            if (line.startsWith('#') || line.length === 0) continue;

            // Warn on missing space before brace (e.g., if{ ... })
            const missingSpaceBeforeBrace = /\b(if|while|for|foreach|switch)\{/;
            if (missingSpaceBeforeBrace.test(line)) {
                const m = line.match(missingSpaceBeforeBrace)!;
                const pos = lines[lineNum].indexOf(m[0]) + m[1].length;
                this.addDiagnostic(
                    diagnostics,
                    lineNum,
                    pos,
                    pos + 1,
                    `Missing space after '${m[1]}' before '{'`,
                    vscode.DiagnosticSeverity.Warning
                );
            }

            // Warn on parentheses after control keywords (Tcl prefers braces)
            const parenAfterKeyword = /\b(if|while|for|foreach|switch)\s*\(/;
            if (parenAfterKeyword.test(line)) {
                const m = line.match(parenAfterKeyword)!;
                const pos = lines[lineNum].indexOf(m[0]) + m[1].length;
                this.addDiagnostic(
                    diagnostics,
                    lineNum,
                    pos,
                    pos + 1,
                    `TCL uses braces for conditions: use "${m[1]} { ... }"`,
                    vscode.DiagnosticSeverity.Warning
                );
            }

            // Check for potential variable name issues
            const varPattern = /\$([a-zA-Z_][a-zA-Z0-9_]*)/g;
            let varMatch;
            while ((varMatch = varPattern.exec(line)) !== null) {
                const varName = varMatch[1];
                // Warn about potential naming conventions
                if (varName.length === 1 && /[A-Z]/.test(varName)) {
                    const pos = lines[lineNum].indexOf(varMatch[0]);
                    this.addDiagnostic(diagnostics, lineNum, pos, pos + varMatch[0].length,
                        'Single letter uppercase variable names may be confusing', 
                        vscode.DiagnosticSeverity.Information);
                }
            }

            // Check for potential command substitution issues
            if (line.includes('`')) {
                const pos = lines[lineNum].indexOf('`');
                this.addDiagnostic(diagnostics, lineNum, pos, pos + 1,
                    'Use [command] instead of `command` for command substitution', 
                    vscode.DiagnosticSeverity.Warning);
            }
        }
    }

    private async validateWithTclsh(document: vscode.TextDocument, diagnostics: vscode.Diagnostic[]): Promise<void> {
        try {
            // Check if tclsh is available
            const tclshPath = await this.findTclsh();
            if (!tclshPath) {
                return; // tclsh not available, skip advanced validation
            }

            // Create temporary file for validation (cross-platform)
            const fs = require('fs');
            const tmpDir = os.tmpdir();
            const tempFile = path.join(tmpDir, `tcl_validate_${Date.now()}.tcl`);
            fs.writeFileSync(tempFile, document.getText(), 'utf8');

            try {
                // Run tclsh -n (syntax check only)
                const { stderr } = await execAsync(`${tclshPath} -n "${tempFile}"`);
                
                if (stderr) {
                    this.parseTclshErrors(stderr, diagnostics);
                }
            } catch (error: any) {
                // tclsh returns non-zero exit code for syntax errors
                if (error.stderr) {
                    this.parseTclshErrors(error.stderr, diagnostics);
                }
            } finally {
                // Clean up temp file
                try {
                    fs.unlinkSync(tempFile);
                } catch (e) {
                    // Ignore cleanup errors
                }
            }
        } catch (error) {
            // Log error but don't fail validation
            this.outputChannel.appendLine(`TCL validation error: ${error}`);
        }
    }

    private async findTclsh(): Promise<string | null> {
        const candidates = process.platform === 'win32'
            ? ['tclsh.exe', 'tclsh86.exe', 'tclsh85.exe', 'C:/Tcl/bin/tclsh.exe', 'C:/Tcl/bin/tclsh86.exe']
            : ['tclsh', 'tclsh8.7', 'tclsh8.6', 'tclsh8.5', '/usr/bin/tclsh', '/usr/local/bin/tclsh'];

        for (const candidate of candidates) {
            try {
                // Attempt running a tiny version print instead of relying on 'which' for portability
                await execAsync(`"${candidate}" -c "puts $tcl_version"`);
                return candidate;
            } catch (_) {
                continue;
            }
        }
        return null;
    }

    private parseTclshErrors(stderr: string, diagnostics: vscode.Diagnostic[]): void {
        const lines = stderr.split('\n');
        
        for (const line of lines) {
            // Parse tclsh error format: "line X: error message"
            const match = line.match(/line (\d+): (.+)/);
            if (match) {
                const lineNum = parseInt(match[1]) - 1; // Convert to 0-based
                const message = match[2];
                
                this.addDiagnostic(diagnostics, lineNum, 0, 100,
                    message, vscode.DiagnosticSeverity.Error);
            }
        }
    }

    private addDiagnostic(
        diagnostics: vscode.Diagnostic[],
        line: number,
        startChar: number,
        endChar: number,
        message: string,
        severity: vscode.DiagnosticSeverity
    ): void {
        const range = new vscode.Range(
            new vscode.Position(line, startChar),
            new vscode.Position(line, endChar)
        );
        
        const diagnostic = new vscode.Diagnostic(range, message, severity);
        diagnostic.source = 'tcl';
        diagnostics.push(diagnostic);
    }

    public dispose(): void {
        this.diagnosticCollection.dispose();
        this.outputChannel.dispose();
    }
}