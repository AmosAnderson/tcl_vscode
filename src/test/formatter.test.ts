import * as assert from 'assert';
import { TclFormatter } from '../formatter/tclFormatter';

suite('TCL Formatter Tests', () => {
    let formatter: TclFormatter;

    setup(() => {
        formatter = new TclFormatter();
    });

    test('Should format basic if statement', () => {
        const input = 'if {$x>0}{puts "positive"}';
        const expected = 'if { $x > 0 } {\n    puts "positive"\n}';
        const result = formatter.format(input);
        assert.strictEqual(result, expected);
    });

    test('Should format procedure definition', () => {
        const input = 'proc test {a b}{return [expr $a+$b]}';
        const expected = 'proc test { a b } {\n    return [expr $a + $b]\n}';
        const result = formatter.format(input);
        assert.strictEqual(result, expected);
    });

    test('Should handle nested braces', () => {
        const input = 'if {$x>0}{if {$y>0}{puts "both positive"}}';
        const expected = 'if { $x > 0 } {\n    if { $y > 0 } {\n        puts "both positive"\n    }\n}';
        const result = formatter.format(input);
        assert.strictEqual(result, expected);
    });

    test('Should indent else blocks correctly', () => {
        const input = [
            'if {$x>0} {',
            'puts "positive"',
            '} else {',
            'puts "non-positive"',
            '}'
        ].join('\n');

        const expected = [
            'if { $x > 0 } {',
            '    puts "positive"',
            '} else {',
            '    puts "non-positive"',
            '}'
        ].join('\n');

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

    test('Should insert spacing around control flow braces', () => {
        const input = [
            'proc test_function{ name value }{',
            '    if{$name eq "" }{',
            '        puts "Empty name"',
            '    }else{',
            '        puts "Name: $name"',
            '    }',
            '}'
        ].join('\n');

        const expected = [
            'proc test_function { name value } {',
            '    if { $name eq "" } {',
            '        puts "Empty name"',
            '    } else {',
            '        puts "Name: $name"',
            '    }',
            '}'
        ].join('\n');

        const result = formatter.format(input);
        assert.strictEqual(result, expected);
    });
});

suite('TCL Formatter Options', () => {
    test('Should respect spacesAroundOperators option', () => {
        const customFormatter = new TclFormatter({
            spacesAroundOperators: false,
            spacesInsideBraces: false
        });
        const result = customFormatter.format('if {$x>0}{puts "positive"}');
        const expected = 'if {$x>0} {\n    puts "positive"\n}';
        assert.strictEqual(result, expected);
    });

    test('Should respect spacesInsideBraces option', () => {
        const customFormatter = new TclFormatter({
            spacesInsideBraces: true
        });
        const result = customFormatter.format('proc demo {a b} {return $a}');
        const expected = 'proc demo { a b } {\n    return $a\n}';
        assert.strictEqual(result, expected);
    });

    test('Should respect spacesInsideBrackets option', () => {
        const customFormatter = new TclFormatter({
            spacesInsideBrackets: true
        });
        const result = customFormatter.format('set list [list a b]');
        const expected = 'set list [ list a b ]';
        assert.strictEqual(result, expected);
    });

    test('Should respect alignBraces option', () => {
        const customFormatter = new TclFormatter({
            alignBraces: false
        });
        const result = customFormatter.format('if {$x>0}{puts $x}}');
        const expected = 'if { $x > 0 } {\n    puts $x\n}}';
        assert.strictEqual(result, expected);
    });
});