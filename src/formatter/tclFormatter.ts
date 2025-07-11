import * as vscode from 'vscode';

export interface TclFormattingOptions {
    indentSize: number;
    useTabs: boolean;
    alignBraces: boolean;
    spacesAroundOperators: boolean;
    spacesInsideBraces: boolean;
    spacesInsideBrackets: boolean;
}

export class TclFormatter {
    private options: TclFormattingOptions;

    constructor(options: Partial<TclFormattingOptions> = {}) {
        this.options = {
            indentSize: options.indentSize ?? 4,
            useTabs: options.useTabs ?? false,
            alignBraces: options.alignBraces ?? true,
            spacesAroundOperators: options.spacesAroundOperators ?? true,
            spacesInsideBraces: options.spacesInsideBraces ?? true,
            spacesInsideBrackets: options.spacesInsideBrackets ?? false,
        };
    }

    private getIndentString(): string {
        return this.options.useTabs ? '\t' : ' '.repeat(this.options.indentSize);
    }

    format(text: string): string {
        const lines = text.split('\n');
        const formattedLines: string[] = [];
        let indentLevel = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmedLine = line.trim();

            // Handle empty lines
            if (!trimmedLine) {
                formattedLines.push('');
                continue;
            }

            // Handle comments
            if (trimmedLine.startsWith('#')) {
                const indentString = this.getIndentString().repeat(indentLevel);
                formattedLines.push(indentString + trimmedLine);
                continue;
            }

            // Count braces in this line (outside of strings)
            const braceCount = this.countBracesInLine(trimmedLine);
            
            // Calculate current line indent
            let currentIndent = indentLevel;

            // If line starts with }, reduce indent for this line
            if (trimmedLine.startsWith('}')) {
                currentIndent = Math.max(0, indentLevel - 1);
            }

            // Special case for } else { and } elseif
            if (/^\s*}\s*(else|elseif)\s/.test(trimmedLine)) {
                currentIndent = Math.max(0, indentLevel - 1);
            }

            // Apply indentation
            const indentString = this.getIndentString().repeat(currentIndent);
            let formattedLine = indentString + trimmedLine;

            // Apply spacing rules
            if (this.options.spacesAroundOperators) {
                formattedLine = this.formatOperatorSpacing(formattedLine);
            }

            if (this.options.spacesInsideBraces) {
                formattedLine = this.formatBraceSpacing(formattedLine);
            }

            if (this.options.spacesInsideBrackets) {
                formattedLine = this.formatBracketSpacing(formattedLine);
            }

            formattedLines.push(formattedLine);

            // Update indent level for next lines
            indentLevel += braceCount.net;
            indentLevel = Math.max(0, indentLevel);
        }

        return formattedLines.join('\n');
    }

    private countBracesInLine(line: string): { opening: number; closing: number; net: number } {
        let opening = 0;
        let closing = 0;
        let inString = false;
        let stringChar = '';
        let escaped = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];

            if (escaped) {
                escaped = false;
                continue;
            }

            if (char === '\\') {
                escaped = true;
                continue;
            }

            if (!inString) {
                if (char === '"' || char === "'") {
                    inString = true;
                    stringChar = char;
                } else if (char === '{') {
                    opening++;
                } else if (char === '}') {
                    closing++;
                }
            } else if (char === stringChar) {
                inString = false;
            }
        }

        return {
            opening,
            closing,
            net: opening - closing
        };
    }

    private formatOperatorSpacing(line: string): string {
        // Don't format operators inside strings
        const parts: string[] = [];
        let current = '';
        let inString = false;
        let stringChar = '';

        for (let i = 0; i < line.length; i++) {
            const char = line[i];

            if (!inString && (char === '"' || char === "'")) {
                if (current) {
                    parts.push(this.addOperatorSpaces(current));
                    current = '';
                }
                inString = true;
                stringChar = char;
                current = char;
            } else if (inString && char === stringChar) {
                current += char;
                parts.push(current);
                current = '';
                inString = false;
            } else {
                current += char;
            }
        }

        if (current) {
            if (inString) {
                parts.push(current);
            } else {
                parts.push(this.addOperatorSpaces(current));
            }
        }

        return parts.join('');
    }

    private addOperatorSpaces(text: string): string {
        // Add spaces around comparison operators
        text = text.replace(/\s*(==|!=|<=|>=)\s*/g, ' $1 ');
        text = text.replace(/\s*([<>])\s*/g, ' $1 ');
        text = text.replace(/\b(eq|ne|in|ni)\b/g, ' $1 ');
        
        // Add spaces around arithmetic operators
        text = text.replace(/(\w)\s*([+\-*/%])\s*(\w)/g, '$1 $2 $3');
        
        // Clean up multiple spaces
        text = text.replace(/\s+/g, ' ');
        
        return text;
    }

    private formatBraceSpacing(line: string): string {
        // Add space before opening braces if needed
        return line.replace(/(\S)\{/g, '$1 {');
    }

    private formatBracketSpacing(line: string): string {
        if (!this.options.spacesInsideBrackets) {
            return line;
        }
        
        // Add space after opening bracket and before closing bracket
        line = line.replace(/\[([^\s\]])/g, '[ $1');
        line = line.replace(/([^\s\[])\]/g, '$1 ]');
        
        return line;
    }
}