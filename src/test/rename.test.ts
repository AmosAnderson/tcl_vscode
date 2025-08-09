import * as assert from 'assert';
import * as vscode from 'vscode';
import { TclRenameProvider } from '../refactoring/renameProvider';

suite('TCL Rename Provider Tests', () => {
    let provider: TclRenameProvider;

    setup(() => {
        provider = new TclRenameProvider();
    });

    test('Should reject renaming built-in commands', async () => {
        const doc = await vscode.workspace.openTextDocument({
            content: 'puts "hello"',
            language: 'tcl'
        });

        const position = new vscode.Position(0, 0); // Position at 'puts'
        
        try {
            await provider.prepareRename(doc, position, new vscode.CancellationTokenSource().token);
            assert.fail('Should have thrown error for built-in command');
        } catch (error) {
            assert.ok(error instanceof Error);
            assert.ok(error.message.includes('Cannot rename built-in TCL command'));
        }

        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    });

    test('Should allow renaming user procedures', async () => {
        const doc = await vscode.workspace.openTextDocument({
            content: 'proc myproc {} { puts "test" }\nmyproc',
            language: 'tcl'
        });

        const position = new vscode.Position(1, 0); // Position at 'myproc' call
        
        const result = provider.prepareRename(doc, position, new vscode.CancellationTokenSource().token);
        assert.ok(result);

        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    });

    test('Should allow renaming variables', async () => {
        const doc = await vscode.workspace.openTextDocument({
            content: 'set myvar 123\nputs $myvar',
            language: 'tcl'
        });

    const position = new vscode.Position(1, 7); // Position within 'myvar' (skip $)
        
        const result = provider.prepareRename(doc, position, new vscode.CancellationTokenSource().token);
        assert.ok(result);

        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    });

    test('Should rename procedure calls inside brace groups (e.g., catch block)', async () => {
        const original = 'proc need2 {a b} {return [list $a $b]}\nset code [catch {need2 1} msg]\nassert {$code == 1} "arg count error code"\nassert {[string match {*wrong # args*} $msg]} "arg error message"\n';
        const doc = await vscode.workspace.openTextDocument({
            content: original,
            language: 'tcl'
        });

        // Position on the procedure name in the definition line (after 'proc ')
        const position = new vscode.Position(0, 5); // start of 'need2'
        const token = new vscode.CancellationTokenSource().token;
        const edit = await provider.provideRenameEdits(doc, position, 'needX', token);
        assert.ok(edit, 'Edit should be returned');

    await vscode.workspace.applyEdit(edit);
    const updatedText = doc.getText();
    // The call inside the catch braces should be renamed
    assert.ok(!/need2/.test(updatedText), 'All instances of need2 should be renamed');
    const countNew = (updatedText.match(/needX/g) || []).length;
        assert.strictEqual(countNew, 2, 'Definition and one call should be renamed');

        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    });
});