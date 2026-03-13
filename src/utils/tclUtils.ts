/**
 * Shared TCL utility functions used across multiple providers.
 */

import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';

/** Escape special regex characters in a literal string. */
export function escapeRegex(lit: string): string {
    return lit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Create a unique temp file path for a TCL script. */
export function createTempTclPath(label: string): string {
    return path.join(os.tmpdir(), `tcl_${label}_${crypto.randomUUID()}.tcl`);
}

/** Normalize a file path to forward slashes (for embedding in TCL scripts). */
export function toForwardSlashes(p: string): string {
    return p.replace(/\\/g, '/');
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

    for (let i = openIdx; i < text.length; i++) {
        const char = text[i];

        // TCL only uses double-quote for string quoting, not single-quote
        if (char === '"') {
            const isEscaped = countBackslashes(text, i) % 2 === 1;

            if (!isEscaped) {
                inString = !inString;
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
