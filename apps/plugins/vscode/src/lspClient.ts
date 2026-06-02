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
  stderrLineBuffer: string;
  stderrDiscardingOversizedLine: boolean;
  nextRequestId: number;
  initialized: boolean;
  stopping: boolean;
  closed: boolean;
  pending: Map<number, PendingRequest>;
  documents: Map<string, number>;
  disposables: vscode.Disposable[];
  shutdownTimers: ReturnType<typeof setTimeout>[];
  stopResolvers: Array<() => void>;
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
const maxDocumentBytes = 256 * 1024;
const lspRequestTimeoutMs = 5_000;
const lspShutdownGraceMs = 500;
const lspTerminateGraceMs = 1_000;
const lspHardKillGraceMs = 1_500;
const lspFinalFallbackGraceMs = 2_000;
const maxLspDiagnosticLineBuffer = 8 * 1024;
const completionLabel = "Yet AI LSP connected";

export function isLspEnabled(): boolean {
  return vscode.workspace.getConfiguration(configurationPrefix).get<boolean>("lsp.enabled", false);
}

export function startYetAiLspClient(context: vscode.ExtensionContext, identity: ProductIdentity, output: LspOutput): void {
  if (!isLspEnabled()) {
    return;
  }
  if (lspProcess && !lspProcess.closed) {
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
    stderrLineBuffer: "",
    stderrDiscardingOversizedLine: false,
    nextRequestId: 1,
    initialized: false,
    stopping: false,
    closed: false,
    pending: new Map(),
    documents: new Map(),
    disposables: [],
    shutdownTimers: [],
    stopResolvers: [],
  };
  lspProcess = client;
  output.appendLine(`Started Yet AI read-only LSP MVP from ${path.basename(binaryPath)}.`);
  attachLspDiagnostics(client, output);
  void initializeLspClient(client, output);
}

export function stopYetAiLspClient(output?: LspOutput): Promise<void> {
  if (!lspProcess) {
    return Promise.resolve();
  }
  const current = lspProcess;
  const stopOutput = output ?? { appendLine() {} };
  lspProcess = undefined;
  const stopped = new Promise<void>((resolve) => {
    current.stopResolvers.push(resolve);
  });
  current.stopping = true;
  disposeLspClient(current);
  rejectPending(current, new Error("LSP client stopped"));
  stopOutput.appendLine("Stopping Yet AI read-only LSP MVP.");
  if (current.closed) {
    resolveLspStop(current);
    return stopped;
  }
  let exitSent = false;
  const sendExit = () => {
    if (current.closed || exitSent) {
      return;
    }
    exitSent = true;
    sendLspNotification(current, "exit", {}, output);
  };
  void sendLspRequest(current, "shutdown", null, stopOutput).catch(() => undefined).finally(sendExit);
  current.shutdownTimers.push(setTimeout(sendExit, lspShutdownGraceMs));
  current.shutdownTimers.push(setTimeout(() => terminateLspProcess(current, "SIGTERM"), lspTerminateGraceMs));
  current.shutdownTimers.push(setTimeout(() => terminateLspProcess(current, "SIGKILL"), lspHardKillGraceMs));
  current.shutdownTimers.push(setTimeout(() => finalizeUnclosedLspProcess(current, stopOutput), lspFinalFallbackGraceMs));
  return stopped;
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
    }, output);
    if (initialize.error) {
      output.appendLine(`Yet AI read-only LSP MVP initialize failed: ${sanitizeLspDiagnostic(initialize.error.message, "initialize failed")}`);
      stopYetAiLspClient(output);
      return;
    }
    if (client.closed || client.stopping) {
      return;
    }
    client.initialized = true;
    sendLspNotification(client, "initialized", {}, output);
    registerDocumentSync(client, output);
    output.appendLine("Yet AI read-only LSP MVP initialized for local file document sync and deterministic completion.");
  } catch (error) {
    if (!client.stopping) {
      output.appendLine(`Yet AI read-only LSP MVP initialize failed: ${sanitizeLspDiagnostic(error, "initialize failed")}`);
      stopYetAiLspClient(output);
    }
  }
}

function registerDocumentSync(client: LspProcess, output: LspOutput): void {
  for (const document of vscode.workspace.textDocuments ?? []) {
    syncOpenDocument(client, document, output);
  }
  client.disposables.push(vscode.workspace.onDidOpenTextDocument((document) => syncOpenDocument(client, document, output)));
  client.disposables.push(vscode.workspace.onDidChangeTextDocument((event) => syncChangedDocument(client, event.document, output)));
  client.disposables.push(vscode.workspace.onDidCloseTextDocument((document) => syncClosedDocument(client, document, output)));
  client.disposables.push(vscode.languages.registerCompletionItemProvider({ scheme: "file" }, {
    async provideCompletionItems(document, position) {
      if (!isEligibleDocument(client, document, output)) {
        return undefined;
      }
      syncOpenDocument(client, document, output);
      if (!client.documents.has(document.uri.toString())) {
        return undefined;
      }
      try {
        const response = await sendLspRequest(client, "textDocument/completion", {
          textDocument: { uri: document.uri.toString() },
          position: { line: position.line, character: position.character },
        }, output);

        if (response.error) {
          output.appendLine(`Yet AI read-only LSP MVP completion failed: ${sanitizeLspDiagnostic(response.error.message, "completion failed")}`);
          return undefined;
        }
        return toCompletionList(response.result);
      } catch (error) {
        output.appendLine(`Yet AI read-only LSP MVP completion unavailable: ${sanitizeLspDiagnostic(error, "completion unavailable")}`);
        return undefined;
      }
    },
  }));
}

function syncOpenDocument(client: LspProcess, document: vscode.TextDocument, output: LspOutput): void {
  if (!client.initialized || !isEligibleDocument(client, document, output)) {
    return;
  }
  const uri = document.uri.toString();
  const version = document.version;
  if (client.documents.get(uri) === version) {
    return;
  }
  if (client.documents.has(uri)) {
    syncChangedDocument(client, document, output);
    return;
  }
  const text = document.getText();
  client.documents.set(uri, version);
  if (!sendLspNotification(client, "textDocument/didOpen", {
    textDocument: {
      uri,
      languageId: document.languageId,
      version,
      text,
    },
  }, output)) {
    client.documents.delete(uri);
  }
}

function syncChangedDocument(client: LspProcess, document: vscode.TextDocument, output: LspOutput): void {
  if (!client.initialized || !isSupportedDocument(document)) {
    return;
  }
  const uri = document.uri.toString();
  if (!isSafeDocumentText(document.getText())) {
    syncUnsafeDocument(client, uri, output);
    return;
  }
  if (!client.documents.has(uri)) {
    syncOpenDocument(client, document, output);
    return;
  }
  const text = document.getText();
  const previousVersion = client.documents.get(uri);
  client.documents.set(uri, document.version);
  if (!sendLspNotification(client, "textDocument/didChange", {
    textDocument: {
      uri,
      version: document.version,
    },
    contentChanges: [{ text }],
  }, output)) {
    if (previousVersion === undefined) {
      client.documents.delete(uri);
    } else {
      client.documents.set(uri, previousVersion);
    }
  }
}

function syncClosedDocument(client: LspProcess, document: vscode.TextDocument, output: LspOutput): void {
  if (!isSupportedDocument(document)) {
    return;
  }
  const uri = document.uri.toString();
  if (!client.documents.delete(uri) || !client.initialized) {
    return;
  }
  sendLspNotification(client, "textDocument/didClose", {
    textDocument: { uri },
  }, output);
}

function syncUnsafeDocument(client: LspProcess, uri: string, output: LspOutput): void {
  if (!client.documents.delete(uri) || !client.initialized) {
    return;
  }
  sendLspNotification(client, "textDocument/didClose", {
    textDocument: { uri },
  }, output);
}

function isEligibleDocument(client: LspProcess, document: vscode.TextDocument, output: LspOutput): boolean {
  if (!isSupportedDocument(document)) {
    return false;
  }
  const text = document.getText();
  if (isSafeDocumentText(text)) {
    return true;
  }
  syncUnsafeDocument(client, document.uri.toString(), output);
  return false;
}

function isSupportedDocument(document: vscode.TextDocument): boolean {
  return document.uri.scheme === "file" && !document.isClosed && !document.isUntitled;
}

function isSafeDocumentText(text: string): boolean {
  return Buffer.byteLength(text, "utf8") <= maxDocumentBytes && !hasBinaryLikeContent(text);
}

function hasBinaryLikeContent(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 0 || code < 0x09 || (code > 0x0d && code < 0x20)) {
      return true;
    }
  }
  return false;
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
  child.stderr?.on("data", (chunk: Buffer) => appendLspStderr(client, chunk.toString("utf8"), output));
  child.stdin?.on("error", (error) => handleLspStdinError(client, output, error));
  child.on("close", (code, signal) => closeLspClient(client, output, `Yet AI read-only LSP MVP exited with code ${code ?? "null"} and signal ${signal ?? "null"}.`, new Error("LSP process exited")));
  child.on("exit", (_code, _signal) => {
    if (!client.closed) {
      client.shutdownTimers.push(setTimeout(() => finalizeUnclosedLspProcess(client, output), lspFinalFallbackGraceMs));
    }
  });
  child.on("error", (error) => {
    closeLspClient(
      client,
      output,
      `Yet AI read-only LSP MVP process error from ${path.basename(client.binaryPath)}: ${sanitizeLspDiagnostic(error, "process error")}`,
      error instanceof Error ? error : new Error("LSP process error"),
    );
  });
}

function closeLspClient(client: LspProcess, output: LspOutput, diagnostic: string, error: Error): void {
  if (client.closed) {
    return;
  }
  client.closed = true;
  client.stdoutBuffer = Buffer.alloc(0);
  flushLspStderr(client, output);
  output.appendLine(diagnostic);
  rejectPending(client, error);
  disposeLspClient(client);
  clearShutdownTimers(client);
  resolveLspStop(client);
  if (lspProcess?.process === client.process) {
    lspProcess = undefined;
  }
}

function handleLspStdinError(client: LspProcess, output: LspOutput, error: Error): void {
  closeLspClient(
    client,
    output,
    `Yet AI read-only LSP MVP stdin error: ${sanitizeLspDiagnostic(error, "stdin error")}`,
    error instanceof Error ? error : new Error("LSP stdin error"),
  );
}

function resolveLspStop(client: LspProcess): void {
  for (const resolve of client.stopResolvers.splice(0)) {
    resolve();
  }
}

function appendLspStderr(client: LspProcess, text: string, output: LspOutput): void {
  client.stderrLineBuffer += text;
  let lineEnd = findLineEnd(client.stderrLineBuffer);
  while (lineEnd !== -1) {
    const nextOffset = client.stderrLineBuffer[lineEnd] === "\r" && client.stderrLineBuffer[lineEnd + 1] === "\n" ? lineEnd + 2 : lineEnd + 1;
    if (!client.stderrDiscardingOversizedLine) {
      appendSanitizedLspStderrLine(client.stderrLineBuffer.slice(0, lineEnd), output);
    }
    client.stderrDiscardingOversizedLine = false;
    client.stderrLineBuffer = client.stderrLineBuffer.slice(nextOffset);
    lineEnd = findLineEnd(client.stderrLineBuffer);
  }
  if (!client.stderrDiscardingOversizedLine && client.stderrLineBuffer.length > maxLspDiagnosticLineBuffer) {
    output.appendLine("[lsp] [redacted oversized LSP stderr line]");
    client.stderrLineBuffer = "";
    client.stderrDiscardingOversizedLine = true;
  } else if (client.stderrDiscardingOversizedLine && client.stderrLineBuffer.length > maxLspDiagnosticLineBuffer) {
    client.stderrLineBuffer = "";
  }
}

function flushLspStderr(client: LspProcess, output: LspOutput): void {
  if (client.stderrDiscardingOversizedLine) {
    client.stderrLineBuffer = "";
    return;
  }
  if (client.stderrLineBuffer.length === 0) {
    return;
  }
  appendSanitizedLspStderrLine(client.stderrLineBuffer, output);
  client.stderrLineBuffer = "";
}

function findLineEnd(text: string): number {
  const lf = text.indexOf("\n");
  const cr = text.indexOf("\r");
  if (lf === -1) {
    return cr;
  }
  if (cr === -1) {
    return lf;
  }
  return Math.min(lf, cr);
}

function appendSanitizedLspStderrLine(line: string, output: LspOutput): void {
  const diagnostic = sanitizeLspDiagnostic(line, "LSP stderr");
  if (diagnostic.trim().length > 0) {
    output.appendLine(`[lsp] ${diagnostic}`);
  }
}

function handleLspStdout(client: LspProcess, chunk: Buffer, output: LspOutput): void {
  if (client.closed) {
    return;
  }
  client.stdoutBuffer = Buffer.concat([client.stdoutBuffer, chunk]);
  if (client.stdoutBuffer.length > maxLspMessageBytes) {
    failLspProtocol(client, output, "Yet AI read-only LSP MVP stdout exceeded bounded parser buffer.", new Error("LSP stdout exceeded bounded parser buffer"));
    return;
  }
  while (client.stdoutBuffer.length > 0) {
    const headerEnd = client.stdoutBuffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      if (client.stdoutBuffer.length > maxLspHeaderBytes) {
        failLspProtocol(client, output, "Yet AI read-only LSP MVP stdout header exceeded bounded parser buffer.", new Error("LSP stdout header exceeded bounded parser buffer"));
      }
      return;
    }
    const header = client.stdoutBuffer.subarray(0, headerEnd).toString("utf8");
    const length = parseContentLength(header);
    if (length === undefined || length > maxLspMessageBytes) {
      failLspProtocol(client, output, "Yet AI read-only LSP MVP stdout message had invalid bounded content length.", new Error("LSP stdout invalid content length"));
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
      failLspProtocol(client, output, `Yet AI read-only LSP MVP stdout JSON parse failed: ${sanitizeLspDiagnostic(error, "invalid JSON")}`, new Error("LSP stdout invalid JSON"));
      return;
    }
  }
}

function failLspProtocol(client: LspProcess, output: LspOutput, diagnostic: string, error: Error): void {
  client.stdoutBuffer = Buffer.alloc(0);
  client.stderrLineBuffer = "";
  client.stderrDiscardingOversizedLine = false;
  client.stopping = true;
  closeLspClient(client, output, diagnostic, error);
  terminateLspProcess(client, "SIGTERM");
  terminateLspProcess(client, "SIGKILL");
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

function sendLspRequest(client: LspProcess, method: string, params: unknown, output?: LspOutput): Promise<LspResponse> {
  const id = client.nextRequestId;
  client.nextRequestId += 1;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, lspRequestTimeoutMs);
    client.pending.set(id, { resolve, reject, timer });
    if (!sendLspMessage(client, { jsonrpc: "2.0", id, method, params }, output)) {
      clearTimeout(timer);
      client.pending.delete(id);
      reject(new Error(`${method} could not be sent`));
    }
  });
}

function sendLspNotification(client: LspProcess, method: string, params: unknown, output?: LspOutput): boolean {
  return sendLspMessage(client, { jsonrpc: "2.0", method, params }, output);
}

function rejectPending(client: LspProcess, error: Error): void {
  for (const pending of client.pending.values()) {
    clearTimeout(pending.timer);
    pending.reject(error);
  }
  client.pending.clear();
}

function disposeLspClient(client: LspProcess): void {
  for (const disposable of client.disposables.splice(0)) {
    disposable.dispose();
  }
}

function clearShutdownTimers(client: LspProcess): void {
  for (const timer of client.shutdownTimers.splice(0)) {
    clearTimeout(timer);
  }
}

function terminateLspProcess(client: LspProcess, signal: NodeJS.Signals): void {
  try {
    if (process.platform === "win32") {
      client.process.kill();
    } else {
      client.process.kill(signal);
    }
  } catch {
  }
}

function finalizeUnclosedLspProcess(client: LspProcess, output: LspOutput): void {
  if (client.closed) {
    return;
  }
  terminateLspProcess(client, "SIGKILL");
  closeLspClient(client, output, "Yet AI read-only LSP MVP stop completed after bounded kill fallback without process close.", new Error("LSP process did not close after bounded stop"));
}

function sendLspMessage(client: LspProcess, message: unknown, output?: LspOutput): boolean {
  const child = client.process;
  if (client.closed || !child.stdin || child.stdin.destroyed || child.stdin.writableEnded) {
    return false;
  }
  const body = JSON.stringify(message);
  const bodyBytes = Buffer.byteLength(body, "utf8");
  if (bodyBytes > maxLspMessageBytes) {
    output?.appendLine("Yet AI read-only LSP MVP skipped oversized outbound LSP message.");
    return false;
  }

  try {
    child.stdin.write(`Content-Length: ${bodyBytes}\r\n\r\n${body}`, (error: Error | null | undefined) => {
      if (error) {
        handleLspStdinError(client, output ?? { appendLine() {} }, error);
      }
    });
    return true;
  } catch (error) {
    output?.appendLine(`Yet AI read-only LSP MVP stdin write failed: ${sanitizeLspDiagnostic(error, "stdin write failed")}`);
    return false;
  }
}
