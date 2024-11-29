import * as vscode from "vscode";
import * as path from 'path';
import { IPty, ISession } from "../../types";
import { DenoTool } from "../../../tools";
import stripAnsi from 'strip-ansi';
import { EOL } from "os";
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


    private ptyAwaitPrompt: (onLines: (lines: string[]) => void) => Promise<void> = (onLines) => {
        let resolver: () => void;
        const dataPromise = new Promise<void>((resolve) => { resolver = resolve; });
        let buffer: string[] = [];
        const dataSub = this.proc.onData((data) => {
            const parts = data.split(/[\r\n]/);
            if (parts.length === 1) {
                buffer.push(parts[0]);
                return;
            }
            parts[0] = buffer.join('') + parts[0];
            buffer = parts.slice(-1).length > 0 ? parts.splice(-1) : buffer = [];
            onLines(parts);
            if (buffer.length && stripAnsi(buffer[0]).trim() === '>') {
                dataSub.dispose();
                resolver();
            }
        });
        return dataPromise;
    }


    private async runCode(code: string, onLines: (lines: string[]) => void): Promise<void> {
        code = code.split(/\r?\n/).join(CTRL_S);
        const executionId = UUID.uuid4();
        console.log(executionId);
        let resolver: () => void;
        const dataPromise = new Promise<void>((resolve) => { resolver = resolve; });
        let buffer: string[] = [];
        let isOutput = false;
        const dataSub = this.proc.onData((data) => {
            const parts = data.split(/[\r\n]/);
            if (parts.length === 1) {
                buffer.push(parts[0]);
                return;
            }
            parts[0] = buffer.join('') + parts[0];
            buffer = parts.slice(-1).length > 0 ? parts.splice(-1) : buffer = [];
            if (!isOutput) {
                const idx = ((partss: string[]): number => {
                    for (const [i, l] of partss.entries()) {
                        if (stripAnsi(l).replaceAll('\r', '').includes(`${executionId}`)) {
                            return i;
                        }
                    }
                    return -1;
                })(parts);
                if (idx >= 0) {
                    isOutput = true;
                    onLines(parts.slice(idx + 1));
                }
            }
            else {
                onLines(parts);
            }
            if (buffer.length && stripAnsi(buffer[0]).trim() === '>') {
                dataSub.dispose();
                resolver();
            }
        });
        const id = executionId.split('-');
        this.proc.write(`console.log("${id[0]}"+"-${id[1]}"+"-${id[2]}"+"-${id[3]}"+"-${id[4]}");${CTRL_S}${code}\r`);
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
        let errors: string[] = [];
        await this.runCode(code, (lines) => {
            for (const [lineNumber, l] of lines.entries()) {
                const isError = REPLSession.lineIsError(l);
                const index = stripAnsi(l).indexOf('##DISPLAYDATA#2d522e5a-4a6c-4aae-b20c-91c5189948d9##');
                if (index === 0) {
                    const display_data: Record<string, string> = JSON.parse(l.substring(52));
                    exec.appendOutput([REPLSession.processOutput(display_data)]);
                }
                else {
                    const s = l.startsWith(EOL) ? l.split(EOL).slice(1).join(EOL) : l;
                    exec.appendOutput([
                        new vscode.NotebookCellOutput([
                            vscode.NotebookCellOutputItem.stdout(s)
                        ])
                    ]);
                }
                if (isError) {
                    errors.push(l)
                }
            }
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
            this.outputChannel.appendLine('\n### DENO EXITED');
        });
    }

    public async start() {
        await this.ptyAwaitPrompt((lines) => lines.map(l => this.outputChannel.appendLine(l)));
        await this.runCode('"Welcome to the REPL kernel (on pty)"', (lines) => lines.map(l => this.outputChannel.appendLine(l)));
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
        this.proc.kill("SIGTERM");
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
