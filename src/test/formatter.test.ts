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

    test('Should preserve regex patterns without adding spaces', () => {
        const formatter = new TclFormatter({ spacesInsideBraces: true });
        // Regex patterns should NOT get spaces added inside braces
        const input = 'set pattern {\\d{3}}';
        const expected = 'set pattern {\\d{3}}';
        const result = formatter.format(input);
        assert.strictEqual(result, expected);
    });

    test('Should preserve complex regex patterns', () => {
        const formatter = new TclFormatter({ spacesInsideBraces: true });
        // Complex phone number regex - should not be modified
        const input = 'set phone {\\m(\\d{3})[-]?(\\d{3})[-]?(\\d{4})\\M}';
        const expected = 'set phone {\\m(\\d{3})[-]?(\\d{3})[-]?(\\d{4})\\M}';
        const result = formatter.format(input);
        assert.strictEqual(result, expected);
    });

    test('Should preserve list values without adding spaces', () => {
        const formatter = new TclFormatter({ spacesInsideBraces: true });
        const input = 'set items {a b c d}';
        const expected = 'set items {a b c d}';
        const result = formatter.format(input);
        assert.strictEqual(result, expected);
    });
});

suite('TCL Formatter Comment Handling', () => {
    let formatter: TclFormatter;

    setup(() => {
        formatter = new TclFormatter();
    });

    test('Should not shift indentation due to opening brace in comment', () => {
        const input = '# open brace {\nset x 5';
        const expected = '# open brace {\nset x 5';
        assert.strictEqual(formatter.format(input), expected);
    });

    test('Should not shift indentation due to closing brace in comment', () => {
        const input = 'proc foo {} {\n    puts "hi"\n    # closing } in comment\n}';
        const expected = 'proc foo {} {\n    puts "hi"\n    # closing } in comment\n}';
        assert.strictEqual(formatter.format(input), expected);
    });

    test('Should not modify comment content', () => {
        const input = '# if {$x > 0} { do something }';
        const expected = '# if {$x > 0} { do something }';
        assert.strictEqual(formatter.format(input), expected);
    });

    test('Should indent comments at current block level', () => {
        const input = 'proc foo {} {\n# a comment\nputs "hi"\n}';
        const expected = 'proc foo {} {\n    # a comment\n    puts "hi"\n}';
        assert.strictEqual(formatter.format(input), expected);
    });

    test('Should not shift indentation due to brace in inline comment', () => {
        const input = 'set x 5 ;# has { brace\nset y 6';
        const expected = 'set x 5 ;# has { brace\nset y 6';
        assert.strictEqual(formatter.format(input), expected);
    });
});

suite('TCL Formatter Inline Block Expansion', () => {
    let formatter: TclFormatter;

    setup(() => {
        formatter = new TclFormatter();
    });

    test('Should expand inline while body to multi-line', () => {
        const input = 'while {$i<10}{incr i}';
        const expected = 'while { $i < 10 } {\n    incr i\n}';
        assert.strictEqual(formatter.format(input), expected);
    });

    test('Should expand inline foreach body to multi-line', () => {
        const input = 'foreach item {a b c}{puts $item}';
        const expected = 'foreach item {a b c} {\n    puts $item\n}';
        assert.strictEqual(formatter.format(input), expected);
    });

    test('Should expand inline for body to multi-line', () => {
        const input = 'for {set i 0}{$i < 5}{incr i}{puts $i}';
        const expected = 'for { set i 0 } { $i < 5 } { incr i } {\n    puts $i\n}';
        assert.strictEqual(formatter.format(input), expected);
    });
});