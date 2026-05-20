import * as assert from 'assert';
import { computeMultilineStringLines } from '../utils/tclUtils';

suite('tclUtils.computeMultilineStringLines', () => {
    test('marks no lines when there are no strings', () => {
        const lines = [
            'set x 1',
            'puts $x',
        ];
        assert.deepStrictEqual(computeMultilineStringLines(lines), [false, false]);
    });

    test('marks no lines for single-line strings', () => {
        const lines = [
            'puts "hello"',
            'puts "world"',
        ];
        assert.deepStrictEqual(computeMultilineStringLines(lines), [false, false]);
    });

    test('marks continuation lines inside a real multiline string', () => {
        const lines = [
            'set msg "line one',
            'line two',
            'line three"',
            'puts $msg',
        ];
        // Line 0 opens the string; lines 1 and 2 are inside; line 2 closes; line 3 is outside.
        assert.deepStrictEqual(
            computeMultilineStringLines(lines),
            [false, true, true, false]
        );
    });

    test('treats escaped quotes as literal, not as string delimiters', () => {
        const lines = [
            'puts "a \\" b"',
            'set y 1',
        ];
        assert.deepStrictEqual(computeMultilineStringLines(lines), [false, false]);
    });

    test('ignores quotes inside # comments (regression: fcb1943)', () => {
        // A comment with an odd number of quotes used to flip the string state
        // and silently suppress lint checks for every subsequent line.
        const lines = [
            '# Print a " character',
            'if{$x == 1} {',
            '    puts "yes"',
            '}',
            'expr $a + $b',
        ];
        assert.deepStrictEqual(
            computeMultilineStringLines(lines),
            [false, false, false, false, false]
        );
    });

    test('only treats # as a comment at command position', () => {
        // `#` not preceded by whitespace (or line start) is just a character,
        // so the surrounding quote still toggles string state.
        const lines = [
            'set v "a#b"',
            'puts $v',
        ];
        assert.deepStrictEqual(computeMultilineStringLines(lines), [false, false]);
    });

    test('does not treat # inside a string as a comment', () => {
        // The comment short-circuit must only apply when not inside a string.
        const lines = [
            'set s "hello # not a comment',
            'still in string"',
            'puts $s',
        ];
        assert.deepStrictEqual(
            computeMultilineStringLines(lines),
            [false, true, false]
        );
    });
});
