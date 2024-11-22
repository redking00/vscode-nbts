import { ShellKernelChannel, IOPubKernelChannel } from "./kernelChannel";
import { Message } from '../jmp';

export class KernelConnection {
    private closeNotifier: () => void
    private shellChannel: ShellKernelChannel
    private ioPubChannel: IOPubKernelChannel
    private onIOPubMessage: (msg: Message) => void


    constructor(closeNotifier: () => void, onIOPubMessage: (msg: Message) => void, key: string, ioPubPort: number, shellPort: number) {
        this.closeNotifier = closeNotifier;
        this.onIOPubMessage = onIOPubMessage;
        this.shellChannel = new ShellKernelChannel(this.closeNotifier, shellPort, key);
        this.ioPubChannel = new IOPubKernelChannel(this.closeNotifier, ioPubPort, key, this.onIOPubMessage);
    }

    public async connect() {
        this.shellChannel.connect();
        this.ioPubChannel.connect();
        await this.shellChannel.connected;
        await this.ioPubChannel.connected
    }

    public tryClose() {
        this.shellChannel.close();
        this.ioPubChannel.close();
    }

    public async executeRequest (idle: Promise<void>, sessionId: string, code: string) {
        return await this.shellChannel.executeRequest(idle, sessionId, code);
    }

}