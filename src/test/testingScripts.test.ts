import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { createTestExecutionScript, TEST_RESULT_PREFIX } from '../testing/testExecution';
import { createCoverageExecutionScript, COVERAGE_BEGIN, COVERAGE_END } from '../testing/coverageExecution';

suite('Tcl test and coverage execution', () => {
    let directory: string;

    setup(function () {
        if (spawnSync('tclsh', [], { input: 'exit 0\n', timeout: 5000 }).error) {
            this.skip();
        }
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tcl-runtime-tests-'));
    });

    teardown(() => {
        if (directory) { fs.rmSync(directory, { recursive: true, force: true }); }
    });

    function write(name: string, text: string): string {
        const file = path.join(directory, name);
        fs.writeFileSync(file, text);
        return file;
    }

    function execute(script: string) {
        const file = write('runner.tcl', script);
        return spawnSync('tclsh', [file], { cwd: directory, encoding: 'utf8', timeout: 5000 });
    }

    const declarations = [
        'package require tcltest',
        'namespace import ::tcltest::*',
        'test alpha-1.0 {passes} -body {expr {2 + 2}} -result 4',
        'test beta-1.0 {fails} -body {puts UNSELECTED_SIDE_EFFECT; expr {2 + 2}} -result 5',
        'test skipped-1.0 {skips} -constraints neverEnabled -body {error SHOULD_NOT_RUN} -result 0',
        'test {literal[1]* name} {exact name} -body {expr {3 + 3}} -result 6',
        'cleanupTests'
    ].join('\n');

    test('selects one imported declaration before sourcing and survives cleanupTests', () => {
        const file = write('sample.test', declarations);
        const result = execute(createTestExecutionScript(file, 'alpha-1.0', 'tcltest'));
        assert.strictEqual(result.status, 0, result.stderr);
        assert.ok(result.stdout.includes(`${TEST_RESULT_PREFIX}passed`), result.stdout);
        assert.ok(!result.stdout.includes('UNSELECTED_SIDE_EFFECT'), result.stdout);
        assert.match(result.stdout, /Total\s+1\s+Passed\s+1/);
    });

    test('retains a selected assertion failure after counters are cleared', () => {
        const file = write('sample.test', declarations);
        const result = execute(createTestExecutionScript(file, 'beta-1.0', 'tcltest'));
        assert.strictEqual(result.status, 1);
        assert.ok(result.stdout.includes(`${TEST_RESULT_PREFIX}failed`), result.stdout);
    });

    test('reports constraints as skipped and matches names literally', () => {
        const file = write('sample.test', declarations);
        const skipped = execute(createTestExecutionScript(file, 'skipped-1.0', 'tcltest'));
        assert.strictEqual(skipped.status, 0, skipped.stderr);
        assert.ok(skipped.stdout.includes(`${TEST_RESULT_PREFIX}skipped`), skipped.stdout);
        const exact = execute(createTestExecutionScript(file, 'literal[1]* name', 'tcltest'));
        assert.strictEqual(exact.status, 0, exact.stderr);
        assert.ok(exact.stdout.includes(`${TEST_RESULT_PREFIX}passed`), exact.stdout);
        assert.ok(!exact.stdout.includes('UNSELECTED_SIDE_EFFECT'));
    });

    test('procedure tests retain global scope and safely quote their source path', () => {
        const file = write('sample [literal] {path}.tcl', [
            'set value 7',
            'proc test_pass {} {global value; if {$value != 7} {error WRONG_SCOPE}}',
            'proc test_fail {} {error EXPECTED_FAILURE}'
        ].join('\n'));
        const passed = execute(createTestExecutionScript(file, 'test_pass', 'procedure'));
        assert.strictEqual(passed.status, 0, passed.stderr);
        assert.ok(passed.stdout.includes(`${TEST_RESULT_PREFIX}passed`));
        const failed = execute(createTestExecutionScript(file, 'test_fail', 'procedure'));
        assert.strictEqual(failed.status, 1);
        assert.match(failed.stderr, /EXPECTED_FAILURE/);
    });

    test('missing test cases fail instead of producing a false pass', () => {
        const file = write('sample.test', declarations);
        const result = execute(createTestExecutionScript(file, 'missing', 'tcltest'));
        assert.strictEqual(result.status, 1);
        assert.match(result.stderr, /Test not found/);
    });

    test('coverage preserves source semantics and records hits and unvisited branches', () => {
        const source = [
            'set literal {α first',
            'second}',
            'set value 7',
            'proc check {} {',
            '    global value',
            '    if {$value == 7} {',
            '        puts PASS',
            '    } else {',
            '        puts FAIL',
            '    }',
            '}',
            'puts $literal',
            'check',
            'switch $value {',
            '    7 {puts SEVEN}',
            '    default {puts OTHER}',
            '}'
        ].join('\n');
        const file = write('coverage [literal].tcl', source);
        const native = spawnSync('tclsh', [file], { cwd: directory, encoding: 'utf8', timeout: 5000 });
        const covered = execute(createCoverageExecutionScript([file], [directory]));
        assert.strictEqual(covered.status, 0, covered.stderr);
        assert.strictEqual(covered.stdout.split(COVERAGE_BEGIN)[0], native.stdout);
        const report = covered.stdout.split(COVERAGE_BEGIN)[1].split(COVERAGE_END)[0];
        assert.match(report, /^LINE:7:1$/m);
        assert.match(report, /^LINE:9:0$/m);
        assert.ok(!/^LINE:2:/m.test(report), 'Multiline literal content is not executable');
        assert.ok(!fs.existsSync(path.join(directory, 'coverage.dat')), 'No stale shared coverage file');
    });

    test('coverage runs procedure tests and handles empty input', () => {
        const file = write('procedure.tcl', 'proc test_one {} {puts PROCEDURE_RAN}\n');
        const result = execute(createCoverageExecutionScript([file], [directory]));
        assert.strictEqual(result.status, 0, result.stderr);
        assert.match(result.stdout, /PROCEDURE_RAN/);
        const empty = execute(createCoverageExecutionScript([], [directory]));
        assert.strictEqual(empty.status, 0, empty.stderr);
        assert.ok(empty.stdout.includes(COVERAGE_BEGIN));
    });

    test('coverage retains reports but signals assertion and source failures', () => {
        const file = write('failing.test', declarations);
        const failed = execute(createCoverageExecutionScript([file], [directory]));
        assert.strictEqual(failed.status, 1, failed.stdout + failed.stderr);
        assert.ok(failed.stdout.includes(COVERAGE_END), 'Failure must not discard measured coverage');
        const broken = write('broken.tcl', 'set value 1\nerror EXPECTED_SOURCE_ERROR\n');
        const sourceError = execute(createCoverageExecutionScript([broken], [directory]));
        assert.strictEqual(sourceError.status, 1);
        assert.match(sourceError.stderr, /EXPECTED_SOURCE_ERROR/);
        assert.ok(sourceError.stdout.includes(COVERAGE_END));
    });
});
