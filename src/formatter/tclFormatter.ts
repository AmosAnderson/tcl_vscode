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
        let normalized = this.normalizeInlineBlocks(text);
        const rawLines = normalized.split('\n');
        const out: string[] = [];
        let indent = 0;

        for (let line of rawLines) {
            let trimmed = line.trim();
            if (trimmed === '') { out.push(''); continue; }

            // Apply spacing rules early (except on pure brace lines)
            if (!/^}+$/ .test(trimmed)) {
                if (this.options.spacesAroundOperators) {
                    trimmed = this.applyOperatorSpacing(trimmed);
                }

                trimmed = this.applyBraceSpacing(trimmed);
                trimmed = this.applyBracketSpacing(trimmed);
            }

            // If the line is purely closing brace(s)
            if (/^}+$/ .test(trimmed)) {
                const braceCount = trimmed.length;

                if (this.options.alignBraces) {
                    // Decrease indent for each brace, emit each on its own line
                    for (let i = 0; i < braceCount; i++) {
                        indent = Math.max(0, indent - 1);
                        out.push(this.createIndent(indent) + '}');
                    }
                } else {
                    indent = Math.max(0, indent - braceCount);
                    out.push(this.createIndent(indent) + trimmed);
                }
                continue;
            }

            // If starts with '}' (mixed content) move one indent back first
            if (trimmed.startsWith('}')) {
                indent = Math.max(0, indent - 1);
            }

            // Emit line
            out.push(this.createIndent(indent) + trimmed);

            // Count brace delta (ignore those inside strings via helper)
            const counts = this.countBraces(trimmed);
            // Adjust indent for each opening brace that is not closed on same line at end
            // Simple rule: indent += (opening - closing) but closing already handled if line began with '}'
            indent += counts.opening - counts.closing;
            if (indent < 0) indent = 0;
        }

        return out.join('\n');
    }

    private normalizeInlineBlocks(text: string): string {
        // Only handle simple one-line inline forms used in tests.
        // proc form
        text = text.replace(/\bproc\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+\{([^}]*)\}\s*\{([^}\n]*)\}/g,
            (_m, name, args, body) => `proc ${name} {${args.trim()}} {\n${this.createIndent(1)}${body.trim()}\n}`);
        // if form(s) possibly chained: if {cond}{body}
        // Replace iteratively to handle nested inline ifs
        let prev: string;
        do {
            prev = text;
            text = text.replace(/\bif\s+\{([^}]*)\}\s*\{([^}\n]*)\}/g,
                (_m, cond, body) => `if {${cond.trim()}} {\n${this.createIndent(1)}${body.trim()}\n}`);
        } while (text !== prev);
        return text;
    }

    private applyOperatorSpacing(line: string): string {
        const spaceOps = (segment: string): string => {
            // Add spaces around common operators if not already spaced
            // Handle > < == != + - * / % inside expressions / conditions
            segment = segment.replace(/([A-Za-z0-9_\]\)])([+\-*\/>%<]=?|==|!=)([A-Za-z0-9_\[\$"'@])/g, (_m, a, op, b) => `${a} ${op} ${b}`);
            // Collapse multiple spaces
            segment = segment.replace(/\s{2,}/g, ' ');
            return segment;
        };

        // Inside [expr ...]
        line = line.replace(/\[expr\s+([^\]]+)\]/g, (_m, inner) => {
            return `[expr ${spaceOps(inner.trim())}]`;
        });

        // Inside braces for conditions: find { ... }
        line = line.replace(/\{([^{}]+)\}/g, (_m, inner) => {
            const trimmed = inner.trim();
            const spaced = spaceOps(trimmed);
            return `{${spaced}}`;
        });
        return line;
    }

    private applyBraceSpacing(line: string): string {
        return line.replace(/\{([^{}\n]*)\}/g, (_m, inner) => {
            const content = inner.trim();
            if (!content) {
                return '{}';
            }

            if (this.options.spacesInsideBraces) {
                return `{ ${content} }`;
            }
            return `{${content}}`;
        });
    }

    private applyBracketSpacing(line: string): string {
        return line.replace(/\[([^\[\]\n]*)\]/g, (_m, inner) => {
            const content = inner.trim();
            if (!content) {
                return '[]';
            }

            if (this.options.spacesInsideBrackets) {
                return `[ ${content} ]`;
            }
            return `[${content}]`;
        });
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