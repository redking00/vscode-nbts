import * as vscode from "vscode";
import * as os from 'os';
import * as path from 'path';
import { ChildProcess } from 'child_process';
import { DenoTool } from "../../tools";
import { UUID } from '@lumino/coreutils';
import { Message } from './jmp';
import { mkdtempSync, writeFileSync, realpathSync, rmdirSync, rmSync } from "fs";
import { KernelConnection } from "./kernelConnection";

export class DenoKernelInstance {

    private proc: ChildProcess
    private key: string
    private kernelConnection: KernelConnection
    private connectionFolder: string
    private outputChannel: vscode.OutputChannel
    private idle?: Promise<void>
    private idleResolver?: () => void
    private currentExecution?: vscode.NotebookCellExecution
    private stopped:boolean = false;

    private static processOutput(data: any) {
        let results: Record<string, string> = {};
        if (data.other) {
            results = {};
            while (data.other.length > 1) {
                const mime = data.other.shift();
                const value = data.other.shift();
                results[mime] = value;
            }
        }
        else {
            results = data;
        }
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

    private onIOPubMessage = (msg: Message) => {
        if (msg.header.msg_type === 'execute_result') {
            let data = msg.content.data;
            this.currentExecution?.appendOutput([DenoKernelInstance.processOutput(data)]);
        }
        else if (msg.header.msg_type === 'display_data') {
            let data = msg.content.data;
            this.currentExecution?.appendOutput([DenoKernelInstance.processOutput(data)]);
        }
        else if (msg.header.msg_type === 'error') {
            let str = msg.content.traceback.length > 0 ? `${msg.content.traceback.slice(1).join('\n')}` : msg.content.evalue;
            this.currentExecution?.appendOutput([
                new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.stderr(str)
                ])
            ]);
        }
        else if (msg.header.msg_type === 'stream') {
            if (msg.content.name === 'stdout') {
                this.currentExecution?.appendOutput([
                    new vscode.NotebookCellOutput([
                        vscode.NotebookCellOutputItem.stdout(msg.content.text),
                    ])
                ]);
            }
            else if (msg.content.name === 'stderr') {
                this.currentExecution?.appendOutput([
                    new vscode.NotebookCellOutput([
                        vscode.NotebookCellOutputItem.stderr(msg.content.text),
                    ])
                ]);
            }
        }
        else if (msg.header.msg_type === 'status') {
            if (msg.content.execution_state === 'busy') { /** */ }
            else if (msg?.content.execution_state === 'idle') {
                this.idleResolver!();
            }
        }
        else if (msg.header.msg_type === 'execute_input') {
            // do nothing 
        }
        else {
            this.outputChannel.appendLine("------------------------------");
            this.outputChannel.appendLine("UNPROCESSED IOPUB MSG");
            this.outputChannel.appendLine(JSON.stringify(msg));
        }
    }


    constructor(
        onError: () => void,
        cwd: string,
        ioPubPort: number,
        shellPort: number,
        hbPort: number,
        controlPort: number,
        stdinPort: number,
        outputChannel: vscode.OutputChannel
    ) {
        this.outputChannel = outputChannel;
        this.key = UUID.uuid4();
        this.connectionFolder = mkdtempSync(realpathSync(os.tmpdir()) + path.sep);
        const fileName = `${this.connectionFolder}${path.sep}connection_file`;
        const connection_data: any = {
            control_port: controlPort,
            shell_port: shellPort,
            transport: "tcp",
            signature_scheme: "sha256",
            stdin_port: stdinPort,
            hb_port: hbPort,
            ip: "127.0.0.1",
            iopub_port: ioPubPort,
            key: this.key
        };
        writeFileSync(fileName, JSON.stringify(connection_data));
        this.outputChannel.appendLine(fileName);
        this.proc = DenoTool.syncLaunch(['jupyter', '--kernel', '--conn', fileName], cwd)!;
        this.outputChannel.appendLine(JSON.stringify(this.proc));
        this.proc!.on("exit", () => {
            this.outputChannel.appendLine('\n### DENO EXITED');
            try {
                if (typeof this.connectionFolder === "string" && this.connectionFolder.length > 0) {
                    this.outputChannel.appendLine('deleting ' + this.connectionFolder);
                    rmSync(fileName);
                    rmdirSync(this.connectionFolder + path.sep);
                }
            }
            catch (err) { this.outputChannel.appendLine(`${err}`); }
            if (!this.stopped) onError();
            
        });
        this.kernelConnection = new KernelConnection(onError, this.onIOPubMessage, this.key, ioPubPort, shellPort);
    }

    public async start() {
        await this.kernelConnection.connect();
    }

    public tryClose() {
        this.stopped = true;
        this.proc.kill("SIGTERM");
        this.kernelConnection.tryClose();
    }

    public async executeRequest(sessionId: string, exec: vscode.NotebookCellExecution) {
        this.currentExecution = exec;
        this.idle = new Promise((resolve) => this.idleResolver = resolve);
        return await this.kernelConnection.executeRequest(this.idle, sessionId, exec.cell.document.getText());
    }
}