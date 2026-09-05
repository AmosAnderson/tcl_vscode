/** Accept an exact JSON argv array, or conventional quoted arguments for convenience. */
export function parseRunArguments(input: string): string[] {
    if (input.trimStart().startsWith('[')) {
        const parsed: unknown = JSON.parse(input);
        if (!Array.isArray(parsed) || !parsed.every(value => typeof value === 'string')) throw new Error('Arguments must be a JSON array of strings');
        return parsed;
    }
    const result: string[] = [];
    let current = '', quote = '', started = false;
    for (let i = 0; i < input.length; i++) {
        const char = input[i];
        if (char === '\\' && quote !== "'" && i + 1 < input.length && (/[\s"'\\]/.test(input[i + 1]))) {
            current += input[++i]; started = true;
        } else if (quote) {
            if (char === quote) quote = ''; else current += char;
        } else if (char === '"' || char === "'") {
            quote = char; started = true;
        } else if (/\s/.test(char)) {
            if (started) { result.push(current); current = ''; started = false; }
        } else { current += char; started = true; }
    }
    if (quote) throw new Error('Unclosed argument quote');
    if (started) result.push(current);
    return result;
}
