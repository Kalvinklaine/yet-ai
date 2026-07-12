import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(root, "apps", "gui", "dist");
const indexPath = path.join(distRoot, "index.html");
const identity = JSON.parse(await readFile(path.join(root, "product", "identity.json"), "utf8"));
const binaryName = identity.engine.binaryName;
const crateName = identity.engine.rustCrate;
const binaryFileName = process.platform === "win32" ? `${binaryName}.exe` : binaryName;
const token = `smoke-${randomUUID()}`;
const timeoutMs = 10_000;
let child;
let childExit;
let childExitResult;
let evidenceRoot;
let stdout = "";
let stderr = "";

try {
  await requireBuiltGui();
  const engineBinary = await resolveEngineBinary();
  const port = await allocatePort();
  evidenceRoot = await mkdtemp(path.join(os.tmpdir(), "yet-ai-engine-web-ui-smoke-"));
  child = spawn(engineBinary, [], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      YET_AI_HTTP_PORT: String(port),
      YET_AI_AUTH_TOKEN: token,
      YET_AI_WEB_UI_DIST_DIR: distRoot,
      XDG_CONFIG_HOME: path.join(evidenceRoot, "config"),
      XDG_CACHE_HOME: path.join(evidenceRoot, "cache"),
    },
  });
  child.stdout.on("data", (chunk) => { stdout = rememberOutput(stdout, chunk); });
  child.stderr.on("data", (chunk) => { stderr = rememberOutput(stderr, chunk); });
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

  const html = await pollWebUiRoot(port);
  assert(html.includes("window.__yetAiInitialRuntimeConfig"), "Root HTML did not include injected runtime config.");
  assert(html.includes('runtimeAccess:"same_origin_proxy"'), "Root HTML did not set same-origin proxy runtime access.");
  assert(!html.includes(token), "Root HTML leaked the runtime token.");
  assert(!/sessionToken|Authorization|Bearer\s+/i.test(html), "Root HTML included token-bearing runtime credentials.");
  const assetPath = firstAssetPath(html);
  assert(assetPath, "Root HTML did not reference a Vite /assets/ file.");
  const assetResponse = await fetch(`http://127.0.0.1:${port}${assetPath}`);
  assert(assetResponse.status === 200, `Expected asset ${assetPath} to return 200, got ${assetResponse.status}.`);
  await assetResponse.arrayBuffer();

  console.log("Engine-served Web UI smoke passed.");
  console.log(`Verified root HTML and ${assetPath} from ${path.relative(root, engineBinary)} on 127.0.0.1:${port}.`);
} catch (error) {
  console.error(redact(error.message));
  process.exitCode = 1;
} finally {
  await cleanup();
}

async function requireBuiltGui() {
  try {
    const fileStat = await stat(indexPath);
    if (!fileStat.isFile()) throw new Error("not a file");
    const html = await readFile(indexPath, "utf8");
    if (!firstAssetPath(html)) throw new Error("built GUI index.html does not reference Vite assets");
  } catch {
    console.error("Engine-served Web UI smoke prerequisite missing: run `npm --prefix apps/gui run build`.");
    process.exit(1);
  }
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
  const candidates = [path.join(root, "target", "debug", binaryFileName), path.join(root, "target", "release", binaryFileName)];
  for (const candidate of candidates) {
    if (await existingFile(candidate)) return candidate;
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
        if (error) reject(error);
        else if (address && typeof address === "object") resolve(address.port);
        else reject(new Error("Failed to allocate a loopback port."));
      });
    });
  });
}

async function pollWebUiRoot(port) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "no response yet";
  while (Date.now() < deadline) {
    if (childExitResult) {
      fail(`Engine exited before Web UI root became ready with status ${childExitResult.code ?? "unknown"}${childExitResult.signal ? ` and signal ${childExitResult.signal}` : ""}.${tailOutput()}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      const html = await response.text();
      if (response.status === 200) return html;
      lastError = `status ${response.status}: ${html.slice(0, 200)}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  fail(`Timed out after ${timeoutMs}ms waiting for Web UI root (${lastError}).${tailOutput()}`);
}

function firstAssetPath(html) {
  const match = html.match(/(?:src|href)=["'](?:\.?\/)?(assets\/[^"']+)["']/);
  return match ? `/${match[1]}` : null;
}

async function cleanup() {
  if (child && child.exitCode === null) {
    child.kill();
    await Promise.race([childExit, new Promise((resolve) => setTimeout(resolve, 2_000))]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  if (evidenceRoot) await rm(evidenceRoot, { recursive: true, force: true });
}

function rememberOutput(target, chunk) {
  return (target + chunk.toString("utf8")).slice(-4000);
}

function tailOutput() {
  const text = redact([stdout.trim(), stderr.trim()].filter(Boolean).join("\n"));
  return text ? `\nEngine output tail:\n${text}` : "";
}

function redact(value) {
  return String(value).split(token).join("[REDACTED]");
}

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}
