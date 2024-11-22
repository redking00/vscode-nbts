import * as vscode from "vscode";

import { Session } from './session/session';

export class DenoNBTSController {

    public static readonly label = "DenoNBTS";
    public static readonly id = "deno-nbts-kernel";
    public static readonly supportedLanguages = ["typescript"];

    private context: vscode.ExtensionContext;
    private sessions = new Map<string, Session>();


    private onError = (fsPath: string) => this.killSession(fsPath)

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        setInterval(() => {
            const closed: [string, Session][] = [...this.sessions.entries()].filter(([_fsPath, session]) => session.isDocumentClosed());
            closed.forEach(([fsPath, session]) => {
                session.tryClose();
                this.sessions.delete(fsPath);
            });
        }, 1000);
    }

    public static get output() {
        const value = vscode.window.createOutputChannel("DenoNBTS");
        Object.defineProperty(this, "output", { value });
        return value;
    }

    public interrupt(document: vscode.NotebookDocument): void {
        this.killSession(document.uri.fsPath);
    }

    public async executeCells(
        doc: vscode.NotebookDocument,
        cells: vscode.NotebookCell[],
        ctrl: vscode.NotebookController
    ): Promise<void> {
        let session = this.sessions.get(doc.uri.fsPath);
        if (!session) {
            session = new Session(() => this.onError(doc.uri.fsPath), doc, DenoNBTSController.output);
            this.sessions.set(doc.uri.fsPath, session);
            await session.start();
        }
        await session.executeCells(doc, cells, ctrl);
    }

    public killAll() {
        [...this.sessions.keys()].forEach((fsPath) => this.killSession(fsPath));
    }

    public killSession(fsPath: string) {
        const session = this.sessions.get(fsPath);
        if (session) {
            session.tryClose();
            this.sessions.delete(fsPath);
        }
    }

}


