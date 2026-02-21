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

            // Comment lines: preserve content unchanged, indent at current level,
            // and do NOT count their braces (they must not affect indentation).
            if (trimmed.startsWith('#')) {
                out.push(this.createIndent(indent) + trimmed);
                continue;
            }

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

            // Count brace delta — strip inline comments first so braces inside
            // "; # ..." do not affect indentation.
            const lineForCounting = this.stripInlineComment(trimmed);
            const counts = this.countBraces(lineForCounting);
            const remainingClosings = Math.max(0, counts.closing - leadingClosings);

            // Adjust indent for each opening brace that is not closed on the same line
            indent += counts.opening - remainingClosings;
            if (indent < 0) indent = 0;
        }

        return out.join('\n');
    }

    private normalizeInlineBlocks(text: string): string {
        // Expand single-line inline block forms into properly indented multi-line forms.
        // Process line-by-line so that comment lines (starting with #) are never modified.
        return text.split('\n').map(line => {
            if (line.trimStart().startsWith('#')) {
                return line;
            }
            return this.expandInlineLine(line);
        }).join('\n');
    }

    private expandInlineLine(line: string): string {
        // proc name {args}{body}
        line = line.replace(/\bproc\s+([a-zA-Z_][a-zA-Z0-9_:]*)\s+\{([^}]*)\}\s*\{([^}\n]*)\}/g,
            (_m, name, args, body) => `proc ${name} {${args.trim()}} {\n${this.createIndent(1)}${body.trim()}\n}`);

        // while {cond}{body}
        line = line.replace(/\bwhile\s+\{([^}]*)\}\s*\{([^}\n]*)\}/g,
            (_m, cond, body) => `while {${cond.trim()}} {\n${this.createIndent(1)}${body.trim()}\n}`);

        // for {init}{cond}{step}{body}
        line = line.replace(/\bfor\s+\{([^}]*)\}\s*\{([^}]*)\}\s*\{([^}]*)\}\s*\{([^}\n]*)\}/g,
            (_m, init, cond, step, body) =>
                `for {${init.trim()}} {${cond.trim()}} {${step.trim()}} {\n${this.createIndent(1)}${body.trim()}\n}`);

        // foreach varName list {body}  (list may be brace-quoted, variable, or bare word)
        line = line.replace(/\bforeach\s+(\S+)\s+(\{[^}]*\}|\S+)\s*\{([^}\n]*)\}/g,
            (_m, varName, list, body) => `foreach ${varName} ${list} {\n${this.createIndent(1)}${body.trim()}\n}`);

        // if {cond}{body} — replace iteratively to handle chained inline ifs
        let prev: string;
        do {
            prev = line;
            line = line.replace(/\bif\s+\{([^}]*)\}\s*\{([^}\n]*)\}/g,
                (_m, cond, body) => `if {${cond.trim()}} {\n${this.createIndent(1)}${body.trim()}\n}`);
        } while (line !== prev);

        return line;
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

        // Only apply operator spacing inside braces that follow control-flow keywords
        // This prevents breaking regex patterns like {\d{3}} or list values
        const conditionKeywords = /\b(if|while|for|foreach|switch|elseif|expr|catch|try)\s*$/i;
        
        // Process each brace group, only spacing those after keywords
        let result = '';
        let lastIndex = 0;
        const braceRegex = /\{([^{}]*)\}/g;
        let match;
        
        while ((match = braceRegex.exec(line)) !== null) {
            const precedingText = line.substring(0, match.index);
            result += line.substring(lastIndex, match.index);
            
            const inner = match[1];
            const trimmed = inner.trim();
            
            // Only apply operator spacing if preceded by a control-flow keyword
            if (conditionKeywords.test(precedingText.trimEnd())) {
                result += `{${spaceOps(trimmed)}}`;
            } else {
                result += match[0]; // Keep original
            }
            
            lastIndex = match.index + match[0].length;
        }
        
        result += line.substring(lastIndex);
        return result;
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
                    } else if (this.options.spacesInsideBraces && this.shouldAddSpacesInsideBrace(result.join(''))) {
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

    /**
     * Determines if spaces should be added inside braces based on context.
     * Only adds spaces after control-flow keywords (if, while, for, foreach, switch, elseif, expr)
     * where the braces contain conditions/expressions.
     * Does NOT add spaces for value contexts like regex patterns, string literals, list values, etc.
     */
    private shouldAddSpacesInsideBrace(precedingText: string): boolean {
        // Get the text immediately before the brace (trimmed)
        const trimmed = precedingText.trimEnd();
        
        // Keywords after which condition/expression braces should have spaces
        const conditionKeywords = /\b(if|while|for|foreach|switch|elseif|expr|catch|try)\s*$/i;
        
        // Check if preceded by a control-flow keyword
        if (conditionKeywords.test(trimmed)) {
            return true;
        }
        
        // Also allow spaces after closing brace (for chained conditions like "} {")
        // This handles the body block after a condition
        if (/}\s*$/.test(trimmed)) {
            return true;
        }
        
        // Allow spaces in proc argument and body braces
        // Matches: "proc name" or "proc name {args}"
        if (/\bproc\s+[^\s{]+\s*$/.test(trimmed) || /\bproc\s+[^\s{]+\s+\{[^}]*\}\s*$/.test(trimmed)) {
            return true;
        }
        
        // For all other cases (regex patterns, string values, list literals, etc.), don't add spaces
        return false;
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

        // Ensure tokens directly before an opening brace are separated by a space,
        // but only if we're not inside a brace-quoted string (to preserve regex quantifiers like \d{3})
        line = this.addSpaceBeforeTopLevelBraces(line);

        return line;
    }

    /**
     * Adds a space before opening braces that follow alphanumeric characters,
     * but only at the "top level" (not inside brace-quoted content like regex patterns).
     */
    private addSpaceBeforeTopLevelBraces(line: string): string {
        const result: string[] = [];
        let braceDepth = 0;
        
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            
            if (char === '{') {
                // Check if we should add space before this brace
                // Only add space at top level (braceDepth === 0) when preceded by alphanumeric/]/
                if (braceDepth === 0 && i > 0) {
                    const prevChar = line[i - 1];
                    // If preceded by alphanumeric, ), or ] and not already spaced
                    if (/[A-Za-z0-9_\)\]]/.test(prevChar)) {
                        // Check if there's already a space (shouldn't match but be safe)
                        if (result.length > 0 && result[result.length - 1] !== ' ') {
                            result.push(' ');
                        }
                    }
                }
                braceDepth++;
                result.push(char);
            } else if (char === '}') {
                braceDepth = Math.max(0, braceDepth - 1);
                result.push(char);
            } else {
                result.push(char);
            }
        }
        
        return result.join('');
    }

    /**
     * Strips an inline TCL comment ("; # ...") from a line for the purposes of
     * brace counting.  A "#" starts a comment only when it appears as the first
     * non-whitespace token of a new command, which on a single line means after
     * a ";" separator.  Strings and nested brackets/braces are respected so that
     * a literal semicolon inside a string or brace group is not treated as a
     * command separator.
     */
    private stripInlineComment(line: string): string {
        let inString = false;
        let stringChar = '';
        let braceDepth = 0;
        let bracketDepth = 0;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];

            // Track string boundaries (double-quote strings only; TCL single-quotes
            // are not special but we mirror the logic used elsewhere in this class).
            if ((char === '"' || char === "'") && !inString) {
                inString = true;
                stringChar = char;
                continue;
            }
            if (inString && char === stringChar) {
                let backslashes = 0;
                let k = i - 1;
                while (k >= 0 && line[k] === '\\') { backslashes++; k--; }
                if (backslashes % 2 === 0) {
                    inString = false;
                    stringChar = '';
                }
                continue;
            }
            if (inString) { continue; }

            if (char === '{') { braceDepth++; }
            else if (char === '}') { braceDepth = Math.max(0, braceDepth - 1); }
            else if (char === '[') { bracketDepth++; }
            else if (char === ']') { bracketDepth = Math.max(0, bracketDepth - 1); }

            // A ";" at the top level is a command separator.  If a "#" follows
            // (with optional whitespace), everything from the ";" onward is a comment.
            if (char === ';' && braceDepth === 0 && bracketDepth === 0) {
                let j = i + 1;
                while (j < line.length && line[j] === ' ') { j++; }
                if (j < line.length && line[j] === '#') {
                    return line.substring(0, i);
                }
            }
        }
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