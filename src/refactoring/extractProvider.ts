import * as vscode from 'vscode';

export class TclExtractProvider implements vscode.CodeActionProvider {
    
    public provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<(vscode.Command | vscode.CodeAction)[]> {
        
        const actions: vscode.CodeAction[] = [];

        // Only provide actions if there's a selection
        if (range instanceof vscode.Selection && !range.isEmpty) {
            actions.push(this.createExtractProcedureAction(document, range));
            actions.push(this.createExtractVariableAction(document, range));
        }

        return actions;
    }

    private createExtractProcedureAction(document: vscode.TextDocument, range: vscode.Selection): vscode.CodeAction {
        const action = new vscode.CodeAction(
            'Extract Procedure',
            vscode.CodeActionKind.RefactorExtract
        );
        
        action.command = {
            command: 'tcl.extractProcedure',
            title: 'Extract Procedure',
            arguments: [document.uri, range]
        };

        return action;
    }

    private createExtractVariableAction(document: vscode.TextDocument, range: vscode.Selection): vscode.CodeAction {
        const action = new vscode.CodeAction(
            'Extract Variable',
            vscode.CodeActionKind.RefactorExtract
        );
        
        action.command = {
            command: 'tcl.extractVariable',
            title: 'Extract Variable',
            arguments: [document.uri, range]
        };

        return action;
    }

    public async extractProcedure(uri: vscode.Uri, range: vscode.Selection): Promise<void> {
        const document = await vscode.workspace.openTextDocument(uri);
        const selectedText = document.getText(range);
        
        if (!selectedText.trim()) {
            vscode.window.showErrorMessage('No code selected');
            return;
        }

        // Prompt for procedure name
        const procedureName = await vscode.window.showInputBox({
            prompt: 'Enter procedure name',
            value: 'new_procedure',
            validateInput: (value) => {
                if (!value || !value.trim()) {
                    return 'Procedure name cannot be empty';
                }
                if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value.trim())) {
                    return 'Invalid procedure name';
                }
                return null;
            }
        });

        if (!procedureName) {
            return;
        }

        try {
            // Analyze the selected code to determine parameters
            const analysis = this.analyzeCodeForExtraction(document, selectedText, range);
            
            // Generate the procedure
            const procedureCode = this.generateProcedure(procedureName, analysis.parameters, selectedText, analysis.returnValue);
            
            // Create workspace edit
            const edit = new vscode.WorkspaceEdit();
            
            // Insert the procedure at the beginning of the file (or before current procedure)
            const insertPosition = this.findInsertPosition(document, range);
            edit.insert(uri, insertPosition, procedureCode + '\n\n');
            
            // Replace selected code with procedure call
            const procedureCall = this.generateProcedureCall(procedureName, analysis.parameters, analysis.returnValue);
            edit.replace(uri, range, procedureCall);
            
            // Apply the edit
            await vscode.workspace.applyEdit(edit);
            
            vscode.window.showInformationMessage(`Procedure '${procedureName}' extracted successfully`);
            
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to extract procedure: ${error}`);
        }
    }

    public async extractVariable(uri: vscode.Uri, range: vscode.Selection): Promise<void> {
        const document = await vscode.workspace.openTextDocument(uri);
        const selectedText = document.getText(range).trim();
        
        if (!selectedText) {
            vscode.window.showErrorMessage('No expression selected');
            return;
        }

        // Prompt for variable name
        const variableName = await vscode.window.showInputBox({
            prompt: 'Enter variable name',
            value: 'extracted_var',
            validateInput: (value) => {
                if (!value || !value.trim()) {
                    return 'Variable name cannot be empty';
                }
                if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value.trim())) {
                    return 'Invalid variable name';
                }
                return null;
            }
        });

        if (!variableName) {
            return;
        }

        try {
            // Create workspace edit
            const edit = new vscode.WorkspaceEdit();
            
            // Find the best position to insert the variable assignment
            const insertPosition = this.findVariableInsertPosition(document, range);
            
            // Create variable assignment
            const variableAssignment = `set ${variableName} ${selectedText}\n`;
            edit.insert(uri, insertPosition, variableAssignment);
            
            // Replace selected expression with variable reference
            edit.replace(uri, range, `$${variableName}`);
            
            // Apply the edit
            await vscode.workspace.applyEdit(edit);
            
            vscode.window.showInformationMessage(`Variable '${variableName}' extracted successfully`);
            
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to extract variable: ${error}`);
        }
    }

    public async inlineVariable(uri: vscode.Uri, position: vscode.Position): Promise<void> {
        const document = await vscode.workspace.openTextDocument(uri);
        const wordRange = document.getWordRangeAtPosition(position);
        
        if (!wordRange) {
            vscode.window.showErrorMessage('No variable selected');
            return;
        }

        let variableName = document.getText(wordRange);
        
        // Check if this is a variable reference or assignment
        const line = document.lineAt(position.line);
        const charBefore = position.character > 0 ? line.text[wordRange.start.character - 1] : '';
        
        // If user selected $varname, remove the $
        if (charBefore === '$') {
            // User is on a variable reference, that's fine
        } else {
            // Check if this could be a variable assignment (set varname ...)
            const lineText = line.text;
            const setPattern = new RegExp(`\\bset\\s+${variableName}\\b`);
            if (!setPattern.test(lineText)) {
                vscode.window.showErrorMessage('Please select a variable name (in a set command or with $)');
                return;
            }
        }

        try {
            // Find the variable assignment
            const assignment = this.findVariableAssignment(document, variableName);
            
            if (!assignment) {
                vscode.window.showErrorMessage(`Cannot find assignment for variable '${variableName}'`);
                return;
            }

            // Create workspace edit
            const edit = new vscode.WorkspaceEdit();
            
            // Replace all references with the assigned value
            const references = this.findVariableReferences(document, variableName);
            
            for (const ref of references) {
                // Replace $variableName with the assigned value
                const refRange = new vscode.Range(
                    ref.line, ref.start - 1, // Include the $
                    ref.line, ref.end
                );
                edit.replace(uri, refRange, assignment.value);
            }
            
            // Remove the variable assignment
            const assignmentRange = new vscode.Range(
                assignment.line, 0,
                assignment.line + 1, 0 // Include the newline
            );
            edit.delete(uri, assignmentRange);
            
            // Apply the edit
            await vscode.workspace.applyEdit(edit);
            
            vscode.window.showInformationMessage(`Variable '${variableName}' inlined successfully`);
            
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to inline variable: ${error}`);
        }
    }

    private analyzeCodeForExtraction(document: vscode.TextDocument, code: string, range: vscode.Selection): {
        parameters: string[];
        returnValue: string | null;
    } {
        const parameters: string[] = [];
        const returnValue: string | null = null;

        // Find variables used in the code
        const variablePattern = /\$([a-zA-Z_][a-zA-Z0-9_]*)/g;
        const variables = new Set<string>();
        let match;
        
        while ((match = variablePattern.exec(code)) !== null) {
            variables.add(match[1]);
        }

        // Check which variables are defined before the selection
        const textBeforeSelection = document.getText(new vscode.Range(0, 0, range.start.line, range.start.character));
        
        for (const variable of variables) {
            const setPattern = new RegExp(`\\bset\\s+${variable}\\b`);
            if (setPattern.test(textBeforeSelection)) {
                parameters.push(variable);
            }
        }

        // Check if the code contains a return statement or sets a variable that's used later
        // This is a simplified analysis - a more sophisticated version would track data flow
        
        return { parameters, returnValue };
    }

    private generateProcedure(name: string, parameters: string[], body: string, returnValue: string | null): string {
        const paramList = parameters.join(' ');
        const indentedBody = body.split('\n').map(line => `    ${line}`).join('\n');
        
        let procedure = `proc ${name} {${paramList}} {\n${indentedBody}`;
        
        if (returnValue) {
            procedure += `\n    return $${returnValue}`;
        }
        
        procedure += '\n}';
        
        return procedure;
    }

    private generateProcedureCall(name: string, parameters: string[], returnValue: string | null): string {
        const args = parameters.map(p => `$${p}`).join(' ');
        let call = `${name} ${args}`;
        
        if (returnValue) {
            call = `set ${returnValue} [${call}]`;
        }
        
        return call;
    }

    private findInsertPosition(document: vscode.TextDocument, range: vscode.Selection): vscode.Position {
        // Look for the current procedure or namespace to insert before it
        for (let line = range.start.line; line >= 0; line--) {
            const lineText = document.lineAt(line).text;
            if (/^\s*proc\s+/.test(lineText) || /^\s*namespace\s+/.test(lineText)) {
                return new vscode.Position(line, 0);
            }
        }
        
        // If no procedure found, insert at the beginning of the file
        return new vscode.Position(0, 0);
    }

    private findVariableInsertPosition(document: vscode.TextDocument, range: vscode.Selection): vscode.Position {
        // Insert at the beginning of the line containing the selection
        return new vscode.Position(range.start.line, 0);
    }

    private findVariableAssignment(document: vscode.TextDocument, variableName: string): { 
        line: number; 
        value: string; 
    } | null {
        const text = document.getText();
        const lines = text.split('\n');
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const setPattern = new RegExp(`\\bset\\s+${variableName}\\s+(.+)$`);
            const match = setPattern.exec(line);
            
            if (match) {
                return {
                    line: i,
                    value: match[1].trim()
                };
            }
        }
        
        return null;
    }

    private findVariableReferences(document: vscode.TextDocument, variableName: string): {
        line: number;
        start: number;
        end: number;
    }[] {
        const references: { line: number; start: number; end: number; }[] = [];
        const text = document.getText();
        const lines = text.split('\n');
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const varPattern = new RegExp(`\\$${variableName}\\b`, 'g');
            let match;
            
            while ((match = varPattern.exec(line)) !== null) {
                references.push({
                    line: i,
                    start: match.index + 1, // Skip the $
                    end: match.index + match[0].length
                });
            }
        }
        
        return references;
    }

    public registerCommands(context: vscode.ExtensionContext): void {
        context.subscriptions.push(
            vscode.commands.registerCommand('tcl.extractProcedure', async () => {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    vscode.window.showErrorMessage('No active editor');
                    return;
                }
                if (editor.selection.isEmpty) {
                    vscode.window.showErrorMessage('No code selected for extraction');
                    return;
                }
                await this.extractProcedure(editor.document.uri, editor.selection);
            }),

            vscode.commands.registerCommand('tcl.extractVariable', async () => {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    vscode.window.showErrorMessage('No active editor');
                    return;
                }
                if (editor.selection.isEmpty) {
                    vscode.window.showErrorMessage('No expression selected for extraction');
                    return;
                }
                await this.extractVariable(editor.document.uri, editor.selection);
            }),

            vscode.commands.registerCommand('tcl.inlineVariable', async () => {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    vscode.window.showErrorMessage('No active editor');
                    return;
                }
                await this.inlineVariable(editor.document.uri, editor.selection.active);
            })
        );
    }
}