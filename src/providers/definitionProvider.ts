import * as vscode from 'vscode';
import { escapeRegex } from '../utils/tclUtils';
import { WorkspaceIndex } from '../analysis/workspaceIndex';
import { SymbolTableCache } from '../analysis/symbolTableCache';

export class TclDefinitionProvider implements vscode.DefinitionProvider {
    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): Promise<vscode.Location | vscode.Location[] | null> {
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return null;
        }

        const word = document.getText(wordRange);
        const line = document.lineAt(position.line).text;

        // Try to find a procedure definition for this word
        const currentDocLocation = this.findProcedureInDocument(document, word);
        if (currentDocLocation) {
            return currentDocLocation;
        }

        const workspaceLocations = await this.findProcedureInWorkspace(word);
        if (workspaceLocations.length > 0) {
            return workspaceLocations;
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
        const name = escapeRegex(procName);
        // Match: proc <name> {args} {body}
        const procRegex = new RegExp(`\\bproc\\s+${name}\\s+\\{[^}]*\\}\\s*\\{`, 'g');
        const match = procRegex.exec(text);
        
        if (match) {
            const position = document.positionAt(match.index);
            const range = new vscode.Range(position, position);
            return new vscode.Location(document.uri, range);
        }
        
        return null;
    }

    private async findProcedureInWorkspace(procName: string): Promise<vscode.Location[]> {
        const index = WorkspaceIndex.getInstance();
        const lowerName = procName.toLowerCase();
        return index.getProcedures().filter(p => {
            // Exact match on name or qualified name
            return p.name.toLowerCase() === lowerName ||
                   p.qualifiedName.toLowerCase() === lowerName ||
                   p.qualifiedName.toLowerCase().endsWith('::' + lowerName);
        }).map(p => {
            const position = new vscode.Position(p.line, 0);
            return new vscode.Location(p.uri, new vscode.Range(position, position));
        });
    }

    private async findNamespaceInWorkspace(nsName: string): Promise<vscode.Location | null> {
        const index = WorkspaceIndex.getInstance();
        const lowerName = nsName.toLowerCase();
        const match = index.getNamespaces().find(n => {
            return n.name.toLowerCase() === lowerName ||
                   n.qualifiedName.toLowerCase() === '::' + lowerName ||
                   n.qualifiedName.toLowerCase() === lowerName;
        });
        if (match) {
            const position = new vscode.Position(match.line, 0);
            return new vscode.Location(match.uri, new vscode.Range(position, position));
        }
        return null;
    }
}

export class TclReferenceProvider implements vscode.ReferenceProvider {

    constructor(private symbolTableCache?: SymbolTableCache) {}

    async provideReferences(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.ReferenceContext,
        _token: vscode.CancellationToken
    ): Promise<vscode.Location[]> {
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return [];
        }

        const word = document.getText(wordRange);
        const escapedWord = escapeRegex(word);
        const references: vscode.Location[] = [];
        const line = document.lineAt(position.line).text;

        // Determine if this is a variable reference
        const isVariable = (wordRange.start.character > 0 && line[wordRange.start.character - 1] === '$')
            || /\bset\s+/.test(line.substring(0, wordRange.start.character + word.length))
            || /\b(global|variable|upvar)\s+/.test(line);

        // For variable references, use scope-aware symbol table
        if (isVariable && this.symbolTableCache) {
            const table = this.symbolTableCache.getOrCreate(document);
            const scopedRanges = table.getScopedReferences(word, position);
            if (scopedRanges.length > 0) {
                return scopedRanges.map(range => new vscode.Location(document.uri, range));
            }
        }

        // Fall back to procedure reference search
        // Check if we're on a procedure definition
        const procDefMatch = line.match(new RegExp(`\\bproc\\s+(${escapedWord})\\s*{`));
        
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
            const procCallMatch = line.match(new RegExp(`\\b${escapedWord}\\b`));
            if (procCallMatch) {
                const procReferences = await this.findProcedureReferences(word);
                references.push(...procReferences);
            }
        }

        return references;
    }

    private async findProcedureReferences(procName: string): Promise<vscode.Location[]> {
        const references: vscode.Location[] = [];
        const index = WorkspaceIndex.getInstance();
        const files = index.getIndexedFiles();
        const escaped = escapeRegex(procName);

        for (const file of files) {
            try {
                const document = await vscode.workspace.openTextDocument(file);
                const text = document.getText();

                // Find procedure calls (not definitions)
                const callRegex = new RegExp(`\\b${escaped}\\b(?!\\s*{)`, 'g');
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
            } catch {
                // Skip files that can't be opened
                continue;
            }
        }
        
        return references;
    }
}