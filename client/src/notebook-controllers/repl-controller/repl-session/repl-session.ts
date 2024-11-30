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
                //(stripAnsi(parts.slice(-1)[0]).trim() === '>') ||
                (parts.length > 1 && (stripAnsi(parts.slice(-2)[0]).trim() === '>')) ||
                (parts.length > 2 && (stripAnsi(parts.slice(-2)[0]).trim() === '') && (stripAnsi(parts.slice(-3)[0]).trim() === '>'))
            ) {
                dataSub.dispose();
                onData(buffer.join(''));
                resolver();
            }
        });
        return dataPromise;
    }


    private async runCode(code: string, onDataLine: (dataLines: string) => void): Promise<void> {
        code = code.split(/\r?\n/).join(CTRL_S);
        const executionId = UUID.uuid4();
        let resolver: () => void;
        const dataPromise = new Promise<void>((resolve) => { resolver = resolve; });
        let isOutput = false;
        const buffer: string[] = [];
        const dataSub = this.proc.onData((data) => {
            const parts = data.split(/(\r\n|\r|\n)/);
            let isFinish = false;
            for (const [lineIndex, line] of parts.entries()) {
                if (!isOutput) {
                    if (stripAnsi(line).includes(`${executionId}`)) {
                        isOutput = true;
                    }
                }
                else {
                    buffer.push(line);
                    onDataLine(line);
                }
                if (buffer.length > 0) {
                    if (
                        //(stripAnsi(buffer.slice(-1)[0]).trim() === '>') ||
                        (buffer.length > 1 && (stripAnsi(buffer.slice(-2)[0]).trim() === '>')) ||
                        (buffer.length > 2 && (stripAnsi(buffer.slice(-2)[0]).trim() === '') && (stripAnsi(buffer.slice(-3)[0]).trim() === '>'))
                    ) {
                        isFinish = true;
                    }
                }
            }
            if (isFinish) {
                dataSub.dispose();
                isOutput = false;
                buffer.splice(0, buffer.length);
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
        const errors: string[] = [];
        const dataLines: string[] = [];
        const displayData: string[] = [];
        let isDisplayData = false;
        let hasOutput = false;
        let outputs: vscode.NotebookCellOutput[] = [];


        await this.runCode(code, async (dataLine) => {
            if (isDisplayData) {
                if (stripAnsi(dataLine).trim().startsWith("##ENDDISPLAYDATA#2d522e5a-4a6c-4aae-b20c-91c5189948d9##")) {
                    isDisplayData = false;
                    const output = REPLSession.processOutput(JSON.parse(displayData.join('')))
                    outputs.push(output);
                    await exec.appendOutput([output]);
                    displayData.splice(0, displayData.length);
                }
                else {
                    displayData.push(stripAnsi(dataLine));
                }
            }
            else {
                if (stripAnsi(dataLine).trim().startsWith("##DISPLAYDATA#2d522e5a-4a6c-4aae-b20c-91c5189948d9##")) {
                    isDisplayData = true;
                    hasOutput = false;
                    dataLines.splice(0, dataLines.length);
                }
                else {
                    dataLines.push(dataLine);
                    if (REPLSession.lineIsError(stripAnsi(dataLine))) {
                        errors.push(dataLine);
                    }
                    if (!hasOutput) {
                        hasOutput = true;
                        const output = new vscode.NotebookCellOutput([
                            vscode.NotebookCellOutputItem.stdout(dataLines.join(''))
                        ])
                        outputs.push(output);
                        await exec.appendOutput([output]);
                    }
                    else {
                        exec.replaceOutputItems([
                            vscode.NotebookCellOutputItem.stdout(dataLines.join(''))
                        ], outputs.slice(-1)[0]);
                    }
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
