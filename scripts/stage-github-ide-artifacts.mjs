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
const jetbrainsUnzipFirstDir = path.join(githubArtifactsRoot, "jetbrains-unzip-first");
const jetbrainsInstallDirectDir = path.join(githubArtifactsRoot, "jetbrains-install-direct");
const manifestStageDir = path.join(githubArtifactsRoot, "manifest");

try {
  const vscodeArtifact = await findSingleArtifact("vscode", ".vsix");
  const jetbrainsArtifact = await findSingleArtifact("jetbrains", ".zip");
  const manifestPath = path.join(distPluginsRoot, "manifest.json");

  await requireFile(manifestPath, "plugin artifact manifest");
  await validateArtifactChecksum(vscodeArtifact);
  await validateArtifactChecksum(jetbrainsArtifact);

  await rm(githubArtifactsRoot, { recursive: true, force: true });
  await mkdir(vscodeStageDir, { recursive: true });
  await mkdir(jetbrainsUnzipFirstDir, { recursive: true });
  await mkdir(jetbrainsInstallDirectDir, { recursive: true });
  await mkdir(manifestStageDir, { recursive: true });

  await copyFile(vscodeArtifact.path, path.join(vscodeStageDir, path.basename(vscodeArtifact.path)));
  await copyFile(vscodeArtifact.checksumPath, path.join(vscodeStageDir, path.basename(vscodeArtifact.checksumPath)));
  await copyFile(jetbrainsArtifact.path, path.join(jetbrainsUnzipFirstDir, path.basename(jetbrainsArtifact.path)));
  await copyFile(jetbrainsArtifact.checksumPath, path.join(jetbrainsUnzipFirstDir, path.basename(jetbrainsArtifact.checksumPath)));
  await copyFile(manifestPath, path.join(manifestStageDir, "manifest.json"));

  await writeInstallReadmes(vscodeArtifact.path, jetbrainsArtifact.path);
  await stageJetBrainsDirectInstall(jetbrainsArtifact.path);
  await validateJetBrainsDirectInstall();

  console.log("GitHub IDE artifact staging complete:");
  console.log(`  ${relative(vscodeStageDir)}`);
  console.log(`  ${relative(jetbrainsUnzipFirstDir)}`);
  console.log(`  ${relative(jetbrainsInstallDirectDir)}`);
  console.log(`  ${relative(manifestStageDir)}`);
  console.log("Source VSIX/ZIP checksums were validated before staging. No provider credentials, hosted backend, IDE launch, or network access are required.");
} catch (error) {
  console.error(`GitHub IDE artifact staging failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
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

async function writeInstallReadmes(vsixPath, jetbrainsZipPath) {
  await writeTextFile(path.join(vscodeStageDir, "README-INSTALL.txt"), `Yet AI VS Code dev-preview GitHub artifact\n\nIMPORTANT: Do not install the downloaded GitHub artifact ZIP directly.\n\nGitHub wraps this folder in an outer artifact ZIP. Unzip that GitHub artifact first, then install the inner VSIX file:\n\n  code --install-extension ${path.basename(vsixPath)} --force\n\nIf your shell is in a different directory, replace ${path.basename(vsixPath)} with the full path to the extracted inner VSIX.\n`);

  await writeTextFile(path.join(jetbrainsUnzipFirstDir, "README-INSTALL.txt"), `Yet AI JetBrains dev-preview GitHub artifact\n\nIMPORTANT: Do not install the downloaded GitHub artifact ZIP directly.\n\nGitHub wraps this folder in an outer artifact ZIP. Unzip that GitHub artifact first, then install the inner plugin ZIP in JetBrains:\n\n  Settings/Preferences -> Plugins -> gear -> Install Plugin from Disk...\n  Choose: ${path.basename(jetbrainsZipPath)}\n\nThe inner plugin ZIP is the installable file; the outer GitHub artifact ZIP is only packaging.\n`);
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

function isSafeArchiveEntryPath(entry) {
  if (typeof entry !== "string" || entry.length === 0) {
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
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function relative(filePath) {
  return path.relative(root, filePath).replaceAll(path.sep, "/");
}
