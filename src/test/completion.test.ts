import * as assert from 'assert';
import * as vscode from 'vscode';
import { TclCompletionItemProvider } from '../providers/completionProvider';

suite('TCL Completion Provider', () => {
    const toLabelString = (item: vscode.CompletionItem): string => {
        const label = item.label;
        if (typeof label === 'string') {
            return label;
        }
        return label.label;
    };

    test('suggests variables from the current scope only', async () => {
        const provider = new TclCompletionItemProvider();
        const document = await vscode.workspace.openTextDocument({
            content: [
                'proc demo {a b} {',
                '    set x 1',
                '    puts $',
                '    set y 2',
                '}'
            ].join('\n'),
            language: 'tcl'
        });

        const position = new vscode.Position(2, '    puts $'.length);
        const tokenSource = new vscode.CancellationTokenSource();
        const context = { triggerKind: vscode.CompletionTriggerKind.Invoke } as vscode.CompletionContext;
        const result = await provider.provideCompletionItems(
            document,
            position,
            tokenSource.token,
            context
        );

        const items = Array.isArray(result) ? result : result.items;
        const labels = items.map(toLabelString);

        assert.ok(labels.includes('a'), 'Procedure argument should be suggested');
        assert.ok(labels.includes('x'), 'Previously defined variable should be suggested');
        assert.ok(!labels.includes('y'), 'Variable declared after cursor should not be suggested');

        tokenSource.dispose();
        provider.dispose();
    });

    test('provides package name completions based on workspace content', async () => {
        const provider = new TclCompletionItemProvider();
        const document = await vscode.workspace.openTextDocument({
            content: [
                'package provide mylib 1.0',
                'package require '
            ].join('\n'),
            language: 'tcl'
        });

        const position = new vscode.Position(1, 'package require '.length);
        const tokenSource = new vscode.CancellationTokenSource();
        const context = { triggerKind: vscode.CompletionTriggerKind.Invoke } as vscode.CompletionContext;
        const result = await provider.provideCompletionItems(
            document,
            position,
            tokenSource.token,
            context
        );

        const items = Array.isArray(result) ? result : result.items;
        const labels = items.map(toLabelString);

        assert.ok(labels.includes('mylib'), 'Package names from current document should be suggested');

        tokenSource.dispose();
        provider.dispose();
    });
});
