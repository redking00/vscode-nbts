import * as vscode from "vscode";
import * as path from 'path';
import { ISession } from "../../types";
import { TextEncoder } from "util";
import { DenoTool } from "../../../tools";
import stripAnsi from 'strip-ansi';
import { UUID } from "@lumino/coreutils";
import { ChildProcess } from "child_process";

const CTRL_S = '\r';

export class REPLSession implements ISession {
    private context: vscode.ExtensionContext;
    private currentDocument: vscode.NotebookDocument;
    private outputChannel: vscode.OutputChannel;
    private stopped: boolean = false;
    private started: boolean = false;
    private proc: ChildProcess
    private currentExecution?: vscode.NotebookCellExecution;

    private static lineIsError(line: string): boolean {
        return line.match(/^Uncaught (.*)Error:/) !== null;
    }

    private async runCode(code: string, onDataLine?: (dataLines: string) => void): Promise<void> {
        code = code.split(/\r?\n/).join(CTRL_S);
        const executionId = UUID.uuid4();
        let resolver: () => void;
        const dataPromise = new Promise<void>((resolve) => { resolver = resolve; });
        this.proc.stdout?.on("data", (data) => {
            const parts = data.split(/(\r\n|\r|\n)/);
            let isFinish = false;
            for (const line of parts) {
                const cLine = stripAnsi(line);
                let pushLine = true;
                if (!isFinish) {
                    if (REPLSession.lineIsError(cLine)) {
                        isFinish = true;
                    }
                    else if (cLine.includes(executionId)) {
                        isFinish = true;
                        pushLine = false;
                    }
                }
                if (pushLine && onDataLine) onDataLine(line);
            }
            if (isFinish) {
                this.proc.stdout?.removeAllListeners();
                resolver();
            }
        });
        code += `${CTRL_S}"${executionId}"\n`;
        this.proc.stdin!.write(new TextEncoder().encode(code));
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
            const dl = stripAnsi(dataLine);
            const dlt = dl.trim();
            if (isDisplayData) {
                if (dlt.startsWith("##ENDDISPLAYDATA#2d522e5a-4a6c-4aae-b20c-91c5189948d9##")) {
                    isDisplayData = false;
                    const output = REPLSession.processOutput(JSON.parse(displayData.join('')))
                    outputs.push(output);
                    await exec.appendOutput([output]);
                    displayData.splice(0, displayData.length);
                }
                else {
                    displayData.push(dl);
                }
            }
            else {
                if (dlt.startsWith("##DISPLAYDATA#2d522e5a-4a6c-4aae-b20c-91c5189948d9##")) {
                    isDisplayData = true;
                    hasOutput = false;
                    dataLines.splice(0, dataLines.length);
                }
                else {
                    dataLines.push(dataLine);
                    if (REPLSession.lineIsError(dl)) {
                        errors.push(dataLine);
                    }
                    if (!hasOutput) {
                        const dlts = stripAnsi(dataLines.join('')).trim();
                        if (dlts.length > 0) {
                            hasOutput = true;
                            const output = new vscode.NotebookCellOutput([
                                vscode.NotebookCellOutputItem.stdout(dataLines.join(''))
                            ])
                            outputs.push(output);
                            await exec.appendOutput([output]);
                        }
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
        this.proc = DenoTool.syncLaunch(['repl', `--eval-file=${bootScriptPath}`, '--allow-all'], cwd)!;
        this.proc!.on("exit", () => {
            if (!this.stopped) onError();
            this.outputChannel.appendLine('\n### DENO EXITED');
        });
    }

    public async start() {
        await this.runCode("console.log('Welcome to Deno repl kernel');");
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
