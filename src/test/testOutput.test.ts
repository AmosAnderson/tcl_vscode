import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { stripTestProtocolOutput } from '../testing/testOutput';
import { COVERAGE_BEGIN, COVERAGE_END } from '../testing/coverageExecution';
import { createTestExecutionScript, TEST_RESULT_PREFIX } from '../testing/testExecution';

suite('Test output presentation', () => {
    test('debug runners use their result file without printing internal status', function () {
        if (spawnSync('tclsh', [], { input: 'exit 0\n', timeout: 5000 }).error) this.skip();
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tcl-output-test-'));
        try {
            const source = path.join(directory, 'source.tcl');
            const runner = path.join(directory, 'runner.tcl');
            const resultFile = path.join(directory, 'status.txt');
            for (const fail of [false, true]) {
                fs.writeFileSync(source, `proc test_case {} { puts REAL_OUTPUT; ${fail ? 'error EXPECTED_FAILURE' : 'return ok'} }`);
                fs.writeFileSync(runner, createTestExecutionScript(source, 'test_case', 'procedure', { resultFile }));
                const result = spawnSync('tclsh', [runner], { cwd: directory, encoding: 'utf8', timeout: 5000 });
                assert.strictEqual(result.status, fail ? 1 : 0, result.stderr);
                assert.strictEqual(fs.readFileSync(resultFile, 'utf8').trim(), fail ? 'failed' : 'passed');
                assert.strictEqual(result.stdout, 'REAL_OUTPUT\n');
                if (fail) assert.match(result.stderr, /EXPECTED_FAILURE/);
            }
        } finally { fs.rmSync(directory, { recursive: true, force: true }); }
    });

    test('hides complete coverage reports and test results while preserving real output', () => {
        const output = [
            'Application says hello', 'LINE:54:1 is ordinary text outside the report',
            `${TEST_RESULT_PREFIX}passed`, COVERAGE_BEGIN,
            'FILEHEX:2f746d702f746573742e74636c', 'LINE:54:1', COVERAGE_END, 'Application shutdown', ''
        ].join('\n');
        assert.strictEqual(stripTestProtocolOutput(output),
            'Application says hello\nLINE:54:1 is ordinary text outside the report\nApplication shutdown\n');
        assert.ok(output.includes(COVERAGE_BEGIN), 'The raw report remains available for coverage parsing');
    });

    test('preserves failure details and handles several CRLF reports', () => {
        const report = `${COVERAGE_BEGIN}\r\nLINE:1:1\r\n${COVERAGE_END}\r\n`;
        const output = `==== selected FAILED\r\nExpected 3, got 2\r\n${TEST_RESULT_PREFIX}failed\r\n${report}` +
            `${TEST_RESULT_PREFIX}skipped\r\n${report}`;
        assert.strictEqual(stripTestProtocolOutput(output), '==== selected FAILED\r\nExpected 3, got 2\r\n');
    });

    test('retains incomplete reports and unexpected result values for diagnosis', () => {
        const output = `${TEST_RESULT_PREFIX}unexpected\n${COVERAGE_BEGIN}\nInterpreter failed before report completion`;
        assert.strictEqual(stripTestProtocolOutput(output), output);
    });
});
