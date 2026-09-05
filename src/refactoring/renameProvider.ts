import * as vscode from 'vscode';
import { TCL_BUILTIN_COMMANDS } from '../data/tclCommands';
import { SymbolTableCache } from '../analysis/symbolTableCache';
import { DocumentSymbolTable } from '../analysis/symbolTable';
import { commandContexts, procedureDeclarations, resolveProcedureName } from '../analysis/procedures';
import { isStaticWord } from '../utils/tclParser';

export class TclRenameProvider implements vscode.RenameProvider {
    
    constructor(private symbolTableCache?: SymbolTableCache) {}
    
    public async provideRenameEdits(
        document: vscode.TextDocument,
        position: vscode.Position,
        newName: string,
        _token: vscode.CancellationToken
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
        if (this.isBuiltinCommandInContext(document, wordRange.start, oldName)) {
            throw new Error(`Cannot rename built-in TCL command '${oldName}'`);
        }

        // Validate the new name
        if (!this.isValidTclIdentifier(newName)) {
            throw new Error('New name is not a valid TCL identifier');
        }

        // Determine the type of symbol being renamed
        const symbolType = await this.getSymbolType(document, wordRange.start, oldName);
        
        if (!symbolType) {
            throw new Error('Cannot determine symbol type for renaming');
        }

        // Find all references to rename
        const edit = new vscode.WorkspaceEdit();
        
        if (symbolType === 'procedure') {
            await this.renameProcedure(document, wordRange.start, oldName, newName, edit);
        } else if (symbolType === 'variable') {
            await this.renameVariable(document, wordRange.start, oldName, newName, edit);
        } else if (symbolType === 'namespace') {
            await this.renameNamespace(document, oldName, newName, edit);
        }

        return edit;
    }

    public prepareRename(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
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
        if (this.isBuiltinCommandInContext(document, wordRange.start, word)) {
            throw new Error(`Cannot rename built-in TCL command '${word}'`);
        }

        return {
            range: wordRange,
            placeholder: word
        };
    }

    private isValidTclIdentifier(name: string): boolean {
        // TCL identifiers can contain letters, digits, underscores, and colons (for namespaces)
        return /^[\p{L}\p{M}_:][\p{L}\p{M}\p{N}_:]*$/u.test(name);
    }

    private escapeRegex(lit: string): string {
        return lit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    private isBuiltinCommand(name: string): boolean {
        // Check against the list of built-in TCL commands
        return TCL_BUILTIN_COMMANDS.some(cmd => cmd.name === name);
    }

    private isBuiltinCommandInContext(document: vscode.TextDocument, wordStartPosition: vscode.Position, word: string): boolean {
        // First check if it's a built-in command
        if (!this.isBuiltinCommand(word)) {
            return false;
        }

        // Check the context to see if it's being used as a command
        const line = document.lineAt(wordStartPosition.line);
        const lineText = line.text;
        const wordStart = wordStartPosition.character;
        
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
        if (beforeWord === '' || beforeWord.endsWith(';')) {
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
        wordStartPosition: vscode.Position,
        symbolName: string
    ): Promise<string | null> {
        
        const table = this.getSymbolTable(document);
        const symbol = table.getSymbolAt(wordStartPosition);
        if (symbol) return symbol.kind === 'procedure' ? 'procedure' : 'variable';
        const offset = document.offsetAt(wordStartPosition);
        if (commandContexts(document.getText()).some(context => {
            const command = context.command.words[0];
            return isStaticWord(command) && command.contentStart <= offset && offset <= command.contentEnd;
        })) return 'procedure';
        const line = document.lineAt(wordStartPosition.line);
        const lineText = line.text;
        const wordStart = wordStartPosition.character;
        const escaped = this.escapeRegex(symbolName);

        // Check context to determine symbol type
        
        // Check if it's a procedure definition
        const procDefPattern = new RegExp(`\\bproc\\s+${escaped}\\b`);
        if (procDefPattern.test(lineText)) {
            return 'procedure';
        }

        // Check if it's a procedure call (at the beginning of a command)
        const procCallPattern = new RegExp(`^\\s*${escaped}\\b`);
        if (procCallPattern.test(lineText)) {
            return 'procedure';
        }

        // Check if it's a variable (preceded by $)
        if (wordStart > 0 && lineText[wordStart - 1] === '$') {
            return 'variable';
        }

        // Check if it's a variable assignment
        const varAssignPattern = new RegExp(`\\bset\\s+${escaped}\\b`);
        if (varAssignPattern.test(lineText)) {
            return 'variable';
        }

        // Check if it's a namespace
        const namespacePattern = new RegExp(`\\bnamespace\\s+(create|eval)\\s+${escaped}\\b`);
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
        const escaped = this.escapeRegex(procName);
        const procPattern = new RegExp(`\\bproc\\s+${escaped}\\b`, 'g');
        return procPattern.test(text);
    }

    private async renameProcedure(
        document: vscode.TextDocument,
        position: vscode.Position,
        oldName: string,
        newName: string,
        edit: vscode.WorkspaceEdit
    ): Promise<void> {
        const documents = [document];
        for (const uri of await vscode.workspace.findFiles('**/*.{tcl,tk,tm,test}', '**/node_modules/**')) {
            if (uri.toString() !== document.uri.toString()) documents.push(await vscode.workspace.openTextDocument(uri));
        }
        const definitions = new Set(documents.flatMap(doc => procedureDeclarations(doc.getText()).map(p => p.qualifiedName)));
        const cursor = document.offsetAt(position);
        const occurrences: { doc: vscode.TextDocument; start: number; end: number; name: string; target: string }[] = [];
        for (const doc of documents) {
            const text = doc.getText();
            const declarations = procedureDeclarations(text);
            for (const declaration of declarations) {
                const word = declaration.command.words[1];
                occurrences.push({ doc, start: word.contentStart, end: word.contentEnd, name: word.value, target: declaration.qualifiedName });
            }
            for (const context of commandContexts(text)) {
                const word = context.command.words[0];
                if (!isStaticWord(word)) continue;
                const target = resolveProcedureName(word.value, context.namespace, definitions);
                if (target) occurrences.push({ doc, start: word.contentStart, end: word.contentEnd, name: word.value, target });
            }
        }
        const selected = occurrences.find(o => o.doc === document && o.start <= cursor && cursor <= o.end);
        if (!selected) throw new Error('Cannot resolve a procedure at the selected position');
        if (newName.includes('::')) throw new Error('Rename the procedure within its current namespace; moving namespaces is a separate refactoring');
        for (const occurrence of occurrences) {
            if (occurrence.target !== selected.target) continue;
            const shortName = occurrence.name.slice(occurrence.name.lastIndexOf('::') + 2);
            const length = occurrence.name.includes('::') ? shortName.length : occurrence.name.length;
            edit.replace(occurrence.doc.uri, new vscode.Range(occurrence.doc.positionAt(occurrence.end - length), occurrence.doc.positionAt(occurrence.end)), newName);
        }
    }

    private getSymbolTable(document: vscode.TextDocument): DocumentSymbolTable {
        if (this.symbolTableCache) return this.symbolTableCache.getOrCreate(document);
        const table = new DocumentSymbolTable(document);
        table.parse();
        return table;
    }

    private async renameVariable(
        document: vscode.TextDocument,
        position: vscode.Position,
        oldName: string,
        newName: string,
        edit: vscode.WorkspaceEdit
    ): Promise<void> {
        const table = this.getSymbolTable(document);
        const symbol = table.getSymbolAt(position);
        if (!symbol || symbol.kind === 'procedure') throw new Error('Cannot resolve a variable binding at the selected position');
        if (newName.includes('::')) throw new Error('Renaming a variable cannot change its scope');
        const ranges = [symbol.range, ...symbol.references];
        for (const range of ranges) {
            const original = document.getText(range);
            const prefixLength = original.includes('::') ? original.lastIndexOf('::') + 2 : 0;
            const start = document.positionAt(document.offsetAt(range.start) + prefixLength);
            edit.replace(document.uri, new vscode.Range(start, range.end), newName);
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
        const escaped = this.escapeRegex(oldName);
        
        for (const file of files) {
            const doc = await vscode.workspace.openTextDocument(file);
            const text = doc.getText();
            const lines = text.split('\n');
            
            for (let lineNum = 0; lineNum < lines.length; lineNum++) {
                const line = lines[lineNum];
                
                // Find namespace definitions
                const nsDefPattern = new RegExp(`\\bnamespace\\s+(create|eval)\\s+${escaped}\\b`, 'g');
                let match;
                while ((match = nsDefPattern.exec(line)) !== null) {
                    const startPos = new vscode.Position(lineNum, match.index + match[0].indexOf(oldName));
                    const endPos = new vscode.Position(lineNum, startPos.character + oldName.length);
                    edit.replace(doc.uri, new vscode.Range(startPos, endPos), newName);
                }

                // Find qualified names using the namespace
                const qualifiedPattern = new RegExp(`\\b${escaped}::[a-zA-Z_][a-zA-Z0-9_]*`, 'g');
                while ((match = qualifiedPattern.exec(line)) !== null) {
                    const startPos = new vscode.Position(lineNum, match.index);
                    const endPos = new vscode.Position(lineNum, startPos.character + oldName.length);
                    edit.replace(doc.uri, new vscode.Range(startPos, endPos), newName);
                }

                // Find namespace current/which commands
                const nsCmdPattern = new RegExp(`\\bnamespace\\s+(current|which).*${escaped}`, 'g');
                while ((match = nsCmdPattern.exec(line)) !== null) {
                    const nameMatch = line.substring(match.index).match(new RegExp(`\\b${escaped}\\b`));
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
