import * as vscode from 'vscode';

export class TclDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
    provideDocumentSymbols(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.SymbolInformation[] | vscode.DocumentSymbol[]> {
        const symbols: vscode.DocumentSymbol[] = [];
        const text = document.getText();
        const lines = text.split('\n');

        // Stack to track namespace context; each entry records the brace depth at which the
        // namespace block was opened so that proc-body closing braces don't accidentally pop it.
        const namespaceStack: { symbol: vscode.DocumentSymbol; depth: number }[] = [];
        let currentNamespace: vscode.DocumentSymbol | null = null;
        let braceDepth = 0;

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const line = lines[lineNum];

            // Update brace depth character-by-character and pop namespaces as they close.
            // This must happen before we try to match new namespace definitions on this line.
            for (const ch of line) {
                if (ch === '{') {
                    braceDepth++;
                } else if (ch === '}') {
                    braceDepth--;
                    while (namespaceStack.length > 0 &&
                           braceDepth < namespaceStack[namespaceStack.length - 1].depth) {
                        namespaceStack.pop();
                        currentNamespace = namespaceStack.length > 0
                            ? namespaceStack[namespaceStack.length - 1].symbol
                            : null;
                    }
                }
            }

            // Match procedure definitions
            const procMatch = line.match(/^\s*proc\s+([a-zA-Z_][a-zA-Z0-9_:]*)\s*\{/);
            if (procMatch) {
                const procName = procMatch[1];

                // Extract arguments - look for simple case first
                const simpleMatch = line.match(/^\s*proc\s+[a-zA-Z_][a-zA-Z0-9_:]*\s*\{([^}]*)\}/);
                const args = simpleMatch
                    ? simpleMatch[1].trim()
                    : '...'; // Multi-line argument list: indicate it has args

                const range = new vscode.Range(lineNum, 0, lineNum, line.length);
                const selectionRange = new vscode.Range(
                    lineNum,
                    line.indexOf(procName),
                    lineNum,
                    line.indexOf(procName) + procName.length
                );

                const procSymbol = new vscode.DocumentSymbol(
                    procName,
                    args ? `{${args}}` : '',
                    vscode.SymbolKind.Function,
                    range,
                    selectionRange
                );

                if (currentNamespace) {
                    currentNamespace.children.push(procSymbol);
                } else {
                    symbols.push(procSymbol);
                }
            }

            // Match namespace definitions
            const nsMatch = line.match(/^\s*namespace\s+eval\s+((?:::)?[a-zA-Z_][a-zA-Z0-9_:]*)\s*{/);
            if (nsMatch) {
                const nsName = nsMatch[1];
                
                const range = new vscode.Range(lineNum, 0, lineNum, line.length);
                const selectionRange = new vscode.Range(
                    lineNum,
                    line.indexOf(nsName),
                    lineNum,
                    line.indexOf(nsName) + nsName.length
                );

                const nsSymbol = new vscode.DocumentSymbol(
                    nsName,
                    'namespace',
                    vscode.SymbolKind.Namespace,
                    range,
                    selectionRange
                );

                if (currentNamespace) {
                    currentNamespace.children.push(nsSymbol);
                } else {
                    symbols.push(nsSymbol);
                }

                namespaceStack.push({ symbol: nsSymbol, depth: braceDepth });
                currentNamespace = nsSymbol;
            }

            // Match global variables
            const globalMatch = line.match(/^\s*global\s+([a-zA-Z_][a-zA-Z0-9_\s]*)/);
            if (globalMatch) {
                const varNames = globalMatch[1].split(/\s+/).filter(v => v.trim());
                
                varNames.forEach(varName => {
                    const range = new vscode.Range(lineNum, 0, lineNum, line.length);
                    const varIndex = line.indexOf(varName);
                    const selectionRange = new vscode.Range(
                        lineNum,
                        varIndex,
                        lineNum,
                        varIndex + varName.length
                    );

                    const varSymbol = new vscode.DocumentSymbol(
                        varName,
                        'global variable',
                        vscode.SymbolKind.Variable,
                        range,
                        selectionRange
                    );

                    if (currentNamespace) {
                        currentNamespace.children.push(varSymbol);
                    } else {
                        symbols.push(varSymbol);
                    }
                });
            }

            // Match variable declarations
            const variableMatch = line.match(/^\s*variable\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
            if (variableMatch) {
                const varName = variableMatch[1];
                
                const range = new vscode.Range(lineNum, 0, lineNum, line.length);
                const selectionRange = new vscode.Range(
                    lineNum,
                    line.indexOf(varName),
                    lineNum,
                    line.indexOf(varName) + varName.length
                );

                const varSymbol = new vscode.DocumentSymbol(
                    varName,
                    'namespace variable',
                    vscode.SymbolKind.Variable,
                    range,
                    selectionRange
                );

                if (currentNamespace) {
                    currentNamespace.children.push(varSymbol);
                } else {
                    symbols.push(varSymbol);
                }
            }

            // Match package provide
            const packageMatch = line.match(/^\s*package\s+provide\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+([\d.]+)/);
            if (packageMatch) {
                const packageName = packageMatch[1];
                const version = packageMatch[2];
                
                const range = new vscode.Range(lineNum, 0, lineNum, line.length);
                const selectionRange = new vscode.Range(
                    lineNum,
                    line.indexOf(packageName),
                    lineNum,
                    line.indexOf(packageName) + packageName.length
                );

                const packageSymbol = new vscode.DocumentSymbol(
                    packageName,
                    `version ${version}`,
                    vscode.SymbolKind.Package,
                    range,
                    selectionRange
                );

                symbols.push(packageSymbol);
            }

        }

        return symbols;
    }
}

export class TclWorkspaceSymbolProvider implements vscode.WorkspaceSymbolProvider {
    private escapeRegex(lit: string): string {
        return lit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    async provideWorkspaceSymbols(
        query: string,
        token: vscode.CancellationToken
    ): Promise<vscode.SymbolInformation[]> {
        const symbols: vscode.SymbolInformation[] = [];
        const escapedQuery = this.escapeRegex(query);
        
        // Find all TCL files in workspace
        const files = await vscode.workspace.findFiles('**/*.{tcl,tk,tm}', '**/node_modules/**');
        
        for (const file of files) {
            if (token.isCancellationRequested) {
                break;
            }

            const document = await vscode.workspace.openTextDocument(file);
            const text = document.getText();
            
            // Search for procedures matching the query
            const procRegex = new RegExp(`\\bproc\\s+(\\w*${escapedQuery}\\w*)\\s*\\{`, 'gi');
            let match;

            while ((match = procRegex.exec(text)) !== null) {
                const procName = match[1];
                const line = document.positionAt(match.index).line;

                // Try to extract args if they're on the same line
                const lineText = document.lineAt(line).text;
                const argsMatch = lineText.match(/\bproc\s+\w+\s*\{([^}]*)\}/);
                const args = argsMatch ? argsMatch[1].trim() : '...';

                const location = new vscode.Location(
                    file,
                    new vscode.Position(line, 0)
                );

                const symbol = new vscode.SymbolInformation(
                    procName,
                    vscode.SymbolKind.Function,
                    args ? `{${args}}` : '',
                    location
                );

                symbols.push(symbol);
            }
            
            // Search for namespaces matching the query
            const nsRegex = new RegExp(`namespace\\s+eval\\s+(\\w*${escapedQuery}\\w*)`, 'gi');
            
            while ((match = nsRegex.exec(text)) !== null) {
                const nsName = match[1];
                const line = document.positionAt(match.index).line;
                
                const location = new vscode.Location(
                    file,
                    new vscode.Position(line, 0)
                );
                
                const symbol = new vscode.SymbolInformation(
                    nsName,
                    vscode.SymbolKind.Namespace,
                    'namespace',
                    location
                );
                
                symbols.push(symbol);
            }
        }
        
        return symbols;
    }
}
