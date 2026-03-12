/**
 * Shared TCL utility functions used across multiple providers.
 */

/** Escape special regex characters in a literal string. */
export function escapeRegex(lit: string): string {
    return lit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Count consecutive backslashes ending at (and including) position `pos` in `str`,
 * walking backwards from `pos - 1`.  Useful for determining whether a character
 * at `pos` is escaped (odd count) or literal (even count).
 */
export function countBackslashes(str: string, pos: number): number {
    let count = 0;
    let checkPos = pos - 1;
    while (checkPos >= 0 && str[checkPos] === '\\') {
        count++;
        checkPos--;
    }
    return count;
}

/**
 * Starting from an opening brace at `openIdx`, find the index of the
 * matching closing brace, respecting string quoting and backslash escapes.
 * Returns -1 if no match is found.
 */
export function findMatchingBrace(text: string, openIdx: number): number {
    let depth = 0;
    let inString = false;
    let stringChar = '';

    for (let i = openIdx; i < text.length; i++) {
        const char = text[i];

        if (char === '"' || char === "'") {
            const isEscaped = countBackslashes(text, i) % 2 === 1;

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
