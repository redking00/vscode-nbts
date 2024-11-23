import * as vscode from 'vscode';
import * as proc from 'child_process';


export class DenoTool {
    static syncLaunch(args: string[], cwd: string) {
        const denoPath: string = vscode.workspace.getConfiguration('deno').get('path') || 'deno';
        if (!denoPath) {
            vscode.window.showErrorMessage(`No path to deno executable`);
            return;
        }
        return proc.execFile(denoPath, args, { cwd: cwd });
    }
}