import { getExpressionWords, getScriptWords, isStaticWord, parseTclList, parseTclScript, TclCommand, TclWord } from '../utils/tclParser';

export interface TclFormattingOptions {
    indentSize: number;
    useTabs: boolean;
    alignBraces: boolean;
    spacesAroundOperators: boolean;
    spacesInsideBraces: boolean;
    spacesInsideBrackets: boolean;
}

/** Formats known Tcl syntax; unknown braced arguments remain literal data. */
export class TclFormatter {
    private readonly options: TclFormattingOptions;
    private baseIndent = '';
    private newline = '\n';

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
        this.newline = text.includes('\r\n') ? '\r\n' : '\n';
        // Formatting must not guess repairs for malformed or incomplete source.
        return parseTclScript(text).errors.length ? text : this.formatScript(text, 0, text.length, 0);
    }

    /** Format complete commands in their original script context; literals are opaque. */
    formatRange(text: string, start: number, end: number): { start: number; end: number; text: string } | undefined {
        let selected: TclCommand[] = [];
        const visit = (from: number, to: number): void => {
            if (start < from || end > to) return;
            const parsed = parseTclScript(text, from, to);
            if (parsed.errors.length) return;
            const commands = parsed.commands.filter(command => command.start >= start && command.end <= end);
            if (commands.length && !text.slice(start, commands[0].start).trim() &&
                !text.slice(commands[commands.length - 1].end, end).trim()) selected = commands;
            for (const command of parsed.commands) {
                for (const body of getScriptWords(command)) visit(body.contentStart, body.contentEnd);
                for (const word of command.words) {
                    for (const sub of word.commandSubstitutions) visit(sub.start + 1, sub.end - 1);
                }
            }
        };
        visit(0, text.length);
        if (!selected.length) return undefined;
        const from = selected[0].start;
        const to = selected[selected.length - 1].end;
        const prefix = text.slice(text.lastIndexOf('\n', from - 1) + 1, from);
        const indentation = prefix.match(/^[ \t]*/)?.[0] ?? '';
        // Keep the user's base indentation, including widths that differ from tabSize.
        const contextual = new TclFormatter(this.options);
        contextual.baseIndent = indentation;
        contextual.newline = text.includes('\r\n') ? '\r\n' : '\n';
        const formatted = contextual.formatScript(text, from, to, 0);
        // Only emitted syntax receives indentation; newlines inside literal words stay exact.
        return { start: from, end: to, text: formatted.slice(indentation.length) };
    }

    private indent(level: number): string {
        return this.baseIndent + (this.options.useTabs ? '\t'.repeat(level) : ' '.repeat(level * this.options.indentSize));
    }

    private formatScript(text: string, start: number, end: number, level: number, trimEdges = false): string {
        const parsed = parseTclScript(text, start, end);
        if (parsed.errors.length) return text.slice(start, end);
        let output = '';
        let cursor = start;
        for (const command of parsed.commands) {
            let gap = text.slice(cursor, command.start);
            if (trimEdges && cursor === start) gap = gap.replace(/^\s+/, '');
            output += this.formatGap(gap, level, !output || output.endsWith('\n'));
            if (!output || output.endsWith('\n')) output += this.indent(level);
            output += this.formatCommand(text, command, level);
            cursor = command.end;
        }
        let suffix = text.slice(cursor, end);
        if (trimEdges && cursor === start) suffix = suffix.replace(/^\s+/, '');
        output += this.formatGap(suffix, level, !output || output.endsWith('\n'));
        // Preserve trailing spaces in words and comments, where they can escape
        // a space or prevent a backslash from continuing onto the next line.
        return trimEdges ? output.replace(/(?:\r?\n)+$/, '') : output;
    }

    private formatGap(gap: string, level: number, atLineStart: boolean): string {
        // Only separators, whitespace and complete comments occur in these gaps.
        return gap.split(/\r?\n/).map((line, index) => {
            if (/^[ \t\r]*$/.test(line)) return '';
            return index > 0 || atLineStart ? this.indent(level) + line.replace(/^[ \t]*/, '') : line;
        }).join(this.newline);
    }

    private formatCommand(text: string, command: TclCommand, level: number): string {
        const words = command.words;
        const name = isStaticWord(words[0]) ? words[0].value.replace(/^::/, '') : '';
        // A {*} expansion can change every subsequent argument's role.
        const hasExpansion = words.some(word => word.expanded);
        const scripts = new Set(hasExpansion ? [] : getScriptWords(command).map(word => word.start));
        const expressions = new Set(hasExpansion ? [] : getExpressionWords(command).map(word => word.start));
        let output = '';
        for (let index = 0; index < words.length; index++) {
            const word = words[index];
            if (index) {
                const gap = text.slice(words[index - 1].end, word.start);
                output += /\\\r?\n/.test(gap) ? ' \\' + this.newline + this.indent(level + 1) : ' ';
            }
            if (word.expanded) {
                output += word.text;
            } else if (name === 'switch' && word.kind === 'braced' && index === words.length - 1 &&
                [...scripts].some(start => start > word.start && start < word.end)) {
                output += this.formatSwitchList(text, word, level);
            } else if (word.kind === 'braced' && scripts.has(word.start)) {
                const inline = (name === 'for' && (index === 1 || index === 3)) ||
                    ((name === 'catch' || name === 'time') && !word.value.includes('\n'));
                output += this.formatBody(text, word, level, inline);
            } else if (word.kind === 'braced' && expressions.has(word.start)) {
                const value = this.formatExpression(word.value);
                output += !value ? '{}' : value.includes('\n') ? '{' + value + '}' : this.paddedBraces(value);
            } else if (!hasExpansion && name === 'proc' && index === 2 && word.kind === 'braced') {
                const params = parseTclList(text, word.contentStart, word.contentEnd);
                output += params.errors.length ? word.text : !params.words.length ? '{}' :
                    this.paddedBraces(text.slice(params.words[0].start, params.words[params.words.length - 1].end));
            } else if (name === 'expr' && expressions.has(word.start) && word.kind === 'bare') {
                // expr concatenates arguments; control commands do not.
                output += this.formatExpression(word.text);
            } else {
                output += this.formatSubstitutions(text, word);
            }
        }
        return output;
    }

    private formatSwitchList(text: string, word: TclWord, level: number): string {
        const parsed = parseTclList(text, word.contentStart, word.contentEnd);
        if (parsed.errors.length || parsed.words.length % 2) return word.text;
        const lines: string[] = [];
        for (let i = 0; i < parsed.words.length; i += 2) {
            const pattern = parsed.words[i];
            const body = parsed.words[i + 1];
            lines.push(this.indent(level + 1) + pattern.text + ' ' +
                (body.kind === 'braced' ? this.formatBody(text, body, level + 1, false) : body.text));
        }
        return '{' + this.newline + lines.join(this.newline) + this.newline + this.indent(level) + '}';
    }

    private formatBody(text: string, word: TclWord, level: number, inline: boolean): string {
        if (parseTclScript(text, word.contentStart, word.contentEnd).errors.length) return word.text;
        const body = this.formatScript(text, word.contentStart, word.contentEnd, inline ? 0 : level + 1, true);
        if (!body) return '{}';
        if (inline && !body.includes('\n')) return this.paddedBraces(body.slice(this.baseIndent.length));
        if (!this.options.alignBraces && body.endsWith('}')) return '{' + this.newline + body + '}';
        return '{' + this.newline + body + this.newline + this.indent(level) + '}';
    }

    private paddedBraces(value: string): string {
        return this.options.spacesInsideBraces ? '{ ' + value + ' }' : '{' + value + '}';
    }

    private formatSubstitutions(text: string, word: TclWord): string {
        if (word.kind === 'braced' || !word.commandSubstitutions.length) return word.text;
        let result = '';
        let cursor = word.start;
        for (const sub of word.commandSubstitutions) {
            result += text.slice(cursor, sub.start);
            const parsed = parseTclScript(text, sub.start + 1, sub.end - 1);
            if (parsed.errors.length || !parsed.commands.length) {
                result += text.slice(sub.start, sub.end);
            } else {
                const inner = this.formatScript(text, sub.start + 1, sub.end - 1, 0, true).slice(this.baseIndent.length);
                const tail = text.slice(parsed.commands[parsed.commands.length - 1].end, sub.end - 1);
                const padding = this.options.spacesInsideBrackets ? ' ' : '';
                // Closing brackets must not be swallowed by a trailing comment.
                result += '[' + padding + inner + (tail.includes('#') ? this.newline : padding) + ']';
            }
            cursor = sub.end;
        }
        return result + text.slice(cursor, word.end);
    }

    private formatExpression(expression: string): string {
        type Kind = 'space' | 'operand' | 'operator' | 'open' | 'close';
        const tokens: { text: string; kind: Kind }[] = [];
        const prefix = 'expr ';
        const substitutions = new Map<number, number>();
        for (const command of parseTclScript(prefix + expression).commands) {
            for (const word of command.words) {
                for (const sub of word.commandSubstitutions) {
                    substitutions.set(sub.start - prefix.length, sub.end - prefix.length);
                }
            }
        }
        const skipVariable = (start: number): number => {
            let index = start + 1;
            if (expression[index] === '{') {
                const close = expression.indexOf('}', index + 1);
                return close < 0 ? expression.length : close + 1;
            }
            while (index < expression.length) {
                const character = String.fromCodePoint(expression.codePointAt(index)!);
                if (!/[\p{L}\p{N}_:]/u.test(character)) break;
                index += character.length;
            }
            if (expression[index] === '(') {
                index++;
                while (index < expression.length && expression[index] !== ')') {
                    if (expression[index] === '\\') index += 2;
                    else if (substitutions.has(index)) index = substitutions.get(index)!;
                    else if (expression[index] === '$') index = skipVariable(index);
                    else index++;
                }
                if (expression[index] === ')') index++;
            }
            return index;
        };
        let index = 0;
        while (index < expression.length) {
            const start = index;
            const ch = expression[index];
            let kind: Kind = 'operand';
            if (/\s/.test(ch)) {
                while (index < expression.length && /\s/.test(expression[index])) index++;
                kind = 'space';
            } else if (substitutions.has(index)) {
                index = substitutions.get(index)!;
            } else if (ch === '$') {
                index = skipVariable(index);
            } else if (ch === '"' || ch === '{') {
                let depth = 1;
                index++;
                while (index < expression.length && depth > 0) {
                    if (expression[index] === '\\') index += 2;
                    else if (ch === '"' && substitutions.has(index)) index = substitutions.get(index)!;
                    else if (expression[index] === (ch === '"' ? '"' : '}')) { depth--; index++; }
                    else if (ch === '{' && expression[index] === '{') { depth++; index++; }
                    else index++;
                }
            } else if (ch === '\\') {
                index = Math.min(index + 2, expression.length);
            } else {
                const number = expression.slice(index).match(/^(?:0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)(?![\w.])/);
                const operator = expression.slice(index).match(/^(?:\*\*|<<|>>|<=|>=|==|!=|&&|\|\||[+\-*/%<>&|^?:!~])/);
                if (number) index += number[0].length;
                else if (operator) { index += operator[0].length; kind = 'operator'; }
                else if (ch === '(' || ch === ')') { index++; kind = ch === '(' ? 'open' : 'close'; }
                else {
                    index++;
                    while (index < expression.length && /[\w:]/.test(expression[index])) index++;
                }
            }
            tokens.push({ text: expression.slice(start, index), kind });
        }
        while (tokens[0]?.kind === 'space' && !tokens[0].text.includes('\n')) tokens.shift();
        while (tokens[tokens.length - 1]?.kind === 'space' && !tokens[tokens.length - 1].text.includes('\n')) tokens.pop();
        if (!this.options.spacesAroundOperators) return tokens.map(token => token.text).join('');
        let result = '';
        let previous: typeof tokens[number] | undefined;
        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            if (token.kind === 'operator' && previous &&
                (previous.kind === 'operand' || previous.kind === 'close') &&
                token.text !== '!' && token.text !== '~') {
                if (result && !/\s$/.test(result)) result += ' ';
                result += token.text;
                if (tokens[i + 1] && tokens[i + 1].kind !== 'space') result += ' ';
            } else result += token.text;
            if (token.kind !== 'space') previous = token;
        }
        return result;
    }
}
