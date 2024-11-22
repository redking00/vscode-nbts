import { ShellKernelChannel, IOPubKernelChannel } from "./kernelChannel";
import { Message } from './jmp';

export class KernelConnection {
    private shellChannel: ShellKernelChannel
    private ioPubChannel: IOPubKernelChannel
    private stopped: boolean = false;
    private connected: boolean = false;

    constructor(onError: () => void, onIOPubMessage: (msg: Message) => void, key: string, ioPubPort: number, shellPort: number) {
        this.shellChannel = new ShellKernelChannel(onError, shellPort, key);
        this.ioPubChannel = new IOPubKernelChannel(onError, ioPubPort, key, onIOPubMessage);
    }

    public async connect() {
        this.shellChannel.connect();
        this.ioPubChannel.connect();
        await this.shellChannel.connected;
        await this.ioPubChannel.connected;
        this.connected = true;
    }

    public tryClose() {
        this.shellChannel.close();
        this.ioPubChannel.close();
        this.stopped = true;
    }

    public async executeRequest(idle: Promise<void>, sessionId: string, code: string) {
        if (this.connected && !this.stopped) {
            return await this.shellChannel.executeRequest(idle, sessionId, code);
        }
        else {
            throw Error(`KernelConnection bad state [connected: ${this.connected}][stopped: ${this.stopped}]`);
        }
    }

}