import * as vscode from "vscode";
import * as path from 'path';
import { DenoKernelInstance } from "./denoKernelInstance";


export class Session {
    private static sessionNumber: number = Math.floor(Math.random() * 20000);
    private denoInstance: DenoKernelInstance;
    private currentDocument: vscode.NotebookDocument;
    private outputChannel: vscode.OutputChannel;
    private stopped: boolean = false;
    private started: boolean = false;

    private async execute(exec: vscode.NotebookCellExecution) {
        exec.start();
        exec.clearOutput();
        const result = await this.denoInstance.executeRequest(this.currentDocument.uri.fsPath, exec);
        exec.end(result);
        return result;
    }

    constructor(onError: () => void, doc: vscode.NotebookDocument, outputChannel: vscode.OutputChannel) {
        Session.sessionNumber = (Session.sessionNumber + 5) % 20000;
        this.currentDocument = doc;
        this.outputChannel = outputChannel;
        this.denoInstance = new DenoKernelInstance(
            onError,
            doc.uri.fsPath.split(path.sep).slice(0, -1).join(path.sep) + path.sep,
            40885 + Session.sessionNumber,
            40886 + Session.sessionNumber,
            40887 + Session.sessionNumber,
            40888 + Session.sessionNumber,
            40889 + Session.sessionNumber,
            this.outputChannel
        );
    }

    public async start() {
        await this.denoInstance.start();
        this.started = true;
    }

    public isDocumentClosed() {
        return this.currentDocument.isClosed;
    }

    public tryClose() {
        this.denoInstance.tryClose();
        this.stopped = true;
    }

    public async executeCells(
        _doc: vscode.NotebookDocument,
        cells: vscode.NotebookCell[],
        ctrl: vscode.NotebookController
    ): Promise<void> {
        for (const cell of cells) {
            if (this.started && !this.stopped) {
                const exec = ctrl.createNotebookCellExecution(cell);
                const isOk = await this.execute(exec);
                if (!isOk) { break };
            }
        }
    }
}
