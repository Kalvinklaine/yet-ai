import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootDistDir = path.join(root, "dist", "plugins", "jetbrains");
const archiveInspectMaxBuffer = 128 * 1024 * 1024;
const maxOutputBytes = 64 * 1024;
const maxFailureText = 4_000;
const pollTimeoutMs = 15_000;
const pollIntervalMs = 250;
const terminateTimeoutMs = 2_000;
const killTimeoutMs = 1_000;
const identity = JSON.parse(await readFile(path.join(root, "product", "identity.json"), "utf8"));
const binaryFileName = process.platform === "win32" ? `${identity.engine.binaryName}.exe` : identity.engine.binaryName;
const bundledEngineResourcePath = `yet-ai-engine/${binaryFileName}`;

let tempDir;
let child;
let smokeToken;

try {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "yet-ai-jetbrains-bundled-runtime-"));
  const zipPath = await findExactlyOneRootDistZip();
  const pluginJarEntry = await findPluginJarEntry(zipPath);
  const pluginJarPath = await extractEntryToFile(zipPath, pluginJarEntry, path.join(tempDir, path.basename(pluginJarEntry)));
  const engineBytes = await extractBundledRuntime(pluginJarPath);
  const enginePath = path.join(tempDir, path.basename(bundledEngineResourcePath));
  await writeFile(enginePath, engineBytes);
  if (process.platform !== "win32") {
    await chmod(enginePath, 0o700);
  }

  const port = await findFreeLoopbackPort();
  smokeToken = `smoke-${randomBytes(32).toString("hex")}`;
  child = startRuntime(enginePath, port, smokeToken);
  await waitForPing(port, smokeToken);
  await stopProcess(child);
  child = undefined;

  console.log("JetBrains bundled runtime startup smoke passed.");
  console.log(`Extracted the bundled ${binaryFileName} from ${path.relative(root, zipPath)} and verified /v1/ping over loopback.`);
  console.log("No IntelliJ launch, provider credentials, provider calls, hosted service, signing, publishing, or production release claim was used.");
} catch (error) {
  let cleanupError;
  if (child !== undefined) {
    cleanupError = await stopProcess(child);
  }
  console.error(formatFailure(error, cleanupError));
  process.exit(1);
} finally {
  if (child !== undefined) {
    await stopProcess(child);
  }
  if (tempDir !== undefined) {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function findExactlyOneRootDistZip() {
  let entries;
  try {
    entries = await readdir(rootDistDir);
  } catch {
    throw new Error("No JetBrains dev-preview artifact directory found under dist/plugins/jetbrains/. Run `npm run prepare:jetbrains-preview` from the repository root first.");
  }
  const zips = [];
  for (const entry of entries) {
    if (!entry.endsWith("-dev-preview.zip")) {
      continue;
    }
    const zipPath = path.join(rootDistDir, entry);
    if ((await stat(zipPath)).isFile()) {
      zips.push(zipPath);
    }
  }
  if (zips.length === 0) {
    throw new Error("No root JetBrains dev-preview ZIP found under dist/plugins/jetbrains/. Run `npm run prepare:jetbrains-preview` from the repository root first.");
  }
  if (zips.length !== 1) {
    throw new Error("dist/plugins/jetbrains/ must contain exactly one root JetBrains dev-preview ZIP. Run `npm run prepare:jetbrains-preview` to rebuild a single current artifact.");
  }
  return zips[0];
}

async function findPluginJarEntry(zipPath) {
  const entries = await safeArchiveEntries(zipPath, `${path.relative(root, zipPath)} root ZIP`);
  const pluginJarEntries = entries.filter((entry) =>
    /(^|\/)lib\/yet-ai-jetbrains-[^/]*\.jar$/.test(entry) && !entry.includes("searchableOptions")
  );
  if (pluginJarEntries.length !== 1) {
    throw new Error(`${path.relative(root, zipPath)} must contain exactly one plugin JAR under lib/ matching yet-ai-jetbrains- and excluding searchableOptions; found ${pluginJarEntries.length}.`);
  }
  return pluginJarEntries[0];
}

async function extractBundledRuntime(pluginJarPath) {
  const jarEntries = await safeArchiveEntries(pluginJarPath, "nested JetBrains plugin JAR");
  if (!jarEntries.includes(bundledEngineResourcePath)) {
    throw new Error(`Nested JetBrains plugin JAR must contain bundled engine resource ${bundledEngineResourcePath}. Run \`npm run prepare:jetbrains-preview\` first.`);
  }
  const engineBytes = await extractEntryBytes(pluginJarPath, bundledEngineResourcePath);
  if (engineBytes === undefined) {
    throw new Error(`Could not extract bundled engine resource ${bundledEngineResourcePath} from nested JetBrains plugin JAR.`);
  }
  if (engineBytes.length === 0) {
    throw new Error(`Bundled engine resource ${bundledEngineResourcePath} must contain non-zero bytes; got 0.`);
  }
  return engineBytes;
}

async function safeArchiveEntries(archivePath, label) {
  const listing = listArchive(archivePath);
  const entries = listing.split(/\r?\n/).filter(Boolean);
  if (entries.length === 0) {
    throw new Error(`${label} has no inspectable entries.`);
  }
  for (const entry of entries) {
    if (!isSafeArchiveEntryPath(entry)) {
      throw new Error(`${label} contains an unsafe ZIP/JAR entry path; entries must be non-empty POSIX relative paths without traversal, backslashes, absolute prefixes, or macOS metadata.`);
    }
  }
  return entries;
}

function listArchive(archivePath) {
  for (const [command, args] of [
    ["zipinfo", ["-1", archivePath]],
    ["unzip", ["-Z", "-1", archivePath]],
    ["jar", ["tf", archivePath]],
  ]) {
    const result = spawnSync(command, args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: archiveInspectMaxBuffer,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    if (result.status === 0) {
      return result.stdout;
    }
  }
  throw new Error(`Could not inspect archive ${path.relative(root, archivePath)}. Install zipinfo/unzip or ensure jar is available with a JDK.`);
}

async function extractEntryToFile(archivePath, entry, destination) {
  const content = await extractEntryBytes(archivePath, entry);
  if (content === undefined) {
    throw new Error(`Could not extract ${entry} from ${path.relative(root, archivePath)} with unzip -p or JDK jar.`);
  }
  await writeFile(destination, content);
  return destination;
}

async function extractEntryBytes(archivePath, entry) {
  if (!isSafeArchiveEntryPath(entry)) {
    throw new Error(`${path.relative(root, archivePath)} contains unsafe ZIP/JAR entry path ${JSON.stringify(entry)}.`);
  }
  const unzipResult = spawnSync("unzip", ["-p", archivePath, entry], {
    cwd: root,
    encoding: "buffer",
    maxBuffer: archiveInspectMaxBuffer,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  if (unzipResult.status === 0) {
    return unzipResult.stdout;
  }

  const extractDir = await mkdtemp(path.join(os.tmpdir(), "yet-ai-jetbrains-bundled-extract-"));
  try {
    const jarResult = spawnSync("jar", ["xf", archivePath, entry], {
      cwd: extractDir,
      encoding: "buffer",
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    if (jarResult.status !== 0) {
      return undefined;
    }
    const extractedPath = await resolveExtractedEntryPath(extractDir, entry);
    if (extractedPath === undefined) {
      throw new Error(`${path.relative(root, archivePath)} extracted unsafe ZIP/JAR entry path ${JSON.stringify(entry)} outside the temporary directory.`);
    }
    return await readFile(extractedPath);
  } finally {
    await rm(extractDir, { recursive: true, force: true });
  }
}

async function resolveExtractedEntryPath(extractDir, entry) {
  const normalizedEntry = entry.replace(/\/+$/g, "");
  const target = path.resolve(extractDir, ...normalizedEntry.split("/"));
  const resolvedRoot = path.resolve(extractDir);
  const resolvedTarget = path.resolve(target);
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
    return undefined;
  }
  try {
    const targetStat = await stat(resolvedTarget);
    if (!targetStat.isFile()) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return resolvedTarget;
}

function isSafeArchiveEntryPath(entry) {
  if (typeof entry !== "string" || entry.length === 0) {
    return false;
  }
  if (entry.includes("\\")) {
    return false;
  }
  if (path.posix.isAbsolute(entry) || path.win32.isAbsolute(entry) || /^[A-Za-z]:/.test(entry)) {
    return false;
  }
  const normalized = entry.replace(/\/+$/g, "");
  if (normalized.length === 0) {
    return false;
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === ".." || segment === "__MACOSX" || segment === ".DS_Store")) {
    return false;
  }
  if (segments.some((segment) => segment.startsWith("._"))) {
    return false;
  }
  return true;
}

async function findFreeLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : undefined;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("Could not reserve a free loopback port for the bundled runtime smoke.");
  }
  return port;
}

function startRuntime(binaryPath, port, token) {
  const runtime = spawn(binaryPath, [], {
    cwd: root,
    env: runtimeEnv(port, token),
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  runtime.stdoutText = "";
  runtime.stderrText = "";
  runtime.on("error", (error) => {
    runtime.spawnError = error;
  });
  runtime.stdout.on("data", (chunk) => {
    runtime.stdoutText = boundedAppend(runtime.stdoutText, chunk.toString("utf8"));
  });
  runtime.stderr.on("data", (chunk) => {
    runtime.stderrText = boundedAppend(runtime.stderrText, chunk.toString("utf8"));
  });
  return runtime;
}

function runtimeEnv(port, token) {
  const env = {
    YET_AI_AUTH_TOKEN: token,
    YET_AI_HTTP_PORT: String(port),
  };
  for (const key of ["PATH", "Path", "HOME", "SystemRoot", "WINDIR", "TMPDIR", "TEMP", "TMP"]) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key];
    }
  }
  return env;
}

async function waitForPing(port, token) {
  const startedAt = Date.now();
  let lastError = "no response";
  while (Date.now() - startedAt < pollTimeoutMs) {
    if (child?.spawnError !== undefined) {
      throw new Error(`Bundled runtime process failed to start: ${child.spawnError.message}`);
    }
    if (child?.exitCode !== null) {
      throw new Error(`Bundled runtime exited before /v1/ping succeeded; code=${child.exitCode ?? "none"} signal=${child.signalCode ?? "none"}`);
    }
    try {
      const response = await ping(port, token);
      if (response.statusCode >= 200 && response.statusCode < 300) {
        return;
      }
      lastError = `/v1/ping returned HTTP ${response.statusCode}`;
    } catch (error) {
      lastError = error?.message ?? String(error);
    }
    await delay(pollIntervalMs);
  }
  throw new Error(`Bundled runtime did not answer authenticated /v1/ping within ${pollTimeoutMs}ms; last error: ${lastError}`);
}

function ping(port, token) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: "127.0.0.1",
      port,
      path: "/v1/ping",
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      timeout: 1_000,
    }, (response) => {
      response.resume();
      response.on("end", () => resolve({ statusCode: response.statusCode ?? 0 }));
    });
    request.on("timeout", () => request.destroy(new Error("/v1/ping request timed out")));
    request.on("error", reject);
    request.end();
  });
}

async function stopProcess(target) {
  if (target.exitCode !== null || target.signalCode !== null) {
    return undefined;
  }
  try {
    target.kill("SIGTERM");
  } catch (error) {
    return `runtime cleanup SIGTERM failed: ${error?.message ?? error}`;
  }
  if (await waitForProcessExit(target, terminateTimeoutMs)) {
    return undefined;
  }
  try {
    target.kill("SIGKILL");
  } catch (error) {
    return `runtime cleanup SIGKILL failed: ${error?.message ?? error}`;
  }
  if (!await waitForProcessExit(target, killTimeoutMs)) {
    return `runtime cleanup timed out ${killTimeoutMs}ms after SIGKILL`;
  }
  return undefined;
}

async function waitForProcessExit(target, ms) {
  if (target.exitCode !== null || target.signalCode !== null) {
    return true;
  }
  return await Promise.race([
    new Promise((resolve) => target.once("exit", () => resolve(true))),
    delay(ms).then(() => false),
  ]);
}

function formatFailure(error, cleanupError) {
  const cleanup = cleanupError ? `\nRuntime cleanup diagnostic:\n${cleanupError}` : "";
  const output = child ? `\nRuntime stdout/stderr tail:\n${child.stdoutText}\n${child.stderrText}` : "";
  return boundedDiagnostic(`JetBrains bundled runtime startup smoke failed: ${error?.message ?? error}${cleanup}${output}`);
}

function boundedAppend(existing, next) {
  const combined = existing + next;
  return combined.length > maxOutputBytes ? combined.slice(-maxOutputBytes) : combined;
}

function boundedDiagnostic(text) {
  return sanitizeText(String(text)).slice(0, maxFailureText);
}

function sanitizeText(text) {
  const values = [root, tempDir, process.env.HOME, process.env.CARGO_HOME, process.env.RUSTUP_HOME]
    .filter((value) => typeof value === "string" && value.length > 0)
    .sort((a, b) => b.length - a.length);
  let sanitized = text;
  for (const value of values) {
    sanitized = sanitized.split(value).join("<local-path>");
  }
  if (smokeToken !== undefined) {
    sanitized = sanitized.split(smokeToken).join("<runtime-token>");
  }
  sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer <redacted>");
  sanitized = sanitized.replace(/YET_AI_AUTH_TOKEN=\S+/gi, "YET_AI_AUTH_TOKEN=<redacted>");
  sanitized = sanitized.replace(/sk-[A-Za-z0-9._-]+/g, "sk-<redacted>");
  sanitized = sanitized.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, "<redacted-email>");
  return sanitized;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
