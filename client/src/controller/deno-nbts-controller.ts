import * as vscode from "vscode";

import { Session } from './session';

export class DenoNBTSController {

    public static readonly label = "DenoNBTS";
    public static readonly id = "deno-nbts-kernel";
    public static readonly supportedLanguages = ["typescript"];

    private context: vscode.ExtensionContext;
    private sessions = new Map<string, Session>();

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        setInterval(() => {
            try {
                let entries = [...this.sessions.entries()];
                let closed = entries.filter((entry) => entry[1].isDocumentClosed());
                for (let e of closed) {
                    e[1].kill();
                    this.sessions.delete(e[0]);
                }
            }
            catch (e) { DenoNBTSController.output.appendLine(`${e}`); }
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
            session = new Session(doc, DenoNBTSController.output);
            this.sessions.set(doc.uri.fsPath, session);
        }
        await session.executeCells(doc, cells, ctrl);
    }

    public killAll(signal?: NodeJS.Signals | number) {
        for (let session of this.sessions.values()) {
            session.kill(signal);
        }
    }

    public killSession(uri: string) {
        const session = this.sessions.get(uri);
        if (session) {
            session.kill();
            this.sessions.delete(uri);
        }
    }

}


