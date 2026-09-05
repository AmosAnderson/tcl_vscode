import { getScriptWords, getExpressionWords, parseTclExpressionSubstitutions, isStaticWord, parseTclScript, TclCommand, TclWord } from '../utils/tclParser';

export interface CommandContext { command: TclCommand; namespace: string; }
export interface ProcedureDeclaration extends CommandContext {
    name: string;
    qualifiedName: string;
    params: TclWord;
    body: TclWord;
}
export function qualifyTclName(name: string, namespace: string): string {
    return (name.startsWith('::') ? name : `${namespace === '::' ? '' : namespace}::${name}`).replace(/:{2,}/g, '::');
}
export function commandContexts(text: string): CommandContext[] {
    const result: CommandContext[] = [];
    const visit = (commands: TclCommand[], namespace: string): void => {
        for (const command of commands) {
            result.push({ command, namespace });
            for (const word of command.words) visit(word.substitutions, namespace);
            for (const expression of getExpressionWords(command)) if (expression.kind === 'braced') visit(parseTclExpressionSubstitutions(text, expression.contentStart, expression.contentEnd).commands, namespace);
            const w = command.words;
            let innerNamespace = namespace;
            if (w[0]?.value.replace(/^::/, '') === 'namespace' && w[1]?.value === 'eval' && isStaticWord(w[2])) innerNamespace = qualifyTclName(w[2].value, namespace);
            else if (w[0]?.value.replace(/^::/, '') === 'proc' && isStaticWord(w[1])) {
                const name = qualifyTclName(w[1].value, namespace);
                innerNamespace = name.slice(0, name.lastIndexOf('::')) || '::';
            }
            for (const body of getScriptWords(command)) visit(parseTclScript(text, body.contentStart, body.contentEnd).commands, innerNamespace);
        }
    };
    visit(parseTclScript(text).commands, '::');
    return result;
}
export function procedureDeclarations(text: string): ProcedureDeclaration[] {
    return commandContexts(text).flatMap(context => {
        const w = context.command.words;
        return !w.some(word => word.expanded) && w[0]?.value.replace(/^::/, '') === 'proc' && w.length === 4 && isStaticWord(w[1]) && w[2].kind === 'braced' && w[3].kind === 'braced'
            ? [{ ...context, name: w[1].value, qualifiedName: qualifyTclName(w[1].value, context.namespace), params: w[2], body: w[3] }]
            : [];
    });
}
export function resolveProcedureName(name: string, namespace: string, definitions: Set<string>): string | undefined {
    const qualified = qualifyTclName(name, namespace);
    if (definitions.has(qualified)) return qualified;
    const global = qualifyTclName(name, '::');
    return !name.startsWith('::') && definitions.has(global) ? global : undefined;
}
