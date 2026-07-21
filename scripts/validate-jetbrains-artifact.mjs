import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { unlinkSync, writeFileSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(root, "dist", "plugins", "jetbrains");
const identity = JSON.parse(await readFile(path.join(root, "product", "identity.json"), "utf8"));
const binaryName = process.platform === "win32" ? `${identity.engine.binaryName}.exe` : identity.engine.binaryName;
const maxBuffer = 256 * 1024 * 1024;

try {
  const zipPath = await findArtifact();
  const zipBytes = await readFile(zipPath);
  const zipSha256 = sha256(zipBytes);
  await validateChecksum(zipPath, zipSha256);

  const zipEntries = listArchive(zipPath);
  const pluginJars = zipEntries.filter((entry) => /(^|\/)lib\/yet-ai-jetbrains-[^/]+\.jar$/.test(entry) && !entry.includes("searchableOptions"));
  requireValue(pluginJars.length === 1, `Expected exactly one JetBrains plugin JAR, found ${pluginJars.length}.`);
  const jarBytes = extractEntry(zipPath, pluginJars[0]);
  const jarEntries = listArchiveBuffer(jarBytes);

  const metadata = parseProperties(extractEntryBuffer(jarBytes, "yet-ai-artifact/build.properties").toString("utf8"));
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  requireValue(metadata["build.commit"] === head, `Embedded build.commit ${metadata["build.commit"] ?? "<missing>"} does not match HEAD ${head}.`);

  const engineBytes = extractEntryBuffer(jarBytes, `yet-ai-engine/${binaryName}`);
  const engineSha256 = sha256(engineBytes);
  requireValue(metadata["engine.sha256"] === engineSha256, `Embedded engine.sha256 ${metadata["engine.sha256"] ?? "<missing>"} does not match bundled engine ${engineSha256}.`);

  const guiEntries = jarEntries.filter((entry) => entry.startsWith("yet-ai-gui/") && !entry.endsWith("/")).sort();
  requireValue(guiEntries.length > 0, "Packaged GUI resources are missing.");
  const guiDigest = createHash("sha256");
  for (const entry of guiEntries) {
    guiDigest.update(entry.slice("yet-ai-gui/".length));
    guiDigest.update("\0");
    guiDigest.update(extractEntryBuffer(jarBytes, entry));
    guiDigest.update("\0");
  }
  const guiSha256 = guiDigest.digest("hex");
  requireValue(metadata["gui.sha256"] === guiSha256, `Embedded gui.sha256 ${metadata["gui.sha256"] ?? "<missing>"} does not match packaged GUI ${guiSha256}.`);

  console.log("JetBrains artifact validation passed.");
  console.log(`artifact=${relative(zipPath)}`);
  console.log(`artifact.sha256=${zipSha256}`);
  console.log(`build.commit=${head}`);
  console.log(`engine.sha256=${engineSha256}`);
  console.log(`gui.sha256=${guiSha256}`);
} catch (error) {
  console.error(`JetBrains artifact validation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

async function findArtifact() {
  const entries = await readdir(artifactDir).catch(() => []);
  const candidates = [];
  for (const entry of entries) {
    if (!entry.endsWith("-dev-preview.zip")) continue;
    const candidate = path.join(artifactDir, entry);
    if ((await stat(candidate)).isFile()) candidates.push(candidate);
  }
  requireValue(candidates.length === 1, `Expected exactly one dev-preview ZIP under ${relative(artifactDir)}, found ${candidates.length}. Run npm run prepare:jetbrains-preview first.`);
  return candidates[0];
}

async function validateChecksum(zipPath, actual) {
  const checksumPath = `${zipPath}.sha256`;
  const value = (await readFile(checksumPath, "utf8")).trim().split(/\s+/);
  requireValue(value[0]?.toLowerCase() === actual, `${relative(checksumPath)} does not match ${relative(zipPath)}.`);
  requireValue(value[1] === undefined || value[1] === path.basename(zipPath), `${relative(checksumPath)} references the wrong artifact name.`);
}

function listArchive(archivePath) {
  const result = spawnSync("unzip", ["-Z1", archivePath], { cwd: root, encoding: "utf8", maxBuffer, stdio: ["ignore", "pipe", "pipe"] });
  requireValue(result.status === 0, `Could not list ${relative(archivePath)} with unzip.`);
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

function listArchiveBuffer(bytes) {
  return withArchiveBuffer(bytes, (archivePath) => listArchive(archivePath));
}

function extractEntry(archivePath, entry) {
  const result = spawnSync("unzip", ["-p", archivePath, entry], { cwd: root, encoding: "buffer", maxBuffer, stdio: ["ignore", "pipe", "pipe"] });
  requireValue(result.status === 0, `Could not extract ${entry} from ${relative(archivePath)}.`);
  return result.stdout;
}

function extractEntryBuffer(bytes, entry) {
  return withArchiveBuffer(bytes, (archivePath) => extractEntry(archivePath, entry));
}

function withArchiveBuffer(bytes, callback) {
  const archivePath = path.join(os.tmpdir(), `yet-ai-artifact-${process.pid}-${Math.random().toString(16).slice(2)}.jar`);
  try {
    writeFileSync(archivePath, bytes);
    return callback(archivePath);
  } finally {
    unlinkSync(archivePath);
  }
}

function parseProperties(value) {
  return Object.fromEntries(value.split(/\r?\n/).filter(Boolean).map((line) => {
    const separator = line.indexOf("=");
    requireValue(separator > 0, "Embedded build.properties contains an invalid line.");
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function relative(value) {
  return path.relative(root, value).replaceAll(path.sep, "/");
}
