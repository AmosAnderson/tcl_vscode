import * as vscode from 'vscode';
import { TCL_BUILTIN_COMMANDS } from '../data/tclCommands';

export class TclRenameProvider implements vscode.RenameProvider {
    
    public async provideRenameEdits(
        document: vscode.TextDocument,
        position: vscode.Position,
        newName: string,
        token: vscode.CancellationToken
    ): Promise<vscode.WorkspaceEdit | null> {
        
        let wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return null;
        }

        // Support variable references that include leading '$'
        let oldName = document.getText(wordRange);
        if (oldName.startsWith('$') && oldName.length > 1) {
            // Adjust range to exclude '$'
            const adjustedStart = new vscode.Position(wordRange.start.line, wordRange.start.character + 1);
            wordRange = new vscode.Range(adjustedStart, wordRange.end);
            oldName = oldName.substring(1);
        }

        // Validate the old name is a valid TCL identifier
        if (!this.isValidTclIdentifier(oldName)) {
            throw new Error('Selected text is not a valid TCL identifier');
        }

        // Check if it's a built-in TCL command being used as a command
        if (this.isBuiltinCommandInContext(document, position, oldName)) {
            throw new Error(`Cannot rename built-in TCL command '${oldName}'`);
        }

        // Validate the new name
        if (!this.isValidTclIdentifier(newName)) {
            throw new Error('New name is not a valid TCL identifier');
        }

        // Determine the type of symbol being renamed
        const symbolType = await this.getSymbolType(document, position, oldName);
        
        if (!symbolType) {
            throw new Error('Cannot determine symbol type for renaming');
        }

        // Find all references to rename
        const edit = new vscode.WorkspaceEdit();
        
        if (symbolType === 'procedure') {
            await this.renameProcedure(document, oldName, newName, edit);
        } else if (symbolType === 'variable') {
            await this.renameVariable(document, oldName, newName, edit);
        } else if (symbolType === 'namespace') {
            await this.renameNamespace(document, oldName, newName, edit);
        }

        return edit;
    }

    public prepareRename(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Range | { range: vscode.Range; placeholder: string }> {
        
        let wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            throw new Error('Nothing to rename here');
        }

        let word = document.getText(wordRange);
        if (word.startsWith('$') && word.length > 1) {
            const adjustedStart = new vscode.Position(wordRange.start.line, wordRange.start.character + 1);
            wordRange = new vscode.Range(adjustedStart, wordRange.end);
            word = word.substring(1);
        }

        if (!this.isValidTclIdentifier(word)) {
            throw new Error('Selected text is not a valid TCL identifier');
        }

        // Check if it's a built-in TCL command being used as a command
        if (this.isBuiltinCommandInContext(document, position, word)) {
            throw new Error(`Cannot rename built-in TCL command '${word}'`);
        }

        return {
            range: wordRange,
            placeholder: word
        };
    }

    private isValidTclIdentifier(name: string): boolean {
        // TCL identifiers can contain letters, digits, underscores, and colons (for namespaces)
        return /^[a-zA-Z_:][a-zA-Z0-9_:]*$/.test(name);
    }

    private isBuiltinCommand(name: string): boolean {
        // Check against the list of built-in TCL commands
        return TCL_BUILTIN_COMMANDS.some(cmd => cmd.name === name);
    }

    private isBuiltinCommandInContext(document: vscode.TextDocument, position: vscode.Position, word: string): boolean {
        // First check if it's a built-in command
        if (!this.isBuiltinCommand(word)) {
            return false;
        }

        // Check the context to see if it's being used as a command
        const line = document.lineAt(position.line);
        const lineText = line.text;
        const wordStart = position.character;
        const wordEnd = wordStart + word.length;
        
        // Don't prevent renaming if it's a variable reference (preceded by $)
        if (wordStart > 0 && lineText[wordStart - 1] === '$') {
            return false;
        }

        // Don't prevent renaming if it's in a string literal
        if (this.isInStringLiteral(lineText, wordStart)) {
            return false;
        }

        // Don't prevent renaming if it's after "set" (variable assignment)
        const setPattern = new RegExp(`\\bset\\s+${word}\\b`);
        if (setPattern.test(lineText)) {
            return false;
        }

        // Check if it's at the beginning of a command
        const beforeWord = lineText.substring(0, wordStart).trim();
        
        // Command at start of line or after command separator
        if (beforeWord === '' || beforeWord.endsWith(';') || beforeWord.endsWith('\n')) {
            return true;
        }

        // Command after control structure keywords
        const controlKeywords = /\b(if|while|for|foreach|catch|switch)\s*\{[^}]*$/;
        if (controlKeywords.test(beforeWord)) {
            return true;
        }

        // Command in brackets (command substitution)
        const bracketPattern = /\[[^\]]*$/;
        if (bracketPattern.test(beforeWord)) {
            return true;
        }

        return false;
    }

    private isInStringLiteral(lineText: string, position: number): boolean {
        let inQuotes = false;
        let inBraces = 0;
        
        for (let i = 0; i < position; i++) {
            const char = lineText[i];
            const prevChar = i > 0 ? lineText[i - 1] : '';
            
            if (char === '"' && prevChar !== '\\') {
                inQuotes = !inQuotes;
            } else if (char === '{' && !inQuotes) {
                inBraces++;
            } else if (char === '}' && !inQuotes) {
                inBraces--;
            }
        }
        
        return inQuotes || inBraces > 0;
    }

    private async getSymbolType(
        document: vscode.TextDocument,
        position: vscode.Position,
        symbolName: string
    ): Promise<string | null> {
        
        const line = document.lineAt(position.line);
        const lineText = line.text;
        const wordStart = position.character - symbolName.length;

        // Check context to determine symbol type
        
        // Check if it's a procedure definition
        const procDefPattern = new RegExp(`\\bproc\\s+${symbolName}\\b`);
        if (procDefPattern.test(lineText)) {
            return 'procedure';
        }

        // Check if it's a procedure call (at the beginning of a command)
        const procCallPattern = new RegExp(`^\\s*${symbolName}\\b`);
        if (procCallPattern.test(lineText)) {
            return 'procedure';
        }

        // Check if it's a variable (preceded by $)
        if (wordStart > 0 && lineText[wordStart - 1] === '$') {
            return 'variable';
        }

        // Check if it's a variable assignment
        const varAssignPattern = new RegExp(`\\bset\\s+${symbolName}\\b`);
        if (varAssignPattern.test(lineText)) {
            return 'variable';
        }

        // Check if it's a namespace
        const namespacePattern = new RegExp(`\\bnamespace\\s+(create|eval)\\s+${symbolName}\\b`);
        if (namespacePattern.test(lineText)) {
            return 'namespace';
        }

        // Look for procedure definition in the document
        if (await this.findProcedureDefinition(document, symbolName)) {
            return 'procedure';
        }

        // Default to variable if we can't determine
        return 'variable';
    }

    private async findProcedureDefinition(
        document: vscode.TextDocument,
        procName: string
    ): Promise<boolean> {
        const text = document.getText();
        const procPattern = new RegExp(`\\bproc\\s+${procName}\\b`, 'g');
        return procPattern.test(text);
    }

    private async renameProcedure(
        document: vscode.TextDocument,
        oldName: string,
        newName: string,
        edit: vscode.WorkspaceEdit
    ): Promise<void> {
        // Collect unique replacement ranges to avoid overlapping/duplicate edits.
        interface Replacement { uri: vscode.Uri; range: vscode.Range; }
        const seen = new Set<string>();
        const replacements: Replacement[] = [];

        const addReplacement = (uri: vscode.Uri, startPos: vscode.Position, endPos: vscode.Position) => {
            const key = `${uri.toString()}|${startPos.line}|${startPos.character}|${endPos.character}`;
            if (!seen.has(key)) {
                seen.add(key);
                replacements.push({ uri, range: new vscode.Range(startPos, endPos) });
            }
        };

        const scanDocument = (doc: vscode.TextDocument) => {
            const lines = doc.getText().split('\n');
            for (let lineNum = 0; lineNum < lines.length; lineNum++) {
                const line = lines[lineNum];
                // Definitions
                const procDefPattern = new RegExp(`\\bproc\\s+${oldName}\\b`, 'g');
                let match: RegExpExecArray | null;
                while ((match = procDefPattern.exec(line)) !== null) {
                    const startPos = new vscode.Position(lineNum, match.index + match[0].lastIndexOf(oldName));
                    const endPos = new vscode.Position(lineNum, startPos.character + oldName.length);
                    addReplacement(doc.uri, startPos, endPos);
                }
                // Calls (allow after whitespace, semicolon, brace, bracket)
                const procCallPattern = new RegExp(`(^|[\n\r\t ;\\[{])${oldName}\\b`, 'g');
                while ((match = procCallPattern.exec(line)) !== null) {
                    // Check if this is part of a proc definition by looking at more context
                    const lineStart = Math.max(0, match.index - 10);
                    const context = line.substring(lineStart, match.index).toLowerCase();
                    if (/proc\s+$/.test(context)) continue;
                    const offset = match[1] ? match[1].length : 0;
                    const startPos = new vscode.Position(lineNum, match.index + offset);
                    const endPos = new vscode.Position(lineNum, startPos.character + oldName.length);
                    addReplacement(doc.uri, startPos, endPos);
                }
            }
        };

        // Scan current document (even if unsaved / untitled)
        scanDocument(document);

        // Scan workspace files
        const files = await vscode.workspace.findFiles('**/*.{tcl,tk,tm,test}');
        for (const file of files) {
            if (file.toString() === document.uri.toString()) continue;
            const doc = await vscode.workspace.openTextDocument(file);
            scanDocument(doc);
        }

        // Apply edits
        for (const rep of replacements) {
            edit.replace(rep.uri, rep.range, newName);
        }
    }

    private async renameVariable(
        document: vscode.TextDocument,
        oldName: string,
        newName: string,
        edit: vscode.WorkspaceEdit
    ): Promise<void> {

        // For variables, we typically only rename within the current file/scope
        // unless it's a global variable

        // Track replacements to avoid duplicates
        const seen = new Set<string>();
        const addReplacement = (lineNum: number, startChar: number, endChar: number) => {
            const key = `${lineNum}|${startChar}|${endChar}`;
            if (!seen.has(key)) {
                seen.add(key);
                const startPos = new vscode.Position(lineNum, startChar);
                const endPos = new vscode.Position(lineNum, endChar);
                edit.replace(document.uri, new vscode.Range(startPos, endPos), newName);
            }
        };

        const text = document.getText();
        const lines = text.split('\n');

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const line = lines[lineNum];

            // Find variable assignments (set command)
            const setPattern = new RegExp(`\\bset\\s+(${oldName})\\b`, 'g');
            let match;
            while ((match = setPattern.exec(line)) !== null) {
                const startChar = match.index + match[0].indexOf(oldName);
                addReplacement(lineNum, startChar, startChar + oldName.length);
            }

            // Find variable references ($ prefix) - but not array references
            const varRefPattern = new RegExp(`\\$${oldName}\\b`, 'g');
            while ((match = varRefPattern.exec(line)) !== null) {
                const startChar = match.index + 1; // Skip the $
                addReplacement(lineNum, startChar, startChar + oldName.length);
            }

            // Find array variable references
            const arrayRefPattern = new RegExp(`\\$${oldName}\\(`, 'g');
            while ((match = arrayRefPattern.exec(line)) !== null) {
                const startChar = match.index + 1; // Skip the $
                addReplacement(lineNum, startChar, startChar + oldName.length);
            }

            // Find other variable-related commands (global, variable, upvar, etc.)
            const varCmdPattern = new RegExp(`\\b(global|variable|upvar)\\s+.*\\b${oldName}\\b`, 'g');
            while ((match = varCmdPattern.exec(line)) !== null) {
                const nameMatch = line.substring(match.index).match(new RegExp(`\\b${oldName}\\b`));
                if (nameMatch && nameMatch.index !== undefined) {
                    const startChar = match.index + nameMatch.index;
                    addReplacement(lineNum, startChar, startChar + oldName.length);
                }
            }
        }
    }

    private async renameNamespace(
        document: vscode.TextDocument,
        oldName: string,
        newName: string,
        edit: vscode.WorkspaceEdit
    ): Promise<void> {
        
        // Find all references across the workspace for namespaces
        const files = await vscode.workspace.findFiles('**/*.{tcl,tk,tm,test}');
        
        for (const file of files) {
            const doc = await vscode.workspace.openTextDocument(file);
            const text = doc.getText();
            const lines = text.split('\n');
            
            for (let lineNum = 0; lineNum < lines.length; lineNum++) {
                const line = lines[lineNum];
                
                // Find namespace definitions
                const nsDefPattern = new RegExp(`\\bnamespace\\s+(create|eval)\\s+${oldName}\\b`, 'g');
                let match;
                while ((match = nsDefPattern.exec(line)) !== null) {
                    const startPos = new vscode.Position(lineNum, match.index + match[0].indexOf(oldName));
                    const endPos = new vscode.Position(lineNum, startPos.character + oldName.length);
                    edit.replace(doc.uri, new vscode.Range(startPos, endPos), newName);
                }

                // Find qualified names using the namespace
                const qualifiedPattern = new RegExp(`\\b${oldName}::[a-zA-Z_][a-zA-Z0-9_]*`, 'g');
                while ((match = qualifiedPattern.exec(line)) !== null) {
                    const startPos = new vscode.Position(lineNum, match.index);
                    const endPos = new vscode.Position(lineNum, startPos.character + oldName.length);
                    edit.replace(doc.uri, new vscode.Range(startPos, endPos), newName);
                }

                // Find namespace current/which commands
                const nsCmdPattern = new RegExp(`\\bnamespace\\s+(current|which).*${oldName}`, 'g');
                while ((match = nsCmdPattern.exec(line)) !== null) {
                    const nameMatch = line.substring(match.index).match(new RegExp(`\\b${oldName}\\b`));
                    if (nameMatch) {
                        const startPos = new vscode.Position(lineNum, match.index + nameMatch.index!);
                        const endPos = new vscode.Position(lineNum, startPos.character + oldName.length);
                        edit.replace(doc.uri, new vscode.Range(startPos, endPos), newName);
                    }
                }
            }
        }
    }
}