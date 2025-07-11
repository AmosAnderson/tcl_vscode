import * as vscode from 'vscode';
import { TclFormatter, TclFormattingOptions } from './tclFormatter';

export class TclDocumentFormattingEditProvider implements vscode.DocumentFormattingEditProvider {
    private formatter: TclFormatter;

    constructor() {
        this.formatter = new TclFormatter();
    }

    provideDocumentFormattingEdits(
        document: vscode.TextDocument,
        options: vscode.FormattingOptions,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.TextEdit[]> {
        const config = vscode.workspace.getConfiguration('tcl');
        
        const formatterOptions: TclFormattingOptions = {
            indentSize: options.tabSize,
            useTabs: !options.insertSpaces,
            alignBraces: config.get<boolean>('format.alignBraces', true),
            spacesAroundOperators: config.get<boolean>('format.spacesAroundOperators', true),
            spacesInsideBraces: config.get<boolean>('format.spacesInsideBraces', true),
            spacesInsideBrackets: config.get<boolean>('format.spacesInsideBrackets', false),
        };

        this.formatter = new TclFormatter(formatterOptions);

        const text = document.getText();
        const formatted = this.formatter.format(text);

        const firstLine = document.lineAt(0);
        const lastLine = document.lineAt(document.lineCount - 1);
        const range = new vscode.Range(firstLine.range.start, lastLine.range.end);

        return [vscode.TextEdit.replace(range, formatted)];
    }
}

export class TclDocumentRangeFormattingEditProvider implements vscode.DocumentRangeFormattingEditProvider {
    private formatter: TclFormatter;

    constructor() {
        this.formatter = new TclFormatter();
    }

    provideDocumentRangeFormattingEdits(
        document: vscode.TextDocument,
        range: vscode.Range,
        options: vscode.FormattingOptions,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.TextEdit[]> {
        const config = vscode.workspace.getConfiguration('tcl');
        
        const formatterOptions: TclFormattingOptions = {
            indentSize: options.tabSize,
            useTabs: !options.insertSpaces,
            alignBraces: config.get<boolean>('format.alignBraces', true),
            spacesAroundOperators: config.get<boolean>('format.spacesAroundOperators', true),
            spacesInsideBraces: config.get<boolean>('format.spacesInsideBraces', true),
            spacesInsideBrackets: config.get<boolean>('format.spacesInsideBrackets', false),
        };

        this.formatter = new TclFormatter(formatterOptions);

        const text = document.getText(range);
        const formatted = this.formatter.format(text);

        return [vscode.TextEdit.replace(range, formatted)];
    }
}