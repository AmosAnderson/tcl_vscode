import { getScriptWords, getExpressionWords, getLambdaParts, parseTclExpressionSubstitutions, isStaticWord, parseTclScript, TclCommand, TclWord } from '../utils/tclParser';

export interface CommandContext { command: TclCommand; namespace: string; className?: string; }
export interface ProcedureDeclaration extends CommandContext {
    name: string;
    qualifiedName: string;
    params: TclWord;
    body: TclWord;
}
export interface NamespaceResolution {
    imports: { namespace: string; pattern: string }[];
    paths: { namespace: string; paths: string[] }[];
    exports: { namespace: string; patterns: string[] }[];
}
export function qualifyTclName(name: string, namespace: string): string {
    return (name.startsWith('::') ? name : `${namespace === '::' ? '' : namespace}::${name}`).replace(/:{2,}/g, '::');
}
export function namespaceOf(name: string): string { return name.slice(0, name.lastIndexOf('::')) || '::'; }
export function commandContexts(text: string): CommandContext[] {
    const result: CommandContext[] = [];
    const visit = (commands: TclCommand[], namespace: string, className?: string): void => {
        for (const command of commands) {
            const w = command.words;
            const name = isStaticWord(w[0]) ? w[0].value.replace(/^::/, '') : '';
            result.push({ command, namespace, className });
            for (const word of w) visit(word.substitutions, namespace, className);
            for (const expression of getExpressionWords(command)) if (expression.kind === 'braced') visit(parseTclExpressionSubstitutions(text, expression.contentStart, expression.contentEnd).commands, namespace, className);
            let innerNamespace = namespace;
            let innerClass = className;
            if (name === 'namespace' && w[1]?.value === 'eval' && isStaticWord(w[2])) innerNamespace = qualifyTclName(w[2].value, namespace);
            else if (name === 'proc' && isStaticWord(w[1])) { innerNamespace = namespaceOf(qualifyTclName(w[1].value, namespace)); innerClass = undefined; }
            else if (['oo::class', 'oo::object'].includes(name) && w[1]?.value === 'create' && isStaticWord(w[2])) innerClass = qualifyTclName(w[2].value, namespace);
            else if (['oo::define', 'oo::objdefine'].includes(name) && isStaticWord(w[1])) innerClass = qualifyTclName(w[1].value, namespace);
            const lambda = getLambdaParts(command);
            if (lambda.length) { innerNamespace = lambda[2] ? qualifyTclName(lambda[2].value, '::') : '::'; innerClass = undefined; }
            for (const body of getScriptWords(command)) visit(parseTclScript(text, body.contentStart, body.contentEnd).commands, innerNamespace, innerClass);
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
function globMatch(value: string, pattern: string): boolean {
    // Static namespace patterns: the common '*' and '?' forms. Bracket patterns
    // remain unresolved rather than being treated as a different Tcl pattern.
    if (pattern.includes('[') || pattern.includes('\\')) return false;
    const regex = pattern.split('').map(ch => ch === '*' ? '.*' : ch === '?' ? '.' : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
    return new RegExp(`^${regex}$`).test(value);
}
export function resolveProcedureName(name: string, namespace: string, definitions: Set<string>, resolution?: NamespaceResolution): string | undefined {
    const qualified = qualifyTclName(name, namespace);
    if (definitions.has(qualified)) return qualified;
    if (resolution) {
        const aliasNamespace = namespaceOf(qualified);
        const short = qualified.slice(qualified.lastIndexOf('::') + 2);
        const imported = new Set<string>();
        for (const entry of resolution.imports.filter(item => item.namespace === aliasNamespace)) {
            for (const target of definitions) {
                if (target.slice(target.lastIndexOf('::') + 2) !== short || !globMatch(target, entry.pattern)) continue;
                if (resolution.exports.some(item => item.namespace === namespaceOf(target) && item.patterns.some(pattern => globMatch(short, pattern)))) imported.add(target);
            }
        }
        if (imported.size === 1) return [...imported][0];
        if (imported.size > 1) return undefined;
        if (!name.includes('::')) {
            const paths = resolution.paths.filter(item => item.namespace === namespace).slice(-1)[0]?.paths ?? [];
            for (const path of paths) {
                const candidate = qualifyTclName(name, path);
                if (definitions.has(candidate)) return candidate;
            }
        }
    }
    if (name.startsWith('::')) return undefined;
    const global = qualifyTclName(name, '::');
    return definitions.has(global) ? global : undefined;
}
