import * as NodeStream from 'node:stream';
import { StreamMessageReader, StreamMessageWriter } from "npm:vscode-jsonrpc@9.0.0-next.6/node";

//const logFile = '/home/diego/NOTEBOOKS/salida.txt';


//---------------------------------------------

const pendingRequests: Record<string, {
  id: number
  method: string
  params: string
}> = {};


//---------------------------------------------
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
  //"changes":[{"range":{"start":{"line":2,"character":0},"end":{"line":3,"character":0}},"rangeLength":1,"text":""}]
  for (const change of changes) {
    if (change.range !== undefined) {
      let text = textDocument.lines.splice(change.range.start.line).join('\n');
      text = [text.substring(0, change.range.start.character), change.text, text.substring(change.range.start.character + change.rangeLength)].join('');
      textDocument.lines.push(...text.split('\n'));
    }
    else { throw Error("UNKNOWN CHANGE TYPE"); }
  }
  //log("------------------- CELL CONTENT NOW -------------------");
  //log(`\n${textDocument.lines.join('\n')}`);
}

//-----------------------------
/*
const log = (msg: string) => {
  const d = new Date();
  const ds = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`;
  Deno.writeTextFileSync(logFile, `[${ds}] ${msg}\n\n`, { append: true });
}
*/
////log("ENV");
////log(Deno.args[0]);

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
  //log(`IDE REQUEST [${data.id}]\n${data.method}\n${JSON.stringify(data.params)}`);

  if (
    data.method === 'textDocument/codeAction' ||
    data.method === 'textDocument/inlayHint' ||
    data.method === 'textDocument/semanticTokens/range'
  ) {
    //{"textDocument":{"uri":"deno-notebook-cell:/home/diego/NOTEBOOKS/test.nb.ts#W3sZmlsZQ%3D%3D"},"range":{"start":{"line":0,"character":15},"end":{"line":0,"character":15}},"context":{"diagnostics":[],"triggerKind":2}}
    const notebook = getNotebookByTextDocumentUri(data.params.textDocument.uri);
    if (notebook !== undefined) {
      const startLine = getStartLine(notebook, data.params.textDocument.uri)!;
      data.params.range.start.line += startLine;
      data.params.range.end.line += startLine;
      data.params.textDocument.uri = notebook.uri;
      //log(`IDE REQUEST [${data.id}] HOOKED\n${data.method}\n${JSON.stringify(data.params)}`);
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
      //log(`IDE REQUEST [${data.id}] HOOKED\n${data.method}\n${JSON.stringify(data.params)}`);
    }
  }
  else if (
    data.method === 'textDocument/hover' ||
    data.method === 'textDocument/implementation' ||
    data.method === 'textDocument/definition' ||
    data.method === 'textDocument/completion'
  ) {
    //{"textDocument":{"uri":"deno-notebook-cell:/home/diego/NOTEBOOKS/chromeclient_test.nb.ts#W4sZmlsZQ%3D%3D"},"position":{"line":1,"character":27}}'
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
  //log(`IDE RESPONSE [${data.id}]\n${JSON.stringify(data)}`);
  await denoIn.write(data);
}

const onIdeNotification = async (data: any) => {
  //log(`IDE NOTIFICATION\n${data.method}\n${JSON.stringify(data.params)}`);
  if (data.method === "notebookDocument/didOpen") {
    //log(`##### NOTEBOOK DIDOPEN###`);
    //{"notebookDocument":{"uri":"file:///home/diego/NOTEBOOKS/chromeclient_test.nb.ts","notebookType":"nbts","version":0,"cells":[{"kind":2,"document":"deno-notebook-cell:/home/diego/NOTEBOOKS/chromeclient_test.nb.ts#W2sZmlsZQ%3D%3D"},{"kind":2,"document":"deno-notebook-cell:/home/diego/NOTEBOOKS/chromeclient_test.nb.ts#W4sZmlsZQ%3D%3D"},{"kind":2,"document":"deno-notebook-cell:/home/diego/NOTEBOOKS/chromeclient_test.nb.ts#W6sZmlsZQ%3D%3D"},{"kind":2,"document":"deno-notebook-cell:/home/diego/NOTEBOOKS/chromeclient_test.nb.ts#X11sZmlsZQ%3D%3D"},{"kind":2,"document":"deno-notebook-cell:/home/diego/NOTEBOOKS/chromeclient_test.nb.ts#X13sZmlsZQ%3D%3D"}]},
    //"cellTextDocuments":[{"uri":"deno-notebook-cell:/home/diego/NOTEBOOKS/chromeclient_test.nb.ts#W2sZmlsZQ%3D%3D","languageId":"typescript","version":1,"text":"import { getNewChrome } from \"./chromeclient.nb.ts\"; \n"},{"uri":"deno-notebook-cell:/home/diego/NOTEBOOKS/chromeclient_test.nb.ts#W4sZmlsZQ%3D%3D","languageId":"typescript","version":1,"text":"const chrome = await getNewChrome();\n"},{"uri":"deno-notebook-cell:/home/diego/NOTEBOOKS/chromeclient_test.nb.ts#W6sZmlsZQ%3D%3D","languageId":"typescript","version":1,"text":"const resp = await chrome.ejecutar('window.location=\"https://docs.deno.com/runtime/reference/cli/jupyter/\"', true);\nconsole.//log(resp);\n"},{"uri":"deno-notebook-cell:/home/diego/NOTEBOOKS/chromeclient_test.nb.ts#X11sZmlsZQ%3D%3D","languageId":"typescript","version":1,"text":"chrome.ejecutar(\"alert('hello from jupyter')\");\n"},{"uri":"deno-notebook-cell:/home/diego/NOTEBOOKS/chromeclient_test.nb.ts#X13sZmlsZQ%3D%3D","languageId":"typescript","version":1,"text":"chrome.terminar();"}]}

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
      //{"textDocument":{"uri":"file:///home/diego/NOTEBOOKS/nbtslsp.ts","languageId":"typescript","version":1,"text":"import * as NodeStream from 'node:stream';\nimport {\n  InitializeRequest,\n  DocumentSymbolRequest,\n  InlayHintRequest,\n  SemanticTokensRangeRequest,\n  FoldingRangeRequest,\n  CodeLensRequest,\n  CodeActionRequest,\n  RegistrationRequest,\n  DocumentHighlightRequest,\n  ShutdownRequest,\n  createProtocolConnection\n} from \"npm:vscode-languageserver-protocol@3.17.6-next.11\";\nimport { StreamMessageReader, StreamMessageWriter } from \"npm:vscode-languageserver-protocol@3.17.6-next.11/node\";\n\n\nlet msgcount = 0;\n\nconst log = (msg: string) => {\n  ++msgcount;\n  Deno.writeTextFileSync('/home/diego/NOTEBOOKS/salida.txt', `[${new Date().toTimeString()}] [${msgcount}] ${msg}\\n`, { append: true });\n}\n\nconst cp = new Deno.Command('deno', { args: ['lsp'], stdin: 'piped', stdout: 'piped' }).spawn();\n\nconst denoConnection = createProtocolConnection(\n  new StreamMessageReader(NodeStream.Readable.fromWeb(cp.stdout as any)),\n  new StreamMessageWriter(NodeStream.Writable.fromWeb(cp.stdin))\n);\n\nconst ideConnection = createProtocolConnection(\n  new StreamMessageReader(NodeStream.Readable.fromWeb(Deno.stdin.readable as any)),\n  new StreamMessageWriter(NodeStream.Writable.fromWeb(Deno.stdout.writable))\n);\n\nideConnection.onClose(() => {\n  //log(\"IDECLOSE EXIT\");\n  cp.kill();\n  Deno.exit(0);\n});\n\ndenoConnection.onClose(() => {\n  //log(\"DENOCLOSE EXIT\");\n  cp.kill();\n  Deno.exit(0);\n});\n\nconst installDefaultHandler = (type: string) => {\n  ideConnection.onRequest(type, async (params, token) => {\n    //log(`${type} request`);\n    const denoResponse = await denoConnection.sendRequest(type, params, token);\n    //log(`${type} response`);\n    return denoResponse;\n  });\n}\n\n\nconst installReverseDefaultHandler = (type: string) => {\n  denoConnection.onRequest(type, async (params, token) => {\n    //log(`${type} request`);\n    const ideResponse = await ideConnection.sendRequest(type, params, token);\n    //log(`${type} response`);\n    return ideResponse;\n  });\n}\n\nconst installReverseSimpleHandler = (type: string) => {\n  denoConnection.onRequest(type, async (token) => {\n    //log(`${type} request`);\n    const ideResponse = await ideConnection.sendRequest(type, token);\n    //log(`${type} response`);\n    return ideResponse;\n  });\n}\n\nideConnection.onRequest(ShutdownRequest.method, async (token) => {\n  //log(\"ShutdownRequest request\");\n  const denoResponse = await denoConnection.sendRequest(ShutdownRequest.method, token);\n  //log(\"ShutdownRequest response\");\n  return denoResponse;\n});\n\nideConnection.onUnhandledNotification((a) => {\n  //log(\"Unhandled notification\");\n  ////log(JSON.stringify(a));\n  denoConnection.sendNotification(a as any);\n})\n\n//ideConnection.onRequest(InitializeRequest.type, async (params, token) => {\n//  //log(\"InitializeRequest request\");\n//  const denoResponse = await denoConnection.sendRequest(InitializeRequest.type, params, token);\n/*\ndenoResponse.capabilities.notebookDocumentSync = {\n  notebookSelector: [\n    {\n      notebook: { scheme: 'file', notebookType: 'nbts' },\n      cells: [{ language: 'typescript' }]\n    }\n  ]\n};\ndenoResponse.serverInfo!.version += \" - DenoNBTS\";\n*/\n//  //log(\"InitializeRequest response\");\n//  return denoResponse;\n//});\ninstallDefaultHandler(InitializeRequest.method);\n\n/*\nideConnection.onRequest(DocumentSymbolRequest.type, async (params, token) => {\n  //log(\"DocumentSymbolRequest request\");\n  const denoResponse = await denoConnection.sendRequest(DocumentSymbolRequest.type, params, token);\n  //log(\"DocumentSymbolRequest response\");\n  return denoResponse;\n});\n*/\ninstallDefaultHandler(DocumentSymbolRequest.method);\n\n\n/*\nideConnection.onRequest(InlayHintRequest.type, async (params, token) => {\n  //log(\"InlayHintRequest request\");\n  const denoResponse = await denoConnection.sendRequest(InlayHintRequest.type, params, token);\n  //log(\"InlayHintRequest response\");\n  return denoResponse;\n});\n*/\ninstallDefaultHandler(InlayHintRequest.method);\n\n/*\nideConnection.onRequest(SemanticTokensRangeRequest.type, async (params, token) => {\n  //log(\"SemanticTokensRangeRequest request\");\n  const denoResponse = await denoConnection.sendRequest(SemanticTokensRangeRequest.type, params, token);\n  //log(\"SemanticTokensRangeRequest response\");\n  return denoResponse;\n});\n*/\ninstallDefaultHandler(SemanticTokensRangeRequest.method);\n\n\n/*\nideConnection.onRequest(FoldingRangeRequest.type, async (params, token) => {\n  //log(\"FoldingRangeRequest request\");\n  const denoResponse = await denoConnection.sendRequest(FoldingRangeRequest.type, params, token);\n  //log(\"FoldingRangeRequest response\");\n  return denoResponse;\n});\n*/\ninstallDefaultHandler(FoldingRangeRequest.method);\n\n/*\nideConnection.onRequest(CodeLensRequest.type, async (params, token) => {\n  //log(\"CodeLensRequest request\");\n  const denoResponse = await denoConnection.sendRequest(CodeLensRequest.type, params, token);\n  //log(\"CodeLensRequest response\");\n  return denoResponse;\n});\n*/\ninstallDefaultHandler(CodeLensRequest.method);\n\n/*\nideConnection.onRequest(CodeActionRequest.type, async (params, token) => {\n  //log(\"CodeActionRequest request\");\n  let denoResponse = null;\n  try {\n    const p = new Promise((resolve,reject)=>{\n      token.onCancellationRequested(()=>{\n        //log(\"CodeActionRequest cancel token\");    \n        reject('rejected');\n      });\n      denoConnection.sendRequest(CodeActionRequest.type, params, token).then((response)=>{resolve(response);}).catch(err=>reject(err));\n    });\n    denoResponse = await p;\n  }\n  catch(e) {\n    //log(\"CodeActionRequest catch\");\n    //log(`${e}`);\n  }\n  finally {\n    //log(\"CodeActionRequest response\");\n  }\n  return denoResponse;\n});\n*/\ninstallDefaultHandler(CodeActionRequest.method);\n\n\n/*\nideConnection.onRequest(RegistrationRequest.type, async (params, token) => {\n  //log(\"RegistrationRequest request\");\n  const denoResponse = await denoConnection.sendRequest(RegistrationRequest.type, params, token);\n  //log(\"RegistrationRequest response\");\n  return denoResponse;\n});\n*/\ninstallDefaultHandler(RegistrationRequest.method);\n\n\n/*\nideConnection.onRequest(DocumentHighlightRequest.type, async (params, token) => {\n  //log(\"DocumentHighlightRequest request\");\n  const denoResponse = await denoConnection.sendRequest(DocumentHighlightRequest.type, params, token);\n  //log(\"DocumentHighlightRequest response\");\n  return denoResponse;\n});\n*/\ninstallDefaultHandler(DocumentHighlightRequest.method);\n\n/*\nideConnection.onRequest(\"textDocument/semanticTokens/full\", async (params, token) => {\n  //log(\"textDocument/semanticTokens/full request\");\n  const denoResponse = await denoConnection.sendRequest(\"textDocument/semanticTokens/full\", params, token);\n  //log(\"textDocument/semanticTokens/full response\");\n  return denoResponse;\n});\n*/\ninstallDefaultHandler(\"textDocument/semanticTokens/full\");\n\n/*\nideConnection.onRequest(\"textDocument/hover\", async (params, token) => {\n  //log(\"textDocument/hover request\");\n  const denoResponse = await denoConnection.sendRequest(\"textDocument/hover\", params, token);\n  //log(\"textDocument/hover response\");\n  return denoResponse;\n});\n*/\ninstallDefaultHandler(\"textDocument/hover\");\n\n/*\nideConnection.onRequest(\"textDocument/definition\", async (params, token) => {\n  //log(\"textDocument/definition request\");\n  const denoResponse = await denoConnection.sendRequest(\"textDocument/definition\", params, token);\n  //log(\"textDocument/definition response\");\n  return denoResponse;\n});\n*/\ninstallDefaultHandler(\"textDocument/definition\");\n\n/*\nideConnection.onRequest(\"textDocument/completion\", async (params, token) => {\n  //log(\"textDocument/completion request\");\n  const denoResponse = await denoConnection.sendRequest(\"textDocument/completion\", params, token);\n  //log(\"textDocument/completion response\");\n  return denoResponse;\n});\n*/\ninstallDefaultHandler(\"textDocument/completion\");\n\n/*\nideConnection.onRequest(\"completionItem/resolve\", async (params, token) => {\n  //log(\"completionItem/resolve request\");\n  const denoResponse = await denoConnection.sendRequest(\"completionItem/resolve\", params, token);\n  //log(\"completionItem/resolve response\");\n  return denoResponse;\n});\n*/\ninstallDefaultHandler(\"completionItem/resolve\");\n\n/*\nideConnection.onRequest(\"deno/taskDefinitions\", async (params, token) => {\n  //log(\"deno/taskDefinitions request\");\n  const denoResponse = await denoConnection.sendRequest(\"deno/taskDefinitions\", params, token);\n  //log(\"deno/taskDefinitions response\");\n  return denoResponse;\n});\n*/\ninstallDefaultHandler(\"deno/taskDefinitions\");\n\n/*\ndenoConnection.onRequest(\"client/registerCapability\", async (params, token) => {\n  //log(\"client/registerCapability request\");\n  const ideResponse = await ideConnection.sendRequest(\"client/registerCapability\", params, token);\n  //log(\"client/registerCapability response\");\n  return ideResponse;\n});\n*/\ninstallReverseDefaultHandler(\"client/registerCapability\");\n\n\ndenoConnection.listen();\n\nideConnection.listen();\n"}}

      const msg = { jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri: notebook.uri, languageId: 'typescript', version: notebook.version, text: fullText } } } as any;
      //log(`IDE NOTIFICATION HOOKED\n${msg.method}\n${JSON.stringify(msg.params)}`);
      await denoIn.write(msg);
    }
  }

  else if (data.method === "notebookDocument/didClose") {
    //log(`##### NOTEBOOK DIDCLOSE###`);
    //{"notebookDocument":{"uri":"file:///home/diego/NOTEBOOKS/chromeclient_test.nb.ts"},"cellTextDocuments":[{"uri":"deno-notebook-cell:/home/diego/NOTEBOOKS/chromeclient_test.nb.ts#W2sZmlsZQ%3D%3D"},{"uri":"deno-notebook-cell:/home/diego/NOTEBOOKS/chromeclient_test.nb.ts#W4sZmlsZQ%3D%3D"},{"uri":"deno-notebook-cell:/home/diego/NOTEBOOKS/chromeclient_test.nb.ts#W6sZmlsZQ%3D%3D"},{"uri":"deno-notebook-cell:/home/diego/NOTEBOOKS/chromeclient_test.nb.ts#X11sZmlsZQ%3D%3D"},{"uri":"deno-notebook-cell:/home/diego/NOTEBOOKS/chromeclient_test.nb.ts#X13sZmlsZQ%3D%3D"}]}
    const notebook = notebooks[data.params.notebookDocument.uri];
    if (notebook !== undefined) {
      for (const t of notebook.textDocuments) {
        delete documentXnotebook[t.uri];
      }
      const msg = { jsonrpc: "2.0", method: "textDocument/didClose", params: { uri: notebook.uri } } as any
      //log(`IDE NOTIFICATION HOOKED\n${msg.method}\n${JSON.stringify(msg.params)}`);
      await denoIn.write(msg);
      delete notebooks[data.params.notebookDocument.uri];
    }
  }

  else if (data.method === "notebookDocument/didChange") {
    //log(`##### NOTEBOOK DIDCHANGE###`);
    //ejemplo modificando estructura
    //{"notebookDocument":{"version":1,"uri":"file:///c%3A/cygwin64/home/80150555V/notebooks/test.nb.ts"},"change":{"cells":{"structure":{"array":{"start":2,"deleteCount":0,"cells":[{"kind":2,"document":"deno-notebook-cell:/c%3A/cygwin64/home/80150555V/notebooks/test.nb.ts#W4sZmlsZQ%3D%3D"}]},"didOpen":[{"uri":"deno-notebook-cell:/c%3A/cygwin64/home/80150555V/notebooks/test.nb.ts#W4sZmlsZQ%3D%3D","languageId":"typescript","version":1,"text":""}],"didClose":[]}}}}
    //ejemplo modificando texto
    //{"notebookDocument":{"version":0,"uri":"file:///home/diego/NOTEBOOKS/test.nb.ts"},"change":{"cells":{"textContent":[{"document":{"uri":"deno-notebook-cell:/home/diego/NOTEBOOKS/test.nb.ts#W1sZmlsZQ%3D%3D","version":2},"changes":[{"range":{"start":{"line":2,"character":0},"end":{"line":3,"character":0}},"rangeLength":1,"text":""}]}]}}}

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
          //log(`LSP DIDCHANGE\n${JSON.stringify(msg)}`);
          await denoIn.write(msg);
        }
      }
      if (data.params.change?.cells?.structure !== undefined) {
        //log(`##### NOTEBOOK DIDCHANGE (STRUCTURE) !!! ###`);
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
        //log(`LSP DIDCHANGE\n${JSON.stringify(msg)}`);
        await denoIn.write(msg);

      }
      if (!processed) {
        //log(`##### NOTEBOOK UNKNOWN DIDCHANGE TYPE ###\n${JSON.stringify(data)}`);
      }
    }
  }
  else {
    await denoIn.write(data);
  }
}

const onIdeUnknown = async (data: any) => {
  //log(`IDE UKNOWN\n${JSON.stringify(data)}`);
  await denoIn.write(data);
}


const onDenoRequest = async (data: any) => {
  //log(`DENO REQUEST [${data.id}]\n${data.method}\n${JSON.stringify(data.params)}`);
  await ideIn.write(data);
}

const onDenoResponse = async (data: any) => {
  //log(`DENO RESPONSE [${data.id}]\n${JSON.stringify(data)}`);

  if (data.result?.capabilities !== undefined) {
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

    //data.result.capabilities.semanticTokensProvider.range = false;
    //data.result.capabilities.semanticTokensProvider = false;
    //data.result.capabilities.selectionRangeProvider = false;
    //data.result.capabilities.foldingRangeProvider = false;
    //data.result.capabilities.codeActionProvider = false;

    //log(`DENO RESPONSE HOOKED [${data.id}]\n${JSON.stringify(data)}`);
  }
  else if (data.result?.range !== undefined) {
    const req = pendingRequests[data.id.toString()];
    if (req) {
      if (req.method === 'textDocument/hover' || req.method === 'textDocument/implementation' || req.method === 'textDocument/definition') {
        const tdUri = (req.params as any).textDocument.uri;
        if (tdUri) {
          const notebook = getNotebookByTextDocumentUri(tdUri);
          if (notebook) {
            const startLine = getStartLine(notebook, tdUri)!;
            data.result.range.start.line -= startLine;
            data.result.range.end.line -= startLine;
            //log(`DENO RESPONSE HOOKED [${data.id}]\n${JSON.stringify(data)}`);
          }
        }
      }
    }
  }
  else if (data.result && data.result.length > 0) {
    //log("RESULT IS ARRAY");
    const req = pendingRequests[data.id.toString()];
    //log(`\n${JSON.stringify(req)}`);
    if (req && req.method === 'textDocument/foldingRange') {
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
            //log(`DENO RESPONSE HOOKED [${data.id}]\n${JSON.stringify(data)}`);
          }
        }
      }
    }
    else if (req && (req.method === 'textDocument/codeAction')) {
      const tdUri = (req.params as any).textDocument.uri;
      if (tdUri) {
        const notebook = getNotebookByTextDocumentUri(tdUri);
        if (notebook) {
          // TODO  ESTE NO ES EL ÚNICO TIPO DE REGISTRO EN EL ARRAY, POR EJEMPLO. ESTO ES DURO, HAY QUE SEPARAR LAS ACCIONES POR DOCUMENTOS
          //{"jsonrpc":"2.0","result":[{"title":"Disable no-unused-vars for this line","kind":"quickfix","diagnostics":[{"range":{"start":{"line":1,"character":6},"end":{"line":1,"character":7}},"severity":2,"code":"no-unused-vars","source":"deno-lint","message":"`j` is never used\nIf this is intentional, prefix it with an underscore like `_j`"}],"edit":{"changes":{"file:///home/diego/NOTEBOOKS/test.nb.ts":[{"range":{"start":{"line":1,"character":0},"end":{"line":1,"character":0}},"newText":"// deno-lint-ignore no-unused-vars\n"}]}}},{"title":"Disable no-unused-vars for the entire file","kind":"quickfix","diagnostics":[{"range":{"start":{"line":1,"character":6},"end":{"line":1,"character":7}},"severity":2,"code":"no-unused-vars","source":"deno-lint","message":"`j` is never used\nIf this is intentional, prefix it with an underscore like `_j`"}],"edit":{"changes":{"file:///home/diego/NOTEBOOKS/test.nb.ts":[{"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":0}},"newText":"// deno-lint-ignore-file no-unused-vars\n"}]}}},{"title":"Ignore lint errors for the entire file","kind":"quickfix","diagnostics":[{"range":{"start":{"line":1,"character":6},"end":{"line":1,"character":7}},"severity":2,"code":"no-unused-vars","source":"deno-lint","message":"`j` is never used\nIf this is intentional, prefix it with an underscore like `_j`"}],"edit":{"changes":{"file:///home/diego/NOTEBOOKS/test.nb.ts":[{"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":0}},"newText":"// deno-lint-ignore-file\n"}]}}},{"title":"Extract function","kind":"refactor.extract.function","isPreferred":false,"disabled":{"reason":"Cannot extract empty range."},"data":{"specifier":"file:///home/diego/NOTEBOOKS/test.nb.ts","range":{"start":{"line":1,"character":7},"end":{"line":1,"character":7}},"refactorName":"Extract Symbol","actionName":"Extract Function"}},{"title":"Extract constant","kind":"refactor.extract.constant","isPreferred":false,"disabled":{"reason":"Cannot extract empty range."},"data":{"specifier":"file:///home/diego/NOTEBOOKS/test.nb.ts","range":{"start":{"line":1,"character":7},"end":{"line":1,"character":7}},"refactorName":"Extract Symbol","actionName":"Extract Constant"}},{"title":"Convert default export to named export","kind":"refactor.rewrite.export.named","isPreferred":false,"disabled":{"reason":"Could not find export statement"},"data":{"specifier":"file:///home/diego/NOTEBOOKS/test.nb.ts","range":{"start":{"line":1,"character":7},"end":{"line":1,"character":7}},"refactorName":"Convert export","actionName":"Convert default export to named export"}},{"title":"Convert named export to default export","kind":"refactor.rewrite.export.default","isPreferred":false,"disabled":{"reason":"Could not find export statement"},"data":{"specifier":"file:///home/diego/NOTEBOOKS/test.nb.ts","range":{"start":{"line":1,"character":7},"end":{"line":1,"character":7}},"refactorName":"Convert export","actionName":"Convert named export to default export"}},{"title":"Convert namespace import to named imports","kind":"refactor.rewrite.import.named","isPreferred":false,"disabled":{"reason":"Selection is not an import declaration."},"data":{"specifier":"file:///home/diego/NOTEBOOKS/test.nb.ts","range":{"start":{"line":1,"character":7},"end":{"line":1,"character":7}},"refactorName":"Convert import","actionName":"Convert namespace import to named imports"}}],"id":3}
          data.result = [];
          //log(`DENO RESPONSE HOOKED [${data.id}]\n${JSON.stringify(data)}`);
        }
      }
    }
  }
  else if (data.result && data.result.data) {
    const req = pendingRequests[data.id.toString()];
    if (req && (req.method === 'textDocument/semanticTokens/full')) {
      const tdUri = (req.params as any).textDocument.uri;
      if (tdUri) {
        const notebook = getNotebookByTextDocumentUri(tdUri);
        if (notebook) {
          // remove that response... full does not work and will never do.
          data.result.data = [];
          //log(`DENO RESPONSE HOOKED [${data.id}]\n${JSON.stringify(data)}`);
        }
      }
    }
  }


  await ideIn.write(data);
}

const onDenoNotification = async (data: any) => {
  //log(`DENO NOTIFICATION\n${data.method}\n${JSON.stringify(data.params)}`);

  if (data.method === 'textDocument/publishDiagnostics') {
    //{"uri":"deno-notebook-cell:/home/diego/NOTEBOOKS/test.nb.ts#W1sZmlsZQ%3D%3D","diagnostics":[{"range":{"start":{"line":3,"character":4},"end":{"line":3,"character":5}},"severity":2,"code":"no-unused-vars","source":"deno-lint","message":"`a` is never used\nIf this is intentional, prefix it with an underscore like `_a`"},{"range":{"start":{"line":3,"character":4},"end":{"line":3,"character":5}},"severity":2,"code":"prefer-const","source":"deno-lint","message":"`a` is never reassigned\nUse `const` instead"}],"version":1}
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
        //log(`DENO NOTIFICATION HOOKED\n${msg.method}\n${JSON.stringify(msg.params)}`);
        await ideIn.write(msg);
      }
    }
  }
  else {
    await ideIn.write(data);
  }


}

const onDenoUnknown = async (data: any) => {
  //log(`DENO UKNOWN\n${JSON.stringify(data)}`);
  await ideIn.write(data);
}


ideOut.listen((data: any) => {
  if (data.method !== undefined) {
    if (data.id !== undefined) {
      pendingRequests[data.id.toString()] = JSON.parse(JSON.stringify(data));
      //log(`${Object.keys(pendingRequests).length} pending requests`);
      onIdeRequest(data);
    }
    else {
      onIdeNotification(data);
      if (data.method === '$/cancelRequest') {
        delete pendingRequests[data.params.id.toString()];
        //log(`${Object.keys(pendingRequests).length} pending requests`);
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
    onDenoResponse(data);
    delete pendingRequests[data.id.toString()];
    //log(`${Object.keys(pendingRequests).length} pending requests`);
  }
  else {
    onDenoUnknown(data);
  }
});
