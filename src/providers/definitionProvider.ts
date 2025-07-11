import * as vscode from 'vscode';

export class TclDefinitionProvider implements vscode.DefinitionProvider {
    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Location | vscode.Location[] | null> {
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return null;
        }

        const word = document.getText(wordRange);
        const line = document.lineAt(position.line).text;

        // Check if we're on a procedure call
        const procCallMatch = line.match(new RegExp(`\\b${word}\\b`));
        if (procCallMatch) {
            // First try to find in current document
            const currentDocLocation = this.findProcedureInDocument(document, word);
            if (currentDocLocation) {
                return currentDocLocation;
            }

            // Then search in workspace
            const workspaceLocations = await this.findProcedureInWorkspace(word);
            if (workspaceLocations.length > 0) {
                return workspaceLocations;
            }
        }

        // Check if we're on a namespace reference
        const nsMatch = line.match(new RegExp(`::${word}\\b`));
        if (nsMatch) {
            const nsLocation = await this.findNamespaceInWorkspace(word);
            if (nsLocation) {
                return nsLocation;
            }
        }

        return null;
    }

    private findProcedureInDocument(document: vscode.TextDocument, procName: string): vscode.Location | null {
        const text = document.getText();
        const procRegex = new RegExp(`\\bproc\\s+(${procName})\\s*{`, 'g');
        const match = procRegex.exec(text);
        
        if (match) {
            const position = document.positionAt(match.index);
            const range = new vscode.Range(position, position);
            return new vscode.Location(document.uri, range);
        }
        
        return null;
    }

    private async findProcedureInWorkspace(procName: string): Promise<vscode.Location[]> {
        const locations: vscode.Location[] = [];
        const files = await vscode.workspace.findFiles('**/*.{tcl,tk,tm}', '**/node_modules/**');
        
        for (const file of files) {
            try {
                const document = await vscode.workspace.openTextDocument(file);
                const text = document.getText();
                
                const procRegex = new RegExp(`\\bproc\\s+(${procName})\\s*{`, 'g');
                let match;
                
                while ((match = procRegex.exec(text)) !== null) {
                    const position = document.positionAt(match.index);
                    const range = new vscode.Range(position, position);
                    locations.push(new vscode.Location(file, range));
                }
            } catch (error) {
                // Skip files that can't be opened
                continue;
            }
        }
        
        return locations;
    }

    private async findNamespaceInWorkspace(nsName: string): Promise<vscode.Location | null> {
        const files = await vscode.workspace.findFiles('**/*.{tcl,tk,tm}', '**/node_modules/**');
        
        for (const file of files) {
            try {
                const document = await vscode.workspace.openTextDocument(file);
                const text = document.getText();
                
                const nsRegex = new RegExp(`namespace\\s+eval\\s+(::)?${nsName}\\s*{`, 'g');
                const match = nsRegex.exec(text);
                
                if (match) {
                    const position = document.positionAt(match.index);
                    const range = new vscode.Range(position, position);
                    return new vscode.Location(file, range);
                }
            } catch (error) {
                // Skip files that can't be opened
                continue;
            }
        }
        
        return null;
    }
}

export class TclReferenceProvider implements vscode.ReferenceProvider {
    async provideReferences(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.ReferenceContext,
        token: vscode.CancellationToken
    ): Promise<vscode.Location[]> {
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return [];
        }

        const word = document.getText(wordRange);
        const references: vscode.Location[] = [];

        // Check if we're on a procedure definition
        const line = document.lineAt(position.line).text;
        const procDefMatch = line.match(new RegExp(`\\bproc\\s+(${word})\\s*{`));
        
        if (procDefMatch) {
            // Find all references to this procedure
            const procReferences = await this.findProcedureReferences(word);
            references.push(...procReferences);
            
            // Include the definition if requested
            if (context.includeDeclaration) {
                const defPosition = document.positionAt(line.indexOf(word));
                references.push(new vscode.Location(document.uri, defPosition));
            }
        } else {
            // Check if we're on a procedure call
            const procCallMatch = line.match(new RegExp(`\\b${word}\\b`));
            if (procCallMatch) {
                const procReferences = await this.findProcedureReferences(word);
                references.push(...procReferences);
            }
        }

        return references;
    }

    private async findProcedureReferences(procName: string): Promise<vscode.Location[]> {
        const references: vscode.Location[] = [];
        const files = await vscode.workspace.findFiles('**/*.{tcl,tk,tm}', '**/node_modules/**');
        
        for (const file of files) {
            try {
                const document = await vscode.workspace.openTextDocument(file);
                const text = document.getText();
                
                // Find procedure calls (not definitions)
                const callRegex = new RegExp(`\\b${procName}\\b(?!\\s*{)`, 'g');
                let match;
                
                while ((match = callRegex.exec(text)) !== null) {
                    // Skip if this is a proc definition
                    const beforeMatch = text.substring(Math.max(0, match.index - 10), match.index);
                    if (beforeMatch.includes('proc')) {
                        continue;
                    }
                    
                    const position = document.positionAt(match.index);
                    const range = new vscode.Range(position, position);
                    references.push(new vscode.Location(file, range));
                }
            } catch (error) {
                // Skip files that can't be opened
                continue;
            }
        }
        
        return references;
    }
}