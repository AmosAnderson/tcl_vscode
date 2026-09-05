/** A source-preserving Tcl lexer. No document text is evaluated. */
export interface TclWord {
    start: number;
    end: number;
    contentStart: number;
    contentEnd: number;
    kind: 'bare' | 'braced' | 'quoted';
    text: string;
    value: string;
    expanded?: boolean;
    substitutions: TclCommand[];
    commandSubstitutions: { start: number; end: number }[];
}
export interface TclCommand { start: number; end: number; words: TclWord[]; }
export interface TclParseError { offset: number; message: string; }
export interface TclParseResult { commands: TclCommand[]; errors: TclParseError[]; }

class Parser {
    readonly errors: TclParseError[] = [];
    pos: number;
    constructor(readonly text: string, start: number, readonly end: number) { this.pos = start; }

    private continuation(): boolean { return this.text[this.pos] === '\\' && this.text[this.pos + 1] === '\n'; }
    private skipSpace(list = false): void {
        while (this.pos < this.end) {
            if (this.continuation()) {
                this.pos += 2;
                while (/[ \t]/.test(this.text[this.pos] ?? '') && this.pos < this.end) this.pos++;
            } else if ((list ? /\s/ : /[ \t\r\v\f]/).test(this.text[this.pos])) {
                this.pos++;
            } else break;
        }
    }
    private error(offset: number, message: string): void { this.errors.push({ offset, message }); }

    script(bracket = false): TclCommand[] {
        const commands: TclCommand[] = [];
        while (this.pos < this.end) {
            this.skipSpace();
            if (bracket && this.text[this.pos] === ']') break;
            if (this.text[this.pos] === ';' || this.text[this.pos] === '\n') { this.pos++; continue; }
            if (this.text[this.pos] === '#') {
                while (this.pos < this.end && this.text[this.pos] !== '\n') {
                    if (this.continuation()) this.pos += 2;
                    else this.pos++;
                }
                continue;
            }
            if (this.pos >= this.end) break;
            const start = this.pos;
            const words: TclWord[] = [];
            while (this.pos < this.end) {
                this.skipSpace();
                if (this.pos >= this.end || /[;\n]/.test(this.text[this.pos]) || (bracket && this.text[this.pos] === ']')) break;
                words.push(this.word(false, bracket));
            }
            if (words.length) commands.push({ start, end: words[words.length - 1].end, words });
        }
        return commands;
    }

    expressionSubstitutions(): { commands: TclCommand[]; spans: { start: number; end: number }[] } {
        const word: TclWord = { start: this.pos, end: this.end, contentStart: this.pos, contentEnd: this.end, kind: 'bare', text: '', value: '', substitutions: [], commandSubstitutions: [] };
        let inQuote = false;
        while (this.pos < this.end) {
            if (this.text[this.pos] === '"') { inQuote = !inQuote; this.pos++; }
            else if (this.text[this.pos] === '\\') this.pos = Math.min(this.pos + 2, this.end);
            else if (this.text[this.pos] === '[') this.substitution(word);
            else if (this.text[this.pos] === '$') this.variable(word);
            else if (this.text[this.pos] === '{' && !inQuote) {
                // Literal operands inside expressions do not perform substitutions.
                this.word(true, false);
            } else this.pos++;
        }
        return { commands: word.substitutions, spans: word.commandSubstitutions };
    }

    list(): TclWord[] {
        const words: TclWord[] = [];
        while (this.pos < this.end) {
            this.skipSpace(true);
            if (this.pos < this.end) words.push(this.word(true, false));
        }
        return words;
    }

    private substitution(word: TclWord): void {
        const start = this.pos++;
        word.substitutions.push(...this.script(true));
        if (this.text[this.pos] === ']') this.pos++;
        else this.error(start, 'Unclosed bracket');
        word.commandSubstitutions.push({ start, end: this.pos });
    }

    private variable(word: TclWord): void {
        const start = this.pos++;
        if (this.text[this.pos] === '{') {
            this.pos++;
            while (this.pos < this.end && this.text[this.pos] !== '}') this.pos++;
            if (this.pos < this.end) this.pos++;
            else this.error(start, 'Unclosed variable name');
            return;
        }
        const nameLength = /^(?:[\p{L}\p{M}\p{N}_]+|:{2,})+/u.exec(this.text.slice(this.pos, this.end))?.[0].length ?? 0;
        if (!nameLength) return;
        this.pos += nameLength;
        if (this.text[this.pos] !== '(') return;
        this.pos++;
        while (this.pos < this.end && this.text[this.pos] !== ')') {
            if (this.text[this.pos] === '\\') this.pos = Math.min(this.pos + 2, this.end);
            else if (this.text[this.pos] === '[') this.substitution(word);
            else if (this.text[this.pos] === '$') this.variable(word);
            else this.pos++;
        }
        if (this.pos < this.end) this.pos++;
        else this.error(start, 'Unclosed array index');
    }

    private word(list: boolean, bracket: boolean): TclWord {
        const start = this.pos;
        const expanded = !list && this.text.startsWith('{*}', this.pos) && this.pos + 3 < this.end && !/[\s;\]]/.test(this.text[this.pos + 3]);
        if (expanded) this.pos += 3;
        const first = this.text[this.pos];
        const kind = first === '{' ? 'braced' : first === '"' ? 'quoted' : 'bare';
        const word: TclWord = { start, end: start, contentStart: this.pos + (kind === 'bare' ? 0 : 1), contentEnd: start, kind, text: '', value: '', expanded, substitutions: [], commandSubstitutions: [] };
        if (kind === 'braced') {
            const open = this.pos++;
            let depth = 1;
            while (this.pos < this.end && depth) {
                const ch = this.text[this.pos++];
                if (ch === '\\') this.pos = Math.min(this.pos + 1, this.end);
                else if (ch === '{') depth++;
                else if (ch === '}') depth--;
            }
            word.contentEnd = this.pos - (depth === 0 ? 1 : 0);
            if (depth) this.error(open, 'Unclosed brace');
        } else {
            if (kind === 'quoted') this.pos++;
            let closed = kind === 'bare';
            while (this.pos < this.end) {
                const ch = this.text[this.pos];
                if (kind === 'quoted' && ch === '"') { closed = true; break; }
                if (kind === 'bare' && (/\s/.test(ch) || (!list && (ch === ';' || (bracket && ch === ']'))) || this.continuation())) break;
                if (ch === '\\') this.pos = Math.min(this.pos + 2, this.end);
                else if (!list && ch === '[') this.substitution(word);
                else if (!list && ch === '$') this.variable(word);
                else this.pos++;
            }
            word.contentEnd = this.pos;
            if (kind === 'quoted') {
                if (closed) this.pos++;
                else this.error(start, 'Unclosed string literal');
            }
        }
        if (kind !== 'bare' && this.pos < this.end && !/\s/.test(this.text[this.pos]) && !this.continuation() && (list || (this.text[this.pos] !== ';' && !(bracket && this.text[this.pos] === ']')))) {
            this.error(this.pos, `Extra characters after close ${kind === 'braced' ? 'brace' : 'quote'}`);
            while (this.pos < this.end && !/\s/.test(this.text[this.pos]) && (list || !/[;\]]/.test(this.text[this.pos]))) this.pos++;
        }
        word.end = this.pos;
        word.text = this.text.slice(start, this.pos);
        word.value = this.text.slice(word.contentStart, word.contentEnd);
        return word;
    }
}

export function parseTclScript(text: string, start = 0, end = text.length): TclParseResult {
    const parser = new Parser(text, start, end);
    return { commands: parser.script(), errors: parser.errors };
}
export function parseTclExpressionSubstitutions(text: string, start = 0, end = text.length): TclParseResult & { spans: { start: number; end: number }[] } {
    const parser = new Parser(text, start, end);
    const result = parser.expressionSubstitutions();
    return { ...result, errors: parser.errors };
}
export function parseTclList(text: string, start = 0, end = text.length): { words: TclWord[]; errors: TclParseError[] } {
    const parser = new Parser(text, start, end);
    return { words: parser.list(), errors: parser.errors };
}
/** True when the literal word can be resolved without substitutions or decoding escapes. */
export function isStaticWord(word: TclWord | undefined): word is TclWord {
    return !!word && !word.expanded && (word.kind === 'braced' ? !/\\\n/.test(word.value) : !/[\\$[]/.test(word.value));
}

function listWords(word: TclWord): TclWord[] {
    const result = parseTclList(word.value);
    return result.errors.length ? [] : result.words.map(w => ({ ...w, start: w.start + word.contentStart, end: w.end + word.contentStart, contentStart: w.contentStart + word.contentStart, contentEnd: w.contentEnd + word.contentStart }));
}

/** A literal lambda is a Tcl list containing parameters, body and optional namespace. */
export function getLambdaParts(command: TclCommand): TclWord[] {
    if (!isStaticWord(command.words[0]) || command.words[0].value.replace(/^::/, '') !== 'apply' || command.words.some(word => word.expanded)) return [];
    const lambda = command.words[1];
    if (!lambda || lambda.kind !== 'braced') return [];
    const parts = listWords(lambda);
    return (parts.length === 2 || parts.length === 3) && parts[0].kind === 'braced' && parts[1].kind === 'braced' && (!parts[2] || isStaticWord(parts[2])) ? parts : [];
}

/** Statically identifiable script arguments; unrecognized commands are opaque. */
export function getScriptWords(command: TclCommand): TclWord[] {
    const w = command.words;
    if (!isStaticWord(w[0]) || w.some(word => word.expanded)) return [];
    const name = w[0].value.replace(/^::/, '');
    let result: TclWord[] = [];
    switch (name) {
        case 'proc': result = w.length === 4 ? [w[3]] : []; break;
        case 'namespace': if (w[1]?.value === 'eval' && w.length === 4) result = [w[3]]; break;
        case 'oo::class': case 'oo::object':
            if (w[1]?.value === 'create' && isStaticWord(w[2]) && w.length === 4) result = [w[3]];
            break;
        case 'oo::define': case 'oo::objdefine':
            if (isStaticWord(w[1]) && w.length === 3) result = [w[2]];
            else if (w[2]?.value === 'method' && w.length === 6) result = [w[5]];
            else if (w[2]?.value === 'constructor' && w.length === 5) result = [w[4]];
            else if (w[2]?.value === 'destructor' && w.length === 4) result = [w[3]];
            break;
        case 'method': if (w.length === 4) result = [w[3]]; break;
        case 'constructor': if (w.length === 3) result = [w[2]]; break;
        case 'destructor': if (w.length === 2) result = [w[1]]; break;
        case 'apply': { const lambda = getLambdaParts(command); if (lambda.length) result = [lambda[1]]; break; }
        case 'if': {
            let i = 1;
            while (i < w.length) {
                if (w[i].value === 'else') { if (w[i + 1]) result.push(w[i + 1]); break; }
                if (w[i].value === 'elseif') i++;
                i++;
                if (w[i]?.value === 'then') i++;
                if (w[i]) result.push(w[i++]);
            }
            break;
        }
        case 'while': if (w[2]) result = [w[2]]; break;
        case 'for': result = [w[1], w[3], w[4]].filter(Boolean); break;
        case 'foreach': case 'lmap': if (w.length >= 4) result = [w[w.length - 1]]; break;
        case 'catch': case 'time': if (w[1]) result = [w[1]]; break;
        case 'try':
            if (w[1]) result.push(w[1]);
            for (let i = 2; i < w.length;) {
                if (w[i].value === 'finally') { if (w[i + 1]) result.push(w[i + 1]); break; }
                if (w[i].value !== 'on' && w[i].value !== 'trap') break;
                if (w[i + 3]) result.push(w[i + 3]);
                i += 4;
            }
            break;
        case 'dict':
            if (['for', 'map', 'update', 'with'].includes(w[1]?.value) && w.length > 3) result = [w[w.length - 1]];
            break;
        case 'switch': {
            let i = 1;
            while (w[i]?.value.startsWith('-')) {
                const option = w[i++].value;
                if (option === '--') break;
                if (option === '-matchvar' || option === '-indexvar') i++;
            }
            i++; // switch value
            const pairs = w.length - i === 1 && w[i].kind === 'braced' ? listWords(w[i]) : w.slice(i);
            result = pairs.filter((word, index) => index % 2 === 1 && word.value !== '-');
            break;
        }
    }
    return result.filter(word => word && word.kind === 'braced');
}

export function getExpressionWords(command: TclCommand): TclWord[] {
    const w = command.words;
    if (!isStaticWord(w[0]) || w.some(word => word.expanded)) return [];
    const name = w[0]?.value.replace(/^::/, '');
    if (name === 'expr') return w.slice(1);
    if (name === 'while' || name === 'for') return w[name === 'while' ? 1 : 2] ? [w[name === 'while' ? 1 : 2]] : [];
    if (name !== 'if') return [];
    const result: TclWord[] = [];
    let i = 1;
    while (i < w.length && w[i].value !== 'else') {
        if (w[i].value === 'elseif') i++;
        if (w[i]) result.push(w[i++]);
        if (w[i]?.value === 'then') i++;
        i++;
    }
    return result;
}

export function walkTclCommands(text: string, start = 0, end = text.length): TclCommand[] {
    const result: TclCommand[] = [];
    const visit = (commands: TclCommand[]): void => {
        for (const command of commands) {
            result.push(command);
            for (const word of command.words) visit(word.substitutions);
            for (const expression of getExpressionWords(command)) if (expression.kind === 'braced') visit(parseTclExpressionSubstitutions(text, expression.contentStart, expression.contentEnd).commands);
            for (const body of getScriptWords(command)) visit(parseTclScript(text, body.contentStart, body.contentEnd).commands);
        }
    };
    visit(parseTclScript(text, start, end).commands);
    return result;
}
