import * as vscode from 'vscode';
import { TclFormatter, TclFormattingOptions } from './tclFormatter';

export class TclFormattingProvider implements vscode.DocumentFormattingEditProvider, vscode.DocumentRangeFormattingEditProvider {
    private createFormatter(options: vscode.FormattingOptions): TclFormatter {
        const config = vscode.workspace.getConfiguration('tcl');

        const formatterOptions: TclFormattingOptions = {
            indentSize: options.tabSize,
            useTabs: !options.insertSpaces,
            alignBraces: config.get<boolean>('format.alignBraces', true),
            spacesAroundOperators: config.get<boolean>('format.spacesAroundOperators', true),
            spacesInsideBraces: config.get<boolean>('format.spacesInsideBraces', true),
            spacesInsideBrackets: config.get<boolean>('format.spacesInsideBrackets', false),
        };

        return new TclFormatter(formatterOptions);
    }

    provideDocumentFormattingEdits(
        document: vscode.TextDocument,
        options: vscode.FormattingOptions,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.TextEdit[]> {
        const formatter = this.createFormatter(options);
        const firstLine = document.lineAt(0);
        const lastLine = document.lineAt(document.lineCount - 1);
        const fullRange = new vscode.Range(firstLine.range.start, lastLine.range.end);
        const formatted = formatter.format(document.getText());

        return [vscode.TextEdit.replace(fullRange, formatted)];
    }

    provideDocumentRangeFormattingEdits(
        document: vscode.TextDocument,
        range: vscode.Range,
        options: vscode.FormattingOptions,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.TextEdit[]> {
        const formatter = this.createFormatter(options);
        const formatted = formatter.format(document.getText(range));

        return [vscode.TextEdit.replace(range, formatted)];
    }
}
