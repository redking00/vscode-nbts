import * as vscode from 'vscode';
import * as proc from 'child_process';


export class DenoTool {
    static syncLaunch(args: string[], cwd: string) {
        const kernelPath: string = vscode.workspace.getConfiguration('deno').get('path') || 'deno';
        if (!kernelPath) {
            vscode.window.showErrorMessage(`No path to deno executable`);
            return;
        }
        return proc.execFile(kernelPath, args, { cwd: cwd });
    }
}