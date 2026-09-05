import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { prepareRelease } from './prepare-release.mjs';

const script = fileURLToPath(new URL('./prepare-release.mjs', import.meta.url));
const releaseNotes = '### Added\n\n- Editor breakpoints and test coverage.\n\n### Fixed\n\n- Preserve Tcl output.';
const changelog = `# Changelog\n\n## [Unreleased]\n\n- Future work.\n\n## [0.8.0] - 2026-09-05\n\n${releaseNotes}\n\n## [0.7.0] - 2026-08-01\n\n- Previous release.\n`;

function fixture(t, { tag = 'v0.8.0', annotated = false } = {}) {
    const cwd = mkdtempSync(join(tmpdir(), 'tcl-release-guard-'));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    const git = (...args) => execFileSync('git', [
        '-c', 'user.name=Release Guard Test',
        '-c', 'user.email=release-guard@example.invalid',
        '-c', 'commit.gpgsign=false',
        '-c', 'tag.gpgsign=false',
        ...args
    ], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const write = (name, content) => writeFileSync(join(cwd, name), content);
    const json = (name, content) => write(name, `${JSON.stringify(content, null, 2)}\n`);
    git('init', '--initial-branch=main');
    git('config', 'core.autocrlf', 'false');
    mkdirSync(join(cwd, 'empty-hooks'));
    git('config', 'core.hooksPath', join(cwd, 'empty-hooks'));
    json('package.json', { name: 'tcl-syntax', version: '0.8.0' });
    json('package-lock.json', { version: '0.8.0', lockfileVersion: 3, packages: { '': { name: 'tcl-syntax', version: '0.8.0' } } });
    write('CHANGELOG.md', changelog);
    git('add', 'package.json', 'package-lock.json', 'CHANGELOG.md');
    git('commit', '-m', 'Release fixture');
    const commit = git('rev-parse', 'HEAD');
    git('update-ref', 'refs/remotes/origin/main', commit);
    if (tag) {
        git('tag', ...(annotated ? ['-a', tag, '-m', 'Release fixture'] : [tag]));
    }
    const cli = (args = [tag], env = {}) => spawnSync(process.execPath, [script, ...args], {
        cwd,
        env: { ...process.env, GITHUB_OUTPUT: '', ...env },
        encoding: 'utf8'
    });
    return { cwd, git, write, json, commit, tag, cli };
}

for (const annotated of [false, true]) {
    for (const ancestor of [false, true]) {
        test(`accepts ${annotated ? 'annotated' : 'lightweight'} tag ${ancestor ? 'at an older main commit' : 'at main HEAD'}`, t => {
            const f = fixture(t, { annotated });
            if (ancestor) {
                f.write('later.txt', 'Later main work\n');
                f.git('add', 'later.txt');
                f.git('commit', '-m', 'Move main forward');
                f.git('update-ref', 'refs/remotes/origin/main', 'HEAD');
                f.git('checkout', '--detach', f.commit);
            }
            const refs = f.git('show-ref');
            assert.deepEqual(prepareRelease({ tag: f.tag, cwd: f.cwd }), {
                eligible: true,
                version: '0.8.0',
                commit: f.commit,
                asset: 'tcl-syntax-0.8.0.vsix',
                notes: releaseNotes
            });
            assert.equal(f.git('show-ref'), refs, 'validation must not mutate refs');
        });
    }
}

test('accepts an unprefixed semantic version tag', t => {
    const f = fixture(t, { tag: '0.8.0' });
    assert.equal(prepareRelease({ tag: f.tag, cwd: f.cwd }).version, '0.8.0');
});

test('skips a tag on a side branch before inspecting release metadata', t => {
    const f = fixture(t, { tag: null });
    f.git('checkout', '-b', 'feature');
    f.json('package.json', { name: 'tcl-syntax', version: '9.9.9' });
    f.git('add', 'package.json');
    f.git('commit', '-m', 'Unmerged feature');
    f.git('tag', 'v0.8.0');
    assert.deepEqual(prepareRelease({ tag: 'v0.8.0', cwd: f.cwd }), { eligible: false });
});

test('fails when origin/main cannot be verified', t => {
    const f = fixture(t);
    f.git('update-ref', '-d', 'refs/remotes/origin/main');
    assert.throws(() => prepareRelease({ tag: f.tag, cwd: f.cwd }), /rev-parse.*origin\/main/);
});

test('requires the exact tag ref, even if another ref has the same name', t => {
    const f = fixture(t, { tag: null });
    f.git('branch', 'v0.8.0');
    assert.throws(() => prepareRelease({ tag: 'v0.8.0', cwd: f.cwd }), /rev-parse.*refs\/tags\/v0\.8\.0/);
});

test('rejects a checkout that differs from the tagged commit', t => {
    const f = fixture(t);
    f.write('later.txt', 'Later main work\n');
    f.git('add', 'later.txt');
    f.git('commit', '-m', 'Move HEAD forward');
    f.git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    assert.throws(() => prepareRelease({ tag: f.tag, cwd: f.cwd }), /Checkout does not match/);
});

for (const tag of [undefined, '', 'v0.8', 'v0.8.0-rc.1', '0.8.0+build', 'v00.8.0', 'v0.08.0', 'v0.8.00', '--all', 'v0.8.0\nversion=9.9.9']) {
    test(`rejects malformed tag ${JSON.stringify(tag)}`, () => {
        assert.throws(() => prepareRelease({ tag, cwd: '/no-git-repository-needed' }), /Release tags must be/);
    });
}

for (const changed of ['manifest', 'lock', 'lock package', 'missing lock package']) {
    test(`rejects ${changed} version mismatch`, t => {
        const f = fixture(t);
        if (changed === 'manifest') {
            f.json('package.json', { name: 'tcl-syntax', version: '0.7.0' });
        } else {
            const lock = JSON.parse(readFileSync(join(f.cwd, 'package-lock.json'), 'utf8'));
            if (changed === 'lock') lock.version = '0.7.0';
            if (changed === 'lock package') lock.packages[''].version = '0.7.0';
            if (changed === 'missing lock package') delete lock.packages[''];
            f.json('package-lock.json', lock);
        }
        assert.throws(() => prepareRelease({ tag: f.tag, cwd: f.cwd }), /must match package\.json and both package-lock\.json root versions/);
    });
}

for (const name of ['../release\nasset=evil', undefined, null, 123]) {
    test(`rejects unsafe or non-string package name ${JSON.stringify(name)}`, t => {
        const f = fixture(t);
        f.json('package.json', { name, version: '0.8.0' });
        assert.throws(() => prepareRelease({ tag: f.tag, cwd: f.cwd }), /Invalid extension package name/);
    });
}

test('extracts the exact dated version with CRLF and preserves nested headings', t => {
    const f = fixture(t);
    const text = `# Changelog\n\n## [0.8.00] - 2026-09-05\n\nWrong version.\n\n${changelog}`;
    f.write('CHANGELOG.md', text.replaceAll('\n', '\r\n'));
    assert.equal(prepareRelease({ tag: f.tag, cwd: f.cwd }).notes, releaseNotes);
});

test('extracts a release section at the end of the changelog', t => {
    const f = fixture(t);
    f.write('CHANGELOG.md', `# Changelog\n\n## [0.8.0] - 2026-09-05\n\n${releaseNotes}\n`);
    assert.equal(prepareRelease({ tag: f.tag, cwd: f.cwd }).notes, releaseNotes);
});

for (const heading of ['## [0.7.0] - 2026-09-05', '## [0.8.0]', '## [0x8x0] - 2026-09-05', '## [0.8.0] - pending']) {
    test(`rejects missing or undated release heading ${JSON.stringify(heading)}`, t => {
        const f = fixture(t);
        f.write('CHANGELOG.md', `${heading}\n\nSome release notes.\n`);
        assert.throws(() => prepareRelease({ tag: f.tag, cwd: f.cwd }), /needs a dated.*0\.8\.0/);
    });
}

test('rejects a release section containing only whitespace', t => {
    const f = fixture(t);
    f.write('CHANGELOG.md', '# Changelog\n\n## [0.8.0] - 2026-09-05\n\n  \t \n## [0.7.0] - 2026-08-01\n\nPrevious notes.\n');
    assert.throws(() => prepareRelease({ tag: f.tag, cwd: f.cwd }), /has no release notes for 0\.8\.0/);
});

test('CLI appends safe GitHub outputs and writes only the tagged release notes', t => {
    const f = fixture(t, { annotated: true });
    const output = join(f.cwd, 'github-output');
    const releaseDir = join(f.cwd, 'release artifacts');
    writeFileSync(output, 'existing=value\n');
    const result = f.cli([f.tag, releaseDir], { GITHUB_OUTPUT: output });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Validated v0\.8\.0/);
    assert.equal(readFileSync(output, 'utf8'), `existing=value\neligible=true\nversion=0.8.0\ncommit=${f.commit}\nasset=tcl-syntax-0.8.0.vsix\n`);
    assert.equal(readFileSync(join(releaseDir, 'release-notes.md'), 'utf8'), `${releaseNotes}\n`);
});

test('CLI emits only eligible=false for a tag outside main', t => {
    const f = fixture(t, { tag: null });
    f.git('checkout', '-b', 'feature');
    f.write('feature.txt', 'Unmerged work\n');
    f.git('add', 'feature.txt');
    f.git('commit', '-m', 'Unmerged feature');
    f.git('tag', 'v0.8.0');
    const output = join(f.cwd, 'github-output');
    const result = f.cli(['v0.8.0'], { GITHUB_OUTPUT: output });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /release skipped/);
    assert.equal(readFileSync(output, 'utf8'), 'eligible=false\n');
});

test('CLI returns a failure and does not emit outputs when validation fails', t => {
    const f = fixture(t);
    const output = join(f.cwd, 'github-output');
    writeFileSync(output, 'existing=value\n');
    const result = f.cli(['v0.8.0-rc.1'], { GITHUB_OUTPUT: output });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Release tags must be/);
    assert.equal(readFileSync(output, 'utf8'), 'existing=value\n');
});
