import * as assert from 'assert';
import * as vscode from 'vscode';
import { spawnSync } from 'child_process';
import { createNamespaceExtractionEdit, createNamespaceRenameEdit } from '../refactoring/namespaceEdits';

async function document(content: string): Promise<vscode.TextDocument> { return vscode.workspace.openTextDocument({ language: 'tcl', content }); }
function transformed(document: vscode.TextDocument, edit: vscode.WorkspaceEdit): string {
    let text = document.getText();
    for (const change of edit.get(document.uri).sort((a, b) => document.offsetAt(b.range.start) - document.offsetAt(a.range.start))) text = text.slice(0, document.offsetAt(change.range.start)) + change.newText + text.slice(document.offsetAt(change.range.end));
    return text;
}
function execute(text: string): string {
    const result = spawnSync('tclsh', [], { input: text, encoding: 'utf8', timeout: 5000 });
    assert.ifError(result.error);
    assert.strictEqual(result.stderr, '', text);
    return result.stdout;
}

suite('Namespace refactoring resolution safety', () => {
    test('extraction preserves imported helpers, relative qualified variables and cross-file imports', async () => {
        const source = 'namespace eval ::extraction_helper_ns {namespace export extraction_value; proc extraction_value {} {return helper}}\nnamespace import ::extraction_helper_ns::extraction_value\nnamespace eval ::extraction_data_ns {variable text stable}\nnamespace export extraction_moved_proc\nproc extraction_moved_proc {} {return [list [extraction_value] $extraction_data_ns::text]}\n';
        const caller = 'namespace eval ::extraction_consumer_ns {namespace import ::extraction_moved_proc; proc run {} {extraction_moved_proc}}\nputs [::extraction_consumer_ns::run]\nputs [::extraction_consumer_ns::extraction_moved_proc]\nputs {extraction_moved_proc literal}\n';
        const definition = await document(source), consumer = await document(caller);
        const start = source.indexOf('proc extraction_moved_proc'), end = source.lastIndexOf('\n');
        const edit = await createNamespaceExtractionEdit(definition, new vscode.Range(definition.positionAt(start), definition.positionAt(end)), 'extraction_target_ns');
        const result = transformed(definition, edit), calls = transformed(consumer, edit);
        assert.strictEqual(execute(result + calls), execute(source + caller));
        assert.ok(result.includes('$::extraction_data_ns::text'));
        assert.ok(result.includes('::extraction_helper_ns::extraction_value'));
        assert.ok(calls.includes('namespace import ::extraction_target_ns::extraction_moved_proc'));
        assert.ok(calls.includes('puts {extraction_moved_proc literal}'));
    });

    test('extraction retains wildcard imports of unrelated commands', async () => {
        const source = 'namespace export extraction_wild_*\nproc extraction_wild_moved {} {return moved}\nproc extraction_wild_stays {} {return stays}\n';
        const caller = 'namespace eval extraction_wild_consumer {namespace import ::extraction_wild_*; proc run {} {list [extraction_wild_moved] [extraction_wild_stays]}}\nputs [extraction_wild_consumer::run]\n';
        const definition = await document(source), consumer = await document(caller);
        const start = source.indexOf('proc extraction_wild_moved'), end = source.indexOf('\nproc extraction_wild_stays');
        const edit = await createNamespaceExtractionEdit(definition, new vscode.Range(definition.positionAt(start), definition.positionAt(end)), 'extraction_wild_target');
        assert.strictEqual(execute(transformed(definition, edit) + transformed(consumer, edit)), execute(source + caller));
        assert.ok(transformed(consumer, edit).includes('::extraction_wild_* ::extraction_wild_target::extraction_wild_moved'));
    });

    test('nested namespace rename follows relative calls, path lists, imports, globals and literal lambdas', async () => {
        const source = 'namespace eval ::rename_other_ns {}\nnamespace eval ::rename_outer_ns {\n namespace eval before {namespace export work; variable value 3; proc work {} {return yes}}\n namespace eval consumer {namespace path {::rename_outer_ns::before ::rename_other_ns}; namespace import ::rename_outer_ns::before::work; proc run {} {list [work] $::rename_outer_ns::before::value}}\n}\nproc rename_global_reader {} {global rename_outer_ns::before::value; return $value}\n';
        const caller = 'namespace eval ::rename_outer_ns {puts [before::work]; puts [consumer::run]}\nputs [rename_global_reader]\nputs [apply {{} {work} ::rename_outer_ns::before}]\nputs {rename_outer_ns::before literal}\n';
        const definition = await document(source), consumer = await document(caller);
        const edit = await createNamespaceRenameEdit(definition, definition.positionAt(source.indexOf('before') + 2), 'after');
        assert.ok(edit);
        const result = transformed(definition, edit!), calls = transformed(consumer, edit!);
        assert.strictEqual(execute(result + calls), execute(source + caller));
        assert.ok(calls.includes('after::work'));
        assert.ok(result.includes('namespace path {::rename_outer_ns::after ::rename_other_ns}'));
        assert.ok(result.includes('namespace import ::rename_outer_ns::after::work'));
        assert.ok(calls.includes('puts {rename_outer_ns::before literal}'));
    });

    test('namespace rename rejects implicitly existing target namespaces', async () => {
        const source = 'namespace eval collision_outer_ns {namespace eval before {}; namespace eval occupied::child {}}\n';
        const definition = await document(source);
        await assert.rejects(createNamespaceRenameEdit(definition, definition.positionAt(source.indexOf('before') + 1), 'occupied'), /already exists/);
    });

    test('affected opaque callbacks are declined without changing literal data', async () => {
        const source = 'namespace eval callback_outer_ns {namespace eval before {proc work {} {}}; after 0 {before::work}}\n';
        const definition = await document(source);
        await assert.rejects(createNamespaceRenameEdit(definition, definition.positionAt(source.indexOf('before') + 1), 'after'), /callback/);
        const extraction = 'proc callback_extract_proc {} {return ok}\nafter 0 {callback_extract_proc}\n';
        const proc = await document(extraction);
        await assert.rejects(createNamespaceExtractionEdit(proc, new vscode.Range(proc.positionAt(0), proc.positionAt(extraction.indexOf('\nafter'))), 'callback_extract_target'), /callback/);
    });
});
