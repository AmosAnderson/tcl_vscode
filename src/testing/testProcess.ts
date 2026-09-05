import { spawn } from 'child_process';
import * as fs from 'fs';
import { createTempTclPath } from '../utils/tclUtils';

export interface TclProcessResult { stdout: string; stderr: string; code: number | null; duration: number; }

/** Own one runner and its child; cancellation settles only after the child closes. */
export async function executeTclScript(interpreter: string, script: string, cwd: string | undefined, signal?: AbortSignal, timeout = 60000): Promise<TclProcessResult> {
    if (signal?.aborted) throw new Error('Test run cancelled');
    const file = createTempTclPath('test');
    await fs.promises.writeFile(file, script, 'utf8');
    try {
        return await new Promise((resolve, reject) => {
            const start = Date.now();
            const child = spawn(interpreter, [file], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
            let stdout = '', stderr = '', reason = '';
            let finished = false;
            const stop = (message: string) => { reason = message; child.kill('SIGKILL'); };
            const abort = () => stop('Test run cancelled');
            const timer = setTimeout(() => stop(`Test timed out after ${timeout}ms`), timeout);
            signal?.addEventListener('abort', abort, { once: true });
            if (signal?.aborted) abort();
            const finish = (error?: Error, code: number | null = null) => {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                signal?.removeEventListener('abort', abort);
                if (error || reason) reject(error ?? new Error(reason));
                else resolve({ stdout, stderr, code, duration: Date.now() - start });
            };
            child.stdout.on('data', data => { stdout += data.toString(); });
            child.stderr.on('data', data => { stderr += data.toString(); });
            child.once('error', error => finish(error));
            child.once('close', code => finish(undefined, code));
        });
    } finally {
        await fs.promises.unlink(file).catch(() => {});
    }
}
