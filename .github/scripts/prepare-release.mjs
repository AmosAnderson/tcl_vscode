import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Validate the checked-out tag without changing refs or publishing anything. */
export function prepareRelease({ tag, cwd = process.cwd(), mainRef = 'refs/remotes/origin/main' }) {
    const match = /^(?:v)?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/.exec(tag || '');
    if (!match) throw new Error('Release tags must be VERSION or vVERSION, for example v0.8.0.');
    const version = match[1];
    const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const commit = git('rev-parse', '--verify', `refs/tags/${tag}^{commit}`);
    if (git('rev-parse', 'HEAD') !== commit) throw new Error('Checkout does not match the tagged commit.');
    git('rev-parse', '--verify', `${mainRef}^{commit}`);
    const ancestry = spawnSync('git', ['merge-base', '--is-ancestor', commit, mainRef], { cwd });
    if (ancestry.error) throw ancestry.error;
    if (ancestry.status === 1) return { eligible: false };
    if (ancestry.status !== 0) throw new Error('Could not verify tag ancestry on main.');

    const manifest = JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf8'));
    const lock = JSON.parse(readFileSync(resolve(cwd, 'package-lock.json'), 'utf8'));
    if ([manifest.version, lock.version, lock.packages?.['']?.version].some(value => value !== version)) {
        throw new Error(`Tag ${tag} must match package.json and both package-lock.json root versions.`);
    }
    if (typeof manifest.name !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(manifest.name)) {
        throw new Error('Invalid extension package name.');
    }

    const lines = readFileSync(resolve(cwd, 'CHANGELOG.md'), 'utf8').split(/\r?\n/);
    const heading = new RegExp(`^## \\[${version.replaceAll('.', '\\.')}\\] - \\d{4}-\\d{2}-\\d{2}$`);
    const start = lines.findIndex(line => heading.test(line));
    if (start < 0) throw new Error(`CHANGELOG.md needs a dated ## [${version}] section.`);
    let end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
    if (end < 0) end = lines.length;
    const notes = lines.slice(start + 1, end).join('\n').trim();
    if (!notes) throw new Error(`CHANGELOG.md has no release notes for ${version}.`);
    return { eligible: true, version, commit, asset: `${manifest.name}-${version}.vsix`, notes };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const result = prepareRelease({ tag: process.argv[2] });
        const { notes, ...outputs } = result;
        if (process.env.GITHUB_OUTPUT) {
            appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(outputs).map(([key, value]) => `${key}=${value}\n`).join(''));
        }
        if (result.eligible) {
            if (process.argv[3]) {
                mkdirSync(process.argv[3], { recursive: true });
                writeFileSync(resolve(process.argv[3], 'release-notes.md'), `${notes}\n`);
            }
            console.log(`Validated ${process.argv[2]} at ${result.commit}: ${result.asset}`);
        } else {
            console.log('::notice::Tag is not reachable from origin/main; release skipped.');
        }
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
