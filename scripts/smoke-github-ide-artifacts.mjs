import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { GuiAssetFreshnessError, assertPackagedGuiFreshnessInArchive, collectLocalAssetReferences, isSafeLocalAssetReference } from "./gui-asset-freshness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactsRoot = path.join(root, "dist", "github-artifacts");
const vscodeStageDir = path.join(artifactsRoot, "vscode-unzip-first");
const jetbrainsInstallDirectDir = path.join(artifactsRoot, "jetbrains-install-direct");
const archiveInspectMaxBuffer = 128 * 1024 * 1024;
const failures = [];
const expectedArtifactStageDirs = new Set(["vscode-unzip-first", "jetbrains-install-direct"]);
const allowedManifestKinds = new Set(["vscode", "jetbrains"]);
const allowedManifestOs = new Set(["linux", "macos", "windows"]);
const allowedManifestArch = new Set(["x64", "arm64", "x86", "arm"]);
const requiredDevPreviewStatus = Object.freeze({
  kind: "dev-preview",
  productionRelease: false,
  publishable: false,
  signing: "none",
  marketplaceUpload: false,
});
const identity = JSON.parse(await readFile(path.join(root, "product", "identity.json"), "utf8"));
const guiDistRoot = path.join(root, "apps", "gui", "dist");
const binaryFileName = process.platform === "win32" ? `${identity.engine.binaryName}.exe` : identity.engine.binaryName;
const bundledEngineResourcePath = `yet-ai-engine/${binaryFileName}`;

await checkArtifactsRootRegressionGuards();

const vscodeVsixPath = await checkVscodeUnzipFirst();
await checkJetBrainsDirectInstall();
await checkManifest();
await checkLocalCombineDownloadSimulation();
await checkMixedPluginArtifacts([vscodeStageDir, jetbrainsInstallDirectDir]);

if (failures.length > 0) {
  console.error("GitHub IDE artifact layout smoke failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("GitHub IDE artifact layout smoke passed.");
console.log(`VS Code unzip-first flow passed: ${relative(vscodeStageDir)} contains inner VSIX ${path.basename(vscodeVsixPath)} plus matching checksum, README install guidance, and embedded manifest.json.`);
console.log(`JetBrains direct-install flow passed: ${relative(jetbrainsInstallDirectDir)} contains only JetBrains distribution contents and validates as the outer GitHub artifact ZIP.`);
console.log(`Embedded manifest flow passed: ${relative(path.join(vscodeStageDir, "manifest.json"))} lists vscode and jetbrains artifacts.`);
console.log("Local combine/download simulation passed: one downloaded VS Code artifact manifest combines into one platform with vscode and jetbrains entries.");
console.log("No provider credentials, IDE launch, hosted backend, marketplace publication, signing, or network access were used.");

async function checkVscodeUnzipFirst() {
  await requireDirectory(vscodeStageDir, "VS Code unzip-first staging folder");
  const vsixPath = await requireSingleFileWithExtension(vscodeStageDir, ".vsix", "VS Code unzip-first staging folder");
  await requireOnlyArtifactFamilyFiles(vscodeStageDir, [path.basename(vsixPath ?? ""), path.basename(vsixPath === undefined ? "" : `${vsixPath}.sha256`), "README-INSTALL.txt", "manifest.json"].filter(Boolean), "VS Code unzip-first artifact");
  if (vsixPath !== undefined) {
    await checkChecksum(vsixPath);
    await checkVscodeVsix(vsixPath);
  }
  const readme = await readRequiredText(path.join(vscodeStageDir, "README-INSTALL.txt"), "VS Code unzip-first README-INSTALL.txt");
  if (readme !== undefined) {
    requireNoSensitiveText(readme, `${relative(vscodeStageDir)}/README-INSTALL.txt`);
    requireText(readme, /do not install the downloaded github artifact zip directly/i, `${relative(vscodeStageDir)}/README-INSTALL.txt must warn not to install the downloaded GitHub artifact ZIP directly.`);
    requireText(readme, /unzip/i, `${relative(vscodeStageDir)}/README-INSTALL.txt must tell users to unzip the GitHub artifact first.`);
    requireText(readme, /code --install-extension\s+\S+\.vsix\s+--force/i, `${relative(vscodeStageDir)}/README-INSTALL.txt must show code --install-extension <path-to-vsix> --force for the inner VSIX.`);
    requireText(readme, /platform|os\/arch|linux|macos|windows/i, `${relative(vscodeStageDir)}/README-INSTALL.txt must mention the OS/architecture platform this artifact was built for.`);
  }
  await checkEmbeddedManifest(vscodeStageDir);
  return vsixPath;
}

async function checkVscodeVsix(vsixPath) {
  const entries = await listArchiveEntries(vsixPath);
  if (entries === undefined) {
    return;
  }
  validateArchiveEntries(entries, `${relative(vsixPath)} VSIX`);
  await checkArchiveGuiFreshness({
    archivePath: vsixPath,
    entries,
    packagedPrefix: "extension/media/gui/",
    label: `${relative(vsixPath)} VSIX packaged GUI`,
    guidance: "Run `npm run prepare:vscode-preview -- --skip-engine-prepare`, then restage GitHub artifacts.",
  });
}

async function checkEmbeddedManifest(directory) {
  const manifestPath = path.join(directory, "manifest.json");
  const manifestText = await readRequiredText(manifestPath, "embedded per-platform manifest");
  if (manifestText === undefined) {
    return;
  }
  requireNoSensitiveText(manifestText, relative(manifestPath));
  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch (error) {
    failures.push(`${relative(manifestPath)} must contain valid JSON: ${error instanceof Error ? error.message : String(error)}.`);
    return;
  }
  validateArtifactManifest(manifest, manifestPath);
}


async function checkJetBrainsDirectInstall() {
  await requireDirectory(jetbrainsInstallDirectDir, "JetBrains direct-install staging folder");
  const forbiddenFiles = [];
  await collectFilesMatching(jetbrainsInstallDirectDir, forbiddenFiles, (entry) => isForbiddenDirectInstallFile(entry.name));
  if (forbiddenFiles.length > 0) {
    failures.push(`${relative(jetbrainsInstallDirectDir)} must contain installable JetBrains distribution contents only; found metadata/readme/checksum file(s): ${forbiddenFiles.map(relative).join(", ")}.`);
  }
  const mixedFiles = [];
  await collectFilesMatching(jetbrainsInstallDirectDir, mixedFiles, (entry) => entry.name.endsWith(".vsix"));
  if (mixedFiles.length > 0) {
    failures.push(`${relative(jetbrainsInstallDirectDir)} must not contain VS Code artifacts; found ${mixedFiles.length} VSIX file(s).`);
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
  await requireDirectory(vscodeStageDir, "embedded manifest staging folder");
  const manifestPath = path.join(vscodeStageDir, "manifest.json");
  const manifestText = await readRequiredText(manifestPath, "GitHub artifact manifest");
  if (manifestText === undefined) {
    return;
  }
  requireNoSensitiveText(manifestText, relative(manifestPath));
  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch (error) {
    failures.push(`${relative(manifestPath)} must contain valid JSON: ${error instanceof Error ? error.message : String(error)}.`);
    return;
  }
  validateArtifactManifest(manifest, manifestPath);
}

async function checkLocalCombineDownloadSimulation() {
  const sourceManifestPath = path.join(vscodeStageDir, "manifest.json");
  if (!await isFile(sourceManifestPath)) {
    failures.push(`${relative(sourceManifestPath)} must exist so the combine job can aggregate per-platform manifests from downloaded VS Code artifacts.`);
    return;
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "yet-ai-github-ide-combine-"));
  try {
    const downloadedArtifactDir = path.join(tempDir, "yet-ai-vscode-unzip-first-local");
    const outputPath = path.join(tempDir, "combined-plugin-manifest", "manifest.json");
    await mkdir(downloadedArtifactDir, { recursive: true });
    await copyFile(sourceManifestPath, path.join(downloadedArtifactDir, "manifest.json"));

    const result = spawnSync(process.execPath, ["scripts/combine-plugin-artifact-manifests.mjs", "--input", tempDir, "--output", outputPath], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: false });
    if (result.status !== 0) {
      failures.push(`Local combine/download simulation must combine a downloaded VS Code artifact manifest successfully. stderr: ${result.stderr.trim() || "<empty>"}`);
      return;
    }

    let combined;
    try {
      combined = JSON.parse(await readFile(outputPath, "utf8"));
    } catch (error) {
      failures.push(`Local combine/download simulation must write valid combined manifest JSON: ${error instanceof Error ? error.message : String(error)}.`);
      return;
    }

    const platforms = Array.isArray(combined?.platforms) ? combined.platforms : [];
    if (platforms.length !== 1) {
      failures.push(`Local combine/download simulation combined manifest must contain exactly one local platform entry; found ${platforms.length}.`);
      return;
    }
    const artifacts = Array.isArray(platforms[0]?.artifacts) ? platforms[0].artifacts : [];
    const kinds = artifacts.map((artifact) => artifact?.kind).sort();
    if (artifacts.length !== 2 || kinds[0] !== "jetbrains" || kinds[1] !== "vscode") {
      failures.push(`Local combine/download simulation platform entry must contain exactly vscode and jetbrains artifacts; found ${kinds.join(", ") || "<none>"}.`);
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function validateArtifactManifest(manifest, manifestPath) {
  const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  if (!/^[a-f0-9]{40}$/i.test(manifest.commit ?? "")) {
    failures.push(`${relative(manifestPath)} must include the exact 40-character commit SHA that produced these dev-preview artifacts.`);
  }
  const status = manifest.devPreviewStatus;
  for (const [field, expected] of Object.entries(requiredDevPreviewStatus)) {
    if (status?.[field] !== expected) {
      failures.push(`${relative(manifestPath)} devPreviewStatus.${field} must be ${JSON.stringify(expected)} so manual dogfood cannot start from production/release-claimed artifacts.`);
    }
  }
  if (typeof status?.manualDogfoodGate !== "string" || !/artifact|smoke|gate/i.test(status.manualDogfoodGate)) {
    failures.push(`${relative(manifestPath)} devPreviewStatus.manualDogfoodGate must describe the artifact/smoke gate required before manual dogfood.`);
  }

  const kinds = new Set(artifacts.map((artifact) => artifact?.kind).filter((kind) => typeof kind === "string"));
  if (artifacts.length !== 2) {
    failures.push(`${relative(manifestPath)} must contain exactly two artifact entries: one vscode and one jetbrains.`);
  }
  for (const kind of kinds) {
    if (!allowedManifestKinds.has(kind)) {
      failures.push(`${relative(manifestPath)} contains unsupported artifact kind ${JSON.stringify(kind)}; expected only vscode and jetbrains.`);
    }
  }
  if (!kinds.has("vscode")) {
    failures.push(`${relative(manifestPath)} must contain a vscode artifact entry.`);
  }
  if (!kinds.has("jetbrains")) {
    failures.push(`${relative(manifestPath)} must contain a jetbrains artifact entry.`);
  }

  const platform = manifest.platform;
  if (platform === undefined || typeof platform !== "object") {
    failures.push(`${relative(manifestPath)} must include a top-level "platform" object identifying the runner OS/architecture.`);
  } else {
    if (typeof platform.os !== "string" || !allowedManifestOs.has(platform.os)) {
      failures.push(`${relative(manifestPath)} platform.os must be a normalized runner OS string (linux|macos|windows); got ${JSON.stringify(platform?.os)}.`);
    }
    if (typeof platform.arch !== "string" || !allowedManifestArch.has(platform.arch)) {
      failures.push(`${relative(manifestPath)} platform.arch must be a normalized runner architecture string (x64|arm64|x86|arm); got ${JSON.stringify(platform?.arch)}.`);
    }
  }

  const runtime = manifest.runtime;
  if (runtime === undefined || typeof runtime !== "object") {
    failures.push(`${relative(manifestPath)} must include a top-level "runtime" object describing the bundled engine.`);
  } else {
    if (typeof runtime.bundledEngineResource !== "string" || runtime.bundledEngineResource.length === 0) {
      failures.push(`${relative(manifestPath)} runtime.bundledEngineResource must be a non-empty string path under yet-ai-engine/.`);
    } else if (!isBoundedResourcePath(runtime.bundledEngineResource, "yet-ai-engine/")) {
      failures.push(`${relative(manifestPath)} runtime.bundledEngineResource must live under yet-ai-engine/; got ${JSON.stringify(runtime.bundledEngineResource)}.`);
    }
    if (typeof runtime.engineBinaryName !== "string" || runtime.engineBinaryName.length === 0) {
      failures.push(`${relative(manifestPath)} runtime.engineBinaryName must be a non-empty string.`);
    }
  }

  for (const artifact of artifacts) {
    if (typeof artifact?.path !== "string") {
      failures.push(`${relative(manifestPath)} every artifact entry must include a relative artifact path.`);
      continue;
    }
    if (!allowedManifestKinds.has(artifact.kind)) {
      continue;
    }
    if (!isBoundedResourcePath(artifact.path, `dist/plugins/${artifact.kind}/`)) {
      failures.push(`${relative(manifestPath)} ${artifact.kind} artifact path must stay under dist/plugins/${artifact.kind}/ and use POSIX relative paths.`);
    }
    if (typeof artifact.sha256Path !== "string" || artifact.sha256Path !== `${artifact.path}.sha256`) {
      failures.push(`${relative(manifestPath)} artifact ${artifact.path} must include sha256Path matching path + .sha256.`);
    }
    if (typeof artifact.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(artifact.sha256)) {
      failures.push(`${relative(manifestPath)} artifact ${artifact.path} must include a SHA-256 digest.`);
    }
    if (typeof artifact.os !== "string" || !allowedManifestOs.has(artifact.os) || artifact.os !== platform?.os) {
      failures.push(`${relative(manifestPath)} artifact ${artifact.path} must include "os" matching the runner OS.`);
    }
    if (typeof artifact.arch !== "string" || !allowedManifestArch.has(artifact.arch) || artifact.arch !== platform?.arch) {
      failures.push(`${relative(manifestPath)} artifact ${artifact.path} must include "arch" matching the runner architecture.`);
    }
    if (artifact.kind === "vscode" && Object.hasOwn(artifact, "bundledEngineResource")) {
      failures.push(`${relative(manifestPath)} vscode artifact ${artifact.path} must not include JetBrains bundledEngineResource metadata.`);
    }
    if (artifact.kind === "jetbrains" && (typeof artifact.bundledEngineResource !== "string" || !isBoundedResourcePath(artifact.bundledEngineResource, "yet-ai-engine/") || artifact.bundledEngineResource !== runtime?.bundledEngineResource)) {
      failures.push(`${relative(manifestPath)} jetbrains artifact ${artifact.path} must include "bundledEngineResource" under yet-ai-engine/ describing the bundled native runtime.`);
    }
  }
}

async function checkArtifactsRootRegressionGuards() {
  await requireDirectory(artifactsRoot, "GitHub artifact staging root");
  const rootEntries = await readdir(artifactsRoot).catch(() => []);
  for (const entry of rootEntries) {
    if (!expectedArtifactStageDirs.has(entry)) {
      failures.push(`${relative(artifactsRoot)} must contain only expected artifact family folders (${[...expectedArtifactStageDirs].join(", ")}); found unexpected entry ${JSON.stringify(entry)}.`);
    }
  }
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
  validateArchiveEntries(entries, label);

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
    validateArchiveEntries(jarEntries, `${label} plugin JAR`);
    requireArchiveEntry(jarEntries, "META-INF/plugin.xml", `${label} plugin JAR must contain META-INF/plugin.xml so JetBrains can load the plugin descriptor.`);
    await checkArchiveGuiFreshness({
      archivePath: pluginJar,
      entries: jarEntries,
      packagedPrefix: "yet-ai-gui/",
      label: `${label} plugin JAR packaged GUI`,
      guidance: "Run `npm run prepare:jetbrains-preview -- --skip-engine-prepare`, then restage GitHub artifacts.",
    });
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

async function checkArchiveGuiFreshness({ archivePath, entries, packagedPrefix, label, guidance }) {
  try {
    await assertPackagedGuiFreshnessInArchive({
      sourceRoot: guiDistRoot,
      entries,
      packagedPrefix,
      label,
      guidance,
      readEntryBytes: async (entry) => extractArchiveEntryBytes(archivePath, entry, `${label} must allow extracting ${entry}.`),
    });
  } catch (error) {
    if (error instanceof GuiAssetFreshnessError) {
      failures.push(error.message);
      return;
    }
    throw error;
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
    failures.push(`Missing ${label}: ${relative(directory)}. Run \`npm run prepare:vscode-preview && npm run prepare:jetbrains-preview && npm run artifact:manifest -- --require vscode,jetbrains && npm run artifact:stage-github\` from the repository root to rebuild staged GitHub artifacts.`);
  }
}

async function requireOnlyArtifactFamilyFiles(directory, allowedNames, label) {
  const allowed = new Set(allowedNames);
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const unexpected = entries.filter((entry) => entry.isFile() && !allowed.has(entry.name)).map((entry) => entry.name);
  if (unexpected.length > 0) {
    failures.push(`${relative(directory)} for ${label} contains unexpected top-level file(s): ${unexpected.sort().join(", ")}.`);
  }
}

async function isDirectory(directory) {
  try {
    return (await stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(filePath) {
  return (await stat(filePath).catch(() => undefined))?.isFile() === true;
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

function requireNoSensitiveText(text, label) {
  const patterns = [
    /\/Users\/[A-Za-z0-9._-]+\//,
    /\b(?:[A-Za-z]:\\|\\\\)[^\s"']+/,
    /\bBearer\s+[A-Za-z0-9._~+/=-]+/i,
    /\b(?:access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|secret|cookie|authorization|auth[_-]?code)\b\s*[:=]/i,
    /[?&#](?:access_token|refresh_token|id_token|api_key|key|token|code|secret|cookie)=/i,
  ];
  if (patterns.some((pattern) => pattern.test(text))) {
    failures.push(`${label} must not contain private absolute paths, credentials, bearer headers, cookies, auth codes, API keys, or URL query/fragment secrets.`);
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
  return lower === "readme-install.txt" || lower === "manifest.json" || lower.endsWith(".sha256") || lower === ".ds_store" || lower === "__macosx";
}

function validateArchiveEntries(entries, label) {
  const seen = new Set();
  for (const entry of entries) {
    if (!isSafeArchiveEntryPath(entry)) {
      failures.push(`${label} contains unsafe ZIP/JAR entry path; entries must be non-empty POSIX relative paths without traversal, backslashes, absolute prefixes, or macOS metadata.`);
      continue;
    }
    const key = entry.replace(/\/+$|^\.\//g, "").toLowerCase();
    if (seen.has(key)) {
      failures.push(`${label} contains duplicate archive entry path after normalization.`);
    }
    seen.add(key);
  }
}

async function listArchiveEntries(archivePath) {
  const commands = [
    ["zipinfo", ["-1", archivePath]],
    ["unzip", ["-Z1", archivePath]],
    ["jar", ["tf", archivePath]],
  ];
  for (const [command, args] of commands) {
    const result = spawnSync(command, args, { cwd: root, encoding: "utf8", maxBuffer: archiveInspectMaxBuffer, stdio: ["ignore", "pipe", "pipe"], shell: false });
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
  const result = spawnSync("unzip", ["-p", archivePath, entry], { cwd: root, encoding: "buffer", maxBuffer: archiveInspectMaxBuffer, stdio: ["ignore", "pipe", "pipe"], shell: false });
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
  if (!entries.includes(expected)) {
    failures.push(message);
  }
}

function requireReferencedGuiAssets(jarEntries, indexHtml, label) {
  const references = new Set(collectLocalAssetReferences(indexHtml));
  const assetReferences = [...references].filter((reference) => /\.(?:js|css)$/i.test(reference));
  if (assetReferences.length === 0) {
    failures.push(`${label} packaged GUI index.html must reference at least one JavaScript or CSS asset.`);
  }
  for (const reference of references) {
    if (!isSafeLocalAssetReference(reference)) {
      failures.push(`${label} packaged GUI index.html references unsafe local asset ${JSON.stringify(reference)}.`);
      continue;
    }
    const expected = `yet-ai-gui/${reference}`;
    if (!jarEntries.includes(expected)) {
      failures.push(`${label} plugin JAR must contain packaged GUI asset ${expected} referenced by yet-ai-gui/index.html.`);
    }
  }
}

function isBoundedResourcePath(value, prefix) {
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
