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
};

let lspProcess: LspProcess | undefined;
let nextRequestId = 1;

const maxLspDiagnosticLength = 1000;
const lspDiagnosticTruncationMarker = "… [truncated sanitized LSP diagnostic]";

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

  lspProcess = { process: child, binaryPath };
  output.appendLine(`Started Yet AI read-only LSP MVP from ${path.basename(binaryPath)}.`);
  attachLspDiagnostics(child, binaryPath, output);
  sendLspMessage(child, {
    jsonrpc: "2.0",
    id: nextRequestId,
    method: "initialize",
    params: {
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
    },
  });
  nextRequestId += 1;
  sendLspMessage(child, {
    jsonrpc: "2.0",
    method: "initialized",
    params: {},
  });
}

export function stopYetAiLspClient(output?: LspOutput): void {
  if (!lspProcess) {
    return;
  }
  const current = lspProcess;
  lspProcess = undefined;
  output?.appendLine("Stopping Yet AI read-only LSP MVP.");
  if (!current.process.killed) {
    sendLspMessage(current.process, {
      jsonrpc: "2.0",
      id: nextRequestId,
      method: "shutdown",
      params: null,
    });
    nextRequestId += 1;
    sendLspMessage(current.process, {
      jsonrpc: "2.0",
      method: "exit",
      params: {},
    });
    current.process.kill();
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

function attachLspDiagnostics(child: childProcess.ChildProcess, binaryPath: string, output: LspOutput): void {
  child.stderr?.on("data", (chunk: Buffer) => {
    const diagnostic = sanitizeLspDiagnostic(chunk.toString("utf8"), "LSP stderr");
    if (diagnostic.trim().length > 0) {
      output.appendLine(`[lsp] ${diagnostic}`);
    }
  });
  child.on("exit", (code, signal) => {
    output.appendLine(`Yet AI read-only LSP MVP exited with code ${code ?? "null"} and signal ${signal ?? "null"}.`);
    if (lspProcess?.process === child) {
      lspProcess = undefined;
    }
  });
  child.on("error", (error) => {
    output.appendLine(`Yet AI read-only LSP MVP process error from ${path.basename(binaryPath)}: ${sanitizeLspDiagnostic(error, "process error")}`);
  });
}

function sendLspMessage(child: childProcess.ChildProcess, message: unknown): void {
  if (!child.stdin || child.killed) {
    return;
  }
  const body = JSON.stringify(message);
  child.stdin.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
}
