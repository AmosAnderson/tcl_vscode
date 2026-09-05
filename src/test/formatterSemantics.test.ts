import * as assert from 'assert';
import { spawnSync } from 'child_process';
import { TclFormatter } from '../formatter/tclFormatter';

suite('Formatter semantics', () => {
    const fixtures: [string, string][] = [
        ['significant braced whitespace', 'set s {  hello  }\nputs [string length $s]\nputs [string length { }]\n'],
        ['nested literal values', 'if {1} {puts {hello}; puts [list {a} { b }]}\n'],
        ['quoted control-like text', 'puts "if {1} {hello}"\nputs "if{a}"\nputs foo{bar}\n'],
        ['inline comments', 'set x a;# if {1} {puts injected}\nputs $x\n'],
        ['continued comments', '# if {1} {puts injected} \\\nputs still-commented\nputs actual\n'],
        ['escaped spaces and braces', 'set s hello\\ \nputs $s\nputs \\{literal\\}\n'],
        ['multiline braced values', 'set s {\n  if {1} {literal}\n text  \n}\nputs $s\n'],
        ['multiline quoted values', 'set s "  first\n    second  \n last "\nputs $s\n'],
        ['scientific literals', 'puts [expr {1e-3+2E+4}]\n'],
        ['quoted expression operands', 'puts [expr {"a+b" eq "a + b"}]\nputs [expr {"a  b" eq "a b"}]\n'],
        ['braced expression operands', 'puts [expr {{a+b} eq {a + b}}]\n'],
        ['array indices in expressions', 'set a(x+y) 4\nputs [expr {$a(x+y)+1}]\n'],
        ['Unicode array variables', 'set é(x+y) 4\nputs [expr {$é(x+y)+1}]\n'],
        ['nested expression substitutions', 'puts [expr {[string length {a+b}]+1}]\n'],
        ['catch script arguments', 'set x 0\ncatch {set x a+b}\nputs $x\n'],
        ['for initialization and step', 'for {set i 0} {$i<2} {incr i} {puts $i}\n'],
        ['switch pattern lists', 'set x 1\nswitch $x {\n  1 {puts one}\n  2 {puts two}\n}\n'],
        ['expanded control arguments', 'if {*}{1 {puts expanded}}\n'],
        ['default parameter values', 'proc f {{x { a+b }} args} {puts $x; puts $args}\nf\n'],
        ['bracket comments', 'puts [set x 1;# ignored\n]\n'],
        ['command continuations', 'puts \\\n  [list one \\\n two]\n'],
    ];

    suiteSetup(function () {
        const probe = spawnSync('tclsh', [], { input: 'puts ready\n', encoding: 'utf8', timeout: 5000 });
        if (probe.error && 'code' in probe.error && probe.error.code === 'ENOENT') this.skip();
        assert.ifError(probe.error);
    });

    for (const [name, input] of fixtures) {
        test('preserves ' + name + ' when executed by Tcl', () => {
            const run = (script: string) => {
                const result = spawnSync('tclsh', [], { input: script, encoding: 'utf8', timeout: 5000 });
                assert.ifError(result.error);
                assert.strictEqual(result.stderr, '', 'Fixture must remain valid Tcl: ' + script);
                return result.stdout;
            };
            const before = run(input);
            for (const options of [{}, { spacesInsideBraces: false, spacesInsideBrackets: true }, { alignBraces: false, useTabs: true }]) {
                const formatter = new TclFormatter(options);
                const formatted = formatter.format(input);
                assert.strictEqual(run(formatted), before, formatted);
                assert.strictEqual(formatter.format(formatted), formatted, 'Formatting must be idempotent');
            }
        });
    }

    test('preserves malformed and incomplete Tcl', () => {
        for (const text of ['if {1}{puts x}', 'proc f {} {', 'puts "unfinished', 'puts [list a']) {
            assert.strictEqual(new TclFormatter().format(text), text);
        }
    });

    test('keeps literal data exact even when padding is enabled', () => {
        for (const text of ['set value { [ a ] }', 'set value { }', 'puts {if {1} {hello}}']) {
            assert.strictEqual(new TclFormatter().format(text), text);
        }
    });
});
