import * as vscode from 'vscode';
import * as proc from 'child_process';

/*
export function waitForProc(label: string, proc: proc.ChildProcess): Promise<undefined>
export function waitForProc(label: string, proc: proc.ChildProcess, getOutput: () => string): Promise<string>
export function waitForProc(label: string, proc: proc.ChildProcess, getOutput?: () => string): Promise<string | undefined> {
    return new Promise((resolve, reject) => {
        proc.on('error', err => reject(new Error(`An error occured while executing ${label}: ${err.message}`)));

        proc.on('exit', (code, signal) => {
            const out = getOutput && getOutput();

            if (signal) { reject(new Error(`${label} was terminated with signal ${signal}`)); }
            else if (code === 0) { resolve(out); }
            else if (out && out.length) { reject(new Error(`${label} exited with code ${code}:\n${out}`)); }
            else { reject(new Error(`${label} exited with code ${code}`)); }
        });
    });
}
*/

export function getConfig() {
    return vscode.workspace.getConfiguration('deno');
}

export function debounce<F extends (...params: any[]) => void>(fn: F, delay: number) {
    let timeoutID: ReturnType<typeof setTimeout> | null = null;
    return function (this: any, ...args: any[]) {
        clearTimeout(timeoutID!);
        timeoutID = setTimeout(() => fn.apply(this, args), delay);
    } as F;
}

export class DenoTool {

    static get config() {
        const value = getConfig();
        Object.defineProperty(this, 'config', { value });
        return value;
    }

    private static get path() {
        const value: Promise<string | undefined> = (async () => this.config.get('path')||'deno')();
        Object.defineProperty(this, 'path', { value });
        return value;
    }

    static async launch(args: string[], cwd: string) {
        const kernelPath = await this.path;
        if (!kernelPath) {
            vscode.window.showErrorMessage(`No path to deno executable`);
            return;
        }
        return proc.spawn(kernelPath, args, { cwd: cwd });
    }

    static syncLaunch(args: string[], cwd: string) {
        const kernelPath:string = this.config.get('path')||'deno'
        if (!kernelPath) {
            vscode.window.showErrorMessage(`No path to deno executable`);
            return;
        }
        return proc.execFile(kernelPath, args, { cwd: cwd });
    }

    static async exec(args: string[]) {
        const kernelPath = await this.path;
        if (!kernelPath) {
            vscode.window.showErrorMessage(`No path to deno executable`);
            return;
        }

        return await new Promise<{ stdout: string, stderr: string }>((resolve, reject) => {
            proc.exec(`${kernelPath} ${args.join(' ')}`, (err, stdout, stderr) => {
                if (err) { reject(err); }
                else { resolve({ stdout, stderr }); }
            });
        });
    }
}

