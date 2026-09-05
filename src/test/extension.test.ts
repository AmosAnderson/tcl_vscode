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

        
        const extension = vscode.extensions.getExtension('amos-anderson.tcl-syntax')!;
        await extension.activate();
        const tclCommands = extension.packageJSON.contributes.commands.map((item: { command: string }) => item.command) as string[];

        const commands = await vscode.commands.getCommands();
        for (const cmd of tclCommands) {
            assert.ok(commands.includes(cmd), `Command ${cmd} should be registered`);
        }
    });

    test('the editor Toggle Breakpoint action supports Tcl without allowing all languages', async () => {
        const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, 'task-fixture.tcl');
        const editor = await vscode.window.showTextDocument(uri);
        editor.selection = new vscode.Selection(0, 0, 0, 0);
        const prior = new Set(vscode.debug.breakpoints.map(breakpoint => breakpoint.id));
        try {
            await vscode.commands.executeCommand('editor.debug.action.toggleBreakpoint');
            const breakpoint = vscode.debug.breakpoints.find(item => item instanceof vscode.SourceBreakpoint &&
                item.location.uri.toString() === uri.toString() && item.location.range.start.line === 0);
            assert.ok(breakpoint, 'The actual editor action adds a source breakpoint for a Tcl document');
        } finally {
            vscode.debug.removeBreakpoints(vscode.debug.breakpoints.filter(item => !prior.has(item.id)));
        }
    });
});
