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

        const position = new vscode.Position(1, 6); // Position at '$myvar'
        
        const result = provider.prepareRename(doc, position, new vscode.CancellationTokenSource().token);
        assert.ok(result);

        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    });
});