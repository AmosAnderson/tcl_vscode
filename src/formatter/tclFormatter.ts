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

    format(text: string): string {
        const lines = text.split('\n');
        const result: string[] = [];
        let currentIndentLevel = 0;

        for (const line of lines) {
            const trimmed = line.trim();
            
            // Skip empty lines
            if (!trimmed) {
                result.push('');
                continue;
            }

            // Count opening and closing braces (outside of strings)
            const { opening, closing } = this.countBraces(trimmed);
            
            // If line starts with }, decrease indent for this line only
            let lineIndentLevel = currentIndentLevel;
            if (trimmed.startsWith('}')) {
                lineIndentLevel = Math.max(0, currentIndentLevel - 1);
            }

            // Create the indented line
            const indentString = this.createIndent(lineIndentLevel);
            const formattedLine = indentString + trimmed;
            
            result.push(formattedLine);

            // Update indent level for next line
            currentIndentLevel += (opening - closing);
            currentIndentLevel = Math.max(0, currentIndentLevel);
        }

        return result.join('\n');
    }

    private createIndent(level: number): string {
        if (this.options.useTabs) {
            return '\t'.repeat(level);
        } else {
            return ' '.repeat(level * this.options.indentSize);
        }
    }

    private countBraces(line: string): { opening: number; closing: number } {
        let opening = 0;
        let closing = 0;
        let inString = false;
        let stringChar = '';

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            const prevChar = i > 0 ? line[i - 1] : '';

            // Handle escaped characters
            if (prevChar === '\\') {
                continue;
            }

            // Handle quoted strings
            if ((char === '"' || char === "'") && !inString) {
                inString = true;
                stringChar = char;
            } else if (char === stringChar && inString) {
                inString = false;
                stringChar = '';
            }

            // Count braces outside of strings
            if (!inString) {
                if (char === '{') {
                    opening++;
                } else if (char === '}') {
                    closing++;
                }
            }
        }

        return { opening, closing };
    }
}