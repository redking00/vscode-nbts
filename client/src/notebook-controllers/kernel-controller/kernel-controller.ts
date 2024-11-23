import * as vscode from "vscode";

import { KernelSession } from './kernel-session/kernel-session';
import { IController } from "../types";

export class KernelController implements IController {

    public static readonly label = "DenoNBTS(main)";
    public static readonly id = "deno-nbts-kernel";
    public static readonly supportedLanguages = ["typescript"];

    private sessions = new Map<string, KernelSession>();

    private onError = (fsPath: string) => this.killSession(fsPath)

    constructor() {
        setInterval(() => {
            const closed: [string, KernelSession][] = [...this.sessions.entries()].filter(([_fsPath, session]) => session.isDocumentClosed());
            closed.forEach(([fsPath, session]) => {
                session.tryClose();
                this.sessions.delete(fsPath);
            });
        }, 1000);
    }

    public get output() {
        const value = vscode.window.createOutputChannel("DenoNBTS(kernel)");
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
            session = new KernelSession(() => this.onError(doc.uri.fsPath), doc, this.output);
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


