import * as vscode from "vscode";
import * as path from 'path';
import { IPty, ISession } from "../../types";
import { DenoTool } from "../../../tools";
import { parseAnsiSequences } from 'ansi-sequence-parser';
import { UUID } from "@lumino/coreutils";

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

    private runCode(code: string): Promise<{ lines: string[], errors: string[] }> {
        let resolver: (result: { lines: string[], errors: string[] }) => void;
        const result = new Promise<{ lines: string[], errors: string[] }>((resolve) => resolver = resolve);
        const executionId = UUID.uuid4();
        let resultLines = [];
        let errors = [];
        let buffer:string[] = [];
        const dataHandler = (data: string) => {
            const parts = data.split(/\r?\n/);
            if (parts.length === 1) {
                buffer.push(data);
                return;
            }
            parts[0] = buffer.join('') + parts[0]
            buffer =  parts.splice(-1);
            const rawLines = parts;
            const lineTokens = rawLines.map((l: string) => parseAnsiSequences(l));
            const lines = lineTokens.map((tokens) => tokens.map((token) => token.value).join(''));
            let finished = false
            for (const l of lines) {
                const isError = REPLSession.lineIsError(l);
                const isFinish = l===`"${executionId}"`
                finished ||= isFinish;
                if (!isFinish) {
                    resultLines.push(l);
                }
                else if (isError) {
                    errors.push(l)
                }
            }
            if (finished) {
                dataSub.dispose();
                resolver({
                    lines: resultLines,
                    errors: errors
                });
            }
        }
        const dataSub = this.proc.onData(dataHandler);
        code += `\n"${executionId}"\n`;
        this.proc.write(code);
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
        let code = exec.cell.document.getText();
        let resolver: (result:boolean) => void;
        const result = new Promise<boolean>((resolve) => resolver = resolve);
        const executionId = UUID.uuid4();
        let errors = [];
        let buffer:string[] = [];
        const dataHandler = (data: string) => {
            const parts = data.split(/\r?\n/);
            if (parts.length === 1) {
                buffer.push(data);
                return;
            }
            parts[0] = buffer.join('') + parts[0]
            buffer =  parts.splice(-1);
            const rawLines = parts;
            //const lineTokens = rawLines.map((l: string) => parseAnsiSequences(l));
            const filteredLines = rawLines.filter((l) => l !== '\x1b[90mundefined\x1b[39m');
            const lineTokens = filteredLines.map((l: string) => parseAnsiSequences(l));
            const lines:string[] = lineTokens.map((tokens) => tokens.map((token) => token.value).join(''));
            let finished = false
            for (const [lineNumber, l] of lines.entries()) {
                const isError = REPLSession.lineIsError(l);
                const isFinish = l===`"${executionId}"`
                finished ||= isFinish;
                if (!isFinish) {
                    const index = l.indexOf('##DISPLAYDATA#2d522e5a-4a6c-4aae-b20c-91c5189948d9##');
                    if (index === 0) {
                        const display_data: Record<string, string> = JSON.parse(l.substring(52));
                        this.currentExecution!.appendOutput([REPLSession.processOutput(display_data)]);
                    }
                    else {
                        this.currentExecution!.appendOutput([
                            new vscode.NotebookCellOutput([
                                vscode.NotebookCellOutputItem.stdout(filteredLines[lineNumber])
                            ])
                        ]);
                    }
                }
                else if (isError) {
                    errors.push(l)
                }
            }
            if (finished) {
                const isOk = errors.length === 0;
                dataSub.dispose();
                resolver(isOk);
            }
        }
        const dataSub = this.proc.onData(dataHandler);
        code += `\n"${executionId}"\n`;
        this.proc.write(code);
        return result;
    }

    constructor(context: vscode.ExtensionContext, onError: () => void, doc: vscode.NotebookDocument, outputChannel: vscode.OutputChannel) {
        this.context = context;
        this.currentDocument = doc;
        this.outputChannel = outputChannel;
        const cwd = doc.uri.fsPath.split(path.sep).slice(0, -1).join(path.sep) + path.sep;
        const bootScriptPath = path.resolve(this.context.extensionPath, 'client', 'src', 'notebook-controllers', 'repl-controller', 'boot', 'boot.ts');
        this.proc = DenoTool.syncLaunchTTY(['repl', `--eval-file=${bootScriptPath}`, '--allow-all'], cwd)!;
        this.proc.onExit(() => {
            if (!this.stopped) onError();
            this.outputChannel.appendLine('\n### DENO EXITED');
        });
    }

    public async start() {
        let resolver:()=>void;
        const prom = new Promise<void>(resolve=>resolver = resolve);
        const dataSub = this.proc.onData((l)=>{
            console.log(l);
            if (l.includes('>')) {
                dataSub.dispose();
                resolver();
            } 
        })
        await prom;
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
