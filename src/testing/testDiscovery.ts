import { getScriptWords, isStaticWord, parseTclScript, TclCommand } from '../utils/tclParser';
import { TclTestKind } from './testExecution';

export interface TclTestDeclaration { name: string; kind: TclTestKind; start: number; end: number; }

/** Discover literal declarations without executing tests or interpreting literal data. */
export function discoverTclTests(text: string): TclTestDeclaration[] {
    const result: TclTestDeclaration[] = [];
    const importedNamespaces = new Set<string>();
    const qualify = (name: string, namespace: string) => name.startsWith('::') ? name : `${namespace === '::' ? '' : namespace}::${name}`;
    const visit = (commands: TclCommand[], namespace: string, imported: boolean): void => {
        for (const command of commands) {
            const w = command.words;
            if (!isStaticWord(w[0]) || w.some(word => word.expanded)) continue;
            const name = w[0].value.replace(/^::/, '');
            if (name === 'namespace' && w[1]?.value === 'import') {
                if (w.slice(2).some(word => isStaticWord(word) && /^(?:::)?tcltest::(?:test|\*)$/.test(word.value))) { imported = true; importedNamespaces.add(namespace); }
            }
            if (name === 'proc') {
                if (w.length === 4 && isStaticWord(w[1]) && /^test_/.test(w[1].value.split('::').pop()!)) {
                    result.push({ name: qualify(w[1].value, namespace), kind: 'procedure', start: command.start, end: command.end });
                }
                continue; // Definitions inside a procedure are dynamic until it executes.
            }
            if ((name === 'tcltest::test' || name === 'test' && (imported || importedNamespaces.has(namespace) || importedNamespaces.has('::'))) && w.length >= 3 && isStaticWord(w[1])) {
                result.push({ name: w[1].value, kind: 'tcltest', start: command.start, end: command.end });
                continue;
            }
            const inner = name === 'namespace' && w[1]?.value === 'eval' && isStaticWord(w[2]) ? qualify(w[2].value, namespace) : namespace;
            for (const body of getScriptWords(command)) visit(parseTclScript(text, body.contentStart, body.contentEnd).commands, inner, inner === namespace ? imported : importedNamespaces.has(inner) || importedNamespaces.has('::'));
        }
    };
    visit(parseTclScript(text).commands, '::', false);
    return result;
}
