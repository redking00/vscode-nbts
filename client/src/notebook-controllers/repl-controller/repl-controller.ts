import * as vscode from "vscode";

import { REPLSession } from './repl-session/repl-session';
import { IController } from "../types";

export class REPLController implements IController {

    public static readonly label = "DenoNBTS(repl)";
    public static readonly id = "deno-nbts-kernel-repl";
    public static readonly supportedLanguages = ["typescript"];
    private context: vscode.ExtensionContext;
    private sessions = new Map<string, REPLSession>();

    private onError = (fsPath: string) => this.killSession(fsPath)

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        setInterval(() => {
            const closed: [string, REPLSession][] = [...this.sessions.entries()].filter(([_fsPath, session]) => session.isDocumentClosed());
            closed.forEach(([fsPath, session]) => {
                session.tryClose();
                this.sessions.delete(fsPath);
            });
        }, 5000);
    }

    public get output() {
        const value = vscode.window.createOutputChannel("DenoNBTS(repl)");
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
            session = new REPLSession(this.context, () => this.onError(doc.uri.fsPath), doc, this.output);
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


