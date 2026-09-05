import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import { createTempTclPath, escapeTclString } from '../utils/tclUtils';

const execFileAsync = promisify(execFile);
export const tclLiteral = (value: string): string => `"${escapeTclString(value)}"`;

export async function executeTclDataScript(interpreter: string, script: string, cwd?: string): Promise<string> {
    const file = createTempTclPath('package_data');
    try {
        await fs.promises.writeFile(file, script, 'utf8');
        const { stdout } = await execFileAsync(interpreter, [file], { cwd, timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
        return stdout.trim();
    } finally { await fs.promises.rm(file, { force: true }); }
}

export async function satisfiesPackageVersion(interpreter: string, available: string, required: string[], exact = false): Promise<boolean> {
    if (!required.length) return true;
    if (exact && required.length !== 1) return false;
    const script = exact
        ? `set available ${tclLiteral(available)}\nset required ${tclLiteral(required[0])}\nputs [expr {[package vcompare $available $required] == 0}]`
        : `puts [package vsatisfies ${[available, ...required].map(tclLiteral).join(' ')}]`;
    return await executeTclDataScript(interpreter, script) === '1';
}
