import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { discoverTclTests } from '../testing/testDiscovery';
import { createTestExecutionScript, TEST_RESULT_PREFIX } from '../testing/testExecution';
import { createCoverageExecutionScript, COVERAGE_END } from '../testing/coverageExecution';
import { executeTclScript } from '../testing/testProcess';

suite('Selected tests and cancellation', () => {
    let directory: string;
    setup(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tcl-selection-')); });
    teardown(() => fs.rmSync(directory, { recursive: true, force: true }));
    test('discovers actual multiline and namespace declarations without entering data', () => {
        const tests = discoverTclTests('# proc test_fake {} {}\nset data {proc test_data {} {}}\nnamespace eval n {\nnamespace import ::tcltest::*\ntest {one [literal]} description \\\n -body {expr 1} -result 1\nproc test_real {} {}\n}\n');
        assert.deepStrictEqual(tests.map(item => item.name), ['one [literal]', '::n::test_real']);
    });
    test('coverage uses exactly the same selected runner, including failures', async () => {
        const file = path.join(directory, 'selected.test');
        fs.writeFileSync(file, 'package require tcltest\nnamespace import ::tcltest::*\ntest chosen {} -body {puts CHOSEN; expr 1} -result 2\ntest unrelated {} -body {puts UNSELECTED} -result {}\ncleanupTests\n');
        const script = createTestExecutionScript(file, 'chosen', 'tcltest', { exit: false });
        const result = await executeTclScript('tclsh', createCoverageExecutionScript([], [directory], script), directory);
        assert.strictEqual(result.code, 1, result.stdout + result.stderr);
        assert.ok(result.stdout.includes('CHOSEN'));
        assert.ok(!result.stdout.includes('UNSELECTED'));
        assert.ok(result.stdout.includes(`${TEST_RESULT_PREFIX}failed`));
        assert.ok(result.stdout.includes(COVERAGE_END));
    });
    test('cancels the running process and can run again', async () => {
        const controller = new AbortController();
        const started = Date.now();
        const pending = executeTclScript('tclsh', 'while {1} {}', directory, controller.signal);
        setTimeout(() => controller.abort(), 100);
        await assert.rejects(pending, /cancelled/);
        assert.ok(Date.now() - started < 3000);
        const next = await executeTclScript('tclsh', 'puts ready', directory);
        assert.strictEqual(next.stdout.trim(), 'ready');
    });
});
