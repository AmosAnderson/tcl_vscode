import * as vscode from 'vscode';
import { TCL_BUILTIN_COMMANDS, STRING_SUBCOMMANDS, TCL_SNIPPETS } from '../data/tclCommands';

export class TclCompletionItemProvider implements vscode.CompletionItemProvider {
    private procedureCache: Map<string, vscode.CompletionItem[]> = new Map();
    private variableCache: Map<string, vscode.CompletionItem[]> = new Map();
    private changeSubscription: vscode.Disposable;

    constructor() {
        // Single listener to clear caches for changed documents to avoid leak of listeners per completion invocation
        this.changeSubscription = vscode.workspace.onDidChangeTextDocument(e => {
            const uri = e.document.uri.toString();
            if (this.procedureCache.has(uri)) this.procedureCache.delete(uri);
            if (this.variableCache.has(uri)) this.variableCache.delete(uri);
        });
    }

    public dispose() {
        this.changeSubscription.dispose();
    }

    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
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

        // Check if we're completing a variable reference
        if (linePrefix.match(/\$\w*$/)) {
            completions.push(...this.getVariableCompletions(document));
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

    private getVariableCompletions(document: vscode.TextDocument): vscode.CompletionItem[] {
        const uri = document.uri.toString();
        
        // Check cache first
        if (this.variableCache.has(uri)) {
            return this.variableCache.get(uri) || [];
        }

        const variables: vscode.CompletionItem[] = [];
        const text = document.getText();
        const varNames = new Set<string>();

        // Match set commands
        const setRegex = /\bset\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;
        let match;
        while ((match = setRegex.exec(text)) !== null) {
            varNames.add(match[1]);
        }

        // Match global commands
        const globalRegex = /\bglobal\s+([a-zA-Z_][a-zA-Z0-9_\s]*)/g;
        while ((match = globalRegex.exec(text)) !== null) {
            match[1].split(/\s+/).forEach(v => varNames.add(v.trim()));
        }

        // Match variable commands
        const variableRegex = /\bvariable\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;
        while ((match = variableRegex.exec(text)) !== null) {
            varNames.add(match[1]);
        }

        // Match proc arguments
        const procRegex = /\bproc\s+[a-zA-Z_][a-zA-Z0-9_:]*\s*{([^}]*)}/g;
        while ((match = procRegex.exec(text)) !== null) {
            const args = match[1].trim().split(/\s+/);
            args.forEach(arg => {
                if (arg && !arg.startsWith('{')) {
                    varNames.add(arg);
                }
            });
        }

        // Create completion items
        varNames.forEach(varName => {
            const item = new vscode.CompletionItem(varName, vscode.CompletionItemKind.Variable);
            item.detail = `$${varName}`;
            item.insertText = varName;
            variables.push(item);
        });

        // Cache the results
        this.variableCache.set(uri, variables);
        
    // (Cache invalidation handled by single subscription in constructor)

        return variables;
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