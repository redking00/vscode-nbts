import * as vscode from "vscode";
import * as zmq from 'zeromq';
import { ChildProcess } from 'child_process';
import { DenoTool } from "../tools";
import * as KernelMessage from './messages';
import { UUID } from '@lumino/coreutils';
import { Message } from './jmp';
import { mkdtempSync, writeFileSync, realpathSync, rmdirSync, rmSync } from "fs";
import * as os from 'os';
import * as path from 'path';

export class Session {
    private proc: ChildProcess | undefined;
    private controlPort: number;
    private shellPort: number;
    private ioPubPort: number;
    private hbPort: number;
    private stdinPort: number;
    private controlSock: zmq.Dealer | null = null;
    private shellSock: zmq.Dealer | null = null;
    private ioPubSock: zmq.Subscriber | null = null;
    private resolver: any = null;
    private isBusy: boolean = false;
    private isOk: boolean = false;
    private key: string;
    private currentExecution: vscode.NotebookCellExecution | null = null;
    private currentDocument: vscode.NotebookDocument;
    private outputChannel: vscode.OutputChannel;
    private stopped: boolean = false;
    private iopubConnectResolver: any;
    private iopubConnect: Promise<void>;
    private shellConnectResolver: any;
    private shellConnect: Promise<void>;
    private totalErrors = 0;
    private static sessionNumber: number = Math.floor(Math.random() * 20000);
    private connectionFolder: string;

    private async launchDenoKernel(cwd: string) {
        let fileName = `${this.connectionFolder}${path.sep}connection_file`;
        this.proc = await DenoTool.launch(['jupyter', '--kernel', '--conn', fileName], cwd);
        this.outputChannel.appendLine(`${this.proc}`);
        this.start();
        this.proc!.on("exit", () => {
            this.outputChannel.appendLine('\n### DENO EXITED');
            this.proc = undefined;
            try { this.controlSock?.close(); } catch (e) { }
            try { this.shellSock?.close(); } catch (e) { }
            try { this.ioPubSock?.close(); } catch (e) { }
            this.controlSock = null;
            this.shellSock = null;
            this.ioPubSock = null;
            try {
                if (typeof this.connectionFolder === "string" && this.connectionFolder.length > 0) {
                    this.outputChannel.appendLine('deleting ' + this.connectionFolder);
                    rmSync(fileName);
                    rmdirSync(this.connectionFolder + path.sep);
                }
            }
            catch (err) { this.outputChannel.appendLine(`${err}`); }
        });
    }

    private async execute(exec: vscode.NotebookCellExecution) {
        this.currentExecution = exec;
        exec.start();
        exec.clearOutput();
        const msg = KernelMessage.createMessage<KernelMessage.IExecuteRequestMsg>({
            msgId: UUID.uuid4(),
            msgType: 'execute_request',
            username: 'user',
            session: exec.cell.document.fileName as any,
            channel: 'shell',
            content: {
                code: exec.cell.document.getText(),
                allow_stdin: false,
                stop_on_error: true,
                silent: false,
                store_history: false,
            }
        });
        let m = new Message(msg);
        const wmsg = m.encode("sha256", this.key);
        let idle = new Promise<boolean>((resolve) => { this.resolver = resolve; });
        await this.shellSock!.send(wmsg);
        this.isOk = false;
        if (!this.stopped) {
            for await (const msg of this.shellSock!) {
                //this.outputChannel.appendLine("\n### SHELLSOCK RECEIVE");
                const response: Message = Message.decode(msg, "sha256", this.key)!;
                //this.outputChannel.appendLine(response);
                if (response.content.status === 'error') {
                    this.isOk = false;
                }
                else if (response.content.status === 'ok') {
                    this.isOk = true;
                }
                await idle;
                break;
            }
        }
    }

    constructor(doc: vscode.NotebookDocument, outputChannel: vscode.OutputChannel) {
        this.currentDocument = doc;
        this.outputChannel = outputChannel;
        this.key = UUID.uuid4();
        this.ioPubPort = 40885 + Session.sessionNumber;
        this.shellPort = 40886 + Session.sessionNumber;
        this.controlPort = 40887 + Session.sessionNumber;
        this.hbPort = 40888 + Session.sessionNumber;
        this.stdinPort = 40889 + Session.sessionNumber;
        this.controlSock = new zmq.Dealer();
        this.shellSock = new zmq.Dealer();
        this.ioPubSock = new zmq.Subscriber();

        this.shellSock.sendHighWaterMark = 0;
        this.shellSock.maxMessageSize = -1;
        this.shellSock.connectTimeout = 100;
        this.ioPubSock.connectTimeout = 100;

        this.iopubConnect = new Promise<void>((resolve) => { this.iopubConnectResolver = resolve; });
        this.ioPubSock!.events.on('connect', () => this.iopubConnectResolver());
        this.ioPubSock!.events.on('connect:retry', () => {
            console.log('iopub connect retry');
            this.totalErrors++;
            if (this.totalErrors > 100) {
                vscode.window.showErrorMessage(`Error connecting to kernel`);
                this.kill();
            }
        });

        this.shellConnect = new Promise<void>((resolve) => { this.shellConnectResolver = resolve; });
        this.shellSock!.events.on('connect', () => this.shellConnectResolver());
        this.shellSock!.events.on('connect:retry', () => {
            console.log('shell connect retry');
            this.totalErrors++;
            if (this.totalErrors > 100) {
                vscode.window.showErrorMessage(`Error connecting to kernel`);
                this.kill();
            }
        });

        this.ioPubSock.connect(`tcp://127.0.0.1:${this.ioPubPort}`);
        this.controlSock.connect(`tcp://127.0.0.1:${this.controlPort}`);
        this.shellSock.connect(`tcp://127.0.0.1:${this.shellPort}`);
        this.ioPubSock.subscribe();


        Session.sessionNumber = (Session.sessionNumber + 5) % 20000;

        let connection_data: any = {
            control_port: this.controlPort,
            shell_port: this.shellPort,
            transport: "tcp",
            signature_scheme: "sha256",
            stdin_port: this.stdinPort,
            hb_port: this.hbPort,
            ip: "127.0.0.1",
            iopub_port: this.ioPubPort,
            key: this.key
        };

        this.connectionFolder = mkdtempSync(realpathSync(os.tmpdir()) + path.sep);
        let fileName = `${this.connectionFolder}${path.sep}connection_file`;
        writeFileSync(fileName, JSON.stringify(connection_data));
        this.outputChannel.appendLine(fileName);
    }


    public isDocumentClosed() {
        return this.currentDocument.isClosed;
    }

    public kill(signal?: NodeJS.Signals | number) {
        this.outputChannel.appendLine('\n### KERNEL KILL');
        try {
            this.currentExecution?.end(false);
        }
        catch { }
        return this.proc?.kill(signal) || false;
    }

    private processOutput(data: any) {
        return new vscode.NotebookCellOutput([...Object.keys(data)].map((mime) => {
            if (mime.includes("json")) {
                return vscode.NotebookCellOutputItem.json(data[mime], mime);
            }
            else if (mime.startsWith("image")) {
                let buff = Buffer.from(data[mime], 'base64');
                return new vscode.NotebookCellOutputItem(buff, mime);
            }
            else {
                return vscode.NotebookCellOutputItem.text(data[mime], mime);
            }
        }));
    }

    public start() {
        //this.outputChannel.appendLine("\n### STARTING SESSION");
        this.stopped = false;
        const listener = async () => {
            for await (const buffers of this.ioPubSock!) {
                //this.outputChannel.appendLine("\n### IOPUB RECEIVED");
                const msg = Message.decode(buffers, "sha256", this.key);
                if (msg?.header.msg_type === 'execute_result') {
                    let data = msg.content.data;
                    this.currentExecution?.appendOutput([this.processOutput(data)]);
                }
                else if (msg?.header.msg_type === 'display_data') {
                    let data = msg.content.data;
                    this.currentExecution?.appendOutput([this.processOutput(data)]);
                }
                else if (msg?.header.msg_type === 'error') {
                    let str = msg.content.traceback.length > 0 ? `${msg.content.traceback.slice(1).join('\n')}` : msg.content.evalue;
                    this.currentExecution?.appendOutput([
                        new vscode.NotebookCellOutput([
                            vscode.NotebookCellOutputItem.stderr(str)
                        ])
                    ]);
                }
                else if (msg?.header.msg_type === 'stream') {
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
                else if (msg?.header.msg_type === 'status') {
                    if (msg?.content.execution_state === 'busy') {
                        this.isBusy = true;
                    }
                    else if (msg?.content.execution_state === 'idle') {
                        this.isBusy = false;
                        this.currentExecution?.end(this.isOk);
                        this.resolver(this.isBusy);
                    }
                }
                else if (msg?.header.msg_type === 'execute_input') {
                    // do nothing 
                }
                else {
                    this.outputChannel.appendLine("------------------------------");
                    this.outputChannel.appendLine("UNPROCESSED IOPUB MSG");
                    this.outputChannel.appendLine(JSON.stringify(msg));
                }
            }
        };
        listener();
    }

    public async executeCells(
        doc: vscode.NotebookDocument,
        cells: vscode.NotebookCell[],
        ctrl: vscode.NotebookController
    ): Promise<void> {
        if (!this.proc) {
            try {
                let cwd = doc.uri.fsPath.split(path.sep).slice(0, -1).join(path.sep) + path.sep;
                await this.launchDenoKernel(cwd);
                await this.iopubConnect;
                await this.shellConnect;
            } catch (error: any) {
                this.outputChannel.append(error.message);
                vscode.window.showErrorMessage(error.message);
                return;
            }
        }
        this.isOk = true;
        for (const cell of cells) {
            if (!this.isOk) { break };
            const exec = ctrl.createNotebookCellExecution(cell);
            await this.execute(exec);
        }
    }
}
