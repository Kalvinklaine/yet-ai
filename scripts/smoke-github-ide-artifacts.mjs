import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactsRoot = path.join(root, "dist", "github-artifacts");
const vscodeStageDir = path.join(artifactsRoot, "vscode-unzip-first");
const jetbrainsUnzipFirstDir = path.join(artifactsRoot, "jetbrains-unzip-first");
const jetbrainsInstallDirectDir = path.join(artifactsRoot, "jetbrains-install-direct");
const manifestStageDir = path.join(artifactsRoot, "manifest");
const failures = [];
const identity = JSON.parse(await readFile(path.join(root, "product", "identity.json"), "utf8"));
const binaryFileName = process.platform === "win32" ? `${identity.engine.binaryName}.exe` : identity.engine.binaryName;
const bundledEngineResourcePath = `yet-ai-engine/${binaryFileName}`;

await checkArtifactsRootRegressionGuards();

const vscodeVsixPath = await checkVscodeUnzipFirst();
const jetbrainsZipPath = await checkJetBrainsUnzipFirst();
await checkJetBrainsDirectInstall();
await checkManifest();
await checkMixedPluginArtifacts([vscodeStageDir, jetbrainsUnzipFirstDir, jetbrainsInstallDirectDir, manifestStageDir]);

if (failures.length > 0) {
  console.error("GitHub IDE artifact layout smoke failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("GitHub IDE artifact layout smoke passed.");
console.log(`VS Code unzip-first flow passed: ${relative(vscodeStageDir)} contains inner VSIX ${path.basename(vscodeVsixPath)} plus matching checksum and README install guidance.`);
console.log(`JetBrains unzip-first flow passed: ${relative(jetbrainsUnzipFirstDir)} contains inner plugin ZIP ${path.basename(jetbrainsZipPath)} plus matching checksum, README install guidance, and installable plugin structure.`);
console.log(`JetBrains direct-install flow passed: ${relative(jetbrainsInstallDirectDir)} contains only JetBrains distribution contents and validates as the outer GitHub artifact ZIP.`);
console.log(`Manifest flow passed: ${relative(path.join(manifestStageDir, "manifest.json"))} lists vscode and jetbrains artifacts.`);
console.log("No provider credentials, IDE launch, hosted backend, marketplace publication, signing, or network access were used.");

async function checkVscodeUnzipFirst() {
  await requireDirectory(vscodeStageDir, "VS Code unzip-first staging folder");
  const vsixPath = await requireSingleFileWithExtension(vscodeStageDir, ".vsix", "VS Code unzip-first staging folder");
  if (vsixPath !== undefined) {
    await checkChecksum(vsixPath);
  }
  const readme = await readRequiredText(path.join(vscodeStageDir, "README-INSTALL.txt"), "VS Code unzip-first README-INSTALL.txt");
  if (readme !== undefined) {
    requireText(readme, /do not install the downloaded github artifact zip directly/i, `${relative(vscodeStageDir)}/README-INSTALL.txt must warn not to install the downloaded GitHub artifact ZIP directly.`);
    requireText(readme, /unzip/i, `${relative(vscodeStageDir)}/README-INSTALL.txt must tell users to unzip the GitHub artifact first.`);
    requireText(readme, /code --install-extension\s+\S+\.vsix\s+--force/i, `${relative(vscodeStageDir)}/README-INSTALL.txt must show code --install-extension <path-to-vsix> --force for the inner VSIX.`);
  }
  return vsixPath;
}

async function checkJetBrainsUnzipFirst() {
  await requireDirectory(jetbrainsUnzipFirstDir, "JetBrains unzip-first staging folder");
  const zipPath = await requireSingleFileWithExtension(jetbrainsUnzipFirstDir, ".zip", "JetBrains unzip-first staging folder");
  if (zipPath !== undefined) {
    await checkChecksum(zipPath);
    await checkJetBrainsZip(zipPath, `${relative(zipPath)} inner plugin ZIP`);
  }
  const readme = await readRequiredText(path.join(jetbrainsUnzipFirstDir, "README-INSTALL.txt"), "JetBrains unzip-first README-INSTALL.txt");
  if (readme !== undefined) {
    requireText(readme, /do not install the downloaded github artifact zip directly/i, `${relative(jetbrainsUnzipFirstDir)}/README-INSTALL.txt must warn not to install the downloaded GitHub artifact ZIP directly.`);
    requireText(readme, /unzip/i, `${relative(jetbrainsUnzipFirstDir)}/README-INSTALL.txt must tell users to unzip the GitHub artifact first.`);
    requireText(readme, /install plugin from disk/i, `${relative(jetbrainsUnzipFirstDir)}/README-INSTALL.txt must tell users to use Install Plugin from Disk.`);
    requireText(readme, /inner plugin zip/i, `${relative(jetbrainsUnzipFirstDir)}/README-INSTALL.txt must identify the inner plugin ZIP as the installable file.`);
  }
  return zipPath;
}

async function checkJetBrainsDirectInstall() {
  await requireDirectory(jetbrainsInstallDirectDir, "JetBrains direct-install staging folder");
  const forbiddenFiles = [];
  await collectFilesMatching(jetbrainsInstallDirectDir, forbiddenFiles, (entry) => isForbiddenDirectInstallFile(entry.name));
  if (forbiddenFiles.length > 0) {
    failures.push(`${relative(jetbrainsInstallDirectDir)} must contain installable JetBrains distribution contents only; found metadata/readme/checksum file(s): ${forbiddenFiles.map(relative).join(", ")}.`);
  }

  const directZipPath = await createZipFromDirectoryContents(jetbrainsInstallDirectDir, "yet-ai-github-jetbrains-direct-");
  if (directZipPath === undefined) {
    return;
  }
  try {
    await checkJetBrainsZip(directZipPath, `${relative(jetbrainsInstallDirectDir)} zipped GitHub direct-install staging folder`);
  } finally {
    await rm(path.dirname(directZipPath), { recursive: true, force: true });
  }
}

async function checkManifest() {
  await requireDirectory(manifestStageDir, "manifest staging folder");
  const manifestPath = path.join(manifestStageDir, "manifest.json");
  const manifestText = await readRequiredText(manifestPath, "GitHub artifact manifest");
  if (manifestText === undefined) {
    return;
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch (error) {
    failures.push(`${relative(manifestPath)} must contain valid JSON: ${error instanceof Error ? error.message : String(error)}.`);
    return;
  }
  const kinds = new Set(Array.isArray(manifest.artifacts) ? manifest.artifacts.map((artifact) => artifact?.kind).filter((kind) => typeof kind === "string") : []);
  if (!kinds.has("vscode")) {
    failures.push(`${relative(manifestPath)} must contain a vscode artifact entry.`);
  }
  if (!kinds.has("jetbrains")) {
    failures.push(`${relative(manifestPath)} must contain a jetbrains artifact entry.`);
  }
}

async function checkArtifactsRootRegressionGuards() {
  await requireDirectory(artifactsRoot, "GitHub artifact staging root");
  const rootEntries = await readdir(artifactsRoot).catch(() => []);
  const hasTopLevelVsix = rootEntries.some((entry) => entry.endsWith(".vsix"));
  const hasTopLevelPluginZip = rootEntries.some((entry) => entry.endsWith(".zip"));
  if (hasTopLevelVsix && hasTopLevelPluginZip) {
    failures.push(`${relative(artifactsRoot)} must not use the old combined two-plugin layout with VSIX and JetBrains ZIP together at the artifact root.`);
  }
  if (await isDirectory(path.join(artifactsRoot, "dist", "plugins", "vscode")) && await isDirectory(path.join(artifactsRoot, "dist", "plugins", "jetbrains"))) {
    failures.push(`${relative(artifactsRoot)} must not resemble the old combined dist/plugins/vscode plus dist/plugins/jetbrains bundle layout.`);
  }
}

async function checkMixedPluginArtifacts(directories) {
  for (const directory of directories) {
    if (!await isDirectory(directory)) {
      continue;
    }
    const files = [];
    await collectFilesMatching(directory, files, (entry) => entry.name.endsWith(".vsix") || entry.name.endsWith(".zip"));
    const hasVsix = files.some((filePath) => filePath.endsWith(".vsix"));
    const hasZip = files.some((filePath) => filePath.endsWith(".zip"));
    if (hasVsix && hasZip) {
      failures.push(`${relative(directory)} must not contain both VS Code .vsix and JetBrains .zip artifacts together.`);
    }
  }
}

async function checkChecksum(artifactPath) {
  const checksumPath = `${artifactPath}.sha256`;
  const checksumText = await readRequiredText(checksumPath, `${path.basename(artifactPath)} checksum`);
  if (checksumText === undefined) {
    return;
  }
  const parts = checksumText.trim().split(/\s+/);
  const expected = parts[0];
  const checksumFileName = parts[1];
  if (!expected?.match(/^[a-f0-9]{64}$/i)) {
    failures.push(`${relative(checksumPath)} must contain a SHA-256 digest.`);
    return;
  }
  if (checksumFileName !== undefined && checksumFileName !== path.basename(artifactPath)) {
    failures.push(`${relative(checksumPath)} must reference ${path.basename(artifactPath)}.`);
  }
  const actual = createHash("sha256").update(await readFile(artifactPath)).digest("hex");
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    failures.push(`${relative(checksumPath)} does not match ${relative(artifactPath)}.`);
  }
}

async function checkJetBrainsZip(zipPath, label) {
  const entries = await listArchiveEntries(zipPath);
  if (entries === undefined) {
    return;
  }
  for (const entry of entries) {
    if (!isSafeArchiveEntryPath(entry)) {
      failures.push(`${label} contains unsafe ZIP entry path ${JSON.stringify(entry)}.`);
    }
  }

  const pluginJarEntry = entries.find((entry) => entry.endsWith(".jar") && entry.includes("/lib/yet-ai-jetbrains-") && !entry.includes("searchableOptions"));
  if (pluginJarEntry === undefined) {
    failures.push(`${label} must contain the Yet AI plugin JAR under lib/.`);
    return;
  }

  const pluginJar = await extractArchiveEntry(zipPath, pluginJarEntry, label);
  if (pluginJar === undefined) {
    return;
  }
  try {
    const jarEntries = await listArchiveEntries(pluginJar);
    if (jarEntries === undefined) {
      return;
    }
    for (const entry of jarEntries) {
      if (!isSafeArchiveEntryPath(entry)) {
        failures.push(`${label} plugin JAR contains unsafe entry path ${JSON.stringify(entry)}.`);
      }
    }
    requireArchiveEntry(jarEntries, "META-INF/plugin.xml", `${label} plugin JAR must contain META-INF/plugin.xml so JetBrains can load the plugin descriptor.`);
    requireArchiveEntry(jarEntries, "yet-ai-gui/index.html", `${label} plugin JAR must contain packaged GUI resources at yet-ai-gui/index.html.`);
    const indexHtml = await extractArchiveEntryText(pluginJar, "yet-ai-gui/index.html", `${label} plugin JAR must allow reading yet-ai-gui/index.html.`);
    if (indexHtml !== undefined) {
      requireReferencedGuiAssets(jarEntries, indexHtml, label);
    }
    requireArchiveEntry(jarEntries, bundledEngineResourcePath, `${label} plugin JAR must contain bundled engine resource at ${bundledEngineResourcePath} (the local cargo-built ${identity.engine.binaryName} staged by npm run prepare:jetbrains-preview).`);
    const engineBytes = await extractArchiveEntryBytes(pluginJar, bundledEngineResourcePath, `${label} plugin JAR must allow extracting bundled engine resource at ${bundledEngineResourcePath}.`);
    if (engineBytes !== undefined && engineBytes.length === 0) {
      failures.push(`${label} plugin JAR bundled engine resource at ${bundledEngineResourcePath} must contain non-zero bytes; got 0.`);
    }
  } finally {
    await rm(path.dirname(pluginJar), { recursive: true, force: true });
  }
}

async function createZipFromDirectoryContents(directory, tempPrefix) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), tempPrefix));
  const zipPath = path.join(tempDir, "artifact.zip");
  const zipResult = spawnSync("zip", ["-qr", zipPath, "."], { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: false });
  if (zipResult.status === 0) {
    return zipPath;
  }
  const jarResult = spawnSync("jar", ["cf", zipPath, "."], { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: false });
  if (jarResult.status === 0) {
    return zipPath;
  }
  failures.push(`Could not create a temporary GitHub-equivalent ZIP from ${relative(directory)} with zip or JDK jar. zip stderr: ${zipResult.stderr.trim() || "<empty>"}; jar stderr: ${jarResult.stderr.trim() || "<empty>"}.`);
  await rm(tempDir, { recursive: true, force: true });
  return undefined;
}

async function requireDirectory(directory, label) {
  if (!await isDirectory(directory)) {
    failures.push(`Missing ${label}: ${relative(directory)}.`);
  }
}

async function isDirectory(directory) {
  try {
    return (await stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

async function requireSingleFileWithExtension(directory, extension, label) {
  const entries = await readdir(directory).catch(() => []);
  const matches = [];
  for (const entry of entries) {
    if (!entry.endsWith(extension)) {
      continue;
    }
    const entryPath = path.join(directory, entry);
    const entryStat = await stat(entryPath).catch(() => undefined);
    if (entryStat?.isFile()) {
      matches.push(entryPath);
    }
  }
  if (matches.length !== 1) {
    failures.push(`${relative(directory)} must contain exactly one ${extension} file for ${label}; found ${matches.length === 0 ? "none" : matches.map((filePath) => path.basename(filePath)).sort().join(", ")}.`);
    return undefined;
  }
  return matches[0];
}

async function readRequiredText(filePath, label) {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      failures.push(`${label} must be a file: ${relative(filePath)}.`);
      return undefined;
    }
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      failures.push(`Missing ${label}: ${relative(filePath)}.`);
      return undefined;
    }
    throw error;
  }
}

function requireText(text, pattern, message) {
  if (!pattern.test(text)) {
    failures.push(message);
  }
}

async function collectFilesMatching(directory, results, predicate) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectFilesMatching(entryPath, results, predicate);
    } else if (entry.isFile() && predicate(entry, entryPath)) {
      results.push(entryPath);
    }
  }
}

function isForbiddenDirectInstallFile(name) {
  const lower = name.toLowerCase();
  return lower === "readme-install.txt" || lower === "manifest.json" || lower.endsWith(".sha256");
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
  failures.push(`Could not inspect ${relative(archivePath)}. Install zipinfo/unzip or ensure jar is available with a JDK.`);
  return undefined;
}

async function extractArchiveEntry(archivePath, entry, label) {
  const content = await extractArchiveEntryBytes(archivePath, entry, label);
  if (content === undefined) {
    failures.push(`${label} must allow extracting ${entry} with unzip -p or JDK jar.`);
    return undefined;
  }
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "yet-ai-github-artifact-entry-"));
  const entryPath = path.join(tempDir, path.basename(entry));
  await writeFile(entryPath, content);
  return entryPath;
}

async function extractArchiveEntryText(archivePath, entry, message) {
  const content = await extractArchiveEntryBytes(archivePath, entry, message);
  if (content === undefined) {
    failures.push(`${message} Could not extract ${entry} with unzip -p or JDK jar.`);
    return undefined;
  }
  return content.toString("utf8");
}

async function extractArchiveEntryBytes(archivePath, entry, label) {
  if (!isSafeArchiveEntryPath(entry)) {
    failures.push(`${label} contains unsafe archive entry path ${JSON.stringify(entry)}.`);
    return undefined;
  }
  const result = spawnSync("unzip", ["-p", archivePath, entry], { cwd: root, encoding: "buffer", stdio: ["ignore", "pipe", "pipe"], shell: false });
  if (result.status === 0) {
    return result.stdout;
  }
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "yet-ai-github-artifact-extract-"));
  try {
    const jarResult = spawnSync("jar", ["xf", archivePath, entry], { cwd: tempDir, encoding: "buffer", stdio: ["ignore", "pipe", "pipe"], shell: false });
    if (jarResult.status !== 0) {
      return undefined;
    }
    const extractedPath = await resolveExtractedEntryPath(tempDir, entry);
    if (extractedPath === undefined) {
      failures.push(`${label} extracted unsafe archive entry path ${JSON.stringify(entry)} outside the temporary directory.`);
      return undefined;
    }
    return await readFile(extractedPath);
  } catch {
    return undefined;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function resolveExtractedEntryPath(tempDir, entry) {
  if (!isSafeArchiveEntryPath(entry)) {
    return undefined;
  }
  const resolvedTempDir = await realpath(tempDir);
  const resolvedPath = path.resolve(resolvedTempDir, ...entry.split(/[\\/]/));
  const relativePath = path.relative(resolvedTempDir, resolvedPath);
  if (relativePath === "" || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return undefined;
  }
  const realExtractedPath = await realpath(resolvedPath);
  const realRelative = path.relative(resolvedTempDir, realExtractedPath);
  if (realRelative === "" || realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
    return undefined;
  }
  return realExtractedPath;
}

function requireArchiveEntry(entries, expected, message) {
  if (!entries.some((entry) => entry.endsWith(expected))) {
    failures.push(message);
  }
}

function requireReferencedGuiAssets(jarEntries, indexHtml, label) {
  const references = collectLocalAssetReferences(indexHtml);
  const assetReferences = [...references].filter((reference) => /\.(?:js|css)$/i.test(reference));
  if (assetReferences.length === 0) {
    failures.push(`${label} packaged GUI index.html must reference at least one JavaScript or CSS asset.`);
  }
  for (const reference of references) {
    if (!isSafeArchiveEntryPath(reference)) {
      failures.push(`${label} packaged GUI index.html references unsafe local asset ${JSON.stringify(reference)}.`);
      continue;
    }
    const expected = `yet-ai-gui/${reference}`;
    if (!jarEntries.some((entry) => entry.endsWith(expected))) {
      failures.push(`${label} plugin JAR must contain packaged GUI asset ${expected} referenced by yet-ai-gui/index.html.`);
    }
  }
}

function collectLocalAssetReferences(html) {
  const references = new Set();
  const assetPattern = /\b(?:src|href)=("|')([^"']+)\1/g;
  for (const match of html.matchAll(assetPattern)) {
    const value = match[2];
    const localPath = toLocalAssetPath(value);
    if (localPath !== undefined) {
      references.add(localPath);
    }
  }
  return references;
}

function toLocalAssetPath(value) {
  if (
    value.length === 0 ||
    value.startsWith("#") ||
    value.startsWith("data:") ||
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("vscode-resource:") ||
    value.startsWith("vscode-webview-resource:")
  ) {
    return undefined;
  }
  const withoutQuery = value.split(/[?#]/, 1)[0];
  const normalized = withoutQuery.replace(/^\.\//, "").replace(/^\//, "");
  if (normalized.length === 0 || normalized.includes("..")) {
    return undefined;
  }
  return normalized;
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
