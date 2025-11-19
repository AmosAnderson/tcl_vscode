import * as vscode from 'vscode';
import { TCL_BUILTIN_COMMANDS } from '../data/tclCommands';

export class TclSignatureHelpProvider implements vscode.SignatureHelpProvider {
    
    public provideSignatureHelp(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.SignatureHelpContext
    ): vscode.ProviderResult<vscode.SignatureHelp> {
        
        const text = document.lineAt(position.line).text;
        const prefix = text.substring(0, position.character);
        
        // Simple parsing to find the command and argument index
        // This is a heuristic and won't handle complex nested commands perfectly
        
        // 1. Tokenize the prefix to find the current command
        // We need to handle nested commands [...]
        
        const commandInfo = this.parseCommand(prefix);
        if (!commandInfo) {
            return null;
        }

        const { commandName, argIndex } = commandInfo;

        // Find the command definition
        const commandDef = TCL_BUILTIN_COMMANDS.find(c => c.name === commandName);
        if (!commandDef) {
            return null;
        }

        const signatureHelp = new vscode.SignatureHelp();
        
        const signature = new vscode.SignatureInformation(commandDef.signature, new vscode.MarkdownString(commandDef.description));
        
        // Parse parameters from the signature string
        // Example: "string option arg ?arg ...?"
        // We skip the first word (command name)
        const paramParts = commandDef.signature.split(/\s+/).slice(1);
        
        signature.parameters = paramParts.map(p => new vscode.ParameterInformation(p));
        
        signatureHelp.signatures = [signature];
        signatureHelp.activeSignature = 0;
        
        // Determine active parameter
        // If the command takes variable arguments (indicated by ?...?), we might clamp the index
        if (signature.parameters.length > 0) {
            signatureHelp.activeParameter = Math.min(argIndex, signature.parameters.length - 1);
        } else {
            signatureHelp.activeParameter = 0;
        }

        return signatureHelp;
    }

    private parseCommand(text: string): { commandName: string, argIndex: number } | null {
        // Remove escaped characters
        const cleanText = text.replace(/\\./g, '__');
        
        // Check if we are inside a nested command [...]
        // We look for the last unclosed '['
        let depth = 0;
        let lastOpenBracket = -1;
        
        for (let i = 0; i < cleanText.length; i++) {
            if (cleanText[i] === '[') {
                depth++;
                lastOpenBracket = i;
            } else if (cleanText[i] === ']') {
                depth--;
            }
        }

        let commandText = cleanText;
        if (depth > 0 && lastOpenBracket !== -1) {
            // We are inside a nested command, so we only care about text after the last '['
            commandText = cleanText.substring(lastOpenBracket + 1);
        }

        // Now tokenize commandText
        // We split by whitespace, but we need to respect quotes and braces
        // This is a simplified tokenizer
        const tokens: string[] = [];
        let currentToken = '';
        let inQuote = false;
        let braceDepth = 0;
        
        for (let i = 0; i < commandText.length; i++) {
            const char = commandText[i];
            
            if (char === '"' && braceDepth === 0) {
                inQuote = !inQuote;
                currentToken += char;
            } else if (char === '{' && !inQuote) {
                braceDepth++;
                currentToken += char;
            } else if (char === '}' && !inQuote) {
                braceDepth--;
                currentToken += char;
            } else if (/\s/.test(char) && !inQuote && braceDepth === 0) {
                if (currentToken.length > 0) {
                    tokens.push(currentToken);
                    currentToken = '';
                }
            } else {
                currentToken += char;
            }
        }
        
        // The last token is the one being typed (or empty if we are at a space)
        // If the last char was a space, we are starting a new token
        const isNewToken = /\s$/.test(commandText);
        
        if (currentToken.length > 0) {
            tokens.push(currentToken);
        }

        if (tokens.length === 0) {
            return null;
        }

        const commandName = tokens[0];
        // argIndex is tokens.length - 1. 
        // If we are typing the command name itself (tokens.length=1 and !isNewToken), argIndex is -1 (not in args yet)
        // But SignatureHelp is usually triggered after the command name + space.
        
        let argIndex = tokens.length - 1;
        if (isNewToken) {
            argIndex++;
        }
        
        // Adjust because tokens[0] is the command name, so first arg is index 0 relative to parameters
        argIndex--; 

        if (argIndex < 0) {
            return null; // Still typing command name
        }

        return { commandName, argIndex };
    }
}
