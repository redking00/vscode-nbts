import * as vscode from 'vscode';

export interface ISession {
    start(): void;
    isDocumentClosed(): boolean;
    tryClose(): void;
    executeCells(
        _doc: vscode.NotebookDocument,
        cells: vscode.NotebookCell[],
        ctrl: vscode.NotebookController
    ): Promise<void>;
}


export interface IController {
    get output(): vscode.OutputChannel;
    interrupt(document: vscode.NotebookDocument): void;
    executeCells(
        doc: vscode.NotebookDocument,
        cells: vscode.NotebookCell[],
        ctrl: vscode.NotebookController
    ): Promise<void>;
    killAll(): void;
    killSession(fsPath: string): void;
}


export interface IPty {
    /**
     * The process ID of the outer process.
     */
    readonly pid: number;

    /**
     * The column size in characters.
     */
    readonly cols: number;

    /**
     * The row size in characters.
     */
    readonly rows: number;

    /**
     * The title of the active process.
     */
    readonly process: string;

    /**
     * (EXPERIMENTAL)
     * Whether to handle flow control. Useful to disable/re-enable flow control during runtime.
     * Use this for binary data that is likely to contain the `flowControlPause` string by accident.
     */
    handleFlowControl: boolean;

    /**
     * Adds an event listener for when a data event fires. This happens when data is returned from
     * the pty.
     * @returns an `IDisposable` to stop listening.
     */
    readonly onData: IEvent<string>;

    /**
     * Adds an event listener for when an exit event fires. This happens when the pty exits.
     * @returns an `IDisposable` to stop listening.
     */
    readonly onExit: IEvent<{ exitCode: number, signal?: number }>;

    /**
     * Resizes the dimensions of the pty.
     * @param columns The number of columns to use.
     * @param rows The number of rows to use.
     */
    resize(columns: number, rows: number): void;

    /**
     * Clears the pty's internal representation of its buffer. This is a no-op
     * unless on Windows/ConPTY. This is useful if the buffer is cleared on the
     * frontend in order to synchronize state with the backend to avoid ConPTY
     * possibly reprinting the screen.
     */
    clear(): void;

    /**
     * Writes data to the pty.
     * @param data The data to write.
     */
    write(data: string): void;

    /**
     * Kills the pty.
     * @param signal The signal to use, defaults to SIGHUP. This parameter is not supported on
     * Windows.
     * @throws Will throw when signal is used on Windows.
     */
    kill(signal?: string): void;

    /**
     * Pauses the pty for customizable flow control.
     */
    pause(): void;

    /**
     * Resumes the pty for customizable flow control.
     */
    resume(): void;
  }


/**
 * An object that can be disposed via a dispose function.
 */
export interface IDisposable {
  dispose(): void;
}

/**
 * An event that can be listened to.
 * @returns an `IDisposable` to stop listening.
 */
export interface IEvent<T> {
  (listener: (e: T) => any): IDisposable;
}