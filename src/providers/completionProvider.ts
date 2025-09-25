import * as vscode from 'vscode';
import { TCL_BUILTIN_COMMANDS, STRING_SUBCOMMANDS, TCL_SNIPPETS } from '../data/tclCommands';

export class TclCompletionItemProvider implements vscode.CompletionItemProvider {
    private procedureCache: Map<string, vscode.CompletionItem[]> = new Map();
    private packageCache: vscode.CompletionItem[] | null = null;
    private changeSubscription: vscode.Disposable;

    constructor() {
        // Single listener to clear caches for changed documents to avoid leak of listeners per completion invocation
        this.changeSubscription = vscode.workspace.onDidChangeTextDocument(e => {
            const uri = e.document.uri.toString();
            if (this.procedureCache.has(uri)) this.procedureCache.delete(uri);
            this.packageCache = null;
        });
    }

    public dispose() {
        this.changeSubscription.dispose();
    }

    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): Promise<vscode.CompletionItem[] | vscode.CompletionList> {
        const linePrefix = document.lineAt(position).text.substr(0, position.character);
        const completions: vscode.CompletionItem[] = [];

        // Check if we're completing a string subcommand
        if (linePrefix.match(/\bstring\s+\w*$/)) {
            return this.getStringSubcommandCompletions();
        }

        // Check if we're completing after a namespace delimiter
        if (linePrefix.match(/::\w*$/)) {
            completions.push(...this.getNamespaceCompletions(document, linePrefix));
        }

        const packageMatch = linePrefix.match(/\bpackage\s+(require|provide|present)\s+([\w:]*$)/);
        if (packageMatch) {
            const prefix = packageMatch[2] ?? '';
            const packageCompletions = await this.getPackageCompletions(document, prefix);
            completions.push(...packageCompletions);
        }

        // Check if we're completing a variable reference
        if (linePrefix.match(/\$\w*$/)) {
            completions.push(...this.getVariableCompletions(document, position));
        }

        // Add built-in commands
        completions.push(...this.getBuiltinCommandCompletions());

        // Add procedures from current file
        completions.push(...this.getProcedureCompletions(document));

        // Add snippets
        completions.push(...this.getSnippetCompletions());

        return completions;
    }

    private getBuiltinCommandCompletions(): vscode.CompletionItem[] {
        return TCL_BUILTIN_COMMANDS.map(cmd => {
            const item = new vscode.CompletionItem(cmd.name, vscode.CompletionItemKind.Function);
            item.detail = cmd.signature;
            item.documentation = new vscode.MarkdownString(cmd.description);
            item.insertText = cmd.name;
            return item;
        });
    }

    private getStringSubcommandCompletions(): vscode.CompletionItem[] {
        return STRING_SUBCOMMANDS.map(sub => {
            const item = new vscode.CompletionItem(sub, vscode.CompletionItemKind.Method);
            item.detail = `string ${sub}`;
            return item;
        });
    }

    private getProcedureCompletions(document: vscode.TextDocument): vscode.CompletionItem[] {
        const uri = document.uri.toString();
        
        // Check cache first
        if (this.procedureCache.has(uri)) {
            return this.procedureCache.get(uri) || [];
        }

        const procedures: vscode.CompletionItem[] = [];
        const text = document.getText();
        const procRegex = /\bproc\s+([a-zA-Z_][a-zA-Z0-9_:]*)\s*{([^}]*)}/g;
        let match;

        while ((match = procRegex.exec(text)) !== null) {
            const procName = match[1];
            const args = match[2].trim();
            
            const item = new vscode.CompletionItem(procName, vscode.CompletionItemKind.Function);
            item.detail = `proc ${procName} {${args}}`;
            item.documentation = new vscode.MarkdownString(`User-defined procedure`);
            
            // Create snippet with argument placeholders
            if (args) {
                const argList = args.split(/\s+/).filter(a => a.length > 0);
                const snippetArgs = argList.map((arg, index) => `$\{${index + 1}:${arg}\}`).join(' ');
                item.insertText = new vscode.SnippetString(`${procName} ${snippetArgs}`);
            } else {
                item.insertText = procName;
            }
            
            procedures.push(item);
        }

        // Cache the results
        this.procedureCache.set(uri, procedures);
        
    // (Cache invalidation handled by single subscription in constructor)

        return procedures;
    }

    private getVariableCompletions(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
        const text = document.getText();
        const offset = document.offsetAt(position);
        const beforePosition = text.slice(0, offset);

        const varNames = new Set<string>();
        const addVar = (name: string) => {
            if (name && !name.startsWith('{')) {
                varNames.add(name);
            }
        };

        const currentProc = this.locateCurrentProcedure(text, offset);
        if (currentProc) {
            currentProc.args.forEach(addVar);
            this.extractVariableNames(currentProc.body.slice(0, offset - currentProc.bodyStart), addVar);
        } else {
            this.extractVariableNames(beforePosition, addVar);
        }

        return Array.from(varNames).map(varName => {
            const item = new vscode.CompletionItem(varName, vscode.CompletionItemKind.Variable);
            item.detail = `$${varName}`;
            item.insertText = varName;
            return item;
        });
    }

    private extractVariableNames(source: string, addVar: (name: string) => void) {
        const setRegex = /\bset\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;
        let match: RegExpExecArray | null;
        while ((match = setRegex.exec(source)) !== null) {
            addVar(match[1]);
        }

        const variableRegex = /\bvariable\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;
        while ((match = variableRegex.exec(source)) !== null) {
            addVar(match[1]);
        }

        const globalRegex = /\bglobal\s+([a-zA-Z_][a-zA-Z0-9_\s]*)/g;
        while ((match = globalRegex.exec(source)) !== null) {
            match[1].split(/\s+/).forEach(name => addVar(name.trim()));
        }
    }

    private locateCurrentProcedure(text: string, offset: number): { name: string; args: string[]; body: string; bodyStart: number; bodyEnd: number } | null {
        const procRegex = /\bproc\s+([a-zA-Z_][a-zA-Z0-9_:]*)\s*{([^}]*)}\s*{/g;
        let match: RegExpExecArray | null;

        while ((match = procRegex.exec(text)) !== null) {
            const bodyStart = match.index + match[0].length;
            const closeIndex = this.findMatchingBrace(text, bodyStart - 1);
            if (closeIndex === -1) {
                continue;
            }

            if (offset >= bodyStart && offset <= closeIndex) {
                const args = match[2].trim() ? match[2].trim().split(/\s+/) : [];
                const body = text.slice(bodyStart, closeIndex);
                return {
                    name: match[1],
                    args,
                    body,
                    bodyStart,
                    bodyEnd: closeIndex
                };
            }
        }

        return null;
    }

    private findMatchingBrace(text: string, openBraceIndex: number): number {
        let depth = 0;
        let inString = false;
        let stringChar = '';

        for (let i = openBraceIndex; i < text.length; i++) {
            const char = text[i];
            const prev = i > 0 ? text[i - 1] : '';

            if (!inString && char === '{') {
                depth++;
            } else if (!inString && char === '}') {
                depth--;
                if (depth === 0) {
                    return i;
                }
            }

            if (prev !== '\\' && (char === '"' || char === '\'')) {
                if (inString && char === stringChar) {
                    inString = false;
                    stringChar = '';
                } else if (!inString) {
                    inString = true;
                    stringChar = char;
                }
            }
        }

        return -1;
    }

    private getNamespaceCompletions(document: vscode.TextDocument, linePrefix: string): vscode.CompletionItem[] {
        const completions: vscode.CompletionItem[] = [];
        const text = document.getText();
        
        // Extract namespace prefix
        const nsMatch = linePrefix.match(/((?:::)?(?:[a-zA-Z_][a-zA-Z0-9_]*::)*)/);
        const nsPrefix = nsMatch ? nsMatch[1] : '';

        // Find namespace definitions
        const nsRegex = /namespace\s+eval\s+((?:::)?[a-zA-Z_][a-zA-Z0-9_:]*)/g;
        const namespaces = new Set<string>();
        let match;

        while ((match = nsRegex.exec(text)) !== null) {
            namespaces.add(match[1]);
        }

        // Add namespace completions
        namespaces.forEach(ns => {
            if (ns.startsWith(nsPrefix)) {
                const item = new vscode.CompletionItem(ns, vscode.CompletionItemKind.Module);
                item.detail = 'namespace';
                completions.push(item);
            }
        });

        return completions;
    }

    private async getPackageCompletions(document: vscode.TextDocument, prefix: string): Promise<vscode.CompletionItem[]> {
        if (this.packageCache) {
            return this.filterCompletionsByPrefix(this.packageCache, prefix);
        }

        const names = new Set<string>();
        const gatherFromText = (text: string) => {
            const regex = /\bpackage\s+(require|provide|present)\s+(?:-exact\s+)?([A-Za-z0-9_:.]+)/g;
            let match: RegExpExecArray | null;
            while ((match = regex.exec(text)) !== null) {
                names.add(match[2]);
            }
        };

        gatherFromText(document.getText());
        vscode.workspace.textDocuments.forEach(doc => {
            if (doc !== document && doc.languageId === 'tcl') {
                gatherFromText(doc.getText());
            }
        });

        const limit = 200;
        const files = await vscode.workspace.findFiles('**/*.{tcl,tk,tm}', '**/node_modules/**', limit);
        for (const uri of files) {
            if (names.size > 512) {
                break;
            }
            try {
                if (vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString())) {
                    continue;
                }
                const bytes = await vscode.workspace.fs.readFile(uri);
                const text = Buffer.from(bytes).toString('utf8');
                gatherFromText(text);
            } catch {
                // Ignore inaccessible files
            }
        }

        const items = Array.from(names).map(name => {
            const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Module);
            item.detail = `package ${name}`;
            return item;
        });

        this.packageCache = items;
        return this.filterCompletionsByPrefix(items, prefix);
    }

    private filterCompletionsByPrefix(items: vscode.CompletionItem[], prefix: string): vscode.CompletionItem[] {
        if (!prefix) {
            return items;
        }
        const lower = prefix.toLowerCase();
        return items.filter(item => item.label.toString().toLowerCase().startsWith(lower));
    }

    private getSnippetCompletions(): vscode.CompletionItem[] {
        return TCL_SNIPPETS.map(snippet => {
            const item = new vscode.CompletionItem(snippet.label, vscode.CompletionItemKind.Snippet);
            item.insertText = new vscode.SnippetString(snippet.insertText);
            item.detail = snippet.detail;
            item.documentation = new vscode.MarkdownString(`Insert ${snippet.detail}`);
            return item;
        });
    }
}