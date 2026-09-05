import { isStaticWord, parseTclScript, walkTclCommands } from '../utils/tclParser';

export interface PackageRequirement {
    name: string;
    versions: string[];
    exact: boolean;
    source: string;
    offset: number;
    development: boolean;
    dynamic: boolean;
}

export function parsePackageRequirements(text: string, source: string, metadata = false): PackageRequirement[] {
    const result: PackageRequirement[] = [];
    for (const command of walkTclCommands(text)) {
        const words = command.words;
        if (!isStaticWord(words[0])) continue;
        const name = words[0].value.replace(/^::/, '');
        let start: number;
        let development = false;
        if (name === 'package' && isStaticWord(words[1]) && words[1].value === 'require') start = 2;
        else if (metadata && (name === 'require' || name === 'test-require')) { start = 1; development = name === 'test-require'; }
        else continue;
        const exact = isStaticWord(words[start]) && words[start].value === '-exact';
        if (exact) start++;
        if (!words[start]) continue;
        const arguments_ = words.slice(start);
        result.push({ name: arguments_[0].value, versions: arguments_.slice(1).map(word => word.value), exact,
            source, offset: command.start, development, dynamic: arguments_.some(word => !isStaticWord(word)) });
    }
    return result;
}

export function parsePackageRegistrations(text: string): { name: string; version: string }[] {
    const result: { name: string; version: string }[] = [];
    for (const { words } of walkTclCommands(text)) {
        if (isStaticWord(words[0]) && words[0].value.replace(/^::/, '') === 'package' && isStaticWord(words[1]) &&
            ['provide', 'ifneeded'].includes(words[1].value) && isStaticWord(words[2]) && isStaticWord(words[3])) {
            result.push({ name: words[2].value, version: words[3].value });
        }
    }
    return result;
}

export function parsePackageMetadata(text: string): { name?: string; version?: string; description?: string } {
    const result: { name?: string; version?: string; description?: string } = {};
    for (const { words } of parseTclScript(text).commands) {
        if (!isStaticWord(words[0]) || !words.slice(1).every(isStaticWord)) continue;
        const key = words[0].value;
        if (key === 'name' || key === 'version' || key === 'description') result[key] = words.slice(1).map(word => word.value).join(' ');
    }
    return result;
}

/** Ordering only. Compatibility is delegated to the selected Tcl interpreter. */
export function compareTclVersions(left: string, right: string): number {
    const parts = (value: string) => value.replace(/a/g, '.-2.').replace(/b/g, '.-1.').split('.').map(Number);
    const a = parts(left), b = parts(right);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const difference = (a[i] || 0) - (b[i] || 0);
        if (difference) return difference;
    }
    return 0;
}
