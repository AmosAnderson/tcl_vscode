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
            trimmed = this.applyStructuralSpacing(trimmed);

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

            const leadingClosings = this.countLeadingClosings(trimmed);

            // If starts with closing brace(s), move indent back accordingly before emitting
            if (leadingClosings > 0) {
                indent = Math.max(0, indent - leadingClosings);
            }

            // Emit line
            out.push(this.createIndent(indent) + trimmed);

            // Count brace delta (ignore those inside strings via helper)
            const counts = this.countBraces(trimmed);
            const remainingClosings = Math.max(0, counts.closing - leadingClosings);

            // Adjust indent for each opening brace that is not closed on the same line
            indent += counts.opening - remainingClosings;
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
        // Don't apply spacing inside string literals
        const result: string[] = [];
        let inString = false;
        let stringChar = '';
        let i = 0;

        while (i < line.length) {
            const char = line[i];

            // Track string state
            if (char === '"' || char === "'") {
                // Count consecutive backslashes before this character
                let backslashCount = 0;
                let checkPos = i - 1;
                while (checkPos >= 0 && line[checkPos] === '\\') {
                    backslashCount++;
                    checkPos--;
                }
                // Quote is escaped only if odd number of backslashes before it
                const isEscaped = backslashCount % 2 === 1;

                if (!isEscaped) {
                    if (!inString) {
                        inString = true;
                        stringChar = char;
                    } else if (char === stringChar) {
                        inString = false;
                        stringChar = '';
                    }
                }
                result.push(char);
                i++;
                continue;
            }

            // If in string, don't modify
            if (inString) {
                result.push(char);
                i++;
                continue;
            }

            // Process braces outside strings
            if (char === '{') {
                const closeIdx = this.findMatchingBraceInString(line, i);
                if (closeIdx !== -1) {
                    const inner = line.substring(i + 1, closeIdx);
                    const trimmed = inner.trim();
                    if (!trimmed) {
                        result.push('{}');
                    } else if (this.options.spacesInsideBraces) {
                        result.push(`{ ${trimmed} }`);
                    } else {
                        result.push(`{${trimmed}}`);
                    }
                    i = closeIdx + 1;
                    continue;
                }
            }

            result.push(char);
            i++;
        }

        return result.join('');
    }

    private applyBracketSpacing(line: string): string {
        // Don't apply spacing inside string literals
        const result: string[] = [];
        let inString = false;
        let stringChar = '';
        let i = 0;

        while (i < line.length) {
            const char = line[i];

            // Track string state
            if (char === '"' || char === "'") {
                // Count consecutive backslashes before this character
                let backslashCount = 0;
                let checkPos = i - 1;
                while (checkPos >= 0 && line[checkPos] === '\\') {
                    backslashCount++;
                    checkPos--;
                }
                // Quote is escaped only if odd number of backslashes before it
                const isEscaped = backslashCount % 2 === 1;

                if (!isEscaped) {
                    if (!inString) {
                        inString = true;
                        stringChar = char;
                    } else if (char === stringChar) {
                        inString = false;
                        stringChar = '';
                    }
                }
                result.push(char);
                i++;
                continue;
            }

            // If in string, don't modify
            if (inString) {
                result.push(char);
                i++;
                continue;
            }

            // Process brackets outside strings
            if (char === '[') {
                const closeIdx = this.findMatchingBracketInString(line, i);
                if (closeIdx !== -1) {
                    const inner = line.substring(i + 1, closeIdx);
                    const trimmed = inner.trim();
                    if (!trimmed) {
                        result.push('[]');
                    } else if (this.options.spacesInsideBrackets) {
                        result.push(`[ ${trimmed} ]`);
                    } else {
                        result.push(`[${trimmed}]`);
                    }
                    i = closeIdx + 1;
                    continue;
                }
            }

            result.push(char);
            i++;
        }

        return result.join('');
    }

    private findMatchingBraceInString(str: string, openIdx: number): number {
        let depth = 0;
        let inString = false;
        let stringChar = '';

        for (let i = openIdx; i < str.length; i++) {
            const char = str[i];

            if (char === '"' || char === "'") {
                // Count consecutive backslashes before this character
                let backslashCount = 0;
                let checkPos = i - 1;
                while (checkPos >= 0 && str[checkPos] === '\\') {
                    backslashCount++;
                    checkPos--;
                }
                // Quote is escaped only if odd number of backslashes before it
                const isEscaped = backslashCount % 2 === 1;

                if (!isEscaped) {
                    if (!inString) {
                        inString = true;
                        stringChar = char;
                    } else if (char === stringChar) {
                        inString = false;
                        stringChar = '';
                    }
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

    private findMatchingBracketInString(str: string, openIdx: number): number {
        let depth = 0;
        let inString = false;
        let stringChar = '';

        for (let i = openIdx; i < str.length; i++) {
            const char = str[i];

            if (char === '"' || char === "'") {
                // Count consecutive backslashes before this character
                let backslashCount = 0;
                let checkPos = i - 1;
                while (checkPos >= 0 && str[checkPos] === '\\') {
                    backslashCount++;
                    checkPos--;
                }
                // Quote is escaped only if odd number of backslashes before it
                const isEscaped = backslashCount % 2 === 1;

                if (!isEscaped) {
                    if (!inString) {
                        inString = true;
                        stringChar = char;
                    } else if (char === stringChar) {
                        inString = false;
                        stringChar = '';
                    }
                }
                continue;
            }

            if (!inString) {
                if (char === '[') {
                    depth++;
                } else if (char === ']') {
                    depth--;
                    if (depth === 0) {
                        return i;
                    }
                }
            }
        }
        return -1;
    }

    private applyStructuralSpacing(line: string): string {
        if (!line) {
            return line;
        }

        // Ensure closing brace before else/elseif has spacing
        line = line.replace(/}\s*(else|elseif|finally|catch)\b/gi, '} $1');

        // Ensure keywords that start blocks have a space before the opening brace
        line = line.replace(/\b(if|elseif|else|switch|while|for|foreach|try|catch|finally)\s*\{/gi, (_m, kw) => `${kw} {`);

        // Ensure procedure definitions have spacing before argument braces
        line = line.replace(/\bproc\s+([^\s{]+)\s*\{/gi, (_m, name) => `proc ${name} {`);

        // Separate adjacent braces
        line = line.replace(/}\s*\{/g, '} {');

        // Ensure tokens directly before an opening brace are separated by a space (avoid $, @)
        line = line.replace(/([A-Za-z0-9_\)\]])\s*\{/g, (_m, prev) => `${prev} {`);

        return line;
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

    private countLeadingClosings(line: string): number {
        let count = 0;
        let inString = false;
        let stringChar = '';

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            const prevChar = i > 0 ? line[i - 1] : '';

            if (prevChar === '\\') {
                continue;
            }

            if ((char === '"' || char === '\'') && !inString) {
                inString = true;
                stringChar = char;
            } else if (char === stringChar && inString) {
                inString = false;
                stringChar = '';
            }

            if (inString) {
                break;
            }

            if (char === '}') {
                count++;
                continue;
            }

            if (!/\s/.test(char)) {
                break;
            }
        }

        return count;
    }
}