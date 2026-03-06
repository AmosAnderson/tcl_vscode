import * as vscode from 'vscode';

export class TclLintProvider {
    private diagnosticCollection: vscode.DiagnosticCollection;

    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('tcl-lint');
    }

    public lint(document: vscode.TextDocument): void {
        if (document.languageId !== 'tcl') {
            return;
        }

        const config = vscode.workspace.getConfiguration('tcl');
        const lintEnabled = config.get<boolean>('lint.enable', true);

        if (!lintEnabled) {
            this.diagnosticCollection.delete(document.uri);
            return;
        }

        const diagnostics: vscode.Diagnostic[] = [];
        const text = document.getText();
        const lines = text.split('\n');

        this.checkExprBracing(lines, diagnostics, config);
        this.checkMissingSwitchDefault(text, lines, diagnostics);
        this.checkCatchWithoutVariable(lines, diagnostics);
        this.checkLineLength(lines, diagnostics, config);
        this.checkDeprecatedCommands(lines, diagnostics);
        this.checkGlobalVariableShorthand(text, lines, diagnostics);

        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    private checkExprBracing(lines: string[], diagnostics: vscode.Diagnostic[], config: vscode.WorkspaceConfiguration): void {
        if (!config.get<boolean>('lint.exprBracing', true)) {
            return;
        }

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            // Skip comments and empty lines
            if (trimmed.startsWith('#') || trimmed.length === 0) {
                continue;
            }

            // Match expr that is not followed by a brace
            // Handle: expr $a + $b, expr 1+2, but not expr {$a + $b}
            const exprMatch = line.match(/\bexpr\s+(?!\{)(\S)/);
            if (exprMatch) {
                const idx = line.indexOf(exprMatch[0]);
                const range = new vscode.Range(i, idx, i, idx + exprMatch[0].length);
                const diagnostic = new vscode.Diagnostic(
                    range,
                    'expr argument should be braced to prevent double substitution and improve performance',
                    vscode.DiagnosticSeverity.Warning
                );
                diagnostic.code = 'tcl-lint-expr-bracing';
                diagnostic.source = 'tcl-lint';
                diagnostics.push(diagnostic);
            }
        }
    }

    private checkMissingSwitchDefault(text: string, lines: string[], diagnostics: vscode.Diagnostic[]): void {
        // Find switch statements and check for default clause
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            // Match switch command (with possible flags)
            const switchMatch = trimmed.match(/^\s*switch\b/);
            if (!switchMatch) {
                continue;
            }

            // Scan forward to find the switch body and check for 'default'
            let braceDepth = 0;
            let foundOpenBrace = false;
            let foundDefault = false;

            for (let j = i; j < lines.length; j++) {
                const scanLine = lines[j];
                let inString = false;
                for (let c = 0; c < scanLine.length; c++) {
                    const ch = scanLine[c];
                    if (c > 0 && scanLine[c - 1] === '\\') continue;

                    if (ch === '"') {
                        inString = !inString;
                    } else if (!inString) {
                        if (ch === '{') {
                            braceDepth++;
                            foundOpenBrace = true;
                        } else if (ch === '}') {
                            braceDepth--;
                        }
                    }
                }

                if (scanLine.match(/\bdefault\b/)) {
                    foundDefault = true;
                }

                if (foundOpenBrace && braceDepth === 0) {
                    break;
                }
            }

            if (foundOpenBrace && !foundDefault) {
                const idx = line.indexOf('switch');
                const range = new vscode.Range(i, idx, i, idx + 6);
                const diagnostic = new vscode.Diagnostic(
                    range,
                    'switch statement has no default clause',
                    vscode.DiagnosticSeverity.Information
                );
                diagnostic.code = 'tcl-lint-switch-default';
                diagnostic.source = 'tcl-lint';
                diagnostics.push(diagnostic);
            }
        }
    }

    private checkCatchWithoutVariable(lines: string[], diagnostics: vscode.Diagnostic[]): void {
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            if (trimmed.startsWith('#') || trimmed.length === 0) {
                continue;
            }

            // Match catch with a body but no result variable
            // catch {script} -> warning
            // catch {script} result -> ok
            // catch {script} result opts -> ok
            const catchMatch = trimmed.match(/\bcatch\s+\{[^}]*\}\s*$/);
            if (catchMatch) {
                const idx = line.indexOf('catch');
                const range = new vscode.Range(i, idx, i, line.length);
                const diagnostic = new vscode.Diagnostic(
                    range,
                    'catch without result variable — errors will be silently ignored',
                    vscode.DiagnosticSeverity.Warning
                );
                diagnostic.code = 'tcl-lint-catch-no-var';
                diagnostic.source = 'tcl-lint';
                diagnostics.push(diagnostic);
            }
        }
    }

    private checkLineLength(lines: string[], diagnostics: vscode.Diagnostic[], config: vscode.WorkspaceConfiguration): void {
        const maxLength = config.get<number>('lint.maxLineLength', 120);
        if (maxLength <= 0) {
            return;
        }

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.length > maxLength) {
                const range = new vscode.Range(i, maxLength, i, line.length);
                const diagnostic = new vscode.Diagnostic(
                    range,
                    `Line exceeds ${maxLength} characters (${line.length})`,
                    vscode.DiagnosticSeverity.Information
                );
                diagnostic.code = 'tcl-lint-line-length';
                diagnostic.source = 'tcl-lint';
                diagnostics.push(diagnostic);
            }
        }
    }

    private checkDeprecatedCommands(lines: string[], diagnostics: vscode.Diagnostic[]): void {
        const deprecated: { pattern: RegExp; message: string }[] = [
            { pattern: /\bstring\s+bytelength\b/, message: "'string bytelength' is deprecated since TCL 8.6 — use 'string length' with encoding" },
            { pattern: /\bstring\s+wordend\b/, message: "'string wordend' is deprecated — use 'tcl_wordBreakAfter' or regexp" },
            { pattern: /\bstring\s+wordstart\b/, message: "'string wordstart' is deprecated — use 'tcl_wordBreakBefore' or regexp" },
        ];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            if (trimmed.startsWith('#') || trimmed.length === 0) {
                continue;
            }

            for (const { pattern, message } of deprecated) {
                const match = line.match(pattern);
                if (match) {
                    const idx = line.indexOf(match[0]);
                    const range = new vscode.Range(i, idx, i, idx + match[0].length);
                    const diagnostic = new vscode.Diagnostic(
                        range,
                        message,
                        vscode.DiagnosticSeverity.Warning
                    );
                    diagnostic.code = 'tcl-lint-deprecated';
                    diagnostic.source = 'tcl-lint';
                    diagnostics.push(diagnostic);
                }
            }
        }
    }

    private checkGlobalVariableShorthand(text: string, lines: string[], diagnostics: vscode.Diagnostic[]): void {
        // Find proc bodies and check for repeated $::varName usage
        // Suggest using 'global varName' or 'variable varName' instead
        let inProc = false;
        let procStart = 0;
        let braceDepth = 0;
        const globalVarUsages = new Map<string, { line: number; col: number }[]>();

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            if (trimmed.match(/^\s*proc\s+/)) {
                inProc = true;
                procStart = i;
                braceDepth = 0;
                globalVarUsages.clear();
            }

            if (inProc) {
                let inString = false;
                for (let c = 0; c < line.length; c++) {
                    if (c > 0 && line[c - 1] === '\\') continue;
                    if (line[c] === '"') {
                        inString = !inString;
                    } else if (!inString) {
                        if (line[c] === '{') braceDepth++;
                        if (line[c] === '}') braceDepth--;
                    }
                }

                // Find $::varName references
                const globalRefs = line.matchAll(/\$::(\w+)/g);
                for (const ref of globalRefs) {
                    const varName = ref[1];
                    if (!globalVarUsages.has(varName)) {
                        globalVarUsages.set(varName, []);
                    }
                    globalVarUsages.get(varName)!.push({ line: i, col: ref.index! });
                }

                // End of proc body
                if (braceDepth === 0 && i > procStart) {
                    // Warn for variables used 3+ times with $:: prefix
                    for (const [varName, usages] of globalVarUsages) {
                        if (usages.length >= 3) {
                            const first = usages[0];
                            const range = new vscode.Range(first.line, first.col, first.line, first.col + varName.length + 3);
                            const diagnostic = new vscode.Diagnostic(
                                range,
                                `'$::${varName}' used ${usages.length} times — consider 'global ${varName}' at proc start`,
                                vscode.DiagnosticSeverity.Information
                            );
                            diagnostic.code = 'tcl-lint-global-shorthand';
                            diagnostic.source = 'tcl-lint';
                            diagnostics.push(diagnostic);
                        }
                    }

                    inProc = false;
                    globalVarUsages.clear();
                }
            }
        }
    }

    public dispose(): void {
        this.diagnosticCollection.dispose();
    }
}
