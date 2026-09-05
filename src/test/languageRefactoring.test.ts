import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { TclRenameProvider } from '../refactoring/renameProvider';
import { SymbolTableCache } from '../analysis/symbolTableCache';
import { TclExtractProvider } from '../refactoring/extractProvider';
import { TclDiagnosticProvider } from '../providers/diagnosticProvider';

function execute(text: string): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tcl-language-test-'));
    const script = path.join(directory, 'program.tcl');
    try {
        fs.writeFileSync(script, text);
        return execFileSync('tclsh', [script], { encoding: 'utf8', timeout: 3000 });
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
async function doc(text: string): Promise<vscode.TextDocument> {
    return vscode.workspace.openTextDocument({ language: 'tcl', content: text });
}
async function apply(document: vscode.TextDocument, edit: vscode.WorkspaceEdit): Promise<string> {
    assert.ok(await vscode.workspace.applyEdit(edit));
    return document.getText();
}
async function rename(text: string, token: string, newName: string, last = false): Promise<string> {
    const document = await doc(text);
    const offset = (last ? text.lastIndexOf(token) : text.indexOf(token)) + (token.startsWith('$') ? 1 : 0);
    assert.ok(offset >= 0);
    const provider = new TclRenameProvider(new SymbolTableCache());
    const edit = await provider.provideRenameEdits(document, document.positionAt(offset), newName, new vscode.CancellationTokenSource().token);
    assert.ok(edit);
    return apply(document, edit!);
}

suite('Language refactoring execution regressions', () => {
    suiteSetup(function () {
        if (spawnSync('tclsh', [], { input: 'puts ok\n', encoding: 'utf8' }).error) this.skip();
    });

    test('parameter rename edits default-valued and multiline declarations precisely', async () => {
        const source = 'proc codex_parameter_rename {\n    first\n    {value {hello world}}\n} {\n    puts "$first:$value"\n}\ncodex_parameter_rename hi\n';
        const result = await rename(source, '$value', 'renamed');
        assert.ok(result.includes('{renamed {hello world}}'));
        assert.ok(!result.includes('renamedproc'));
        assert.strictEqual(execute(result), execute(source));
    });

    test('rename covers subsequent writes and named mutation commands', async () => {
        const source = 'set count 1\nset count 2\nincr count\nappend count 4\nputs $count\n';
        const result = await rename(source, '$count', 'total');
        assert.ok(!result.includes('count'));
        assert.strictEqual(execute(result), '34\n');
    });

    test('rename preserves Unicode array bindings', async () => {
        const source = 'set é(x+y) 4\nputs [expr {$é(x+y)+1}]\n';
        const result = await rename(source, '$é', 'renamed');
        assert.ok(result.includes('set renamed(x+y) 4'));
        assert.strictEqual(execute(result), execute(source));
    });

    test('rename retains global qualification on references from procedures', async () => {
        const source = 'set globalValue 7\nproc codex_global_reference {} {puts $::globalValue}\ncodex_global_reference\n';
        const result = await rename(source, 'globalValue', 'renamed');
        assert.ok(result.includes('$::renamed'));
        assert.strictEqual(execute(result), execute(source));
    });

    test('rename keeps unrelated locals and literal dollar text unchanged', async () => {
        const source = 'proc codex_scope_a {} {set x 1; incr x; puts $x}\nproc codex_scope_b {} {set x 7; puts $x}\nset text {$x}\ncodex_scope_a\ncodex_scope_b\nputs $text\n';
        const result = await rename(source, '$x', 'renamed');
        assert.ok(result.includes('proc codex_scope_b {} {set x 7; puts $x}'));
        assert.ok(result.includes('set text {$x}'));
        assert.strictEqual(execute(result), execute(source));
    });

    test('procedure rename changes calls in bodies, substitutions and expressions only', async () => {
        const source = 'proc codex_proc_rename {} {return 1}\nset literal {codex_proc_rename sample}\nputs "the codex_proc_rename value"\nset value [codex_proc_rename]\nif {[codex_proc_rename]} {codex_proc_rename}\nputs $literal\nputs $value\n';
        const result = await rename(source, 'codex_proc_rename', 'codex_proc_renamed');
        assert.ok(result.includes('set literal {codex_proc_rename sample}'));
        assert.ok(result.includes('puts "the codex_proc_rename value"'));
        assert.ok(result.includes('if {[codex_proc_renamed]} {codex_proc_renamed}'));
        assert.strictEqual(execute(result), execute(source));
    });

    test('procedure rename resolves names within their defining namespace', async () => {
        const source = 'namespace eval codex_ns_a {\n proc pick {} {return A}\n proc invoke {} {pick}\n}\nnamespace eval codex_ns_b {\n proc pick {} {return B}\n}\nputs [codex_ns_a::pick]\nputs [codex_ns_a::invoke]\nputs [codex_ns_b::pick]\n';
        const result = await rename(source, 'pick', 'choose');
        assert.ok(result.includes('codex_ns_a::choose'));
        assert.ok(result.includes('codex_ns_b::pick'));
        assert.strictEqual(execute(result), execute(source));
    });

    for (const fixture of [
        { name: 'quoted arguments', source: 'proc codex_inline_identity {value} {return $value}\nset result [codex_inline_identity {hello world}]\nputs $result\n', call: 'codex_inline_identity {hello' },
        { name: 'single argument evaluation', source: 'proc codex_inline_twice {value} {return [list $value $value]}\nset n 0\nputs [codex_inline_twice [incr n]]\nputs $n\n', call: 'codex_inline_twice [incr' },
        { name: 'bare returned values', source: 'proc codex_inline_bare {} {return 42}\ncodex_inline_bare\nputs done\n', call: 'codex_inline_bare\n' },
        { name: 'local scope', source: 'proc codex_inline_locals {} {set x 7; return $x}\nset x 1\nset result [codex_inline_locals]\nputs "$x:$result"\n', call: 'codex_inline_locals]' },
        { name: 'defaults and variadic arguments', source: 'proc codex_inline_defaults {{x {hello world}} args} {return [list $x $args]}\nputs [codex_inline_defaults]\n', call: 'codex_inline_defaults]' },
        { name: 'definition namespace', source: 'namespace eval codex_inline_ns {\n variable value 7\n proc read {} {variable value; return $value}\n}\nputs [codex_inline_ns::read]\n', call: 'codex_inline_ns::read]' },
        { name: 'return control flow', source: 'proc codex_inline_return {x} {if {$x} {return early}; return late}\nputs [codex_inline_return 1]\nputs after\n', call: 'codex_inline_return 1]' },
    ]) {
        test(`inline preserves ${fixture.name}`, async () => {
            const document = await doc(fixture.source);
            const edit = await new TclExtractProvider().provideInlineEdits(document, document.positionAt(fixture.source.indexOf(fixture.call)));
            const result = await apply(document, edit);
            assert.ok(result.includes('::apply'));
            assert.strictEqual(execute(result), execute(fixture.source));
        });
    }

    for (const fixture of [
        { name: 'enclosing parameters', source: 'proc codex_extract_input {input} {\n    puts $input\n}\ncodex_extract_input hi\n', selection: '    puts $input' },
        { name: 'loop bindings', source: 'foreach item {a b} {\n    puts $item\n}\n', selection: '    puts $item' },
        { name: 'catch bindings', source: 'catch {error example} result\nputs $result\n', selection: 'puts $result' },
        { name: 'multiple outputs and mutations', source: 'set x 1\nset a 0\nset b 0\nincr x\nset a $x\nset b 4\nputs "$a:$b:$x"\n', selection: 'incr x\nset a $x\nset b 4' },
        { name: 'multiline literal contents', source: 'set value {line one\n  line two}\nputs $value\n', selection: 'set value {line one\n  line two}' },
    ]) {
        test(`extract preserves ${fixture.name}`, async () => {
            const document = await doc(fixture.source);
            const start = fixture.source.indexOf(fixture.selection);
            const range = new vscode.Selection(document.positionAt(start), document.positionAt(start + fixture.selection.length));
            const edit = new TclExtractProvider().createProcedureExtractionEdit(document, range, 'codex_extracted');
            const result = await apply(document, edit);
            assert.strictEqual(execute(result), execute(fixture.source));
        });
    }

    test('extract declines partial commands and escaping control flow', async () => {
        const document = await doc('proc sample {x} {\n    return $x\n}\n');
        const provider = new TclExtractProvider();
        assert.throws(() => provider.createProcedureExtractionEdit(document, new vscode.Selection(1, 4, 1, 13), 'extracted'), /control flow/);
        assert.throws(() => provider.createProcedureExtractionEdit(document, new vscode.Selection(1, 5, 1, 13), 'extracted'), /complete Tcl commands/);
    });
});

suite('Non-executing Tcl diagnostics', () => {
    test('validation neither performs side effects nor enters infinite loops', async () => {
        const marker = path.join(os.tmpdir(), `tcl-diagnostic-must-not-execute-${process.pid}-${Date.now()}`);
        const document = await doc(`close [open {${marker}} w]\nwhile {1} {}\n`);
        const provider = new TclDiagnosticProvider();
        try {
            await provider.provideDiagnostics(document);
            assert.ok(!fs.existsSync(marker), 'Diagnostics executed document contents');
        } finally {
            provider.dispose();
            if (fs.existsSync(marker)) fs.unlinkSync(marker);
        }
    });

    test('literal brackets, quotes, closing characters and hash arguments are valid', async () => {
        const document = await doc('set literal {[}\nset quote {"}\nputs }\nputs ]\nset hash #value\n');
        const provider = new TclDiagnosticProvider();
        try {
            await provider.provideDiagnostics(document);
            assert.deepStrictEqual(vscode.languages.getDiagnostics(document.uri).filter(d => d.severity === vscode.DiagnosticSeverity.Error), []);
        } finally { provider.dispose(); }
    });

    test('incomplete commands in known procedure bodies are diagnosed', async () => {
        const document = await doc('proc incomplete {} {\n puts [list a\n}\n');
        const provider = new TclDiagnosticProvider();
        try {
            await provider.provideDiagnostics(document);
            assert.ok(vscode.languages.getDiagnostics(document.uri).some(d => d.message === 'Unclosed bracket'));
        } finally { provider.dispose(); }
    });
});
