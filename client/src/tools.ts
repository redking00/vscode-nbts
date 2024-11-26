import * as vscode from 'vscode';
import * as proc from 'child_process';
import * as path from 'path';

//@ts-ignore
const requireFunc = typeof __webpack_require__ === "function" ? __non_webpack_require__ : require;
const moduleName = path.join(vscode.env.appRoot, "node_modules", "node-pty");
const spawn: typeof import('node-pty').spawn = requireFunc(moduleName).spawn;

export class DenoTool {
    static syncLaunch(args: string[], cwd: string) {
        const denoPath: string = vscode.workspace.getConfiguration('deno').get('path') || (process.platform === 'win32' ? 'deno.exe' : 'deno');
        if (!denoPath) {
            vscode.window.showErrorMessage(`No path to deno executable`);
            return;
        }
        return proc.execFile(denoPath, args, { cwd: cwd });
    }

    static syncLaunchPTY(args: string[], cwd: string) {
        const denoPath: string = vscode.workspace.getConfiguration('deno').get('path') || (process.platform === 'win32' ? 'deno.exe' : 'deno');
        if (!denoPath) {
            vscode.window.showErrorMessage(`No path to deno executable`);
            return;
        }
        return spawn(denoPath, args, { cwd: cwd, useConpty: false });
    }

}