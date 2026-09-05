import { COVERAGE_BEGIN, COVERAGE_END } from './coverageExecution';
import { TEST_RESULT_PREFIX } from './testExecution';

/** Keep runner protocol available to parsers while hiding it from test output. */
export function stripTestProtocolOutput(output: string): string {
    return output
        .replace(new RegExp(`${COVERAGE_BEGIN}[\\s\\S]*?${COVERAGE_END}(?:\\r?\\n)?`, 'g'), '')
        .replace(new RegExp(`^${TEST_RESULT_PREFIX}(?:passed|failed|skipped)(?:\\r?\\n|$)`, 'gm'), '');
}
