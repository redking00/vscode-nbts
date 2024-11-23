import * as vscode from "vscode";
import * as path from 'path';
import { ISession } from "../../types";
import { ChildProcess } from "child_process";
import { DenoTool } from "../../../tools";
import { TextEncoder } from "util";
import * as AnsiParser from "ansi-parser";
import { UUID } from "@lumino/coreutils";


export class REPLSession implements ISession {
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
            const lines = filteredLines.map((l) => AnsiParser.removeAnsi(l));
            errors.push(...lines.filter((l: string) => REPLSession.lineIsError(l)));
            let finished = false;
            if (lines.length > 1 && lines[lines.length - 1] === '') {
                if (lines[lines.length - 2] === `"${executionId}"`) {
                    lines.splice(-2, 2);
                    finished = true;
                }
            }
            if (lines.length > 0) {
                this.currentExecution!.appendOutput([
                    new vscode.NotebookCellOutput([
                        vscode.NotebookCellOutputItem.stdout(lines.join('\n')),
                    ])
                ]);
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

    constructor(onError: () => void, doc: vscode.NotebookDocument, outputChannel: vscode.OutputChannel) {
        this.currentDocument = doc;
        this.outputChannel = outputChannel;
        const cwd = doc.uri.fsPath.split(path.sep).slice(0, -1).join(path.sep) + path.sep;
        this.proc = DenoTool.syncLaunch(['repl', '--allow-all'], cwd)!;
        this.proc!.on("exit", () => {
            if (!this.stopped) onError();
            this.outputChannel.appendLine('\n### DENO EXITED');
        });
        outputChannel.appendLine(JSON.stringify(this.proc));
    }

    public async start() {
        const { lines, errors } = await this.runCode("'Welcome to the Deno REPL Kernel!'");
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
