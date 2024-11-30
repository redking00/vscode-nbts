import * as vscode from "vscode";
import * as path from 'path';
import { IPty, ISession } from "../../types";
import { DenoTool } from "../../../tools";
import stripAnsi from 'strip-ansi';
import { UUID } from "@lumino/coreutils";

const CTRL_S = String.fromCharCode(19);


export class REPLSession implements ISession {
    private context: vscode.ExtensionContext;
    private currentDocument: vscode.NotebookDocument;
    private outputChannel: vscode.OutputChannel;
    private stopped: boolean = false;
    private started: boolean = false;
    private proc: IPty;
    private currentExecution?: vscode.NotebookCellExecution;

    private static lineIsError(line: string): boolean {
        return line.startsWith('Uncaught Error: ')
            || line.startsWith('Uncaught TypeError: ')
            || line.startsWith('Uncaught ReferenceError: ');
    }

    private ptyAwaitPrompt: (onData: (data: string) => void) => Promise<void> = (onData) => {
        let resolver: () => void;
        const dataPromise = new Promise<void>((resolve) => { resolver = resolve; });
        const buffer: string[] = [];
        const dataSub = this.proc.onData((data) => {
            const parts = data.split(/(\r\n|\r|\n)/);
            buffer.push(...parts);
            if (
                (stripAnsi(parts.slice(-1)[0]).trim() === '>') ||
                (parts.length > 1 && (stripAnsi(parts.slice(-2)[0]).trim() === '>'))
            ) {
                dataSub.dispose();
                onData(buffer.join(''));
                resolver();
            }
        });
        return dataPromise;
    }


    private async runCode(code: string, onDataLines: (dataLines: string[]) => void): Promise<void> {
        code = code.split(/\r?\n/).join(CTRL_S);
        const executionId = UUID.uuid4();
        let resolver: () => void;
        const dataPromise = new Promise<void>((resolve) => { resolver = resolve; });
        let isOutput = false;
        const buffer: string[] = [];
        const dataSub = this.proc.onData((data) => {
            const parts = data.split(/(\r\n|\r|\n)/);
            if (!isOutput) {
                const idx = parts.findIndex((l) => stripAnsi(l).includes(`${executionId}`));
                if (idx >= 0) {
                    isOutput = true;
                    buffer.push(...parts.slice(idx + 1));
                }
            } else {
                buffer.push(...parts);
            }
            if (parts.length > 0) {
                if (
                    (stripAnsi(parts.slice(-1)[0]).trim() === '>') ||
                    (parts.length > 1 && (stripAnsi(parts.slice(-2)[0]).trim() === '>'))
                ) {
                    dataSub.dispose();
                    onDataLines(buffer);
                    isOutput = false;
                    buffer.splice(0, buffer.length);
                    resolver();
                }
            }
        });
        const id = executionId.split('-');
        this.proc.write(`console.log("${id[0]}"+"-${id[1]}"+"-${id[2]}"+"-${id[3]}"+"-${id[4]}\n");${CTRL_S}${code}\r`);
        return dataPromise;
    }


    private static processOutput(results: any) {
        return new vscode.NotebookCellOutput([...Object.keys(results)].map((mime) => {
            if (mime === "image/svg+xml") {
                return vscode.NotebookCellOutputItem.text(results[mime], mime);
            }
            else if (mime.startsWith("image")) {
                let buff = Buffer.from(results[mime], 'base64');
                return new vscode.NotebookCellOutputItem(buff, mime);
            }
            else if (mime.includes("json")) {
                return vscode.NotebookCellOutputItem.json(results[mime], mime);
            }
            else {
                return vscode.NotebookCellOutputItem.text(results[mime], mime);
            }
        }));
    }

    private async execute(exec: vscode.NotebookCellExecution): Promise<boolean> {
        this.currentExecution = exec;
        exec.start();
        exec.clearOutput();
        let code = exec.cell.document.getText();
        const errors: string[] = [];
        await this.runCode(code, (dataLines) => {
            errors.push(...dataLines.filter(p => REPLSession.lineIsError(stripAnsi(p))));
            exec.appendOutput([
                new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.stdout(dataLines.join(''))
                ])
            ]);
        });
        const isOk = errors.length === 0;
        exec.end(isOk);
        return isOk;
    }


    constructor(context: vscode.ExtensionContext, onError: () => void, doc: vscode.NotebookDocument, outputChannel: vscode.OutputChannel) {
        this.context = context;
        this.currentDocument = doc;
        this.outputChannel = outputChannel;
        const cwd = doc.uri.fsPath.split(path.sep).slice(0, -1).join(path.sep) + path.sep;
        const bootScriptPath = path.resolve(this.context.extensionPath, 'client', 'src', 'notebook-controllers', 'repl-controller', 'boot', 'boot.ts');
        this.proc = DenoTool.syncLaunchPTY(['repl', `--eval-file=${bootScriptPath}`, '--allow-all'], cwd)!;
        this.proc.onExit(() => {
            if (!this.stopped) onError();
            console.log('\n### DENO EXITED');
        });
    }

    public async start() {
        await this.ptyAwaitPrompt((data) => console.log(data));
        await this.runCode('"Welcome to the REPL kernel (on pty)"', (data) => console.log(data));
        this.started = true;
    }

    public isDocumentClosed() {
        return this.currentDocument.isClosed;
    }

    public tryClose() {
        this.stopped = true;
        if (this.currentExecution) {
            try { this.currentExecution.end(false); } catch (_) { }
        }
        this.stopped = true;
        this.proc.kill();
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
