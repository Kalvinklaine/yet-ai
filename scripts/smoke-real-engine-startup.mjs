import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const identity = JSON.parse(await readFile(path.join(root, "product", "identity.json"), "utf8"));
const binaryName = identity.engine.binaryName;
const crateName = identity.engine.rustCrate;
const binaryFileName = process.platform === "win32" ? `${binaryName}.exe` : binaryName;
const keepEvidence = process.env.YET_AI_KEEP_SMOKE_EVIDENCE === "1";
const token = `smoke-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const timeoutMs = 10_000;
let child;
let evidenceRoot;
let childExit;
let childExitResult;
let stdout = "";
let stderr = "";

function fail(message) {
  throw new Error(message);
}

async function existingFile(candidate) {
  try {
    const candidateStat = await stat(candidate);
    return candidateStat.isFile();
  } catch {
    return false;
  }
}

async function resolveEngineBinary() {
  const candidates = [
    path.join(root, "target", "debug", binaryFileName),
    path.join(root, "apps", "plugins", "vscode", "bin", binaryFileName),
    path.join(root, "target", "release", binaryFileName),
  ];
  for (const candidate of candidates) {
    if (await existingFile(candidate)) {
      return candidate;
    }
  }
  console.error(`Engine binary not found. Run: cargo build -p ${crateName}`);
  console.error(`Expected one of: ${candidates.map((candidate) => path.relative(root, candidate)).join(", ")}`);
  process.exit(1);
}

function allocatePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error) {
          reject(error);
        } else if (address && typeof address === "object") {
          resolve(address.port);
        } else {
          reject(new Error("Failed to allocate a loopback port."));
        }
      });
    });
  });
}

function redact(value) {
  return value.split(token).join("[REDACTED]");
}

function rememberOutput(target, chunk) {
  const next = target + chunk.toString("utf8");
  return next.slice(-4000);
}

function tailOutput() {
  const text = redact([stdout.trim(), stderr.trim()].filter(Boolean).join("\n"));
  return text ? `\nEngine output tail:\n${text}` : "";
}

async function requestPing(port, headers = {}) {
  const response = await fetch(`http://127.0.0.1:${port}/v1/ping`, { headers });
  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

async function pollAuthenticatedPing(port) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "no response yet";
  while (Date.now() < deadline) {
    if (childExitResult) {
      fail(`Engine exited before /v1/ping became ready with status ${childExitResult.code ?? "unknown"}${childExitResult.signal ? ` and signal ${childExitResult.signal}` : ""}.${tailOutput()}`);
    }
    try {
      const response = await requestPing(port, { Authorization: `Bearer ${token}` });
      if (response.status === 200 && response.body?.ready === true) {
        return response;
      }
      lastError = `status ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  fail(`Timed out after ${timeoutMs}ms waiting for authenticated /v1/ping (${lastError}).${tailOutput()}`);
}

async function waitForLogEvidence(logPath) {
  const deadline = Date.now() + 5_000;
  let content = "";
  while (Date.now() < deadline) {
    try {
      content = await readFile(logPath, "utf8");
    } catch {
      content = "";
    }
    const lines = content.split("\n");
    const hasReject = lines.some((line) => line.includes("http.auth.reject")
      && line.includes("endpoint=/v1/ping")
      && line.includes("caller=gui_runtime_client")
      && line.includes("auth_header_present=false")
      && line.includes("reason=missing_header"));
    const hasSummary = lines.some((line) => line.includes("http.request.summary")
      && line.includes("endpoint=/v1/ping")
      && line.includes("caller=gui_runtime_client")
      && line.includes("auth_header_present=true")
      && line.includes("result_status=200"));
    if (hasReject && hasSummary) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  fail(`Engine log did not contain expected auth reject and auth-present request summary evidence at ${logPath}.`);
}

async function cleanup() {
  if (child && child.exitCode === null) {
    child.kill();
    await Promise.race([
      childExit,
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
    if (child.exitCode === null) {
      child.kill("SIGKILL");
    }
  }
  if (evidenceRoot && !keepEvidence) {
    await rm(evidenceRoot, { recursive: true, force: true });
  }
}

process.on("SIGINT", () => {
  if (child && child.exitCode === null) {
    child.kill();
  }
  process.exit(130);
});
process.on("SIGTERM", () => {
  if (child && child.exitCode === null) {
    child.kill();
  }
  process.exit(143);
});

try {
  const engineBinary = await resolveEngineBinary();
  const port = await allocatePort();
  evidenceRoot = await mkdtemp(path.join(os.tmpdir(), "yet-ai-real-engine-smoke-"));
  const configDir = path.join(evidenceRoot, "config");
  const cacheDir = path.join(evidenceRoot, "cache");
  const logDir = path.join(evidenceRoot, "logs");
  const logPath = path.join(logDir, `engine-${port}.log`);

  child = spawn(engineBinary, [], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      YET_AI_HTTP_PORT: String(port),
      YET_AI_AUTH_TOKEN: token,
      YET_AI_LOG_DIR: logDir,
      YET_AI_LOG_LEVEL: "info",
      XDG_CONFIG_HOME: configDir,
      XDG_CACHE_HOME: cacheDir,
    },
  });
  child.stdout.on("data", (chunk) => {
    stdout = rememberOutput(stdout, chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr = rememberOutput(stderr, chunk);
  });
  childExit = new Promise((resolve) => {
    child.once("exit", (code, signal) => {
      childExitResult = { code, signal };
      resolve(childExitResult);
    });
  });
  child.once("error", (error) => {
    childExitResult = { code: null, signal: null };
    stderr = rememberOutput(stderr, error.message);
  });

  await pollAuthenticatedPing(port);

  const unauthenticated = await requestPing(port, { "X-Yet-AI-Caller": "gui_runtime_client" });
  if (unauthenticated.status !== 401) {
    fail(`Expected unauthenticated /v1/ping to return 401, got ${unauthenticated.status}.`);
  }

  const authenticated = await requestPing(port, {
    Authorization: `Bearer ${token}`,
    "X-Yet-AI-Caller": "gui_runtime_client",
  });
  if (authenticated.status !== 200 || authenticated.body?.ready !== true) {
    fail(`Expected authenticated caller /v1/ping success, got ${authenticated.status}.`);
  }

  await waitForLogEvidence(logPath);

  console.log("Real engine auth smoke passed.");
  console.log(`Verified ${path.relative(root, engineBinary)} on 127.0.0.1:${port}.`);
  if (keepEvidence) {
    console.log(`Preserved smoke evidence at ${evidenceRoot}.`);
  }
} catch (error) {
  console.error(redact(error.message));
  process.exitCode = 1;
} finally {
  await cleanup();
}
