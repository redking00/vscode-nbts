import * as zmq from 'zeromq';
import { UUID } from '@lumino/coreutils';
import * as KernelMessage from './messages';
import { Message } from './jmp';

class _KernelChannel {
    protected stopped: boolean = false;
    private socket: zmq.Dealer | zmq.Subscriber;
    private port: number;
    public readonly connected: Promise<void>;
    private totalErrors: number = 0;
    private onError: () => void;

    constructor(onError: () => void, socket: zmq.Dealer | zmq.Subscriber, port: number) {
        this.onError = onError
        this.socket = socket;
        this.port = port;
        this.connected = new Promise<void>((resolve) => {
            this.socket.events.on('connect', () => {
                this.totalErrors = 0;
                if (this.socket instanceof zmq.Subscriber) {
                    this.socket.subscribe();
                }
                resolve();
            });
        });
        this.socket.events.on('connect:retry', () => {
            this.totalErrors++;
            if (this.totalErrors > 100 && this.totalErrors < 102) {
                this.onError();
            }
        });
    }

    public connect() {
        this.socket.connect(`tcp://127.0.0.1:${this.port}`);
    }

    public close() {
        this.stopped = true;
        try { this.socket.close() } catch (_e) { }
    }
}

export class ShellKernelChannel extends _KernelChannel {
    private key: string;
    private sock: zmq.Dealer;
    constructor(onError: () => void, port: number, key: string) {
        const sock = new zmq.Dealer();
        sock.sendHighWaterMark = 0;
        sock.maxMessageSize = -1;
        sock.connectTimeout = 100;
        super(onError, sock, port);
        this.sock = sock;
        this.key = key;
    }

    public async executeRequest(idle: Promise<void>, sessionId: string, code: string) {
        const msg = KernelMessage.createMessage<KernelMessage.IExecuteRequestMsg>({
            msgId: UUID.uuid4(),
            msgType: 'execute_request',
            username: 'user',
            session: sessionId,
            channel: 'shell',
            content: {
                code: code,
                allow_stdin: false,
                stop_on_error: true,
                silent: false,
                store_history: false,
            }
        });
        let m = new Message(msg);
        const wmsg = m.encode("sha256", this.key);
        await this.sock.send(wmsg);
        let isOk = true;
        if (!this.stopped) {
            for await (const msg of this.sock) {
                const response: Message = Message.decode(msg, "sha256", this.key)!;
                if (response.content.status === 'error') {
                    isOk = false;
                }
                else if (response.content.status === 'ok') {
                    isOk = true;
                }
                await idle;
                break;
            }
        }
        return isOk;
    }
}

export class IOPubKernelChannel extends _KernelChannel {
    private key: string;
    private ioPubSock: zmq.Subscriber;
    private onMessage: (msg: Message) => void

    private startListener() {
        (async () => {
            for await (const buffers of this.ioPubSock!) {
                const msg = Message.decode(buffers, "sha256", this.key);
                if (msg) this.onMessage(msg);
                if (this.stopped) break;
            }
        })();
    }

    constructor(onError: () => void, port: number, key: string, onMessage: (msg: Message) => void) {
        const sock = new zmq.Subscriber();
        super(onError, sock, port);
        this.ioPubSock = sock;
        this.key = key;
        this.onMessage = onMessage;
        this.startListener();
    }

}