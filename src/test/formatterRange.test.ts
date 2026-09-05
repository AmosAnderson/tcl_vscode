import * as assert from 'assert';
import { spawnSync } from 'child_process';
import { TclFormatter } from '../formatter/tclFormatter';

suite('Contextual formatting', () => {
    const formatter = new TclFormatter();
    test('retains enclosing indentation and declines literal selections', () => {
        const source = 'proc f {} {\n    puts    hello\n    set value {puts    literal}\n}\n';
        const from = source.indexOf('    puts');
        const edit = formatter.formatRange(source, from, source.indexOf('\n', from));
        assert.ok(edit);
        assert.strictEqual(source.slice(0, edit.start) + edit.text + source.slice(edit.end), source.replace('puts    hello', 'puts hello'));
        const literal = source.indexOf('puts    literal');
        assert.strictEqual(formatter.formatRange(source, literal, literal + 'puts    literal'.length), undefined);
        assert.strictEqual(formatter.formatRange(source, from + 6, from + 9), undefined);
    });
    test('formats switch lists and preserves execution, patterns and fallthrough', () => {
        const source = 'set x a\nswitch -- $x {\na -\nb {\nputs { two  spaces }\n}\ndefault {puts no}\n}\n';
        const formatted = formatter.format(source);
        assert.ok(formatted.includes('    a -\n    b {\n        puts'));
        assert.strictEqual(formatter.format(formatted), formatted);
        const execute = (input: string) => spawnSync('tclsh', [], { input, encoding: 'utf8', timeout: 5000 });
        const before = execute(source), after = execute(formatted);
        assert.ifError(before.error);
        assert.strictEqual(after.stderr, before.stderr);
        assert.strictEqual(after.stdout, before.stdout);
        assert.strictEqual(after.status, before.status);
    });
    test('range indentation never changes multiline literal values and keeps CRLF syntax', () => {
        for (const newline of ['\n', '\r\n']) {
            const literal = '{first\n  second}';
            const source = ['proc f {} {', '  if {1} {', `puts    ${literal}`, 'catch {puts [string length hello]}', '}', '}', 'f', ''].join(newline);
            const from = source.indexOf('  if'), to = source.indexOf(newline + '}', source.indexOf('catch')) + newline.length + 1;
            const edit = formatter.formatRange(source, from, to);
            assert.ok(edit);
            const result = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
            assert.ok(result.includes(literal));
            assert.ok(edit.text.includes(`{${newline}      puts`));
            const execute = (input: string) => spawnSync('tclsh', [], { input, encoding: 'utf8', timeout: 5000 });
            const before = execute(source), after = execute(result);
            assert.ifError(after.error);
            assert.strictEqual(after.stderr, before.stderr);
            assert.strictEqual(after.stdout, before.stdout);
            assert.strictEqual(after.status, before.status);
            const repeated = formatter.formatRange(result, edit.start, edit.start + edit.text.length);
            assert.strictEqual(repeated?.text, edit.text);
        }
    });
});
