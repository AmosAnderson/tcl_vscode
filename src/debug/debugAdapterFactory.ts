import * as vscode from 'vscode';
import { TclDebugSession } from './tclDebugAdapter';

export class TclDebugAdapterDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {
    
    createDebugAdapterDescriptor(session: vscode.DebugSession, executable: vscode.DebugAdapterExecutable | undefined): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
        // Use inline debug adapter implementation
        return new vscode.DebugAdapterInlineImplementation(new TclDebugSession());
    }

    dispose() {
        // Cleanup if needed
    }
}

export class TclConfigurationProvider implements vscode.DebugConfigurationProvider {

    /**
     * Massage a debug configuration just before a debug session is being launched,
     * e.g. add all missing attributes to the debug configuration.
     */
    resolveDebugConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration, token?: vscode.CancellationToken): vscode.ProviderResult<vscode.DebugConfiguration> {

        // if launch.json is missing or empty
        if (!config.type && !config.request && !config.name) {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.languageId === 'tcl') {
                config.type = 'tcl';
                config.name = 'Launch';
                config.request = 'launch';
                config.program = '${file}';
                config.stopOnEntry = true;
            }
        }

        if (!config.program) {
            return vscode.window.showInformationMessage("Cannot find a program to debug").then(_ => {
                return undefined;	// abort launch
            });
        }

        return config;
    }

    /**
     * Provide dynamic configurations for the debug configuration dropdown.
     */
    provideDebugConfigurations(folder: vscode.WorkspaceFolder | undefined, token?: vscode.CancellationToken): vscode.ProviderResult<vscode.DebugConfiguration[]> {
        return [
            {
                name: "Launch TCL",
                request: "launch",
                type: "tcl",
                program: "${file}",
                stopOnEntry: true,
                tclPath: "tclsh",
                cwd: "${workspaceFolder}"
            },
            {
                name: "Launch TCL (No Stop)",
                request: "launch", 
                type: "tcl",
                program: "${file}",
                stopOnEntry: false,
                tclPath: "tclsh",
                cwd: "${workspaceFolder}"
            }
        ];
    }

    /**
     * Called when VS Code needs initial debug configurations (e.g., when creating launch.json)
     */
    provideDebugConfigurationSnippets?(folder: vscode.WorkspaceFolder | undefined, token?: vscode.CancellationToken): vscode.ProviderResult<vscode.DebugConfiguration[]> {
        return this.provideDebugConfigurations(folder, token);
    }
}