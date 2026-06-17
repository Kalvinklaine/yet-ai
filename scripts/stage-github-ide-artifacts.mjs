import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distPluginsRoot = path.join(root, "dist", "plugins");
const githubArtifactsRoot = path.join(root, "dist", "github-artifacts");
const vscodeStageDir = path.join(githubArtifactsRoot, "vscode-unzip-first");
const jetbrainsInstallDirectDir = path.join(githubArtifactsRoot, "jetbrains-install-direct");
const platform = platformSuffixFor();
const allowedManifestKinds = new Set(["vscode", "jetbrains"]);


try {
  const vscodeArtifact = await findSingleArtifact("vscode", ".vsix");
  const jetbrainsArtifact = await findSingleArtifact("jetbrains", ".zip");
  const manifestPath = path.join(distPluginsRoot, "manifest.json");

  await requireFile(manifestPath, "plugin artifact manifest");
  await validateManifest(manifestPath, vscodeArtifact, jetbrainsArtifact);
  await validateArtifactChecksum(vscodeArtifact);
  await validateArtifactChecksum(jetbrainsArtifact);

  await rm(githubArtifactsRoot, { recursive: true, force: true });
  await mkdir(vscodeStageDir, { recursive: true });
  await mkdir(jetbrainsInstallDirectDir, { recursive: true });

  await copyFile(vscodeArtifact.path, path.join(vscodeStageDir, path.basename(vscodeArtifact.path)));
  await copyFile(vscodeArtifact.checksumPath, path.join(vscodeStageDir, path.basename(vscodeArtifact.checksumPath)));
  await copyFile(manifestPath, path.join(vscodeStageDir, "manifest.json"));

  await writeVscodeReadme(vscodeArtifact.path, platform);
  await stageJetBrainsDirectInstall(jetbrainsArtifact.path);
  await validateJetBrainsDirectInstall();

  console.log("GitHub IDE artifact staging complete:");
  console.log(`  ${relative(vscodeStageDir)}`);
  console.log(`  ${relative(jetbrainsInstallDirectDir)}`);
  console.log("Source VSIX/ZIP checksums were validated before staging. No provider credentials, hosted backend, IDE launch, or network access are required.");
} catch (error) {
  console.error(`GitHub IDE artifact staging failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

async function validateManifest(manifestPath, vscodeArtifact, jetbrainsArtifact) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`${relative(manifestPath)} must contain valid artifact manifest JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!/^[a-f0-9]{40}$/i.test(manifest?.commit ?? "")) {
    throw new Error(`${relative(manifestPath)} must include the exact 40-character commit SHA before staging GitHub artifacts.`);
  }
  if (typeof manifest?.createdAt !== "string" || Number.isNaN(Date.parse(manifest.createdAt))) {
    throw new Error(`${relative(manifestPath)} must include a parseable createdAt timestamp before staging GitHub artifact provenance metadata.`);
  }
  const status = manifest?.devPreviewStatus;
  if (status?.kind !== "dev-preview" || status?.productionRelease !== false || status?.publishable !== false || status?.signed !== false || status?.published !== false || status?.notarized !== false || status?.marketplaceUpload !== false || status?.signing !== "none" || status?.notarization !== "none" || status?.productionInstaller !== false) {
    throw new Error(`${relative(manifestPath)} must declare devPreviewStatus as unsigned, unpublished, not notarized, install-from-file dev-preview metadata before manual dogfood.`);
  }
  if (manifest?.platform?.os !== platform.os || manifest?.platform?.arch !== platform.arch) {
    throw new Error(`${relative(manifestPath)} platform ${manifest?.platform?.os}/${manifest?.platform?.arch} does not match staging platform ${platform.os}/${platform.arch}.`);
  }
  if (!isBoundedArchivePath(manifest?.runtime?.bundledEngineResource, "yet-ai-engine/")) {
    throw new Error(`${relative(manifestPath)} must include bounded runtime.bundledEngineResource under yet-ai-engine/.`);
  }
  if (typeof manifest?.runtime?.engineBinaryName !== "string" || !/^[a-f0-9]{64}$/i.test(manifest?.runtime?.engineSha256 ?? "")) {
    throw new Error(`${relative(manifestPath)} must include runtime.engineBinaryName and runtime.engineSha256 provenance metadata before staging GitHub artifacts.`);
  }
  if (!isBoundedArchivePath(manifest?.runtime?.engineBinaryPath, "target/") && !isBoundedArchivePath(manifest?.runtime?.engineBinaryPath, "apps/plugins/vscode/bin/")) {
    throw new Error(`${relative(manifestPath)} must include a bounded runtime.engineBinaryPath provenance metadata path.`);
  }

  const artifacts = Array.isArray(manifest?.artifacts) ? manifest.artifacts : [];
  if (artifacts.length !== 2) {
    throw new Error(`${relative(manifestPath)} must contain exactly two artifact entries before staging: vscode and jetbrains.`);
  }
  const byKind = new Map(artifacts.map((artifact) => [artifact?.kind, artifact]));
  for (const kind of allowedManifestKinds) {
    const artifact = byKind.get(kind);
    if (artifact === undefined) {
      throw new Error(`${relative(manifestPath)} must contain a ${kind} artifact entry before staging.`);
    }
    const expectedPath = relative(kind === "vscode" ? vscodeArtifact.path : jetbrainsArtifact.path);
    if (artifact.path !== expectedPath || artifact.sha256Path !== `${expectedPath}.sha256`) {
      throw new Error(`${relative(manifestPath)} ${kind} artifact metadata must match the exact staged source artifact and checksum paths.`);
    }
    if (artifact.os !== platform.os || artifact.arch !== platform.arch) {
      throw new Error(`${relative(manifestPath)} ${kind} artifact platform metadata must match ${platform.os}/${platform.arch}.`);
    }
    if (!/^[a-f0-9]{64}$/i.test(artifact.sha256 ?? "")) {
      throw new Error(`${relative(manifestPath)} ${kind} artifact entry must include a SHA-256 digest.`);
    }
    const expectedSha256 = await readChecksum(kind === "vscode" ? vscodeArtifact.checksumPath : jetbrainsArtifact.checksumPath, kind === "vscode" ? vscodeArtifact.path : jetbrainsArtifact.path);
    if (artifact.sha256.toLowerCase() !== expectedSha256) {
      throw new Error(`${relative(manifestPath)} ${kind} artifact SHA-256 metadata must match the source checksum before staging.`);
    }
  }
}

async function findSingleArtifact(kind, extension) {
  const directory = path.join(distPluginsRoot, kind);
  const suffix = `-dev-preview${extension}`;
  let entries;
  try {
    entries = await readdir(directory);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`Missing ${kind} artifact directory: ${relative(directory)}. Run npm run prepare:${kind}-preview first.`);
    }
    throw error;
  }
  const artifactNames = [];
  for (const entry of entries) {
    if (!entry.endsWith(suffix)) {
      continue;
    }
    const artifactPath = path.join(directory, entry);
    const artifactStat = await stat(artifactPath);
    if (artifactStat.isFile()) {
      artifactNames.push(entry);
    }
  }
  if (artifactNames.length !== 1) {
    const found = artifactNames.length === 0 ? "none" : artifactNames.sort().join(", ");
    throw new Error(`Expected exactly one ${kind} ${suffix} artifact under ${relative(directory)}; found ${found}. Run the matching prepare script first.`);
  }
  const artifactPath = path.join(directory, artifactNames[0]);
  return { path: artifactPath, checksumPath: `${artifactPath}.sha256` };
}

async function requireFile(filePath, label) {
  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`Missing ${label}: ${relative(filePath)}`);
    }
    throw error;
  }
  if (!fileStat.isFile()) {
    throw new Error(`Expected ${label} to be a file: ${relative(filePath)}`);
  }
}

async function validateArtifactChecksum(artifact) {
  await requireFile(artifact.path, "source artifact");
  await requireFile(artifact.checksumPath, "source artifact checksum");
  const expected = await readChecksum(artifact.checksumPath, artifact.path);
  const actual = createHash("sha256").update(await readFile(artifact.path)).digest("hex");
  if (actual !== expected) {
    throw new Error(`${relative(artifact.checksumPath)} does not match ${relative(artifact.path)}: expected ${expected}, actual ${actual}`);
  }
}

async function readChecksum(checksumPath, artifactPath) {
  const text = (await readFile(checksumPath, "utf8")).trim();
  const match = text.match(/^([a-fA-F0-9]{64})(?:\s+(.+))?$/);
  if (match === null) {
    throw new Error(`${relative(checksumPath)} must contain a sha256 digest and optional artifact filename.`);
  }
  const referencedName = match[2]?.trim();
  if (referencedName !== undefined && referencedName.length > 0 && referencedName !== path.basename(artifactPath)) {
    throw new Error(`${relative(checksumPath)} references ${referencedName}, expected ${path.basename(artifactPath)}.`);
  }
  return match[1].toLowerCase();
}

async function writeVscodeReadme(vsixPath, platform) {
  const platformTag = `${platform.os}-${platform.arch}`;
  const platformLine = `This artifact was built for ${platform.os}/${platform.arch} (suffix: ${platform.suffix}). Download the matching ${platformTag} artifact for your OS/architecture; mixing platforms will fail because the JetBrains plugin JAR bundles a native ${process.env.YET_AI_ENGINE_BINARY_NAME || "yet-lsp"} runtime staged from the local cargo build output (not a signed or notarized production engine).`;
  await writeTextFile(path.join(vscodeStageDir, "README-INSTALL.txt"), `Yet AI VS Code dev-preview GitHub artifact for ${platformTag}

IMPORTANT: Do not install the downloaded GitHub artifact ZIP directly.

${platformLine}

GitHub wraps this folder in an outer artifact ZIP. Unzip that GitHub artifact first, then install the inner VSIX file:

  code --install-extension ${path.basename(vsixPath)} --force

If your shell is in a different directory, replace ${path.basename(vsixPath)} with the full path to the extracted inner VSIX.
`);
}

async function writeTextFile(filePath, text) {
  await writeFile(filePath, text, "utf8");
}

async function stageJetBrainsDirectInstall(jetbrainsZipPath) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "yet-ai-jetbrains-direct-"));
  try {
    const entries = await listArchiveEntries(jetbrainsZipPath);
    for (const entry of entries) {
      if (!isSafeArchiveEntryPath(entry)) {
        throw new Error(`${relative(jetbrainsZipPath)} contains unsafe ZIP entry path ${JSON.stringify(entry)}.`);
      }
    }
    await extractArchive(jetbrainsZipPath, tempDir);
    await cp(tempDir, jetbrainsInstallDirectDir, { recursive: true });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function validateJetBrainsDirectInstall() {
  const forbiddenFiles = [];
  await collectForbiddenDirectInstallFiles(jetbrainsInstallDirectDir, forbiddenFiles);
  if (forbiddenFiles.length > 0) {
    throw new Error(`${relative(jetbrainsInstallDirectDir)} must contain only JetBrains plugin distribution contents; found confusing metadata/readme file(s): ${forbiddenFiles.map(relative).join(", ")}`);
  }

  const pluginXml = await findLoosePluginXml(jetbrainsInstallDirectDir);
  if (pluginXml !== undefined) {
    return;
  }

  const jarPaths = [];
  await collectFiles(jetbrainsInstallDirectDir, jarPaths, ".jar");
  for (const jarPath of jarPaths) {
    const entries = await listArchiveEntries(jarPath).catch(() => []);
    if (entries.includes("META-INF/plugin.xml")) {
      return;
    }
  }

  throw new Error(`${relative(jetbrainsInstallDirectDir)} must contain JetBrains plugin distribution contents with META-INF/plugin.xml either loose or inside a nested plugin JAR.`);
}

async function collectForbiddenDirectInstallFiles(directory, results) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectForbiddenDirectInstallFiles(entryPath, results);
    } else if (entry.isFile() && isForbiddenDirectInstallFile(entry.name)) {
      results.push(entryPath);
    }
  }
}

function isForbiddenDirectInstallFile(name) {
  const lower = name.toLowerCase();
  return lower === "readme-install.txt" || lower === "manifest.json" || lower.endsWith(".sha256");
}

async function findLoosePluginXml(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const found = await findLoosePluginXml(entryPath);
      if (found !== undefined) {
        return found;
      }
    } else if (entry.isFile() && entry.name === "plugin.xml" && path.basename(path.dirname(entryPath)) === "META-INF") {
      return entryPath;
    }
  }
  return undefined;
}

async function collectFiles(directory, results, extension) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(entryPath, results, extension);
    } else if (entry.isFile() && entry.name.endsWith(extension)) {
      results.push(entryPath);
    }
  }
}

async function listArchiveEntries(archivePath) {
  const commands = [
    ["zipinfo", ["-1", archivePath]],
    ["unzip", ["-Z1", archivePath]],
    ["jar", ["tf", archivePath]],
  ];
  for (const [command, args] of commands) {
    const result = spawnSync(command, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: false });
    if (result.status === 0) {
      return result.stdout.split(/\r?\n/).filter(Boolean);
    }
  }
  throw new Error(`Could not inspect ${relative(archivePath)}. Install zipinfo/unzip or ensure jar is available with a JDK.`);
}

async function extractArchive(archivePath, targetDir) {
  const unzipResult = spawnSync("unzip", ["-q", archivePath, "-d", targetDir], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: false });
  if (unzipResult.status === 0) {
    return;
  }

  const jarResult = spawnSync("jar", ["xf", archivePath], { cwd: targetDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: false });
  if (jarResult.status === 0) {
    return;
  }

  throw new Error(`Could not extract ${relative(archivePath)} with unzip or JDK jar. unzip stderr: ${unzipResult.stderr.trim() || "<empty>"}; jar stderr: ${jarResult.stderr.trim() || "<empty>"}`);
}

function isBoundedArchivePath(value, prefix) {
  return typeof value === "string" && value.startsWith(prefix) && isSafeArchiveEntryPath(value);
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
  const normalized = entry.replace(/\\/g, "/").replace(/\/+$/g, "");
  if (normalized.length === 0) {
    return false;
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "__MACOSX" || segment === ".DS_Store")) {
    return false;
  }
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function relative(filePath) {
  return path.relative(root, filePath).replaceAll(path.sep, "/");
}


function platformSuffixFor(stage) {
  const os = stringOrUndefined(process.env.YET_AI_RUNTIME_OS) ?? process.platform;
  const arch = stringOrUndefined(process.env.YET_AI_RUNTIME_ARCH) ?? process.arch;
  return {
    os: normalizeOsLabel(os),
    arch: normalizeArchLabel(arch),
    suffix: `${normalizeOsLabel(os)}-${normalizeArchLabel(arch)}`,
  };
}

function normalizeOsLabel(value) {
  const lower = (value ?? "").toLowerCase();
  if (lower === "win32" || lower === "windows" || lower.startsWith("windows-")) {
    return "windows";
  }
  if (lower === "darwin" || lower === "macos" || lower === "osx" || lower.startsWith("macos-")) {
    return "macos";
  }
  if (lower === "linux" || lower.startsWith("ubuntu") || lower.startsWith("linux-")) {
    return "linux";
  }
  return lower;
}

function normalizeArchLabel(value) {
  const lower = (value ?? "").toLowerCase();
  if (lower === "x64" || lower === "amd64" || lower === "x86_64") {
    return "x64";
  }
  if (lower === "arm64" || lower === "aarch64") {
    return "arm64";
  }
  if (lower === "x86" || lower === "i386" || lower === "i686") {
    return "x86";
  }
  if (lower === "arm") {
    return "arm";
  }
  return lower;
}

function stringOrUndefined(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

