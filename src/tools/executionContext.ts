import * as vscode from 'vscode';
import * as path from 'path';

export function activeTclResource(): vscode.Uri | undefined {
    return vscode.window.activeTextEditor?.document.uri ?? vscode.workspace.workspaceFolders?.[0]?.uri;
}

export function resolveTclFolder(resource = activeTclResource()): vscode.WorkspaceFolder | undefined {
    return resource ? vscode.workspace.getWorkspaceFolder(resource) : vscode.workspace.workspaceFolders?.[0];
}

/** Defaults of feature settings must not mask the selected project interpreter. */
export function resolveTclInterpreter(resource?: vscode.Uri, feature?: 'repl' | 'test', override?: string): string {
    if (override?.trim()) return override;
    const config = vscode.workspace.getConfiguration('tcl', resource ?? activeTclResource());
    if (feature) {
        const setting = config.inspect<string>(`${feature}.tclPath`);
        const explicit = setting?.workspaceFolderValue ?? setting?.workspaceValue ?? setting?.globalValue;
        if (explicit?.trim()) return explicit;
    }
    return config.get<string>('interpreter.path')?.trim() || 'tclsh';
}

export function resolveTclCwd(resource = activeTclResource(), override?: string): string | undefined {
    const folder = resolveTclFolder(resource);
    if (override) {
        const expanded = override.replace(/\$\{workspaceFolder\}/g, folder?.uri.fsPath ?? '').replace(/\$\{fileDirname\}/g, resource ? path.dirname(resource.fsPath) : '');
        return path.isAbsolute(expanded) ? expanded : path.resolve(folder?.uri.fsPath ?? process.cwd(), expanded);
    }
    return folder?.uri.fsPath ?? (resource?.scheme === 'file' ? path.dirname(resource.fsPath) : undefined);
}

export function tclConfigurationTarget(resource?: vscode.Uri): vscode.ConfigurationTarget {
    return resolveTclFolder(resource) ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Global;
}
