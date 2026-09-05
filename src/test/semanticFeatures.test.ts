import * as assert from 'assert';
import * as vscode from 'vscode';
import { analyzeDocument } from '../analysis/documentAnalysis';
import { WorkspaceIndex } from '../analysis/workspaceIndex';
import { TclCompletionItemProvider } from '../providers/completionProvider';
import { TclDefinitionProvider, TclReferenceProvider } from '../providers/definitionProvider';
import { TclDocumentSymbolProvider } from '../providers/symbolProvider';
import { TclSignatureHelpProvider } from '../providers/signatureHelpProvider';
import { TclCodeLensProvider } from '../providers/codeLensProvider';
import { TclHoverProvider } from '../providers/hoverProvider';
import { resolveProcedureName } from '../analysis/procedures';
import { TclRenameProvider } from '../refactoring/renameProvider';
import { spawnSync } from 'child_process';

const source = () => new vscode.CancellationTokenSource();
async function doc(text: string): Promise<vscode.TextDocument> { return vscode.workspace.openTextDocument({ content: text, language: 'tcl' }); }
async function completions(document: vscode.TextDocument, text: string, last = true): Promise<vscode.CompletionItem[]> {
    const position = document.positionAt((last ? document.getText().lastIndexOf(text) : document.getText().indexOf(text)) + text.length);
    const token = source();
    try {
        const result = await new TclCompletionItemProvider().provideCompletionItems(document, position, token.token, { triggerKind: vscode.CompletionTriggerKind.Invoke } as vscode.CompletionContext);
        return Array.isArray(result) ? result : result.items;
    } finally { token.dispose(); }
}

suite('Shared semantic language features', () => {
    test('index and outline handle static Tcl syntax, literals, Unicode and complete ranges', async () => {
        const document = await doc('set literal {proc phantom {} {}}\n# proc comment {} {}\nnamespace eval ::semantic_shape {proc café {{value {hello world}}} {return $value}; proc second {} {}}\nproc ::semantic_shape::third {\n first\n {second 4}\n} {return $first}\n');
        const parsed = await WorkspaceIndex.getInstance().parseFile(document.uri);
        assert.deepStrictEqual(parsed.procedures.map(item => item.qualifiedName), ['::semantic_shape::café', '::semantic_shape::second', '::semantic_shape::third']);
        assert.deepStrictEqual(parsed.procedures[0].params, ['value']);
        const token = source();
        try {
            const outline = new TclDocumentSymbolProvider().provideDocumentSymbols(document, token.token);
            assert.strictEqual(outline[0].children.length, 2);
            assert.ok(outline[1].range.end.line > outline[1].range.start.line);
            assert.ok(outline[0].range.contains(outline[0].children[1].range));
        } finally { token.dispose(); }
    });

    test('definitions and references resolve namespace and case without matching data', async () => {
        const document = await doc('namespace eval semantic_nav {proc Foo {x} {return $x}; proc foo {x} {return $x}; proc caller {} {Foo {hello}}}\nset literal {Foo data}\n# Foo comment\nsemantic_nav::Foo value\nsemantic_nav::foo other\n');
        const text = document.getText();
        const position = document.positionAt(text.indexOf('Foo {hello}') + 1);
        const token = source();
        try {
            const definitions = await new TclDefinitionProvider().provideDefinition(document, position, token.token);
            assert.strictEqual(definitions?.length, 1);
            assert.strictEqual(document.getText(definitions![0].range), 'Foo');
            const references = await new TclReferenceProvider().provideReferences(document, position, { includeDeclaration: false }, token.token);
            assert.strictEqual(references.length, 2);
            assert.deepStrictEqual(references.map(item => document.getText(item.range)).sort(), ['Foo', 'semantic_nav::Foo']);
            const withDeclaration = await new TclReferenceProvider().provideReferences(document, position, { includeDeclaration: true }, token.token);
            assert.strictEqual(withDeclaration.length, 3);
        } finally { token.dispose(); }
    });

    test('parameters and reopened namespace variables navigate to their bindings', async () => {
        const document = await doc('namespace eval semantic_bind {variable value 1}\nnamespace eval semantic_bind {proc read {{arg hi}} {variable value; puts "$arg:$value:$::semantic_bind::value"}}\n');
        const token = source();
        try {
            for (const name of ['$value', '$::semantic_bind::value']) {
                const result = await new TclDefinitionProvider().provideDefinition(document, document.positionAt(document.getText().indexOf(name) + 2), token.token);
                assert.ok(result?.some(item => item.range.start.line === 0));
            }
            const position = document.positionAt(document.getText().indexOf('$arg') + 2);
            const result = await new TclDefinitionProvider().provideDefinition(document, position, token.token);
            assert.strictEqual(document.getText(result![0].range), 'arg');
            const refs = await new TclReferenceProvider().provideReferences(document, position, { includeDeclaration: false }, token.token);
            assert.strictEqual(refs.length, 1);
        } finally { token.dispose(); }
    });

    test('static namespace imports and paths resolve only exported unambiguous commands', () => {
        const names = new Set(['::library::public', '::library::private', '::pathlib::find']);
        const resolution = { imports: [{ namespace: '::consumer', pattern: '::library::*' }], exports: [{ namespace: '::library', patterns: ['public'] }], paths: [{ namespace: '::consumer', paths: ['::pathlib'] }] };
        assert.strictEqual(resolveProcedureName('public', '::consumer', names, resolution), '::library::public');
        assert.strictEqual(resolveProcedureName('consumer::public', '::', names, resolution), '::library::public');
        assert.strictEqual(resolveProcedureName('::consumer::public', '::', names, resolution), '::library::public');
        assert.strictEqual(resolveProcedureName('private', '::consumer', names, resolution), undefined);
        assert.strictEqual(resolveProcedureName('find', '::consumer', names, resolution), '::pathlib::find');
    });

    test('completion uses default parameters and loop bindings without command noise', async () => {
        const document = await doc('proc semantic_completion {{value {hello world}}} {\n foreach item {a b} {\n  puts $\n }\n}\n');
        const labels = (await completions(document, 'puts $')).map(item => item.label);
        assert.ok(labels.includes('value'));
        assert.ok(labels.includes('item'));
        assert.ok(!labels.includes('puts'));
        const data = await doc('set literal {expr $}\n# expr $\n');
        assert.deepStrictEqual(await completions(data, 'expr $', false), []);
    });

    test('metadata supplies ensemble completions and qualified namespace members', async () => {
        const document = await doc('namespace eval semantic_complete_ns {proc member {} {}}\ndict \nsemantic_complete_ns::\n');
        assert.ok((await completions(document, 'dict ')).some(item => item.label === 'get'));
        const items = await completions(document, 'semantic_complete_ns::');
        assert.ok(items.some(item => String(item.label).endsWith('semantic_complete_ns::member')));
    });

    test('user signatures follow multiline commands and nested argument boundaries', async () => {
        const document = await doc('proc semantic_signature {first {second {hello world}} args} {}\nsemantic_signature [list one two] \\\n    \n');
        const position = document.positionAt(document.getText().lastIndexOf('    ') + 4);
        const token = source();
        try {
            const result = await new TclSignatureHelpProvider().provideSignatureHelp(document, position, token.token, {} as vscode.SignatureHelpContext);
            assert.ok(result);
            assert.ok(result!.signatures[0].label.includes('hello world'));
            assert.strictEqual(result!.activeParameter, 1);
        } finally { token.dispose(); }
    });

    test('TclOO methods and lambda parameters have independent semantic scopes', async () => {
        const document = await doc('oo::class create SemanticClass {\n variable state\n method first {value} {my second $value}\n method second {{value hi}} {return "$value:$state"}\n}\nSemanticClass create semantic_object\nsemantic_object second hello\napply {{value} {puts $value}} sample\nset value outer\n');
        const analysis = analyzeDocument(document);
        assert.deepStrictEqual(analysis.declarations.map(item => item.kind), ['class', 'method', 'method', 'lambda']);
        const token = source();
        try {
            const position = document.positionAt(document.getText().indexOf('my second') + 4);
            const definitions = await new TclDefinitionProvider().provideDefinition(document, position, token.token);
            assert.strictEqual(definitions?.length, 1);
            assert.strictEqual(document.getText(definitions![0].range), 'second');
            const references = await new TclReferenceProvider().provideReferences(document, position, { includeDeclaration: false }, token.token);
            assert.strictEqual(references.length, 2);
            const lambdaPosition = document.positionAt(document.getText().lastIndexOf('$value') + 2);
            const lambda = analysis.table.getSymbolAt(lambdaPosition);
            assert.strictEqual(lambda?.kind, 'parameter');
            assert.strictEqual(lambda?.references.length, 1);
            const classState = analysis.table.getSymbolAt(document.positionAt(document.getText().indexOf('$state') + 2));
            assert.ok(classState?.qualifiedName?.includes('SemanticClass'));
        } finally { token.dispose(); }
    });
    test('literal instance bindings resolve inherited methods and decline ambiguous assignments', async () => {
        const document = await doc('oo::class create SemanticParent {method inherited {value} {return $value}}\noo::class create SemanticChild {superclass SemanticParent}\nset instance [SemanticChild new]\n$instance inherited hello\n$instance \nset ambiguous [SemanticChild new]\nset ambiguous somethingElse\n$ambiguous inherited wrong\n');
        const text = document.getText(), token = source();
        try {
            const position = document.positionAt(text.indexOf('$instance inherited') + '$instance inh'.length);
            const definitions = await new TclDefinitionProvider().provideDefinition(document, position, token.token);
            assert.strictEqual(definitions?.length, 1);
            assert.strictEqual(document.getText(definitions![0].range), 'inherited');
            assert.ok((await completions(document, '$instance ')).some(item => item.label === 'inherited'));
            const ambiguous = document.positionAt(text.indexOf('$ambiguous inherited') + '$ambiguous inh'.length);
            assert.strictEqual(await new TclDefinitionProvider().provideDefinition(document, ambiguous, token.token), null);
        } finally { token.dispose(); }
    });

    test('cross-file hover, variable references and CodeLens share current document versions', async () => {
        const declaration = await doc('# Shared documentation\nproc semantic_shared {arg} {return $arg}\nset ::semantic_shared_value 1\n');
        const caller = await doc('semantic_shared {hello}\nputs $::semantic_shared_value\nset literal {semantic_shared data}\n');
        const token = source();
        const lensProvider = new TclCodeLensProvider();
        try {
            const hover = await new TclHoverProvider().provideHover(caller, new vscode.Position(0, 3), token.token);
            assert.ok(hover?.contents.some(content => (content as vscode.MarkdownString).value.replace(/&nbsp;/g, ' ').includes('Shared documentation')));
            const definitions = await new TclDefinitionProvider().provideDefinition(caller, new vscode.Position(1, 10), token.token);
            assert.ok(definitions?.some(item => item.uri.toString() === declaration.uri.toString()));
            const lenses = lensProvider.provideCodeLenses(declaration, token.token);
            assert.strictEqual((await lensProvider.resolveCodeLens(lenses[0], token.token)).command?.title, '1 reference');
            const edit = new vscode.WorkspaceEdit();
            edit.insert(caller.uri, new vscode.Position(1, 0), 'semantic_shared more\n');
            assert.ok(await vscode.workspace.applyEdit(edit));
            const refreshed = lensProvider.provideCodeLenses(declaration, token.token);
            assert.strictEqual((await lensProvider.resolveCodeLens(refreshed[0], token.token)).command?.title, '2 references');
        } finally { lensProvider.dispose(); token.dispose(); }
    });
    test('method renaming updates resolved callers and rejects class-local collisions', async () => {
        const original = 'oo::class create SemanticRenameMethod {method first {value} {my second $value}; method second {value} {return $value}; method occupied {} {}}\nSemanticRenameMethod create rename_method_object\nputs [rename_method_object first hello]\nputs {second literal}\n';
        const document = await doc(original);
        const token = source();
        const provider = new TclRenameProvider();
        try {
            const position = document.positionAt(original.indexOf('my second') + 4);
            await assert.rejects(provider.provideRenameEdits(document, position, 'occupied', token.token), /already exists/);
            const edit = await provider.provideRenameEdits(document, position, 'renamed', token.token);
            assert.ok(edit);
            await vscode.workspace.applyEdit(edit!);
            const result = document.getText();
            assert.ok(result.includes('my renamed $value'));
            assert.ok(result.includes('method renamed {value}'));
            assert.ok(result.includes('puts {second literal}'));
            const supported = spawnSync('tclsh', [], { input: 'puts [info commands oo::class]\n', encoding: 'utf8' }).stdout?.trim();
            if (supported) assert.strictEqual(spawnSync('tclsh', [], { input: result, encoding: 'utf8' }).stdout, spawnSync('tclsh', [], { input: original, encoding: 'utf8' }).stdout);
        } finally { token.dispose(); }
    });
    test('class renaming preserves qualification and updates oo::define and superclass names', async () => {
        const original = 'namespace eval semantic_rename_class {oo::class create Before {method first {} {return ok}}; oo::class create Occupied {}}\noo::define ::semantic_rename_class::Before method second {} {return more}\noo::class create SemanticRenameChild {superclass ::semantic_rename_class::Before}\nputs [[semantic_rename_class::Before new] second]\nputs {semantic_rename_class::Before literal}\n';
        const document = await doc(original);
        const token = source();
        const provider = new TclRenameProvider();
        try {
            const position = document.positionAt(original.indexOf('Before') + 2);
            await assert.rejects(provider.provideRenameEdits(document, position, 'Occupied', token.token), /already exists/);
            const edit = await provider.provideRenameEdits(document, position, 'After', token.token);
            assert.ok(edit);
            await vscode.workspace.applyEdit(edit!);
            const result = document.getText();
            assert.ok(result.includes('oo::class create After'));
            assert.ok(result.includes('oo::define ::semantic_rename_class::After'));
            assert.ok(result.includes('superclass ::semantic_rename_class::After'));
            assert.ok(result.includes('[semantic_rename_class::After new]'));
            assert.ok(result.includes('puts {semantic_rename_class::Before literal}'));
            const supported = spawnSync('tclsh', [], { input: 'puts [info commands oo::class]\n', encoding: 'utf8' }).stdout?.trim();
            if (supported) assert.strictEqual(spawnSync('tclsh', [], { input: result, encoding: 'utf8' }).stdout, spawnSync('tclsh', [], { input: original, encoding: 'utf8' }).stdout);
        } finally { token.dispose(); }
    });
});
