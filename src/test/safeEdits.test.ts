import * as assert from 'assert';
import * as vscode from 'vscode';
import { spawnSync } from 'child_process';
import { createVariableExtractionEdit, createVariableInlineEdit } from '../refactoring/variableEdits';
import { createNamespaceExtractionEdit, createNamespaceRenameEdit } from '../refactoring/namespaceEdits';
import { TclLintProvider } from '../providers/lintProvider';
import { TclCodeActionProvider } from '../providers/codeActionProvider';
import { TclDiagnosticProvider } from '../providers/diagnosticProvider';

function transformed(document: vscode.TextDocument, edit: vscode.WorkspaceEdit): string {
    let text = document.getText();
    for (const change of edit.get(document.uri).sort((a, b) => document.offsetAt(b.range.start) - document.offsetAt(a.range.start))) {
        text = text.slice(0, document.offsetAt(change.range.start)) + change.newText + text.slice(document.offsetAt(change.range.end));
    }
    return text;
}
function execute(input: string): string {
    const result = spawnSync('tclsh', [], { input, encoding: 'utf8', timeout: 5000 });
    assert.ifError(result.error); assert.strictEqual(result.stderr, '', input); return result.stdout;
}
async function doc(content: string): Promise<vscode.TextDocument> { return vscode.workspace.openTextDocument({ language: 'tcl', content }); }

suite('Source edit safety and lint', () => {
    test('variable inlining respects bindings, literals and adjacent commands', async () => {
        const source = 'proc a {} {set value {two  words}; puts "$value:${value}"; puts {$value}}\nproc b {} {set value other; puts $value}\na\nb\n';
        const document = await doc(source);
        const edit = createVariableInlineEdit(document, document.positionAt(source.indexOf('value')));
        const result = transformed(document, edit);
        assert.strictEqual(execute(result), execute(source));
        assert.ok(result.includes('puts {$value}'));
        assert.ok(result.includes('proc b {} {set value other; puts $value}'));
    });
    test('inlining declines side effects, reassignment and early reads', async () => {
        for (const source of ['set value [incr count]\nputs $value', 'set value 1\nset value 2\nputs $value', 'puts $value\nset value 1']) {
            const document = await doc(source);
            assert.throws(() => createVariableInlineEdit(document, document.positionAt(source.indexOf('value'))));
        }
    });
    test('inlining declines assignments that may not execute and calls that can mutate the caller', async () => {
        for (const source of [
            'if {0} {set value 1}\nputs $value\n',
            'foreach item {} {set value 1}\nputs $value\n',
            'catch {error stop; set value 1}\nputs $value\n',
            'proc mutate {} {upvar 1 value target; set target 2}\nproc example {} {set value 1; mutate; puts $value}\nexample\n',
        ]) {
            const document = await doc(source);
            const offset = source.indexOf('set value') + 5;
            assert.throws(() => createVariableInlineEdit(document, document.positionAt(offset)), /may not execute|Dynamic scope/);
        }
    });
    test('extraction retains single argument evaluation and refuses delayed/data selections', async () => {
        const source = 'set count 0\nputs [incr count]\nputs $count\n';
        const document = await doc(source), from = source.indexOf('[incr count]');
        const edit = createVariableExtractionEdit(document, new vscode.Range(document.positionAt(from), document.positionAt(from + 12)), 'saved');
        assert.strictEqual(execute(transformed(document, edit)), execute(source));
        const literal = await doc('set data {puts hello}\n');
        assert.throws(() => createVariableExtractionEdit(literal, new vscode.Range(0, 10, 0, 20), 'saved'));
    });
    test('namespace extraction preserves multiline values and actual callers', async () => {
        const source = 'proc safe_ns_fixture {} {puts {first\n  second}}\nsafe_ns_fixture\nputs {safe_ns_fixture}\n';
        const document = await doc(source), end = source.indexOf('\nsafe_ns_fixture');
        const edit = await createNamespaceExtractionEdit(document, new vscode.Range(document.positionAt(0), document.positionAt(end)), 'codex_safe_namespace');
        const result = transformed(document, edit);
        assert.strictEqual(execute(result), execute(source));
        assert.ok(result.includes('puts {safe_ns_fixture}'));
        const sensitive = await doc('proc sensitive {} {namespace current}\n');
        await assert.rejects(createNamespaceExtractionEdit(sensitive, new vscode.Range(0, 0, 0, 37), 'target'), /complete|dependent/);
    });
    test('namespace rename edits declarations and qualified bindings without literal data', async () => {
        const source = 'namespace eval codex_before {variable x 1; proc p {} {variable x; puts $x}}\ncodex_before::p\nputs $::codex_before::x\nputs {codex_before::p}\n';
        const document = await doc(source);
        const edit = await createNamespaceRenameEdit(document, new vscode.Position(0, 20), 'codex_after');
        assert.ok(edit);
        assert.strictEqual(execute(transformed(document, edit)), execute(source));
        assert.ok(transformed(document, edit).includes('puts {codex_before::p}'));
    });
    test('lint recognizes command spans and creates a valid nested-expression fix', async () => {
        const source = 'set items {a b}\nset data {expr $a + 1}\nputs [expr [llength $items] + 1]\nswitch 1 {1 {puts default}}\n';
        const document = await doc(source), lint = new TclLintProvider();
        try {
            const diagnostics = lint.lint(document);
            assert.strictEqual(diagnostics.filter(item => item.code === 'tcl-lint-expr-bracing').length, 1);
            assert.ok(diagnostics.some(item => item.code === 'tcl-lint-switch-default'));
            const actions = new TclCodeActionProvider().provideCodeActions(document, new vscode.Range(0, 0, 3, 40), { diagnostics, triggerKind: vscode.CodeActionTriggerKind.Invoke, only: undefined }, new vscode.CancellationTokenSource().token);
            assert.strictEqual(actions.length, 1);
            assert.strictEqual(execute(transformed(document, actions[0].edit!)), execute(source));
        } finally { lint.dispose(); }
    });
    test('lint suppressions target the next command and ignore literal directives', async () => {
        const document = await doc('set text {# tcl-lint-disable-next-line expr-bracing}\nexpr 1+2\n# tcl-lint-disable-next-line expr-bracing\nexpr 3+4\n');
        const lint = new TclLintProvider();
        try { assert.deepStrictEqual(lint.lint(document).filter(d => d.code === 'tcl-lint-expr-bracing').map(d => d.range.start.line), [1]); }
        finally { lint.dispose(); }
    });
    test('superseded diagnostic checks settle and closing clears publication', async () => {
        const document = await doc('puts [unfinished\n'), provider = new TclDiagnosticProvider();
        try {
            const pending = Array.from({ length: 20 }, () => provider.provideDiagnostics(document));
            provider.clear(document.uri);
            await Promise.all(pending);
            assert.deepStrictEqual(provider.getDiagnostics(document.uri), []);
        } finally { provider.dispose(); }
    });
});
