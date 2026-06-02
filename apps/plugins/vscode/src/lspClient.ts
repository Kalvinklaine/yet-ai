import * as childProcess from "node:child_process";
import * as path from "node:path";
import * as vscode from "vscode";
import { findEngineBinary, redactRuntimeDiagnosticText } from "./engineConnection";
import { ProductIdentity, configurationPrefix } from "./identity";

type LspOutput = {
  appendLine(value: string): void;
};

type LspProcess = {
  process: childProcess.ChildProcess;
  binaryPath: string;
  stdoutBuffer: Buffer;
  nextRequestId: number;
  initialized: boolean;
  pending: Map<number, PendingRequest>;
  documents: Map<string, number>;
  disposables: vscode.Disposable[];
};

type PendingRequest = {
  resolve(value: LspResponse): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
};

type LspResponse = {
  id?: number;
  result?: unknown;
  error?: { message?: string };
};

let lspProcess: LspProcess | undefined;

const maxLspDiagnosticLength = 1000;
const lspDiagnosticTruncationMarker = "… [truncated sanitized LSP diagnostic]";
const maxLspHeaderBytes = 8 * 1024;
const maxLspMessageBytes = 512 * 1024;
const lspRequestTimeoutMs = 5_000;
const completionLabel = "Yet AI LSP connected";

export function isLspEnabled(): boolean {
  return vscode.workspace.getConfiguration(configurationPrefix).get<boolean>("lsp.enabled", false);
}

export function startYetAiLspClient(context: vscode.ExtensionContext, identity: ProductIdentity, output: LspOutput): void {
  if (!isLspEnabled()) {
    return;
  }
  if (lspProcess && !lspProcess.process.killed) {
    output.appendLine("Yet AI read-only LSP MVP is already running.");
    return;
  }

  let binaryPath: string | undefined;
  try {
    const configuredPath = vscode.workspace.getConfiguration(configurationPrefix).get<string>("engineBinaryPath", "").trim();
    binaryPath = findEngineBinary(configuredPath.length > 0 ? configuredPath : undefined, context.extensionPath, identity.engine.binaryName);
  } catch (error) {
    output.appendLine(`Yet AI read-only LSP MVP not started: ${sanitizeLspDiagnostic(error, "engine binary is not usable")}`);
    return;
  }

  if (!binaryPath) {
    output.appendLine("Yet AI read-only LSP MVP not started: engine binary not found.");
    return;
  }

  let child: childProcess.ChildProcess;
  try {
    child = childProcess.spawn(binaryPath, ["--lsp-stdio"], {
      env: createLspProcessEnvironment(process.env),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (error) {
    output.appendLine(`Yet AI read-only LSP MVP failed to start from ${path.basename(binaryPath)}: ${sanitizeLspDiagnostic(error, "spawn failed")}`);
    return;
  }

  const client: LspProcess = {
    process: child,
    binaryPath,
    stdoutBuffer: Buffer.alloc(0),
    nextRequestId: 1,
    initialized: false,
    pending: new Map(),
    documents: new Map(),
    disposables: [],
  };
  lspProcess = client;
  output.appendLine(`Started Yet AI read-only LSP MVP from ${path.basename(binaryPath)}.`);
  attachLspDiagnostics(client, output);
  void initializeLspClient(client, output);
}

export function stopYetAiLspClient(output?: LspOutput): void {
  if (!lspProcess) {
    return;
  }
  const current = lspProcess;
  lspProcess = undefined;
  for (const disposable of current.disposables.splice(0)) {
    disposable.dispose();
  }
  for (const pending of current.pending.values()) {
    clearTimeout(pending.timer);
    pending.reject(new Error("LSP client stopped"));
  }
  current.pending.clear();
  output?.appendLine("Stopping Yet AI read-only LSP MVP.");
  if (!current.process.killed) {
    void sendLspRequest(current, "shutdown", null).catch(() => undefined).finally(() => {
      sendLspNotification(current, "exit", {});
      current.process.kill();
    });
  }
}

export function createLspProcessEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "Path", "SystemRoot", "WINDIR"]) {
    if (source[key]) {
      env[key] = source[key];
    }
  }
  return env;
}

export function sanitizeLspDiagnostic(error: unknown, fallback: string): string {
  const rawMessage = error instanceof Error ? error.message : typeof error === "string" ? error : fallback;
  const redacted = redactRuntimeDiagnosticText(rawMessage);
  if (redacted.length <= maxLspDiagnosticLength) {
    return redacted;
  }
  return `${redacted.slice(0, maxLspDiagnosticLength - lspDiagnosticTruncationMarker.length)}${lspDiagnosticTruncationMarker}`;
}

async function initializeLspClient(client: LspProcess, output: LspOutput): Promise<void> {
  try {
    const initialize = await sendLspRequest(client, "initialize", {
      processId: process.pid,
      rootUri: null,
      capabilities: {
        textDocument: {
          synchronization: {
            didOpen: true,
            didChange: true,
            didClose: true,
          },
          completion: {
            dynamicRegistration: false,
          },
        },
        workspace: {},
      },
    });
    if (initialize.error) {
      output.appendLine(`Yet AI read-only LSP MVP initialize failed: ${sanitizeLspDiagnostic(initialize.error.message, "initialize failed")}`);
      stopYetAiLspClient(output);
      return;
    }
    client.initialized = true;
    sendLspNotification(client, "initialized", {});
    registerDocumentSync(client, output);
    output.appendLine("Yet AI read-only LSP MVP initialized for local file document sync and deterministic completion.");
  } catch (error) {
    output.appendLine(`Yet AI read-only LSP MVP initialize failed: ${sanitizeLspDiagnostic(error, "initialize failed")}`);
    stopYetAiLspClient(output);
  }
}

function registerDocumentSync(client: LspProcess, output: LspOutput): void {
  for (const document of vscode.workspace.textDocuments ?? []) {
    syncOpenDocument(client, document);
  }
  client.disposables.push(vscode.workspace.onDidOpenTextDocument((document) => syncOpenDocument(client, document)));
  client.disposables.push(vscode.workspace.onDidChangeTextDocument((event) => syncChangedDocument(client, event.document)));
  client.disposables.push(vscode.workspace.onDidCloseTextDocument((document) => syncClosedDocument(client, document)));
  client.disposables.push(vscode.languages.registerCompletionItemProvider({ scheme: "file" }, {
    async provideCompletionItems(document, position) {
      if (!isSupportedDocument(document)) {
        return undefined;
      }
      syncOpenDocument(client, document);
      const response = await sendLspRequest(client, "textDocument/completion", {
        textDocument: { uri: document.uri.toString() },
        position: { line: position.line, character: position.character },
      });
      if (response.error) {
        output.appendLine(`Yet AI read-only LSP MVP completion failed: ${sanitizeLspDiagnostic(response.error.message, "completion failed")}`);
        return undefined;
      }
      return toCompletionList(response.result);
    },
  }));
}

function syncOpenDocument(client: LspProcess, document: vscode.TextDocument): void {
  if (!client.initialized || !isSupportedDocument(document)) {
    return;
  }
  const uri = document.uri.toString();
  const version = document.version;
  if (client.documents.get(uri) === version) {
    return;
  }
  if (client.documents.has(uri)) {
    syncChangedDocument(client, document);
    return;
  }
  client.documents.set(uri, version);
  sendLspNotification(client, "textDocument/didOpen", {
    textDocument: {
      uri,
      languageId: document.languageId,
      version,
      text: document.getText(),
    },
  });
}

function syncChangedDocument(client: LspProcess, document: vscode.TextDocument): void {
  if (!client.initialized || !isSupportedDocument(document)) {
    return;
  }
  const uri = document.uri.toString();
  if (!client.documents.has(uri)) {
    syncOpenDocument(client, document);
    return;
  }
  client.documents.set(uri, document.version);
  sendLspNotification(client, "textDocument/didChange", {
    textDocument: {
      uri,
      version: document.version,
    },
    contentChanges: [{ text: document.getText() }],
  });
}

function syncClosedDocument(client: LspProcess, document: vscode.TextDocument): void {
  if (!isSupportedDocument(document)) {
    return;
  }
  const uri = document.uri.toString();
  if (!client.documents.delete(uri) || !client.initialized) {
    return;
  }
  sendLspNotification(client, "textDocument/didClose", {
    textDocument: { uri },
  });
}

function isSupportedDocument(document: vscode.TextDocument): boolean {
  return document.uri.scheme === "file" && !document.isClosed && !document.isUntitled;
}

function toCompletionList(result: unknown): vscode.CompletionList | undefined {
  if (!isObject(result) || !Array.isArray(result.items)) {
    return undefined;
  }
  const items = result.items
    .filter(isObject)
    .map((item) => {
      const label = typeof item.label === "string" ? item.label : completionLabel;
      const completionItem = new vscode.CompletionItem(label, vscode.CompletionItemKind.Text);
      if (typeof item.detail === "string") {
        completionItem.detail = item.detail;
      }
      return completionItem;
    });
  return new vscode.CompletionList(items, Boolean(result.isIncomplete));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function attachLspDiagnostics(client: LspProcess, output: LspOutput): void {
  const child = client.process;
  child.stdout?.on("data", (chunk: Buffer) => handleLspStdout(client, chunk, output));
  child.stderr?.on("data", (chunk: Buffer) => {
    const diagnostic = sanitizeLspDiagnostic(chunk.toString("utf8"), "LSP stderr");
    if (diagnostic.trim().length > 0) {
      output.appendLine(`[lsp] ${diagnostic}`);
    }
  });
  child.on("exit", (code, signal) => {
    output.appendLine(`Yet AI read-only LSP MVP exited with code ${code ?? "null"} and signal ${signal ?? "null"}.`);
    rejectPending(client, new Error("LSP process exited"));
    for (const disposable of client.disposables.splice(0)) {
      disposable.dispose();
    }
    if (lspProcess?.process === child) {
      lspProcess = undefined;
    }
  });
  child.on("error", (error) => {
    output.appendLine(`Yet AI read-only LSP MVP process error from ${path.basename(client.binaryPath)}: ${sanitizeLspDiagnostic(error, "process error")}`);
    rejectPending(client, error instanceof Error ? error : new Error("LSP process error"));
    if (lspProcess?.process === child) {
      lspProcess = undefined;
    }
  });
}

function handleLspStdout(client: LspProcess, chunk: Buffer, output: LspOutput): void {
  client.stdoutBuffer = Buffer.concat([client.stdoutBuffer, chunk]);
  if (client.stdoutBuffer.length > maxLspMessageBytes) {
    output.appendLine("Yet AI read-only LSP MVP stdout exceeded bounded parser buffer.");
    rejectPending(client, new Error("LSP stdout exceeded bounded parser buffer"));
    return;
  }
  while (client.stdoutBuffer.length > 0) {
    const headerEnd = client.stdoutBuffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      if (client.stdoutBuffer.length > maxLspHeaderBytes) {
        output.appendLine("Yet AI read-only LSP MVP stdout header exceeded bounded parser buffer.");
        rejectPending(client, new Error("LSP stdout header exceeded bounded parser buffer"));
      }
      return;
    }
    const header = client.stdoutBuffer.subarray(0, headerEnd).toString("utf8");
    const length = parseContentLength(header);
    if (length === undefined || length > maxLspMessageBytes) {
      output.appendLine("Yet AI read-only LSP MVP stdout message had invalid bounded content length.");
      rejectPending(client, new Error("LSP stdout invalid content length"));
      return;
    }
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (client.stdoutBuffer.length < bodyEnd) {
      return;
    }
    const body = client.stdoutBuffer.subarray(bodyStart, bodyEnd).toString("utf8");
    client.stdoutBuffer = client.stdoutBuffer.subarray(bodyEnd);
    try {
      const message = JSON.parse(body) as LspResponse;
      if (typeof message.id === "number") {
        const pending = client.pending.get(message.id);
        if (pending) {
          client.pending.delete(message.id);
          clearTimeout(pending.timer);
          pending.resolve(message);
        }
      }
    } catch (error) {
      output.appendLine(`Yet AI read-only LSP MVP stdout JSON parse failed: ${sanitizeLspDiagnostic(error, "invalid JSON")}`);
      rejectPending(client, new Error("LSP stdout invalid JSON"));
      return;
    }
  }
}

function parseContentLength(header: string): number | undefined {
  for (const line of header.split("\r\n")) {
    const [name, value] = line.split(":");
    if (name?.toLowerCase() === "content-length") {
      const length = Number(value?.trim());
      if (Number.isInteger(length) && length >= 0) {
        return length;
      }
    }
  }
  return undefined;
}

function sendLspRequest(client: LspProcess, method: string, params: unknown): Promise<LspResponse> {
  const id = client.nextRequestId;
  client.nextRequestId += 1;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, lspRequestTimeoutMs);
    client.pending.set(id, { resolve, reject, timer });
    sendLspMessage(client.process, { jsonrpc: "2.0", id, method, params });
  });
}

function sendLspNotification(client: LspProcess, method: string, params: unknown): void {
  sendLspMessage(client.process, { jsonrpc: "2.0", method, params });
}

function rejectPending(client: LspProcess, error: Error): void {
  for (const pending of client.pending.values()) {
    clearTimeout(pending.timer);
    pending.reject(error);
  }
  client.pending.clear();
}

function sendLspMessage(child: childProcess.ChildProcess, message: unknown): void {
  if (!child.stdin || child.killed || child.stdin.destroyed) {
    return;
  }
  const body = JSON.stringify(message);
  try {
    child.stdin.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
  } catch {
    return;
  }
}
