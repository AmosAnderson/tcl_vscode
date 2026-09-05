import * as assert from 'assert';
import { getExpressionWords, getScriptWords, parseTclList, parseTclScript, walkTclCommands } from '../utils/tclParser';

suite('Tcl source parser', () => {
    test('preserves literal words, embedded quotes, escaped braces and command comments', () => {
        const text = 'set a {[}; set b {a\\}b}; puts x"y;# [not code]\nputs $a\n';
        const parsed = parseTclScript(text);
        assert.deepStrictEqual(parsed.errors, []);
        assert.deepStrictEqual(parsed.commands.map(command => command.words[0].value), ['set', 'set', 'puts', 'puts']);
        assert.strictEqual(parsed.commands[0].words[2].value, '[');
        assert.strictEqual(parsed.commands[1].words[2].value, 'a\\}b');
        assert.strictEqual(parsed.commands[2].words[1].value, 'x"y');
    });

    test('tracks bracket substitutions and absolute nested spans', () => {
        const text = 'puts "x [list [string length {hello world}] ok] y"';
        const parsed = parseTclScript(text);
        assert.deepStrictEqual(parsed.errors, []);
        const word = parsed.commands[0].words[1];
        assert.strictEqual(word.substitutions[0].words[0].value, 'list');
        assert.strictEqual(text.slice(word.commandSubstitutions[0].start, word.commandSubstitutions[0].end), '[list [string length {hello world}] ok]');
        assert.deepStrictEqual(walkTclCommands(text).map(command => command.words[0].value), ['puts', 'list', 'string']);
    });

    test('walks executable bodies and expressions without entering data', () => {
        const text = 'proc sample {x} {\n if {[sample $x]} {sample 1}\n set literal {sample 2}\n switch $x {a {sample 3} default {sample 4}}\n}';
        const commands = walkTclCommands(text);
        assert.strictEqual(commands.filter(command => command.words[0].value === 'sample').length, 4);
        assert.ok(!commands.some(command => command.words[0].value === 'sample' && command.words[1]?.value === '2'));
    });

    test('Tcl lists preserve semicolons and nested default argument offsets', () => {
        const text = 'prefix x {y {a;b [literal]}} args suffix';
        const parsed = parseTclList(text, 7, text.indexOf(' suffix'));
        assert.deepStrictEqual(parsed.errors, []);
        assert.deepStrictEqual(parsed.words.map(word => word.value), ['x', 'y {a;b [literal]}', 'args']);
        assert.strictEqual(parsed.words[1].contentStart, 10);
    });

    test('rejects incomplete and malformed words without inventing closing delimiters', () => {
        for (const text of ['set x {abc', 'set x "abc', 'puts [list a', 'set x {a}suffix', 'puts "x"suffix', 'puts $arr(missing']) {
            assert.ok(parseTclScript(text).errors.length, text);
        }
        for (const text of ['puts }', 'puts ]', 'set x {[}', 'set x {"}', 'set x #value', 'puts $arr(a b)', 'puts $(' ]) {
            assert.deepStrictEqual(parseTclScript(text).errors, [], text);
        }
    });

    test('keeps Unicode array variable substitutions within one word', () => {
        const parsed = parseTclScript('puts $é(a b)');
        assert.deepStrictEqual(parsed.errors, []);
        assert.strictEqual(parsed.commands[0].words.length, 2);
        assert.strictEqual(parsed.commands[0].words[1].value, '$é(a b)');
    });

    test('declines body/expression inference for argument expansion', () => {
        for (const text of ['if {*}$args {set data {literal}}', 'proc {*}$args {set data {literal}}', 'expr {*}$args']) {
            const command = parseTclScript(text).commands[0];
            assert.deepStrictEqual(getScriptWords(command), []);
            assert.deepStrictEqual(getExpressionWords(command), []);
        }
    });
});
