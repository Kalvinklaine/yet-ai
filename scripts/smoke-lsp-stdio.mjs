import { spawn, spawnSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const timeoutMs = 10_000;
const terminateTimeoutMs = 2_000;
const killTimeoutMs = 1_000;
const maxOutputBytes = 64 * 1024;
const maxFailureText = 4_000;
const maxHeaderBytes = 8 * 1024;
const maxMessageBytes = 512 * 1024;
const completionLabel = "Yet AI LSP connected";
const documentUri = "file:///yet-ai-lsp-smoke/src/main.rs";
const documentText = "fn main() {}\n";

let child;

try {
  const binary = await findOrBuildBinary();
  child = startLsp(binary);

  const initializedResponse = response(1);
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { capabilities: {} } });
  const initialized = await initializedResponse;
  assert(initialized.result?.serverInfo?.name === "Yet AI LSP", "initialize did not return Yet AI LSP serverInfo");
  assert(initialized.result?.capabilities?.textDocumentSync === 1, "initialize did not return textDocumentSync capability");
  assert(typeof initialized.result?.capabilities?.completionProvider === "object", "initialize did not return completionProvider capability");

  send({ jsonrpc: "2.0", method: "initialized", params: {} });
  send({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: {
      textDocument: {
        uri: documentUri,
        languageId: "rust",
        version: 1,
        text: documentText
      }
    }
  });
  const completionResponse = response(2);
  send({
    jsonrpc: "2.0",
    id: 2,
    method: "textDocument/completion",
    params: {
      textDocument: { uri: documentUri },
      position: { line: 0, character: 3 }
    }
  });
  const completion = await completionResponse;
  const items = completion.result?.items;
  assert(Array.isArray(items), "completion result did not include items");
  assert(items.length === 1, "completion result did not include exactly one status item");
  assert(items[0]?.label === completionLabel, "completion result did not include deterministic status label");
  assert(items[0]?.detail === "Local read-only LSP status", "completion result did not include deterministic status detail");

  send({ jsonrpc: "2.0", method: "textDocument/didClose", params: { textDocument: { uri: documentUri } } });
  const closedCompletionResponse = response(3);
  send({
    jsonrpc: "2.0",
    id: 3,
    method: "textDocument/completion",
    params: {
      textDocument: { uri: documentUri },
      position: { line: 0, character: 3 }
    }
  });
  const closedCompletion = await closedCompletionResponse;
  assert(Array.isArray(closedCompletion.result?.items), "closed-document completion did not return items");
  assert(closedCompletion.result.items.length === 0, "closed-document completion did not return an empty result");

  const unsupportedResponse = response(4);
  send({ jsonrpc: "2.0", id: 4, method: "workspace/symbol", params: { query: "smoke" } });
  const unsupported = await unsupportedResponse;
  assert(unsupported.error?.code === -32601, "unsupported probe did not return method-not-supported error");

  const shutdownResponse = response(5);
  send({ jsonrpc: "2.0", id: 5, method: "shutdown", params: {} });
  const shutdown = await shutdownResponse;
  assert(shutdown.result === null, "shutdown did not return null result");
  send({ jsonrpc: "2.0", method: "exit", params: {} });
  await waitForExit(0);

  console.log("LSP stdio smoke passed.");
} catch (error) {
  let cleanupError;
  if (child) {
    cleanupError = await stopProcess(child);
  }
  console.error(formatFailure(error, cleanupError));
  process.exit(1);
} finally {
  if (child) {
    await stopProcess(child);
  }
}

async function findOrBuildBinary() {
  const identity = JSON.parse(await readFile(path.join(root, "product", "identity.json"), "utf8"));
  const crateName = identity.engine.rustCrate;
  const binaryName = identity.engine.binaryName;
  const binaryFileName = process.platform === "win32" ? `${binaryName}.exe` : binaryName;
  const binary = path.join(root, "target", "debug", binaryFileName);
  const result = spawnSync("cargo", ["build", "-p", crateName], {
    cwd: root,
    env: cargoEnv(),
    encoding: "utf8",
    maxBuffer: maxOutputBytes
  });
  if (result.status !== 0) {
    throw new Error(`cargo build failed before LSP stdio smoke\n${boundedDiagnostic(result.stderr || result.stdout || "")}`);
  }
  if (!(await isFile(binary))) {
    throw new Error("cargo build completed but debug LSP binary was not found");
  }
  return binary;
}

async function isFile(file) {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

function startLsp(binary) {
  const lsp = spawn(binary, ["--lsp-stdio"], {
    cwd: root,
    env: lspEnv(),
    stdio: ["pipe", "pipe", "pipe"]
  });
  lsp.stdoutBuffer = Buffer.alloc(0);
  lsp.stderrText = "";
  lsp.pending = new Map();
  lsp.stdout.on("data", (chunk) => handleStdout(chunk));
  lsp.stderr.on("data", (chunk) => {
    lsp.stderrText = boundedAppend(lsp.stderrText, chunk.toString("utf8"));
  });
  lsp.on("exit", (code, signal) => {
    for (const { reject, timer } of lsp.pending.values()) {
      clearTimeout(timer);
      reject(new Error(`LSP process exited before response; code=${code ?? "none"} signal=${signal ?? "none"}`));
    }
    lsp.pending.clear();
  });
  lsp.on("error", (error) => {
    for (const { reject, timer } of lsp.pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    lsp.pending.clear();
  });
  return lsp;
}

function send(message) {
  assert(child.exitCode === null && child.signalCode === null, "cannot send message to exited LSP process");
  const body = Buffer.from(JSON.stringify(message), "utf8");
  child.stdin.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8"), body]));
}

function response(id) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.pending.delete(id);
      reject(new Error(`timed out waiting for LSP response id ${id}`));
    }, timeoutMs);
    child.pending.set(id, { resolve, reject, timer });
  });
}

function handleStdout(chunk) {
  child.stdoutBuffer = Buffer.concat([child.stdoutBuffer, chunk]);
  if (child.stdoutBuffer.length > maxOutputBytes) {
    throwPending(new Error("LSP stdout exceeded bounded smoke buffer"));
    return;
  }
  while (child.stdoutBuffer.length > 0) {
    const headerEnd = child.stdoutBuffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      if (child.stdoutBuffer.length > maxHeaderBytes) {
        throwPending(new Error("LSP response header exceeded bounded smoke buffer"));
      }
      return;
    }
    const header = child.stdoutBuffer.subarray(0, headerEnd).toString("utf8");
    const length = parseContentLength(header);
    if (length > maxMessageBytes) {
      throwPending(new Error("LSP response body exceeded bounded smoke buffer"));
      return;
    }
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (child.stdoutBuffer.length < bodyEnd) {
      return;
    }
    const body = child.stdoutBuffer.subarray(bodyStart, bodyEnd).toString("utf8");
    child.stdoutBuffer = child.stdoutBuffer.subarray(bodyEnd);
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      throwPending(new Error("LSP response body was not valid JSON"));
      return;
    }
    const pending = child.pending.get(parsed.id);
    if (pending) {
      child.pending.delete(parsed.id);
      clearTimeout(pending.timer);
      pending.resolve(parsed);
    }
  }
}

function parseContentLength(header) {
  for (const line of header.split("\r\n")) {
    const [name, value] = line.split(":");
    if (name?.toLowerCase() === "content-length") {
      const length = Number(value?.trim());
      if (Number.isInteger(length) && length >= 0) {
        return length;
      }
    }
  }
  throwPending(new Error("LSP response omitted Content-Length"));
  return 0;
}

function throwPending(error) {
  for (const { reject, timer } of child.pending.values()) {
    clearTimeout(timer);
    reject(error);
  }
  child.pending.clear();
}

async function waitForExit(expectedCode) {
  if (child.exitCode !== null) {
    assert(child.exitCode === expectedCode, `LSP process exited with code ${child.exitCode}`);
    return;
  }
  const result = await Promise.race([
    new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal }))),
    delay(timeoutMs).then(() => ({ timeout: true }))
  ]);
  if (result.timeout) {
    throw new Error("LSP process did not exit after shutdown/exit");
  }
  assert(result.code === expectedCode, `LSP process exited with code ${result.code ?? "none"} signal ${result.signal ?? "none"}`);
}

async function stopProcess(target) {
  if (target.exitCode !== null || target.signalCode !== null) {
    return undefined;
  }
  try {
    target.kill("SIGTERM");
  } catch (error) {
    return cleanupDiagnostic("SIGTERM", error);
  }
  const exited = await waitForProcessExit(target, terminateTimeoutMs);
  if (exited) {
    return undefined;
  }
  try {
    target.kill("SIGKILL");
  } catch (error) {
    return cleanupDiagnostic("SIGKILL", error);
  }
  const killed = await waitForProcessExit(target, killTimeoutMs);
  if (!killed) {
    return `LSP cleanup timed out ${killTimeoutMs}ms after SIGKILL`;
  }
  return undefined;
}

async function waitForProcessExit(target, ms) {
  if (target.exitCode !== null || target.signalCode !== null) {
    return true;
  }
  return await Promise.race([
    new Promise((resolve) => target.once("exit", () => resolve(true))),
    delay(ms).then(() => false)
  ]);
}

function cleanupDiagnostic(signal, error) {
  return boundedDiagnostic(`LSP cleanup ${signal} failed: ${error?.message ?? error}`);
}

function lspEnv() {
  const env = cargoEnv();
  delete env.YET_AI_AUTH_TOKEN;
  return env;
}

function cargoEnv() {
  return {
    ...process.env,
    CARGO_HOME: process.env.CARGO_HOME ?? path.join(process.env.HOME ?? root, ".cargo"),
    RUSTUP_HOME: process.env.RUSTUP_HOME ?? path.join(process.env.HOME ?? root, ".rustup")
  };
}

function boundedAppend(existing, next) {
  const combined = existing + next;
  return combined.length > maxOutputBytes ? combined.slice(-maxOutputBytes) : combined;
}

function formatFailure(error, cleanupError) {
  const cleanup = cleanupError ? `\nLSP cleanup diagnostic:\n${cleanupError}` : "";
  const output = child ? `\nLSP stderr/stdout tail:\n${child.stderrText}\n${child.stdoutBuffer.toString("utf8")}` : "";
  return boundedDiagnostic(`LSP stdio smoke failed: ${error?.message ?? error}${cleanup}${output}`);
}

function boundedDiagnostic(text) {
  return sanitizeText(String(text)).slice(0, maxFailureText);
}

function sanitizeText(text) {
  const values = [root, process.env.HOME, process.env.CARGO_HOME, process.env.RUSTUP_HOME]
    .filter((value) => typeof value === "string" && value.length > 0)
    .sort((a, b) => b.length - a.length);
  let sanitized = text;
  for (const value of values) {
    sanitized = sanitized.split(value).join("<local-path>");
  }
  sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer <redacted>");
  sanitized = sanitized.replace(/sk-[A-Za-z0-9._-]+/g, "sk-<redacted>");
  sanitized = sanitized.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, "<redacted-email>");
  return sanitized;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
