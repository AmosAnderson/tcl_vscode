import * as assert from 'assert';
import { TclFormatter } from '../formatter/tclFormatter';

suite('TCL Formatter Tests', () => {
    let formatter: TclFormatter;

    setup(() => {
        formatter = new TclFormatter();
    });

    test('Should format basic if statement', () => {
        const input = 'if {$x>0}{puts "positive"}';
        const expected = 'if {$x > 0} {\n    puts "positive"\n}';
        const result = formatter.format(input);
        assert.strictEqual(result, expected);
    });

    test('Should format procedure definition', () => {
        const input = 'proc test {a b}{return [expr $a+$b]}';
        const expected = 'proc test {a b} {\n    return [expr $a + $b]\n}';
        const result = formatter.format(input);
        assert.strictEqual(result, expected);
    });

    test('Should handle nested braces', () => {
        const input = 'if {$x>0}{if {$y>0}{puts "both positive"}}';
        const expected = 'if {$x > 0} {\n    if {$y > 0} {\n        puts "both positive"\n    }\n}';
        const result = formatter.format(input);
        assert.strictEqual(result, expected);
    });

    test('Should preserve string literals', () => {
        const input = 'puts "hello world"';
        const expected = 'puts "hello world"';
        const result = formatter.format(input);
        assert.strictEqual(result, expected);
    });

    test('Should handle list operations', () => {
        const input = 'set list [list a b c]';
        const expected = 'set list [list a b c]';
        const result = formatter.format(input);
        assert.strictEqual(result, expected);
    });
});