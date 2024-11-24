import * as vscode from "vscode";
import * as path from 'path';
import { ISession } from "../../types";
import { ChildProcess } from "child_process";
import { DenoTool } from "../../../tools";
import { TextEncoder } from "util";
import * as AnsiParser from "ansi-parser";
import { UUID } from "@lumino/coreutils";


export class REPLSession implements ISession {
    private context: vscode.ExtensionContext;
    private currentDocument: vscode.NotebookDocument;
    private outputChannel: vscode.OutputChannel;
    private stopped: boolean = false;
    private started: boolean = false;
    private proc: ChildProcess;
    private currentExecution?: vscode.NotebookCellExecution;

    private static lineIsError(line: string): boolean {
        return line.startsWith('Uncaught Error: ')
            || line.startsWith('Uncaught TypeError: ')
            || line.startsWith('Uncaught ReferenceError: ');
    }

    private runCode(code: string): Promise<{ lines: string[], errors: string[] }> {
        let resolver: (result: { lines: string[], errors: string[] }) => void;
        const result = new Promise<{ lines: string[], errors: string[] }>((resolve) => resolver = resolve);
        const executionId = UUID.uuid4();
        let resultLines = [];
        let errors = [];
        const dataHandler = (data: string) => {
            const rawLines = data.replaceAll('\r\n', '\n').split('\n');
            const filteredLines = rawLines.filter((l) => l !== '\x1b[90mundefined\x1b[39m');
            const lines = filteredLines.map((l) => AnsiParser.removeAnsi(l));
            errors.push(...lines.filter((l: string) => REPLSession.lineIsError(l)));
            let finished = false;
            if (lines.length > 1 && lines[lines.length - 1] === '') {
                if (lines[lines.length - 2] === `"${executionId}"`) {
                    lines.splice(-2, 2);
                    finished = true;
                }
            }
            resultLines.push(...lines);
            if (finished) {
                this.proc.stdout!.removeListener("data", dataHandler);
                resolver({
                    lines: resultLines,
                    errors: errors
                });
            }
        }
        this.proc.stdout!.addListener("data", dataHandler);
        code += `\n"${executionId}"\n`;
        this.proc.stdin!.write(new TextEncoder().encode(code));
        return result;
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
        this.currentExecution.start();
        this.currentExecution.clearOutput();
        let resolver: (result: boolean) => void;
        const result = new Promise<boolean>((resolve) => resolver = resolve);
        const executionId = UUID.uuid4();
        let errors = [];
        const dataHandler = (data: string) => {
            const rawLines = data.replaceAll('\r\n', '\n').split('\n');
            const filteredLines = rawLines.filter((l) => l !== '\x1b[90mundefined\x1b[39m');
            const lines: string[] = filteredLines.map((l) => AnsiParser.removeAnsi(l));
            errors.push(...lines.filter((l: string) => REPLSession.lineIsError(l)));
            let finished = false;
            if (lines.length > 1 && lines[lines.length - 1] === '') {
                if (lines[lines.length - 2] === `"${executionId}"`) {
                    lines.splice(-2, 2);
                    finished = true;
                }
            }
            if (lines.length > 0) {
                for (const line of lines) {
                    if (line.length > 0) {
                        const index = line.indexOf('##DISPLAYDATA#2d522e5a-4a6c-4aae-b20c-91c5189948d9##');
                        if (index === 0) {
                            const display_data: Record<string, string> = JSON.parse(line.substring(52));
                            this.currentExecution!.appendOutput([REPLSession.processOutput(display_data)]);
                        }
                        else {
                            this.currentExecution!.appendOutput([
                                new vscode.NotebookCellOutput([
                                    vscode.NotebookCellOutputItem.stdout(line)
                                ])
                            ]);
                        }
                    }
                }
            }
            if (finished) {
                const isOk = errors.length === 0;
                this.proc.stdout!.removeListener("data", dataHandler);
                this.currentExecution!.end(isOk);
                resolver(isOk);
            }
        }
        this.proc.stdout!.addListener("data", dataHandler);
        let code = exec.cell.document.getText().replaceAll('\r\n', '\n').trim();
        code += `\n"${executionId}"\n`;
        this.proc.stdin!.write(new TextEncoder().encode(code));
        return result;
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
        const { lines, errors } = await this.runCode("'Welcome to Deno repl kernel'");
        console.log(lines);
        console.log(errors);
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
