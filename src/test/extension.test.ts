import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    test('Extension should be present', () => {
        assert.ok(vscode.extensions.getExtension('amos-anderson.tcl-syntax'));
    });

    test('Extension should activate', async () => {
        const extension = vscode.extensions.getExtension('amos-anderson.tcl-syntax');
        if (extension && !extension.isActive) {
            await extension.activate();
        }
        assert.ok(extension?.isActive);
    });

    test('TCL language should be recognized', async () => {
        const doc = await vscode.workspace.openTextDocument({
            content: 'puts "Hello World"',
            language: 'tcl'
        });
        
        assert.strictEqual(doc.languageId, 'tcl');
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    });

    test('Commands should be registered', async () => {
        const commands = await vscode.commands.getCommands();
        
        const tclCommands = [
            'tcl.formatDocument',
            'tcl.startREPL',
            'tcl.evaluateSelection',
            'tcl.runCurrentFile'
        ];
        
        for (const cmd of tclCommands) {
            assert.ok(commands.includes(cmd), `Command ${cmd} should be registered`);
        }
    });
});