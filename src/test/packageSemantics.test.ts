import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { parsePackageMetadata, parsePackageRegistrations, parsePackageRequirements, compareTclVersions } from '../tools/packageModel';
import { satisfiesPackageVersion } from '../tools/tclProcess';
import { parseRunArguments } from '../tools/runArguments';
import { extractPackageArchive } from '../tools/packageArchive';

suite('Tcl package and execution semantics', () => {
    test('requirements ignore comments/literal data and retain exact, ranges, dynamic values and origins', () => {
        const text = '# package require false 1.0\nset literal {package require false 1.0}\npackage require -exact {real name} 1.0\nif {1} {package require foo 1.0-2.0 3.0}\npackage require $computed\ntest-require tests 1.2\n';
        const requirements = parsePackageRequirements(text, '/example/Package.tcl', true);
        assert.deepStrictEqual(requirements.map(item => item.name), ['real name', 'foo', '$computed', 'tests']);
        assert.strictEqual(requirements[0].exact, true);
        assert.deepStrictEqual(requirements[1].versions, ['1.0-2.0', '3.0']);
        assert.strictEqual(requirements[2].dynamic, true);
        assert.strictEqual(requirements[3].development, true);
        assert.ok(requirements.every(item => item.source === '/example/Package.tcl' && item.offset >= 0));
    });
    test('one index can register multiple packages and versions without treating data as code', () => {
        assert.deepStrictEqual(parsePackageRegistrations('package ifneeded A 1.0 {source a.tcl}\npackage ifneeded A 1.1 {source a1.tcl}\nif {1} {package ifneeded B 2.0 {source b.tcl}}\nset data {package provide Fake 1.0}'),
            [{ name: 'A', version: '1.0' }, { name: 'A', version: '1.1' }, { name: 'B', version: '2.0' }]);
        assert.deepStrictEqual(parsePackageMetadata('name {MyPkg}\nversion 1.2b3\ndescription "A useful package"'), { name: 'MyPkg', version: '1.2b3', description: 'A useful package' });
    });
    test('native compatibility preserves major boundaries, exact requests, ranges and prereleases', async function () {
        if (spawnSync('tclsh', [], { input: 'exit 0\n' }).error) this.skip();
        assert.strictEqual(await satisfiesPackageVersion('tclsh', '2.0', ['1.0']), false);
        assert.strictEqual(await satisfiesPackageVersion('tclsh', '1.9', ['1.0']), true);
        assert.strictEqual(await satisfiesPackageVersion('tclsh', '1.1', ['1.0'], true), false);
        assert.strictEqual(await satisfiesPackageVersion('tclsh', '1.9', ['1.0-2.0']), true);
        assert.strictEqual(await satisfiesPackageVersion('tclsh', '2.0', ['1.0-2.0']), false);
        assert.ok(compareTclVersions('1.2', '1.2b9') > 0);
        assert.ok(compareTclVersions('1.2b1', '1.2a9') > 0);
        await assert.rejects(satisfiesPackageVersion('tclsh', '1.0', ['1.0} ; puts injected; #'], true), /version/);
    });
    test('argument parsing preserves empty strings, whitespace, quotes, Unicode and metacharacters', () => {
        const argv = ['a b', '', '日本語', '$HOME; rm -rf', 'a"b', 'C:\\some\\file'];
        assert.deepStrictEqual(parseRunArguments(JSON.stringify(argv)), argv);
        assert.deepStrictEqual(parseRunArguments('one "two three" \'\' "日本語"'), ['one', 'two three', '', '日本語']);
        assert.throws(() => parseRunArguments('"unfinished'), /Unclosed/);
        assert.throws(() => parseRunArguments('[1]'), /array of strings/);
    });
    test('regular tar package extracts while links and traversal are rejected before writing', async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tcl-archive-test-'));
        const tar = (name: string, type = '0') => {
            const header = Buffer.alloc(512);
            header.write(name, 0); header.write('0000644\0', 100); header.write('00000000003\0', 124);
            header.fill(32, 148, 156); header.write(type, 156); header.write('ustar\0', 257);
            const checksum = header.reduce((sum, byte) => sum + byte, 0);
            header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148);
            return Buffer.concat([header, Buffer.from('abc'), Buffer.alloc(509), Buffer.alloc(1024)]);
        };
        try {
            const file = path.join(directory, 'package.tar');
            fs.writeFileSync(file, tar('pkg/main.tcl'));
            await extractPackageArchive(file, path.join(directory, 'valid'));
            assert.strictEqual(fs.readFileSync(path.join(directory, 'valid/pkg/main.tcl'), 'utf8'), 'abc');
            fs.writeFileSync(file, tar('../outside.tcl'));
            await assert.rejects(extractPackageArchive(file, path.join(directory, 'invalid')), /outside/);
            fs.writeFileSync(file, tar('link', '2'));
            await assert.rejects(extractPackageArchive(file, path.join(directory, 'invalid')), /regular files/);
            assert.strictEqual(fs.existsSync(path.join(directory, 'invalid')), false);
        } finally { fs.rmSync(directory, { recursive: true, force: true }); }
    });
});
