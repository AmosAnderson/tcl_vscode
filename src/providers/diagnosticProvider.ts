import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import { createTempTclPath, computeMultilineStringLines } from '../utils/tclUtils';
import { getScriptWords, parseTclScript, TclCommand } from '../utils/tclParser';

const execFileAsync = promisify(execFile);

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

        const version = document.version;
        const diagnostics: vscode.Diagnostic[] = [];
        
        // Basic syntax validation
        this.validateBasicSyntax(document, diagnostics);
        
        // Advanced validation with tclsh if available and enabled
        const useTclsh = config.get<boolean>('diagnostics.useTclsh', true);
        if (useTclsh) {
            await this.validateWithTclsh(document, diagnostics);
        }

        if (document.version === version) this.diagnosticCollection.set(document.uri, diagnostics);
    }

    private validateBasicSyntax(document: vscode.TextDocument, diagnostics: vscode.Diagnostic[]): void {
        const text = document.getText();
        const scan = (start: number, end: number): void => {
            const parsed = parseTclScript(text, start, end);
            for (const error of parsed.errors) {
                const position = document.positionAt(error.offset);
                this.addDiagnostic(diagnostics, position.line, position.character, position.character + 1,
                    error.message, vscode.DiagnosticSeverity.Error);
            }
            const visit = (commands: TclCommand[]): void => {
                for (const command of commands) {
                    for (const word of command.words) visit(word.substitutions);
                    for (const body of getScriptWords(command)) scan(body.contentStart, body.contentEnd);
                }
            };
            visit(parsed.commands);
        };
        scan(0, text.length);
        this.checkCommonIssues(document, diagnostics);
    }

    private checkCommonIssues(document: vscode.TextDocument, diagnostics: vscode.Diagnostic[]): void {
        const text = document.getText();
        const lines = text.split('\n');
        const insideString = computeMultilineStringLines(lines);

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const line = lines[lineNum].trim();
            
            // Skip comments, empty lines, and lines inside multiline strings
            if (line.startsWith('#') || line.length === 0 || insideString[lineNum]) continue;

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
        // The interpreter receives source as data. info complete performs parsing only;
        // source/eval/substitution of document text must never be used for diagnostics.
        const dataFile = createTempTclPath('validate');
        const checkFile = createTempTclPath('check');
        try {
            fs.writeFileSync(dataFile, document.getText(), 'utf8');
            fs.writeFileSync(checkFile, 'set channel [open [lindex $argv 0] r]\nset script [read $channel]\nclose $channel\nputs [info complete $script]\n', 'utf8');
            const configured = vscode.workspace.getConfiguration('tcl').get<string>('interpreter.path', 'tclsh');
            const { stdout } = await execFileAsync(configured, [checkFile, dataFile], { timeout: 2000, maxBuffer: 1024 });
            if (stdout.trim() === '0' && !diagnostics.some(d => d.severity === vscode.DiagnosticSeverity.Error)) {
                const position = document.positionAt(document.getText().length);
                this.addDiagnostic(diagnostics, position.line, position.character, position.character,
                    'Incomplete Tcl command', vscode.DiagnosticSeverity.Error);
            }
        } catch (error) {
            this.outputChannel.appendLine(`TCL completeness check unavailable: ${error}`);
        } finally {
            for (const file of [dataFile, checkFile]) {
                try { fs.unlinkSync(file); } catch { /* best-effort cleanup */ }
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