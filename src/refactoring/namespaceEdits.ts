import * as vscode from 'vscode';
import { TCL_BUILTIN_COMMANDS } from '../data/tclCommands';
import { analyzeDocument, DocumentAnalysis } from '../analysis/documentAnalysis';
import { CommandContext, NamespaceResolution, procedureDeclarations, qualifyTclName, resolveProcedureName } from '../analysis/procedures';
import { getLambdaParts, isStaticWord, parseTclList, parseTclScript, TclWord } from '../utils/tclParser';

interface Snapshot { analyses: DocumentAnalysis[]; definitions: Set<string>; resolution: NamespaceResolution; }
async function snapshot(current: vscode.TextDocument): Promise<Snapshot> {
    const all = new Map<string, vscode.TextDocument>([[current.uri.toString(), current]]);
    for (const document of vscode.workspace.textDocuments) if (!document.isClosed && document.languageId === 'tcl') all.set(document.uri.toString(), document);
    for (const uri of await vscode.workspace.findFiles('**/*.{tcl,tk,tm,test}', '**/node_modules/**')) if (!all.has(uri.toString())) all.set(uri.toString(), await vscode.workspace.openTextDocument(uri));
    const analyses = [...all.values()].map(analyzeDocument);
    const definitions = new Set(analyses.flatMap(analysis => analysis.declarations.filter(declaration => declaration.kind === 'procedure' || declaration.kind === 'class').map(declaration => declaration.qualifiedName)));
    const resolution: NamespaceResolution = { imports: [], exports: [], paths: [] };
    for (const analysis of analyses) { resolution.imports.push(...analysis.resolution.imports); resolution.exports.push(...analysis.resolution.exports); resolution.paths.push(...analysis.resolution.paths); }
    return { analyses, definitions, resolution };
}
function globMatch(value: string, pattern: string): boolean {
    if (pattern.includes('[') || pattern.includes('\\')) return false;
    return new RegExp('^' + pattern.split('').map(char => char === '*' ? '.*' : char === '?' ? '.' : char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('') + '$').test(value);
}
function resolveCall(context: CommandContext, state: Snapshot): string | undefined {
    return isStaticWord(context.command.words[0]) ? resolveProcedureName(context.command.words[0].value, context.namespace, state.definitions, state.resolution) : undefined;
}
function hasNamespace(state: Snapshot, namespace: string): boolean {
    return state.analyses.some(analysis => analysis.declarations.some(declaration => declaration.qualifiedName === namespace || declaration.qualifiedName.startsWith(namespace + '::')) || analysis.table.getAllSymbols().some(symbol => symbol.qualifiedName === namespace || symbol.qualifiedName?.startsWith(namespace + '::')));
}
/** Callbacks are executable data. Decline affected opaque callbacks instead of
 * silently leaving stale names or rewriting ordinary strings and comments. */
function checkOpaqueReferences(context: CommandContext, text: string, names: string[]): void {
    const words = context.command.words;
    const name = words[0]?.value.replace(/^::/, '');
    const callback = ['after', 'bind', 'fileevent', 'trace', 'eval', 'uplevel', 'interp'].includes(name) || words.some(word => word.value === '-command') || name === 'namespace' && ['code', 'ensemble'].includes(words[1]?.value) || name === 'apply' && !getLambdaParts(context.command).length;
    if (!callback) return;
    const source = text.slice(words[1]?.start ?? context.command.end, context.command.end);
    const spellings = names.flatMap(value => value.startsWith(context.namespace + '::') ? [value, value.slice(context.namespace.length + 2)] : [value]);
    if (spellings.some(value => new RegExp(`(?<![\\p{L}\\p{N}_:])(?:::)?${value.replace(/^::/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}_]|::)`, 'u').test(source))) throw new Error('An affected callback or dynamically constructed command cannot be rewritten safely');
}
function namespaceDirectives(context: CommandContext): void {
    const words = context.command.words;
    if (words[0]?.value.replace(/^::/, '') !== 'namespace' || !['path', 'import', 'export'].includes(words[1]?.value)) return;
    if (words.slice(2).some(word => !isStaticWord(word))) throw new Error('Dynamic namespace imports, exports, or paths prevent safe refactoring');
}
function variableRanges(analysis: DocumentAnalysis): { range: vscode.Range; qualifiedName: string }[] {
    const ranges: { range: vscode.Range; qualifiedName: string }[] = [];
    for (const symbol of analysis.table.getAllSymbols()) if (symbol.kind !== 'procedure' && symbol.qualifiedName) for (const range of [symbol.range, ...symbol.references]) ranges.push({ range, qualifiedName: symbol.qualifiedName });
    for (const usage of analysis.table.getVariableUsages()) if (!usage.symbol && usage.qualifiedName) ranges.push({ range: usage.range, qualifiedName: usage.qualifiedName });
    return ranges;
}

export async function createNamespaceExtractionEdit(document: vscode.TextDocument, selection: vscode.Range, name: string): Promise<vscode.WorkspaceEdit> {
    if (!/^(?:::)?[\p{L}_][\p{L}\p{N}_]*(?:::[\p{L}_][\p{L}\p{N}_]*)*$/u.test(name)) throw new Error('Invalid namespace name');
    const target = qualifyTclName(name, '::');
    const text = document.getText(), start = document.offsetAt(selection.start), end = document.offsetAt(selection.end);
    const parsed = parseTclScript(text, start, end), top = parseTclScript(text).commands;
    if (parsed.errors.length || !parsed.commands.length || parsed.commands.some(command => !top.some(original => original.start === command.start && original.end === command.end))) throw new Error('Select complete top-level procedure definitions');
    const moved = procedureDeclarations(text).filter(proc => proc.command.start >= start && proc.command.end <= end);
    if (moved.length !== parsed.commands.length || moved.some(proc => proc.name.includes('::'))) throw new Error('Select only unqualified top-level procedures');
    const state = await snapshot(document);
    if (hasNamespace(state, target)) throw new Error('The target namespace already exists');
    const mapping = new Map(moved.map(proc => [proc.qualifiedName, `${target}::${proc.name}`]));
    for (const name of mapping.keys()) if (state.analyses.flatMap(analysis => analysis.declarations).filter(declaration => declaration.qualifiedName === name).length !== 1) throw new Error('A selected procedure has ambiguous definitions');
    const exported = moved.filter(proc => state.resolution.exports.some(entry => entry.namespace === '::' && entry.patterns.some(pattern => globMatch(proc.name, pattern))));
    const exportedNames = new Set(exported.map(proc => proc.qualifiedName));
    const builtins = new Set(TCL_BUILTIN_COMMANDS.map(command => command.name.split(' ')[0]));
    const sensitive = new Set(['namespace', 'variable', 'upvar', 'uplevel', 'eval', 'info', 'source', 'load', 'interp', 'rename', 'apply', 'after', 'bind', 'fileevent', 'trace']);
    const replacements = new Map<string, { start: number; end: number; text: string }>();
    const replaceBody = (from: number, to: number, value: string) => replacements.set(`${from}:${to}`, { start: from - start, end: to - start, text: value });
    for (const context of analyzeDocument(document).contexts.filter(context => context.command.start >= start && context.command.end <= end)) {
        const word = context.command.words[0];
        if (moved.some(proc => proc.command.start === context.command.start)) continue;
        if (!isStaticWord(word) || sensitive.has(word.value.replace(/^::/, '')) || word.value.replace(/^::/, '') === 'proc') throw new Error('Namespace-dependent or dynamic code cannot be moved safely');
        const resolved = resolveCall(context, state);
        const replacement = resolved ? mapping.get(resolved) ?? resolved : builtins.has(word.value.replace(/^::/, '')) ? `::${word.value.replace(/^::/, '')}` : undefined;
        if (!replacement) throw new Error(`Cannot resolve command '${word.value}' before moving it`);
        replaceBody(word.contentStart, word.contentEnd, replacement);
    }
    // Relative qualified variables otherwise acquire the newly introduced namespace.
    for (const variable of variableRanges(analyzeDocument(document))) {
        const from = document.offsetAt(variable.range.start), to = document.offsetAt(variable.range.end);
        const original = document.getText(variable.range);
        if (from >= start && to <= end && original.includes('::') && !original.startsWith('::')) replaceBody(from, to, variable.qualifiedName);
    }
    const edit = new vscode.WorkspaceEdit();
    for (const analysis of state.analyses) for (const context of analysis.contexts) {
        namespaceDirectives(context);
        if (analysis.document === document && context.command.start >= start && context.command.end <= end) continue;
        checkOpaqueReferences(context, analysis.text, [...mapping.keys()]);
        const word = context.command.words[0];
        const resolved = resolveCall(context, state), replacement = resolved && mapping.get(resolved);
        if (replacement) edit.replace(analysis.document.uri, analysis.range(word.contentStart, word.contentEnd), replacement);
        const words = context.command.words;
        if (words[0]?.value.replace(/^::/, '') === 'namespace' && words[1]?.value === 'import') for (const pattern of words.slice(2).filter(item => isStaticWord(item) && item.value !== '-force')) {
            const qualified = qualifyTclName(pattern.value, context.namespace);
            const affected = [...mapping].filter(([original]) => exportedNames.has(original) && globMatch(original, qualified));
            if (!affected.length) continue;
            if (/[*?[]/.test(pattern.value)) edit.insert(analysis.document.uri, analysis.document.positionAt(pattern.end), ' ' + affected.map(([, target]) => target).join(' '));
            else edit.replace(analysis.document.uri, analysis.range(pattern.contentStart, pattern.contentEnd), affected[0][1]);
        }
    }
    let body = text.slice(start, end);
    for (const replacement of [...replacements.values()].sort((a, b) => b.start - a.start)) body = body.slice(0, replacement.start) + replacement.text + body.slice(replacement.end);
    const exports = exported.length ? `namespace export ${exported.map(proc => proc.name).join(' ')}\n` : '';
    edit.replace(document.uri, selection, `namespace eval ${target} {\n${exports}${body}\n}`);
    return edit;
}

export async function createNamespaceRenameEdit(document: vscode.TextDocument, position: vscode.Position, newName: string): Promise<vscode.WorkspaceEdit | undefined> {
    const offset = document.offsetAt(position);
    const selected = analyzeDocument(document).declarations.find(declaration => declaration.kind === 'namespace' && declaration.nameWord.contentStart <= offset && offset <= declaration.nameWord.contentEnd);
    if (!selected) return undefined;
    if (!/^[\p{L}_][\p{L}\p{N}_]*$/u.test(newName)) throw new Error('Use a single namespace name; renaming cannot change its parent');
    const oldName = selected.qualifiedName, target = oldName.slice(0, oldName.lastIndexOf('::') + 2) + newName;
    if (target === oldName) return new vscode.WorkspaceEdit();
    const state = await snapshot(document);
    if (hasNamespace(state, target)) throw new Error('The target namespace already exists');
    const remap = (name: string) => name === oldName || name.startsWith(oldName + '::') ? target + name.slice(oldName.length) : name;
    const edit = new vscode.WorkspaceEdit(), seen = new Set<string>();
    const replace = (analysis: DocumentAnalysis, word: Pick<TclWord, 'contentStart' | 'contentEnd' | 'value'>, resolved: string, namespace: string) => {
        const desired = remap(resolved);
        if (desired === resolved) return;
        const newNamespace = remap(namespace);
        let value = desired;
        if (!word.value.startsWith('::')) {
            if (qualifyTclName(word.value, newNamespace) === desired) return;
            if (newNamespace === '::') value = desired.slice(2);
            else if (desired.startsWith(newNamespace + '::')) value = desired.slice(newNamespace.length + 2);
        }
        const key = `${analysis.document.uri}:${word.contentStart}:${word.contentEnd}`;
        if (!seen.has(key)) { seen.add(key); edit.replace(analysis.document.uri, analysis.range(word.contentStart, word.contentEnd), value); }
    };
    for (const analysis of state.analyses) {
        for (const declaration of analysis.declarations) if (['namespace', 'procedure', 'class'].includes(declaration.kind)) {
            const context = analysis.contexts.find(item => item.command.start === declaration.command.start);
            replace(analysis, declaration.nameWord, declaration.qualifiedName, context?.namespace ?? '::');
        }
        for (const context of analysis.contexts) {
            namespaceDirectives(context);
            checkOpaqueReferences(context, analysis.text, [oldName]);
            const words = context.command.words, name = words[0]?.value.replace(/^::/, '');
            const resolved = resolveCall(context, state);
            if (resolved) replace(analysis, words[0], resolved, context.namespace);
            if (name === 'namespace') {
                if (words[1]?.value === 'path' && words.length === 3) {
                    const list = parseTclList(analysis.text, words[2].contentStart, words[2].contentEnd);
                    if (list.errors.length || list.words.some(word => !isStaticWord(word))) throw new Error('Malformed or dynamic namespace path');
                    for (const word of list.words) replace(analysis, word, qualifyTclName(word.value, context.namespace), context.namespace);
                } else if (words[1]?.value === 'import') for (const word of words.slice(2).filter(word => isStaticWord(word) && word.value !== '-force')) replace(analysis, word, qualifyTclName(word.value, context.namespace), context.namespace);
                else if (['exists', 'delete', 'children', 'parent', 'inscope', 'upvar'].includes(words[1]?.value)) {
                    const operands = words[1].value === 'delete' ? words.slice(2) : words.slice(2, 3);
                    for (const word of operands) if (isStaticWord(word)) replace(analysis, word, qualifyTclName(word.value, context.namespace), context.namespace);
                } else if (['which', 'origin'].includes(words[1]?.value)) {
                    const word = words[words.length - 1];
                    if (words.length > 2 && isStaticWord(word)) replace(analysis, word, resolveProcedureName(word.value, context.namespace, state.definitions, state.resolution) ?? qualifyTclName(word.value, context.namespace), context.namespace);
                }
            }
            if (name === 'upvar') {
                const first = /^#?\d+$/.test(words[1]?.value ?? '') ? 2 : 1;
                for (let i = first; i + 1 < words.length; i += 2) if (isStaticWord(words[i]) && words[i].value.startsWith('::')) replace(analysis, words[i], words[i].value, '::');
            }
            if (['oo::define', 'oo::objdefine'].includes(name) && isStaticWord(words[1])) replace(analysis, words[1], qualifyTclName(words[1].value, context.namespace), context.namespace);
            if (name === 'superclass' && context.className) for (const word of words.slice(1)) if (isStaticWord(word)) replace(analysis, word, qualifyTclName(word.value, context.namespace), context.namespace);
            const lambda = getLambdaParts(context.command);
            if (lambda[2]) replace(analysis, lambda[2], qualifyTclName(lambda[2].value, '::'), '::');
        }
        for (const variable of variableRanges(analysis)) {
            const value = analysis.document.getText(variable.range);
            if (!value.includes('::')) continue;
            const from = analysis.document.offsetAt(variable.range.start), to = analysis.document.offsetAt(variable.range.end);
            const namespace = analysis.table.getScopeAt(variable.range.start).namespace ?? '::';
            replace(analysis, { contentStart: from, contentEnd: to, value }, variable.qualifiedName, namespace);
        }
    }
    return edit;
}
