import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import { createTempTclPath } from '../utils/tclUtils';
import { getScriptWords, parseTclScript, TclCommand, walkTclCommands } from '../utils/tclParser';

import { resolveTclInterpreter } from '../tools/executionContext';

const execFileAsync = promisify(execFile);

export class TclDiagnosticProvider {
    private diagnosticCollection: vscode.DiagnosticCollection;
    private outputChannel: vscode.OutputChannel | undefined;

    private readonly pending = new Map<string, { abort: AbortController; timer: ReturnType<typeof setTimeout>; resolve: () => void }>();
    private readonly unavailable = new Map<string, number>();

    public getDiagnostics(uri: vscode.Uri): readonly vscode.Diagnostic[] {
        return this.diagnosticCollection.get(uri) ?? [];
    }

    public clear(uri: vscode.Uri): void {
        const request = this.pending.get(uri.toString());
        if (request) { clearTimeout(request.timer); request.abort.abort(); request.resolve(); this.pending.delete(uri.toString()); }
        this.diagnosticCollection.delete(uri);
    }

    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('tcl');
    }

    public async provideDiagnostics(document: vscode.TextDocument): Promise<void> {
        if (document.languageId !== 'tcl') {
            return;
        }

        this.clear(document.uri);
        const config = vscode.workspace.getConfiguration('tcl', document.uri);
        if (!config.get<boolean>('diagnostics.enable', true)) return;
        const version = document.version;
        const diagnostics: vscode.Diagnostic[] = [];
        this.validateBasicSyntax(document, diagnostics);
        this.diagnosticCollection.set(document.uri, diagnostics);
        if (!config.get<boolean>('diagnostics.useTclsh', true)) return;
        const interpreter = resolveTclInterpreter(document.uri);
        if ((this.unavailable.get(interpreter) ?? 0) > Date.now()) return;
        await new Promise<void>(resolve => {
            const abort = new AbortController();
            const timer = setTimeout(async () => {
                try {
                    await this.validateWithTclsh(document, diagnostics, abort.signal, interpreter);
                    if (!abort.signal.aborted && document.version === version && !document.isClosed) this.diagnosticCollection.set(document.uri, diagnostics);
                } finally {
                    if (this.pending.get(document.uri.toString())?.abort === abort) this.pending.delete(document.uri.toString());
                    resolve();
                }
            }, Math.max(0, config.get<number>('diagnostics.debounceMs', 200)));
            this.pending.set(document.uri.toString(), { abort, timer, resolve });
        });
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
        for (const command of walkTclCommands(document.getText())) {
            const word = command.words[0];
            const match = /^(if|while|for|foreach|switch)\{/.exec(word.value);
            if (!match) continue;
            const position = document.positionAt(word.contentStart + match[1].length);
            this.addDiagnostic(diagnostics, position.line, position.character, position.character + 1,
                `Missing space after '${match[1]}' before '{'`, vscode.DiagnosticSeverity.Warning);
        }
    }

    private async validateWithTclsh(document: vscode.TextDocument, diagnostics: vscode.Diagnostic[], signal: AbortSignal, configured: string): Promise<void> {
        // The interpreter receives source as data. info complete performs parsing only;
        // source/eval/substitution of document text must never be used for diagnostics.
        const dataFile = createTempTclPath('validate');
        const checkFile = createTempTclPath('check');
        try {
            fs.writeFileSync(dataFile, document.getText(), 'utf8');
            fs.writeFileSync(checkFile, 'set channel [open [lindex $argv 0] r]\nset script [read $channel]\nclose $channel\nputs [info complete $script]\n', 'utf8');
            const { stdout } = await execFileAsync(configured, [checkFile, dataFile], { timeout: 2000, maxBuffer: 1024, signal });
            if (stdout.trim() === '0' && !diagnostics.some(d => d.severity === vscode.DiagnosticSeverity.Error)) {
                const position = document.positionAt(document.getText().length);
                this.addDiagnostic(diagnostics, position.line, position.character, position.character,
                    'Incomplete Tcl command', vscode.DiagnosticSeverity.Error);
            }
        } catch (error) {
            if (!signal.aborted) {
                this.unavailable.set(configured, Date.now() + 30000);
                (this.outputChannel ??= vscode.window.createOutputChannel('TCL Diagnostics')).appendLine(`TCL completeness check unavailable: ${error}`);
            }
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
        for (const key of [...this.pending.keys()]) this.clear(vscode.Uri.parse(key));
        this.diagnosticCollection.dispose();
        this.outputChannel?.dispose();
    }
}