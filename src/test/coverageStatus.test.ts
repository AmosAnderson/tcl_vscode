import * as assert from 'assert';
import * as vscode from 'vscode';
import { TclCoverageProvider } from '../testing/coverageProvider';
import { COVERAGE_BEGIN, COVERAGE_END } from '../testing/coverageExecution';

suite('Coverage status lifecycle', () => {
    test('recorded coverage replaces clear status with aggregate coverage and disposes prior messages', () => {
        const descriptor = Object.getOwnPropertyDescriptor(vscode.window, 'setStatusBarMessage');
        assert.ok(descriptor);
        const messages: { text: string; disposed: boolean }[] = [];
        Object.defineProperty(vscode.window, 'setStatusBarMessage', {
            ...descriptor,
            value: (text: string) => {
                const message = { text, disposed: false };
                messages.push(message);
                return new vscode.Disposable(() => { message.disposed = true; });
            }
        });
        const provider = new TclCoverageProvider();
        const report = (file: string, counts: number[]) => [
            COVERAGE_BEGIN, `FILEHEX:${Buffer.from(file).toString('hex')}`,
            ...counts.map((count, index) => `LINE:${index + 1}:${count}`), COVERAGE_END
        ].join('\n');
        try {
            provider.clearCoverage();
            provider.recordCoverage(report('/tmp/coverage-status-one.tcl', [1, 0]));
            provider.recordCoverage(report('/tmp/coverage-status-two.tcl', [1, 0, 0, 0]));
            assert.deepStrictEqual(messages.map(message => message.text), [
                'Coverage cleared', 'Coverage: 50.0%', 'Coverage: 33.3%'
            ]);
            assert.deepStrictEqual(messages.map(message => message.disposed), [true, true, false],
                'Replacing a message must prevent an older clear message from resurfacing');
            provider.dispose();
            assert.ok(messages.every(message => message.disposed), 'Disposal clears the provider-owned status');
        } finally {
            provider.dispose();
            Object.defineProperty(vscode.window, 'setStatusBarMessage', descriptor);
        }
    });
});
