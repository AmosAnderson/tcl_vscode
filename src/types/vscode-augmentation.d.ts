import 'vscode';

declare module 'vscode' {
    export interface DocumentFormatterMetadata {
        readonly displayName?: string;
    }

    export namespace languages {
        export function registerDocumentFormattingEditProvider(
            selector: DocumentSelector,
            provider: DocumentFormattingEditProvider,
            metadata?: DocumentFormatterMetadata
        ): Disposable;

        export function registerDocumentRangeFormattingEditProvider(
            selector: DocumentSelector,
            provider: DocumentRangeFormattingEditProvider,
            metadata?: DocumentFormatterMetadata
        ): Disposable;
    }
}
