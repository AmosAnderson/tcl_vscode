/**
 * Shared TCL utility functions used across multiple providers.
 */

import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

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
 * Escape a string for safe embedding inside a TCL double-quoted context.
 * Handles backslashes, double quotes, dollar signs, and square brackets.
 */
export function escapeTclString(str: string): string {
    return str
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\$/g, '\\$')
        .replace(/\[/g, '\\[')
        .replace(/\]/g, '\\]');
}

/**
 * Clean up orphaned temp TCL files from previous sessions.
 * Removes files matching `tcl_*_*.tcl` in the OS temp directory
 * that are older than `maxAgeMs` (default 1 hour).
 */
export function cleanupTempTclFiles(maxAgeMs: number = 3600000): void {
    try {
        const tmpDir = os.tmpdir();
        const now = Date.now();
        const files = fs.readdirSync(tmpDir);
        for (const file of files) {
            if (/^tcl_\w+_[\w-]+\.tcl$/.test(file)) {
                const fullPath = path.join(tmpDir, file);
                try {
                    const stat = fs.statSync(fullPath);
                    if (now - stat.mtimeMs > maxAgeMs) {
                        fs.unlinkSync(fullPath);
                    }
                } catch { /* file may have been removed already */ }
            }
        }
    } catch { /* best-effort cleanup */ }
}

/**
 * Resolve a command name to an absolute path, similar to Unix `which`.
 * Returns the resolved path or `null` if not found.
 */
export async function which(cmd: string): Promise<string | null> {
    // If it's already an absolute path, just check existence
    if (path.isAbsolute(cmd)) {
        return fs.existsSync(cmd) ? cmd : null;
    }

    try {
        const command = process.platform === 'win32' ? 'where' : 'which';
        const { stdout } = await execFileAsync(command, [cmd], { timeout: 5000 });
        const resolved = stdout.trim().split(/\r?\n/)[0];
        return resolved || null;
    } catch {
        return null;
    }
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

/**
 * For each line in `lines`, compute whether the line starts inside a
 * multiline double-quoted string.  Returns a boolean array of the same
 * length as `lines` where `true` means the line is a continuation of a
 * string that opened on a previous line.
 */
export function computeMultilineStringLines(lines: string[]): boolean[] {
    const result: boolean[] = new Array(lines.length).fill(false);
    let inString = false;

    for (let i = 0; i < lines.length; i++) {
        result[i] = inString;
        const line = lines[i];
        for (let c = 0; c < line.length; c++) {
            if (line[c] === '"' && countBackslashes(line, c) % 2 === 0) {
                inString = !inString;
            }
        }
    }
    return result;
}
