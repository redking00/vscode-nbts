import * as vscode from 'vscode';

export interface ISession {
    start(): void;
    isDocumentClosed(): boolean;
    tryClose(): void;
    executeCells(
        _doc: vscode.NotebookDocument,
        cells: vscode.NotebookCell[],
        ctrl: vscode.NotebookController
    ): Promise<void>;
}


export interface IController {
    get output(): vscode.OutputChannel;
    interrupt(document: vscode.NotebookDocument): void;
    executeCells(
        doc: vscode.NotebookDocument,
        cells: vscode.NotebookCell[],
        ctrl: vscode.NotebookController
    ): Promise<void>;
    killAll(): void;
    killSession(fsPath: string): void;
}


