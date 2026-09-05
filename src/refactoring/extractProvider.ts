import * as vscode from 'vscode';
import { TCL_BUILTIN_COMMANDS } from '../data/tclCommands';
import { escapeTclString } from '../utils/tclUtils';
import { DocumentSymbolTable } from '../analysis/symbolTable';
import { commandContexts, procedureDeclarations, resolveProcedureName } from '../analysis/procedures';
import { isStaticWord, parseTclScript, walkTclCommands } from '../utils/tclParser';

export class TclExtractProvider implements vscode.CodeActionProvider {
    
    private static readonly builtinNames = new Set(
        TCL_BUILTIN_COMMANDS.map(cmd => cmd.name)
    );

    public provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        _context: vscode.CodeActionContext,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<(vscode.Command | vscode.CodeAction)[]> {
        
        const actions: vscode.CodeAction[] = [];

        // Only provide extract actions if there's a selection
        if (range instanceof vscode.Selection && !range.isEmpty) {
            actions.push(this.createExtractProcedureAction(document, range));
            actions.push(this.createExtractVariableAction(document, range));
        }

        // Provide inline procedure action when cursor is on a word (procedure call)
        const wordRange = document.getWordRangeAtPosition(range.start);
        if (wordRange) {
            const word = document.getText(wordRange);
            if (!TclExtractProvider.builtinNames.has(word)) {
                actions.push(this.createInlineProcedureAction(document, range));
            }
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

    private createInlineProcedureAction(_document: vscode.TextDocument, _range: vscode.Range | vscode.Selection): vscode.CodeAction {
        const action = new vscode.CodeAction(
            'Inline Procedure',
            vscode.CodeActionKind.RefactorInline
        );

        action.command = {
            command: 'tcl.inlineProcedure',
            title: 'Inline Procedure'
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
            const edit = this.createProcedureExtractionEdit(document, range, procedureName.trim());
            // Apply the edit
            await vscode.workspace.applyEdit(edit);
            
            vscode.window.showInformationMessage(`Procedure '${procedureName}' extracted successfully`);
            
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to extract procedure: ${error}`);
        }
    }

    public createProcedureExtractionEdit(document: vscode.TextDocument, range: vscode.Selection, name: string): vscode.WorkspaceEdit {
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error('Invalid procedure name');
        if (procedureDeclarations(document.getText()).some(declaration => declaration.name === name)) throw new Error('A procedure with this name already exists');
        const selectedText = document.getText(range);
        const analysis = this.analyzeCodeForExtraction(document, selectedText, range);
        const procedure = this.generateProcedure(name, analysis.parameters, selectedText, analysis.returnValue);
        const edit = new vscode.WorkspaceEdit();
        edit.insert(document.uri, this.findInsertPosition(document, range), procedure + '\n\n');
        edit.replace(document.uri, range, this.generateProcedureCall(name, analysis.parameters, analysis.returnValue));
        return edit;
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

        const variableName = document.getText(wordRange);
        
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

    public async inlineProcedure(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { vscode.window.showErrorMessage('No active editor'); return; }
        try {
            const edit = await this.provideInlineEdits(editor.document, editor.selection.active);
            await vscode.workspace.applyEdit(edit);
            vscode.window.showInformationMessage('Procedure inlined successfully');
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to inline procedure: ${error}`);
        }
    }

    public async provideInlineEdits(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.WorkspaceEdit> {
        const text = document.getText();
        const offset = document.offsetAt(position);
        const call = commandContexts(text).find(context => {
            const word = context.command.words[0];
            return isStaticWord(word) && word.contentStart <= offset && offset <= word.contentEnd;
        });
        if (!call) throw new Error('Select a procedure call to inline');
        const declarations = procedureDeclarations(text);
        for (const uri of await vscode.workspace.findFiles('**/*.{tcl,tk,tm,test}', '**/node_modules/**')) {
            if (uri.toString() === document.uri.toString()) continue;
            const other = await vscode.workspace.openTextDocument(uri);
            declarations.push(...procedureDeclarations(other.getText()));
        }
        const names = new Set(declarations.map(declaration => declaration.qualifiedName));
        const target = resolveProcedureName(call.command.words[0].value, call.namespace, names);
        const matches = declarations.filter(declaration => declaration.qualifiedName === target);
        if (matches.length !== 1) throw new Error('The procedure definition is missing or ambiguous');
        const definition = matches[0];
        // apply creates the same argument bindings and local variable frame as proc.
        // Keep the original argument source so each argument is evaluated exactly once.
        // Relative commands and namespace variables resolve in the definition namespace.
        const namespace = definition.qualifiedName.slice(0, definition.qualifiedName.lastIndexOf('::')) || '::';
        const lambda = `[list ${definition.params.text} ${definition.body.text} "${escapeTclString(namespace)}"]`;
        const args = text.slice(call.command.words[0].end, call.command.end);
        const replacement = `::apply ${lambda}${args}`;
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, new vscode.Range(document.positionAt(call.command.start), document.positionAt(call.command.end)), replacement);
        return edit;
    }

    private analyzeCodeForExtraction(document: vscode.TextDocument, code: string, range: vscode.Selection): {
        parameters: string[];
        returnValue: string | null;
    } {
        const selectedStart = document.offsetAt(range.start);
        const selectedEnd = document.offsetAt(range.end);
        const table = new DocumentSymbolTable(document);
        table.parse();
        const parameters: string[] = [];
        const outputs: string[] = [];
        const inside = (candidate: vscode.Range): boolean => document.offsetAt(candidate.start) >= selectedStart && document.offsetAt(candidate.end) <= selectedEnd;
        for (const symbol of table.getVisibleSymbols(range.start)) {
            if (symbol.kind === 'procedure') continue;
            const occurrences = [symbol.range, ...symbol.references];
            if (!occurrences.some(inside)) continue;
            // Reference parameters are linked in the new frame, preserving scalar/array
            // bindings and every mutation without guessing a single return value.
            if (!inside(symbol.range)) parameters.push(symbol.name);
            else if (occurrences.some(candidate => document.offsetAt(candidate.start) >= selectedEnd)) outputs.push(symbol.name);
        }
        for (const usage of table.getVariableUsages()) {
            if (inside(usage.range) && !usage.symbol) parameters.push(usage.name);
        }
        // Refactoring requires complete commands and caller-local control flow.
        const parsed = parseTclScript(document.getText(), selectedStart, selectedEnd);
        if (parsed.errors.length) throw new Error('Select complete Tcl commands');
        const parentCommands = walkTclCommands(document.getText());
        if (!parsed.commands.length || !parsed.commands.every(command => parentCommands.some(original => original.start === command.start && original.end === command.end))) throw new Error('Select complete Tcl commands');
        for (const command of walkTclCommands(code)) {
            if (['return', 'break', 'continue', 'uplevel', 'upvar'].includes(command.words[0]?.value)) throw new Error('The selection contains control flow that cannot be extracted safely');
        }
        // Link external and escaping bindings through upvar at the call site.
        // This includes outputs, so multiple assigned values and arrays retain behavior.
        return { parameters: [...new Set([...parameters, ...outputs])], returnValue: null };
    }

    private generateProcedure(name: string, parameters: string[], body: string, _returnValue: string | null): string {
        let prefix = '__tcl_extract_arg';
        while (body.includes(prefix) || parameters.some(parameter => parameter.startsWith(prefix))) prefix += '_';
        const args = parameters.map((_, index) => `${prefix}${index}`);
        const links = parameters.map((parameter, index) => `    upvar 1 $${args[index]} ${parameter}`).join('\n');
        const indentedBody = body;
        return `proc ${name} {${args.join(' ')}} {\n${links ? links + '\n' : ''}${indentedBody}\n}`;
    }

    private generateProcedureCall(name: string, parameters: string[], _returnValue: string | null): string {
        return [name, ...parameters].join(' ');
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
            }),

            vscode.commands.registerCommand('tcl.inlineProcedure', async () => {
                await this.inlineProcedure();
            })
        );
    }
}