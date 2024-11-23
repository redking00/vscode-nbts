import { TextDecoder, TextEncoder } from 'util';

import * as vscode from 'vscode';

export class NBTSSerializer implements vscode.NotebookSerializer {

	async deserializeNotebook(content: Uint8Array, _token: vscode.CancellationToken): Promise<vscode.NotebookData> {
		let cells: vscode.NotebookCellData[] = [];
		let fileContent = `\n${new TextDecoder().decode(content).replaceAll('\r\n', '\n')}`;
		let blocks = fileContent.split(/\n\/\/#nbts@/m);
		for (let n = 0; n < blocks.length; ++n) {
			let block = blocks[n];
			if (block.startsWith('mark\n')) {
				cells.push(new vscode.NotebookCellData(
					vscode.NotebookCellKind.Markup,
					block.substring(5).split(/\n/m).map(l => l.substring(3)).join('\n'),
					'markdown')
				);
			}
			else if (block.startsWith('code\n')) {
				cells.push(new vscode.NotebookCellData(
					vscode.NotebookCellKind.Code,
					block.substring(5),
					'typescript')
				);
			}
			else if (n === 0) {
				if (block.trim().length > 0) {
					cells.push(new vscode.NotebookCellData(vscode.NotebookCellKind.Code, block.trim(), 'typescript'));
				}
			}
		}
		return new vscode.NotebookData(cells);
	}

	async serializeNotebook(data: vscode.NotebookData, _token: vscode.CancellationToken): Promise<Uint8Array> {
		let blocks: string[] = [];
		for (const cell of data.cells) {
			if (cell.kind === vscode.NotebookCellKind.Markup) {
				blocks.push(`\n//#nbts@mark\n${cell.value.replaceAll('\r\n', '\n').split(/\n/m).map(l => `// ${l}`).join('\n')}`);
			}
			else {
				blocks.push(`\n//#nbts@code\n${cell.value.replaceAll('\r\n', '\n')}`);
			}
		}
		return new TextEncoder().encode(blocks.join(''));
	}

}