import * as vscode from 'vscode';
import { TclFormatter, TclFormattingOptions } from './tclFormatter';

export class TclFormattingProvider implements vscode.DocumentFormattingEditProvider, vscode.DocumentRangeFormattingEditProvider {
    private createFormatter(options: vscode.FormattingOptions, resource: vscode.Uri): TclFormatter {
        const config = vscode.workspace.getConfiguration('tcl', resource);

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
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.TextEdit[]> {
        try {
            const formatter = this.createFormatter(options, document.uri);
            const firstLine = document.lineAt(0);
            const lastLine = document.lineAt(document.lineCount - 1);
            const fullRange = new vscode.Range(firstLine.range.start, lastLine.range.end);
            const formatted = formatter.format(document.getText());

            return [vscode.TextEdit.replace(fullRange, formatted)];
        } catch (error) {
            console.error('TCL formatting failed:', error);
            return [];
        }
    }

    provideDocumentRangeFormattingEdits(
        document: vscode.TextDocument,
        range: vscode.Range,
        options: vscode.FormattingOptions,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.TextEdit[]> {
        try {
            const formatter = this.createFormatter(options, document.uri);
            const edit = formatter.formatRange(document.getText(), document.offsetAt(range.start), document.offsetAt(range.end));
            return edit ? [vscode.TextEdit.replace(new vscode.Range(document.positionAt(edit.start), document.positionAt(edit.end)), edit.text)] : [];
        } catch (error) {
            console.error('TCL range formatting failed:', error);
            return [];
        }
    }
}
