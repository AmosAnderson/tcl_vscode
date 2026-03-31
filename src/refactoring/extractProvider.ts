import * as vscode from 'vscode';
import { TCL_BUILTIN_COMMANDS } from '../data/tclCommands';
import { escapeRegex, findMatchingBrace } from '../utils/tclUtils';

export class TclExtractProvider implements vscode.CodeActionProvider {
    
    private static readonly builtinNames = new Set(
        TCL_BUILTIN_COMMANDS.map(cmd => cmd.name)
    );

    public provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext,
        token: vscode.CancellationToken
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

    private createInlineProcedureAction(document: vscode.TextDocument, range: vscode.Range | vscode.Selection): vscode.CodeAction {
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

    public async inlineProcedure(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor');
            return;
        }

        const document = editor.document;
        const position = editor.selection.active;
        const wordRange = document.getWordRangeAtPosition(position);

        if (!wordRange) {
            vscode.window.showErrorMessage('No procedure name under cursor');
            return;
        }

        const procName = document.getText(wordRange);

        // Reject built-in commands
        if (TclExtractProvider.builtinNames.has(procName)) {
            vscode.window.showInformationMessage(`'${procName}' is a built-in TCL command and cannot be inlined`);
            return;
        }

        try {
            // Find the procedure definition
            const procDef = this.findProcDefinition(document, procName)
                ?? await this.findProcDefinitionInWorkspace(procName, document.uri);

            if (!procDef) {
                vscode.window.showErrorMessage(`Cannot find definition for procedure '${procName}'`);
                return;
            }

            // Safety check: reject procs that use upvar/uplevel/global
            const unsafePattern = /\b(upvar|uplevel|global)\b/;
            if (unsafePattern.test(procDef.body)) {
                vscode.window.showWarningMessage(
                    `Procedure '${procName}' uses upvar, uplevel, or global and cannot be safely inlined`
                );
                return;
            }

            // Parse the call site to extract actual arguments
            const callLine = document.lineAt(position.line).text;
            const callArgs = this.parseCallSiteArguments(callLine, procName);

            if (callArgs === null) {
                vscode.window.showErrorMessage(`Cannot parse arguments at the call site for '${procName}'`);
                return;
            }

            if (callArgs.length !== procDef.params.length) {
                vscode.window.showErrorMessage(
                    `Argument count mismatch: '${procName}' expects ${procDef.params.length} argument(s) but got ${callArgs.length}`
                );
                return;
            }

            // Substitute parameters in the body
            let inlinedBody = procDef.body;
            for (let i = 0; i < procDef.params.length; i++) {
                const paramName = procDef.params[i];
                const argValue = callArgs[i];
                const paramPattern = new RegExp(`\\$${escapeRegex(paramName)}\\b`, 'g');
                inlinedBody = inlinedBody.replace(paramPattern, argValue);
            }

            // Determine the full call range on the line
            const callRange = this.findCallRange(document, position.line, procName);
            if (!callRange) {
                vscode.window.showErrorMessage(`Cannot determine the call expression for '${procName}'`);
                return;
            }

            // Check if the call is in a set assignment: set x [procName args]
            const setAssignMatch = callLine.match(
                new RegExp(`^(\\s*)set\\s+(\\S+)\\s+\\[${escapeRegex(procName)}\\b[^\\]]*\\]\\s*$`)
            );

            const edit = new vscode.WorkspaceEdit();
            const lineRange = new vscode.Range(
                position.line, 0,
                position.line, callLine.length
            );

            if (setAssignMatch) {
                const indent = setAssignMatch[1];
                const targetVar = setAssignMatch[2];
                // Replace "return <value>" with "set <targetVar> <value>"
                const transformed = this.transformReturnForAssignment(inlinedBody, targetVar, indent);
                edit.replace(document.uri, lineRange, transformed);
            } else {
                // Simple inline: replace the call range with the body
                const indent = callLine.match(/^(\s*)/)?.[1] ?? '';
                const transformed = this.indentBody(this.stripTrailingReturn(inlinedBody), indent);
                edit.replace(document.uri, callRange, transformed);
            }

            await vscode.workspace.applyEdit(edit);
            vscode.window.showInformationMessage(`Procedure '${procName}' inlined successfully`);

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to inline procedure: ${error}`);
        }
    }

    private findProcDefinition(
        document: vscode.TextDocument, procName: string
    ): { params: string[]; body: string } | null {
        const text = document.getText();
        return this.extractProcParts(text, procName);
    }

    private async findProcDefinitionInWorkspace(
        procName: string, excludeUri: vscode.Uri
    ): Promise<{ params: string[]; body: string } | null> {
        const files = await vscode.workspace.findFiles('**/*.{tcl,tk,tm}', '**/node_modules/**');

        for (const file of files) {
            if (file.toString() === excludeUri.toString()) {
                continue;
            }
            try {
                const doc = await vscode.workspace.openTextDocument(file);
                const result = this.extractProcParts(doc.getText(), procName);
                if (result) {
                    return result;
                }
            } catch {
                continue;
            }
        }
        return null;
    }

    /**
     * Extract parameter names and body from a `proc` definition in raw text.
     * Handles brace-delimited bodies with nested braces.
     */
    private extractProcParts(
        text: string, procName: string
    ): { params: string[]; body: string } | null {
        const name = escapeRegex(procName);
        // Find the proc header: proc <name> {params}
        const headerRegex = new RegExp(`\\bproc\\s+${name}\\s+\\{([^}]*)\\}\\s*\\{`);
        const headerMatch = headerRegex.exec(text);
        if (!headerMatch) {
            return null;
        }

        // Parse params respecting braces (e.g., {c default} → param name "c")
        const rawParams = headerMatch[1].trim();
        const params: string[] = [];
        let pi = 0;
        while (pi < rawParams.length) {
            if (rawParams[pi] === '{') {
                const close = rawParams.indexOf('}', pi);
                if (close === -1) { break; }
                const inner = rawParams.substring(pi + 1, close).trim();
                const paramName = inner.split(/\s+/)[0];
                if (paramName) { params.push(paramName); }
                pi = close + 1;
            } else if (/\s/.test(rawParams[pi])) {
                pi++;
            } else {
                const end = rawParams.substring(pi).search(/[\s{]/);
                const token = end === -1 ? rawParams.substring(pi) : rawParams.substring(pi, pi + end);
                if (token) { params.push(token); }
                pi += token.length;
            }
        }

        // Find the body using findMatchingBrace which handles strings and escapes
        const bodyOpenIdx = headerMatch.index + headerMatch[0].length - 1;
        const bodyCloseIdx = findMatchingBrace(text, bodyOpenIdx);
        if (bodyCloseIdx === -1) {
            return null;
        }

        const body = text.substring(bodyOpenIdx + 1, bodyCloseIdx).trim();
        return { params, body };
    }

    /**
     * Parse the arguments passed at a call site.
     * Handles simple words, quoted strings, bracketed expressions, and braced groups.
     */
    private parseCallSiteArguments(lineText: string, procName: string): string[] | null {
        const name = escapeRegex(procName);
        const callMatch = new RegExp(`\\b${name}\\b`).exec(lineText);
        if (!callMatch) {
            return null;
        }

        // The arguments start after the proc name
        let rest = lineText.substring(callMatch.index + callMatch[0].length);

        // Strip a trailing ']' if the call was wrapped in [...]
        const trimmed = rest.trimEnd();
        if (trimmed.endsWith(']')) {
            rest = trimmed.substring(0, trimmed.length - 1);
        }

        const args: string[] = [];
        let pos = 0;

        while (pos < rest.length) {
            // Skip whitespace
            while (pos < rest.length && /\s/.test(rest[pos])) {
                pos++;
            }
            if (pos >= rest.length) {
                break;
            }

            const ch = rest[pos];

            if (ch === '"') {
                // Quoted string
                const end = rest.indexOf('"', pos + 1);
                if (end === -1) {
                    return null;
                }
                args.push(rest.substring(pos + 1, end));
                pos = end + 1;
            } else if (ch === '{') {
                // Braced group
                let depth = 1;
                let j = pos + 1;
                while (j < rest.length && depth > 0) {
                    if (rest[j] === '{') { depth++; }
                    else if (rest[j] === '}') { depth--; }
                    j++;
                }
                args.push(rest.substring(pos + 1, j - 1));
                pos = j;
            } else if (ch === '[') {
                // Bracketed command
                let depth = 1;
                let j = pos + 1;
                while (j < rest.length && depth > 0) {
                    if (rest[j] === '[') { depth++; }
                    else if (rest[j] === ']') { depth--; }
                    j++;
                }
                args.push(rest.substring(pos, j));
                pos = j;
            } else {
                // Bare word / variable reference
                let j = pos;
                while (j < rest.length && !/\s/.test(rest[j])) {
                    j++;
                }
                args.push(rest.substring(pos, j));
                pos = j;
            }
        }

        return args;
    }

    /**
     * Find the range of the full call expression on the given line.
     * Detects both bare `procName arg ...` and bracketed `[procName arg ...]`.
     */
    private findCallRange(
        document: vscode.TextDocument, line: number, procName: string
    ): vscode.Range | null {
        const lineText = document.lineAt(line).text;
        const name = escapeRegex(procName);

        // Try bracketed call first: [procName ...]
        const bracketRegex = new RegExp(`\\[${name}\\b[^\\]]*\\]`);
        const bracketMatch = bracketRegex.exec(lineText);
        if (bracketMatch) {
            return new vscode.Range(
                line, bracketMatch.index,
                line, bracketMatch.index + bracketMatch[0].length
            );
        }

        // Bare call: procName arg1 arg2 ...  (rest of line, trimmed)
        const bareRegex = new RegExp(`\\b${name}\\b.*$`);
        const bareMatch = bareRegex.exec(lineText);
        if (bareMatch) {
            const endCol = bareMatch.index + bareMatch[0].trimEnd().length;
            return new vscode.Range(line, bareMatch.index, line, endCol);
        }

        return null;
    }

    /**
     * Transform a procedure body for a `set x [proc ...]` call site:
     * replace `return <value>` statements with `set <varName> <value>`.
     */
    private transformReturnForAssignment(body: string, varName: string, indent: string): string {
        const lines = body.split('\n');
        const result: string[] = [];

        for (const line of lines) {
            const returnMatch = line.match(/^\s*return\s+(.+)$/);
            if (returnMatch) {
                result.push(`${indent}set ${varName} ${returnMatch[1].trim()}`);
            } else {
                result.push(`${indent}${line.trim()}`);
            }
        }

        return result.join('\n');
    }

    private stripTrailingReturn(body: string): string {
        const lines = body.split('\n');
        if (lines.length > 0) {
            const lastLine = lines[lines.length - 1].trim();
            const returnMatch = lastLine.match(/^return\s+(.+)$/);
            if (returnMatch) {
                lines[lines.length - 1] = returnMatch[1].trim();
            } else if (lastLine === 'return') {
                lines.pop();
            }
        }
        return lines.join('\n');
    }

    private indentBody(body: string, indent: string): string {
        const lines = body.split('\n');
        return lines.map((line, i) => i === 0 ? line : `${indent}${line}`).join('\n');
    }

    private analyzeCodeForExtraction(document: vscode.TextDocument, code: string, range: vscode.Selection): {
        parameters: string[];
        returnValue: string | null;
    } {
        const parameters: string[] = [];
        let returnValue: string | null = null;

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

        // Check if the code sets a variable that is used after the selection
        const textAfterSelection = document.getText(new vscode.Range(range.end.line, range.end.character, document.lineCount - 1, 0));
        const setInCode = /\bset\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+/g;
        while ((match = setInCode.exec(code)) !== null) {
            const varName = match[1];
            const usedAfter = new RegExp(`\\$${varName}\\b`);
            if (usedAfter.test(textAfterSelection)) {
                returnValue = varName;
                break;
            }
        }

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
            }),

            vscode.commands.registerCommand('tcl.inlineProcedure', async () => {
                await this.inlineProcedure();
            })
        );
    }
}