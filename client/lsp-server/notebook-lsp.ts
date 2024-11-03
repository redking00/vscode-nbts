import * as NodeStream from 'node:stream';
import { StreamMessageReader, StreamMessageWriter } from "npm:vscode-jsonrpc@9.0.0-next.6/node";


type nbNotebook = {
  uri: string
  textDocuments: nbTextDocument[]
  version: number
}

type nbTextDocument = {
  uri: string
  languageId: string
  lines: string[]
}

type PendingRequest = {
  id: number
  method: string
  params: string
}

const pendingRequests: Record<string, PendingRequest> = {};

const notebooks: Record<string, nbNotebook> = {}

const documentXnotebook: Record<string, string> = {}

const getNotebookByTextDocumentUri = (textDocumentUri: string) => {
  const notebookUri = documentXnotebook[textDocumentUri];
  return notebookUri !== undefined ? notebooks[notebookUri] : undefined;
}

const getFullText = (notebook: nbNotebook) => notebook.textDocuments.map((t: nbTextDocument) => t.languageId === 'typescript' ? t.lines.join('\n') : t.lines.map(l => `//${l}`).join('\n')).join('\n')

const getStartLine = (notebook: nbNotebook, textDocumentUri: string) => {
  let lineNumber = 0;
  for (const t of notebook.textDocuments) {
    if (t.uri === textDocumentUri) { return lineNumber; }
    else { lineNumber += t.lines.length; }
  }
}

const applyTextChanges = (textDocument: nbTextDocument, changes: { range: { start: { line: number, character: number } }, rangeLength: number, text: string }[]) => {
  for (const change of changes) {
    if (change.range !== undefined) {
      let text = textDocument.lines.splice(change.range.start.line).join('\n');
      text = [text.substring(0, change.range.start.character), change.text, text.substring(change.range.start.character + change.rangeLength)].join('');
      textDocument.lines.push(...text.split('\n'));
    }
    else { throw Error("UNKNOWN CHANGE TYPE"); }
  }
}

const cp = new Deno.Command('deno', {
  args: ['lsp'],
  stdin: 'piped',
  stdout: 'piped',
  env: JSON.parse(Deno.args[0]) as any
}).spawn();


const denoOut = new StreamMessageReader(NodeStream.Readable.fromWeb(cp.stdout as any));
const denoIn = new StreamMessageWriter(NodeStream.Writable.fromWeb(cp.stdin));
const ideOut = new StreamMessageReader(NodeStream.Readable.fromWeb(Deno.stdin.readable as any));
const ideIn = new StreamMessageWriter(NodeStream.Writable.fromWeb(Deno.stdout.writable));

const onIdeRequest = async (data: any) => {
  if (
    data.method === 'textDocument/codeAction' ||
    data.method === 'textDocument/inlayHint' ||
    data.method === 'textDocument/semanticTokens/range'
  ) {
    const notebook = getNotebookByTextDocumentUri(data.params.textDocument.uri);
    if (notebook !== undefined) {
      const startLine = getStartLine(notebook, data.params.textDocument.uri)!;
      data.params.range.start.line += startLine;
      data.params.range.end.line += startLine;
      data.params.textDocument.uri = notebook.uri;
    }
  }
  else if (
    data.method === 'textDocument/foldingRange' ||
    data.method === 'textDocument/codeLens' ||
    data.method === 'textDocument/semanticTokens/full'
  ) {
    const notebook = getNotebookByTextDocumentUri(data.params.textDocument.uri);
    if (notebook !== undefined) {
      data.params.textDocument.uri = notebook.uri;
    }
  }
  else if (
    data.method === 'textDocument/hover' ||
    data.method === 'textDocument/implementation' ||
    data.method === 'textDocument/definition' ||
    data.method === 'textDocument/completion'
  ) {
    const notebook = getNotebookByTextDocumentUri(data.params.textDocument.uri);
    if (notebook !== undefined) {
      const startLine = getStartLine(notebook, data.params.textDocument.uri);
      data.params.position.line += startLine;
      data.params.textDocument.uri = notebook.uri;
    }
  }
  await denoIn.write(data);
  if (data.method === 'shutdown') {
    cp.kill();
    Deno.exit(0);
  }
}

const onIdeResponse = async (data: any) => {
  await denoIn.write(data);
}

const onIdeNotification = async (data: any) => {
  if (data.method === "notebookDocument/didOpen") {
    let notebook = notebooks[data.params.notebookDocument.uri];
    if (notebook === undefined) {
      notebook = {
        uri: data.params.notebookDocument.uri,
        version: 1,
        textDocuments: data.params.cellTextDocuments.map((ctd: any) => ({
          uri: ctd.uri,
          languageId: ctd.languageId,
          lines: ctd.text.split('\n')
        }))
      };
      notebook.textDocuments.forEach(t => documentXnotebook[t.uri] = notebook!.uri)
      notebooks[notebook.uri] = notebook;
      const fullText = getFullText(notebook);
      const msg = { jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri: notebook.uri, languageId: 'typescript', version: notebook.version, text: fullText } } } as any;
      await denoIn.write(msg);
    }
  }

  else if (data.method === "notebookDocument/didClose") {
    const notebook = notebooks[data.params.notebookDocument.uri];
    if (notebook !== undefined) {
      for (const t of notebook.textDocuments) {
        delete documentXnotebook[t.uri];
      }
      const msg = { jsonrpc: "2.0", method: "textDocument/didClose", params: { uri: notebook.uri } } as any
      await denoIn.write(msg);
      delete notebooks[data.params.notebookDocument.uri];
    }
  }

  else if (data.method === "notebookDocument/didChange") {
    const notebook = notebooks[data.params.notebookDocument.uri];
    if (notebook) {
      let processed = false;
      if (data.params.change?.cells?.textContent !== undefined) {
        processed = true;
        let changed = false;
        for (const tc of data.params.change.cells.textContent) {
          const textDocument = notebook.textDocuments.find(t => t.uri === tc.document.uri);
          if (textDocument) {
            applyTextChanges(textDocument, tc.changes);
            changed = true;
          }
        }
        if (changed) {
          const fullText = getFullText(notebook);
          const msg = {
            jsonrpc: "2.0",
            method: 'textDocument/didChange',
            params: {
              textDocument: { uri: notebook.uri, version: ++notebook.version, languageId: 'typescript' },
              contentChanges: [{ text: fullText }]
            }
          } as any;
          await denoIn.write(msg);
        }
      }
      if (data.params.change?.cells?.structure !== undefined) {
        processed = true;

        notebook.textDocuments = [
          ...notebook.textDocuments.slice(0, data.params.change.cells.structure.array.start),
          ...(
            data.params.change.cells.structure.array.cells ?
              data.params.change.cells.structure.array.cells.map((c: any) => ({
                uri: c.document,
                languageId: c.kind === 2 ? 'typescript' : 'markdown',
                lines: data.params.change.cells.structure.didOpen ? data.params.change.cells.structure.didOpen.find((d: any) => d.uri === c.document).text.split('\n') : []
              } as nbTextDocument)) : []),
          ...notebook.textDocuments.slice(data.params.change.cells.structure.array.start + data.params.change.cells.structure.array.deleteCount)
        ].filter(f => f);

        if (data.params.change.cells.structure.didOpen) {
          data.params.change.cells.structure.didOpen.forEach((d: any) => documentXnotebook[d.uri] = notebook.uri);
        }
        if (data.params.change.cells.structure.didClose) {
          data.params.change.cells.structure.didClose.forEach((d: any) => delete documentXnotebook[d.uri]);
        }

        const fullText = getFullText(notebook);
        const msg = {
          jsonrpc: "2.0",
          method: 'textDocument/didChange',
          params: {
            textDocument: { uri: notebook.uri, version: ++notebook.version, languageId: 'typescript' },
            contentChanges: [{ text: fullText }]
          }
        } as any;
        await denoIn.write(msg);

      }
      if (!processed) {
      }
    }
  }
  else {
    await denoIn.write(data);
  }
}

const onIdeUnknown = async (data: any) => {
  await denoIn.write(data);
}


const onDenoRequest = async (data: any) => {
  await ideIn.write(data);
}

const onDenoResponse = async (req: PendingRequest | undefined, data: any) => {
  if (req) {
    if (req.method === 'initialize') {
      data.result.capabilities.notebookDocumentSync = {
        notebookSelector: [
          {
            notebook: { scheme: 'file', notebookType: 'nbts' },
            cells: [{ language: 'typescript' }, { language: 'markdown' }]
          },
          {
            notebook: { scheme: 'file', notebookType: 'jupyter-notebook' },
            cells: [{ language: 'typescript' }, { language: 'markdown' }]
          }
        ]
      };
    }
    else if (req.method === 'textDocument/hover' || req.method === 'textDocument/implementation' || req.method === 'textDocument/definition') {
      const tdUri = (req.params as any).textDocument.uri;
      if (tdUri) {
        const notebook = getNotebookByTextDocumentUri(tdUri);
        if (notebook) {
          const startLine = getStartLine(notebook, tdUri)!;
          data.result.range.start.line -= startLine;
          data.result.range.end.line -= startLine;
        }
      }
    }
    else if (req.method === 'textDocument/foldingRange') {
      if (data.result && data.result.length > 0) {
        const tdUri = (req.params as any).textDocument.uri;
        if (tdUri) {
          const notebook = getNotebookByTextDocumentUri(tdUri);
          if (notebook) {
            const td = notebook.textDocuments.find(d => d.uri === tdUri);
            if (td) {
              const startLine = getStartLine(notebook, tdUri)!;
              data.result = data.result.map((r: any) => {
                r.startLine -= startLine;
                r.endLine -= startLine;
                return r;
              }).filter((r: any) => r.startLine >= 0 && r.startLine < (td.lines.length));
            }
          }
        }
      }
    }
    else if (req && (req.method === 'textDocument/codeAction')) {
      const tdUri = (req.params as any).textDocument.uri;
      if (tdUri) {
        const notebook = getNotebookByTextDocumentUri(tdUri);
        if (notebook) {
          data.result = [];
        }
      }
    }
    else if (req && (req.method === 'textDocument/semanticTokens/full')) {
      const tdUri = (req.params as any).textDocument.uri;
      if (tdUri) {
        const notebook = getNotebookByTextDocumentUri(tdUri);
        if (notebook) {
          data.result.data = [];
        }
      }
    }
  }
  await ideIn.write(data);
}

const onDenoNotification = async (data: any) => {
  if (data.method === 'textDocument/publishDiagnostics') {
    const notebook = notebooks[data.params.uri];
    if (notebook !== undefined) {
      for (const td of notebook.textDocuments) {
        const startLine = getStartLine(notebook, td.uri)!;
        const diagnostics = data.params.diagnostics.filter((d: any) => d.range.start.line >= startLine && d.range.start.line < startLine + td.lines.length).map((d: any) => {
          d.range.start.line -= startLine;
          d.range.end.line -= startLine;
          return d;
        })
        const msg = {
          jsonrpc: "2.0",
          method: "textDocument/publishDiagnostics",
          params: { uri: td.uri, diagnostics: diagnostics }
        };
        await ideIn.write(msg);
      }
    }
  }
  else {
    await ideIn.write(data);
  }
}

const onDenoUnknown = async (data: any) => {
  await ideIn.write(data);
}


ideOut.listen((data: any) => {
  if (data.method !== undefined) {
    if (data.id !== undefined) {
      pendingRequests[`${data.id}`] = JSON.parse(JSON.stringify(data));
      onIdeRequest(data);
    }
    else {
      onIdeNotification(data);
      if (data.method === '$/cancelRequest') {
        delete pendingRequests[`${data.params.id}`];
      }
    }
  }
  else if (data.result !== undefined) {
    onIdeResponse(data);
  }
  else {
    onIdeUnknown(data);
  }
});

denoOut.listen((data: any) => {
  if (data.method !== undefined) {
    if (data.id !== undefined) {
      onDenoRequest(data);
    }
    else {
      onDenoNotification(data);
    }
  }
  else if (data.result !== undefined) {
    const req = pendingRequests[`${data.id}`];
    onDenoResponse(req, data);
    delete pendingRequests[`${data.id}`];
  }
  else {
    onDenoUnknown(data);
  }
});