import * as vscode from 'vscode';
import { TCL_BUILTIN_COMMANDS } from '../data/tclCommands';

export class TclHoverProvider implements vscode.HoverProvider {
    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Hover> {
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return null;
        }

        const word = document.getText(wordRange);
        const line = document.lineAt(position.line).text;

        // Check for built-in commands
        const builtinCommand = TCL_BUILTIN_COMMANDS.find(cmd => cmd.name === word);
        if (builtinCommand) {
            const markdown = new vscode.MarkdownString();
            markdown.appendCodeblock(`${builtinCommand.signature}`, 'tcl');
            markdown.appendText(builtinCommand.description);
            markdown.appendText(`\n\n**Category:** ${builtinCommand.category}`);
            
            return new vscode.Hover(markdown, wordRange);
        }

        // Check for user-defined procedures
        const procInfo = this.findProcedureInfo(document, word);
        if (procInfo) {
            const markdown = new vscode.MarkdownString();
            markdown.appendCodeblock(`proc ${procInfo.name} {${procInfo.args}}`, 'tcl');
            markdown.appendText('User-defined procedure');
            
            if (procInfo.comment) {
                markdown.appendText(`\n\n${procInfo.comment}`);
            }
            
            return new vscode.Hover(markdown, wordRange);
        }

        // Check for variables
        const varInfo = this.getVariableInfo(document, position, word);
        if (varInfo) {
            const markdown = new vscode.MarkdownString();
            markdown.appendCodeblock(`$${word}`, 'tcl');
            markdown.appendText(`Variable: ${varInfo.type}`);
            
            if (varInfo.value) {
                markdown.appendText(`\n\n**Value:** ${varInfo.value}`);
            }
            
            return new vscode.Hover(markdown, wordRange);
        }

        // Check for namespace references
        if (word.includes('::') || line.includes(`::${word}`)) {
            const markdown = new vscode.MarkdownString();
            markdown.appendCodeblock(word, 'tcl');
            markdown.appendText('Namespace reference');
            
            return new vscode.Hover(markdown, wordRange);
        }

        return null;
    }

    private findProcedureInfo(document: vscode.TextDocument, procName: string): {
        name: string;
        args: string;
        comment?: string;
    } | null {
        const text = document.getText();
        const lines = text.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const procMatch = line.match(new RegExp(`\\bproc\\s+(${procName})\\s*\\{`, 'i'));

            if (procMatch) {
                const name = procMatch[1];

                // Find the matching closing brace for arguments
                const startIdx = text.indexOf(line) + line.indexOf('{');
                const endIdx = this.findMatchingBrace(text, startIdx);

                let args = '';
                if (endIdx !== -1) {
                    args = text.substring(startIdx + 1, endIdx).trim();
                }

                // Look for comment above the procedure
                let comment = '';
                for (let j = i - 1; j >= 0; j--) {
                    const prevLine = lines[j].trim();
                    if (prevLine.startsWith('#')) {
                        comment = prevLine.substring(1).trim() + '\n' + comment;
                    } else if (prevLine === '') {
                        continue;
                    } else {
                        break;
                    }
                }

                return {
                    name,
                    args,
                    comment: comment.trim() || undefined
                };
            }
        }

        return null;
    }

    private findMatchingBrace(text: string, openIdx: number): number {
        let depth = 0;
        let inString = false;
        let stringChar = '';

        for (let i = openIdx; i < text.length; i++) {
            const char = text[i];
            const prevChar = i > 0 ? text[i - 1] : '';

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

            if (!inString) {
                if (char === '{') {
                    depth++;
                } else if (char === '}') {
                    depth--;
                    if (depth === 0) {
                        return i;
                    }
                }
            }
        }
        return -1;
    }

    private getVariableInfo(document: vscode.TextDocument, position: vscode.Position, varName: string): {
        type: string;
        value?: string;
    } | null {
        const text = document.getText();
        const lines = text.split('\n');
        
        // Look for variable declarations before the current position
        for (let i = position.line; i >= 0; i--) {
            const line = lines[i];
            
            // Check for set command
            const setMatch = line.match(new RegExp(`\\bset\\s+(${varName})\\s+(.+)`, 'i'));
            if (setMatch) {
                const value = setMatch[2].trim();
                return {
                    type: 'local variable',
                    value: value.length > 50 ? value.substring(0, 50) + '...' : value
                };
            }
            
            // Check for global command
            const globalMatch = line.match(new RegExp(`\\bglobal\\s+.*\\b${varName}\\b`, 'i'));
            if (globalMatch) {
                return {
                    type: 'global variable'
                };
            }
            
            // Check for variable command
            const variableMatch = line.match(new RegExp(`\\bvariable\\s+(${varName})(?:\\s+(.+))?`, 'i'));
            if (variableMatch) {
                const value = variableMatch[2]?.trim();
                return {
                    type: 'namespace variable',
                    value: value && value.length > 50 ? value.substring(0, 50) + '...' : value
                };
            }
            
            // Check for proc arguments
            const procMatch = line.match(/\bproc\s+\w+\s*\{/);
            if (procMatch) {
                // Find the argument list in braces
                const argsStart = line.indexOf('{', line.indexOf('proc'));
                if (argsStart !== -1) {
                    const argsEnd = line.indexOf('}', argsStart);
                    if (argsEnd !== -1) {
                        const argsText = line.substring(argsStart + 1, argsEnd);
                        const args = argsText.trim().split(/\s+/);
                        if (args.includes(varName)) {
                            return {
                                type: 'procedure argument'
                            };
                        }
                    }
                }
            }
        }
        
        return null;
    }
}