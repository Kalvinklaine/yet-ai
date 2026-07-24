import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jetbrainsRoot = path.join(root, "apps", "plugins", "jetbrains");
const distributionsDir = path.join(jetbrainsRoot, "build", "distributions");
const rootDistDir = path.join(root, "dist", "plugins", "jetbrains");
const archiveInspectMaxBuffer = 128 * 1024 * 1024;
const failures = [];
const identity = JSON.parse(await readFile(path.join(root, "product", "identity.json"), "utf8"));
const binaryFileName = process.platform === "win32" ? `${identity.engine.binaryName}.exe` : identity.engine.binaryName;
const bundledEngineResourcePath = `yet-ai-engine/${binaryFileName}`;
const expectedPluginVersion = await readGradleProjectVersion();
const staleToleranceMs = 2000;
const prepareMessage = "Run `npm run prepare:jetbrains-preview` from the repository root to rebuild generated JetBrains preview artifacts.";
const gradleCommandSelfCheck = process.argv.includes("--self-check-gradle-command");

if (gradleCommandSelfCheck) {
  assertGradleArtifactSmokeCommandSelfCheck();
  assertArtifactSmokeMarkerSelfCheck();
  console.log("Gradle artifact smoke command self-check passed.");
  process.exit(0);
}

const zipPaths = await findDistributionZips();
if (zipPaths.length === 0) {
  failures.push("No JetBrains installable ZIP found. Run `npm run prepare:jetbrains-preview` from the repository root first.");
} else {
  for (const zipPath of zipPaths) {
    await checkZip(zipPath);
  }
}

const rootDistZipPath = await findRootDistZip();
let rootArtifactHashes;
if (rootDistZipPath === undefined) {
  failures.push("No root JetBrains dev-preview artifact found under dist/plugins/jetbrains/. Run `npm run prepare:jetbrains-preview` first.");
} else {
  rootArtifactHashes = await checkRootDistArtifact(rootDistZipPath);
}

await checkDocs();

if (failures.length === 0) {
  checkPackagedGuiServerBehavior(rootDistZipPath, rootArtifactHashes);
}

if (failures.length > 0) {
  console.error("JetBrains installable ZIP smoke failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("JetBrains installable ZIP smoke passed.");
for (const zipPath of zipPaths) {
  console.log(`Checked ${path.relative(root, zipPath)}.`);
}
if (rootDistZipPath !== undefined) {
  console.log(`Checked ${path.relative(root, rootDistZipPath)} and checksum.`);
}
console.log("Verified installable ZIP structure and manual install docs without launching an IDE. No provider credentials are required or used; the smoke does not call OpenAI or contact hosted Yet AI services.");

function checkPackagedGuiServerBehavior(rootZipPath, expectedHashes) {
  const command = buildGradleArtifactSmokeCommand(process.platform);
  const result = spawnSync(command.file, command.args, {
    cwd: jetbrainsRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    env: { ...process.env, YET_AI_INSTALLABLE_SMOKE_ZIP: path.normalize(path.resolve(rootZipPath)) },
  });
  if (result.status !== 0) {
    failures.push("Production packaged GUI server behavior smoke failed. Rebuild the current JetBrains preview and rerun the installable smoke.");
    return;
  }
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (!artifactSmokeMarkerMatches(output, expectedHashes)) {
    failures.push("Production packaged GUI server behavior smoke did not report one executed artifact-backed test.");
    return;
  }
  console.log("Verified production JVM packaged GUI hosted entry and panel-relative JavaScript/CSS behavior without launching JCEF.");
}

function buildGradleArtifactSmokeCommand(platform) {
  const gradleArgs = ["smokePackagedGuiServerBehavior", "--console=plain"];
  if (platform === "win32") {
    return { file: "cmd.exe", args: ["/d", "/s", "/c", "gradle.bat", ...gradleArgs] };
  }
  return { file: "gradle", args: gradleArgs };
}

function assertGradleArtifactSmokeCommandSelfCheck() {
  const args = ["smokePackagedGuiServerBehavior", "--console=plain"];
  assertDeepEqual(buildGradleArtifactSmokeCommand("win32"), { file: "cmd.exe", args: ["/d", "/s", "/c", "gradle.bat", ...args] }, "Windows Gradle artifact smoke command shape");
  assertDeepEqual(buildGradleArtifactSmokeCommand("darwin"), { file: "gradle", args }, "POSIX Gradle artifact smoke command shape");
}

function assertArtifactSmokeMarkerSelfCheck() {
  const jarSha256 = "a".repeat(64);
  const zipSha256 = "b".repeat(64);
  const marker = `PACKAGED_GUI_SERVER_ARTIFACT_SMOKE_EXECUTED tests=1 jarSha256=${jarSha256} zipSha256=${zipSha256}`;
  const expected = { jarSha256, zipSha256 };
  assertDeepEqual(artifactSmokeMarkerMatches(marker, expected), true, "matching artifact smoke marker");
  assertDeepEqual(artifactSmokeMarkerMatches(`${marker}\n${marker}`, expected), false, "duplicate artifact smoke marker");
  assertDeepEqual(artifactSmokeMarkerMatches(`${marker} trailing`, expected), false, "malformed artifact smoke marker");
  assertDeepEqual(artifactSmokeMarkerMatches(marker, { jarSha256: "c".repeat(64), zipSha256 }), false, "mismatched artifact JAR hash");
  assertDeepEqual(artifactSmokeMarkerMatches(marker, { jarSha256, zipSha256: "c".repeat(64) }), false, "mismatched artifact ZIP hash");
}

function artifactSmokeMarkerMatches(output, expectedHashes) {
  if (expectedHashes === undefined) {
    return false;
  }
  const markerPattern = /^PACKAGED_GUI_SERVER_ARTIFACT_SMOKE_EXECUTED tests=1 jarSha256=(?<jarSha256>[a-f0-9]{64}) zipSha256=(?<zipSha256>[a-f0-9]{64})$/gm;
  const markers = [...output.matchAll(markerPattern)];
  return markers.length === 1 &&
    markers[0].groups?.jarSha256 === expectedHashes.jarSha256 &&
    markers[0].groups?.zipSha256 === expectedHashes.zipSha256;
}

function assertDeepEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} mismatch: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function readGradleProjectVersion() {
  const buildFile = await readFile(path.join(jetbrainsRoot, "build.gradle.kts"), "utf8");
  const match = buildFile.match(/^version\s*=\s*"([^"]+)"/m);
  if (match === null) {
    failures.push("Could not read JetBrains plugin version from apps/plugins/jetbrains/build.gradle.kts.");
    return "";
  }
  return match[1];
}

async function findRootDistZip() {
  try {
    const entries = await readdir(rootDistDir);
    const zips = [];
    for (const entry of entries) {
      if (!entry.endsWith("-dev-preview.zip")) {
        continue;
      }
      const zipPath = path.join(rootDistDir, entry);
      const zipStat = await stat(zipPath);
      if (zipStat.isFile()) {
        zips.push(zipPath);
      }
    }
    if (zips.length > 1) {
      failures.push("dist/plugins/jetbrains/ must contain exactly one current dev-preview ZIP after prepare.");
    }
    return zips.sort()[0];
  } catch {
    return undefined;
  }
}

async function checkRootDistArtifact(zipPath) {
  const relativeZip = path.relative(root, zipPath);
  const expectedName = `${identity.product.id}-jetbrains-${expectedPluginVersion}-dev-preview.zip`;
  if (path.basename(zipPath) !== expectedName) {
    failures.push(`${relativeZip} must use the stable ${expectedName} naming pattern for the current JetBrains plugin version.`);
  }
  const zipSha256 = await checkChecksum(zipPath);
  await checkFreshness(zipPath, await collectRootArtifactInputs(), `${relativeZip} is older than JetBrains preview build inputs.`);
  await checkZip(zipPath);
  if (zipSha256 === undefined) {
    return undefined;
  }
  const jarSha256 = await readNestedProductionJarSha256(zipPath);
  return jarSha256 === undefined ? undefined : { zipSha256, jarSha256 };
}

async function checkChecksum(zipPath) {
  const checksumPath = `${zipPath}.sha256`;
  let checksumText;
  try {
    checksumText = await readFile(checksumPath, "utf8");
  } catch {
    failures.push(`${path.relative(root, checksumPath)} must exist next to the root dev-preview ZIP.`);
    return undefined;
  }
  const parts = checksumText.trim().split(/\s+/);
  const expected = parts[0];
  const checksumFileName = parts[1];
  if (!expected?.match(/^[a-f0-9]{64}$/i)) {
    failures.push(`${path.relative(root, checksumPath)} must contain a SHA-256 digest.`);
    return undefined;
  }
  if (checksumFileName !== undefined && checksumFileName !== path.basename(zipPath)) {
    failures.push(`${path.relative(root, checksumPath)} must reference ${path.basename(zipPath)}.`);
  }
  const actual = createHash("sha256").update(await readFile(zipPath)).digest("hex");
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    failures.push(`${path.relative(root, checksumPath)} does not match ${path.relative(root, zipPath)}.`);
    return undefined;
  }
  return actual;
}

async function readNestedProductionJarSha256(zipPath) {
  const listing = listZip(zipPath);
  if (listing === undefined) {
    return undefined;
  }
  const pluginJars = listing.split(/\r?\n/).filter((entry) =>
    /^[^/]+\/lib\/yet-ai-jetbrains-[^/]+\.jar$/.test(entry) && !entry.endsWith("-searchableOptions.jar")
  );
  if (pluginJars.length !== 1) {
    failures.push("The root JetBrains dev-preview ZIP must contain exactly one production plugin JAR.");
    return undefined;
  }
  const jarBytes = await extractZipEntryBytes(zipPath, pluginJars[0]);
  if (jarBytes === undefined) {
    failures.push("The root JetBrains dev-preview ZIP production plugin JAR could not be read.");
    return undefined;
  }
  return createHash("sha256").update(jarBytes).digest("hex");
}

async function collectRootArtifactInputs() {
  const inputs = [
    path.join(jetbrainsRoot, "build.gradle.kts"),
    path.join(jetbrainsRoot, "settings.gradle.kts"),
    path.join(jetbrainsRoot, "src", "main", "resources", "META-INF", "plugin.xml"),
    path.join(root, "apps", "gui", "dist", "index.html"),
  ];
  for (const zipPath of await findDistributionZips()) {
    inputs.push(zipPath);
  }
  await collectFiles(path.join(jetbrainsRoot, "src", "main", "kotlin"), inputs, [".kt", ".java"]);
  await collectFiles(path.join(jetbrainsRoot, "build", "generated", "resources", "yet-ai-gui"), inputs, [".html", ".js", ".css"]);
  await collectFiles(path.join(jetbrainsRoot, "build", "generated", "resources", "yet-ai-engine"), inputs, [binaryFileName]);
  if (!inputs.some((filePath) => filePath.endsWith(path.join("yet-ai-engine", binaryFileName)))) {
    const fallbackPath = path.join(root, "target", "debug", binaryFileName);
    try {
      const fallbackStat = await stat(fallbackPath);
      if (fallbackStat.isFile()) {
        inputs.push(fallbackPath);
      }
    } catch {}
  }
  return inputs;
}

async function collectFiles(directoryPath, results, extensions) {
  let entries;
  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(entryPath, results, extensions);
    } else if (entry.isFile() && extensions.some((extension) => entry.name.endsWith(extension))) {
      results.push(entryPath);
    }
  }
}

async function findDistributionZips() {
  try {
    const entries = await readdir(distributionsDir);
    const zips = [];
    for (const entry of entries) {
      if (!entry.endsWith(".zip")) {
        continue;
      }
      const zipPath = path.join(distributionsDir, entry);
      const zipStat = await stat(zipPath);
      if (zipStat.isFile()) {
        zips.push(zipPath);
      }
    }
    return zips.sort();
  } catch {
    return [];
  }
}

async function checkZip(zipPath) {
  const listing = listZip(zipPath);
  if (listing === undefined) {
    return;
  }
  const entries = listing.split(/\r?\n/).filter(Boolean);
  const pluginJarEntry = entries.find((entry) => entry.endsWith(".jar") && entry.includes("/lib/yet-ai-jetbrains-") && !entry.includes("searchableOptions"));
  if (pluginJarEntry === undefined) {
    failures.push(`${path.relative(root, zipPath)} must contain a plugin JAR under lib/.`);
    return;
  }
  for (const entry of entries) {
    if (!isSafeZipEntryPath(entry)) {
      failures.push(`${path.relative(root, zipPath)} contains unsafe ZIP/JAR entry path; entries must be non-empty POSIX relative paths without traversal, backslashes, absolute prefixes, or macOS metadata.`);
    }
  }
  const pluginJar = await extractZipEntry(zipPath, pluginJarEntry);
  if (pluginJar === undefined) {
    return;
  }
  try {
    const jarListing = listZip(pluginJar);
    if (jarListing === undefined) {
      return;
    }
    const jarEntries = jarListing.split(/\r?\n/).filter(Boolean);
    for (const entry of jarEntries) {
      if (!isSafeZipEntryPath(entry)) {
        failures.push(`${path.relative(root, zipPath)} plugin JAR contains unsafe ZIP/JAR entry path; entries must be non-empty POSIX relative paths without traversal, backslashes, absolute prefixes, or macOS metadata.`);
      }
    }
    requireZipEntry(jarListing, "META-INF/plugin.xml", `${path.relative(root, zipPath)} plugin JAR must contain META-INF/plugin.xml.`);
    const pluginXml = await extractZipEntryText(pluginJar, "META-INF/plugin.xml", `${path.relative(root, zipPath)} plugin JAR must allow reading META-INF/plugin.xml.`);
    if (pluginXml !== undefined) {
      validatePluginMetadata(pluginXml, zipPath);
    }
    requireZipEntry(jarListing, "yet-ai-gui/index.html", `${path.relative(root, zipPath)} plugin JAR must contain packaged GUI resources with yet-ai-gui/index.html. Run npm run prepare:jetbrains-preview after building GUI assets.`);
    const indexHtml = await extractZipEntryText(pluginJar, "yet-ai-gui/index.html", `${path.relative(root, zipPath)} plugin JAR must allow reading yet-ai-gui/index.html.`);
    if (indexHtml !== undefined) {
      requireReferencedGuiAssets(jarEntries, indexHtml, zipPath);
    }
    requireZipEntry(jarListing, bundledEngineResourcePath, `${path.relative(root, zipPath)} plugin JAR must contain bundled engine resource at ${bundledEngineResourcePath} (the local cargo-built yet-lsp staged by npm run prepare:jetbrains-preview).`);
    const engineBytes = await extractZipEntryBytes(pluginJar, bundledEngineResourcePath);
    if (engineBytes === undefined) {
      failures.push(`${path.relative(root, zipPath)} plugin JAR must allow extracting bundled engine resource at ${bundledEngineResourcePath}.`);
    } else if (engineBytes.length === 0) {
      failures.push(`${path.relative(root, zipPath)} plugin JAR bundled engine resource at ${bundledEngineResourcePath} must contain non-zero bytes; got 0.`);
    }
  } finally {
    await rm(path.dirname(pluginJar), { recursive: true, force: true });
  }
}

async function extractZipEntry(zipPath, entry) {
  const content = await extractZipEntryBytes(zipPath, entry);
  if (content === undefined) {
    failures.push(`Could not extract ${entry} from ${path.relative(root, zipPath)} with unzip -p or JDK jar. Install unzip or ensure jar is available with a JDK to inspect nested plugin JARs.`);
    return undefined;
  }
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "yet-ai-jetbrains-"));
  const jarPath = path.join(tempDir, path.basename(entry));
  await writeFile(jarPath, content);
  return jarPath;
}

async function extractZipEntryText(zipPath, entry, message) {
  const content = await extractZipEntryBytes(zipPath, entry);
  if (content === undefined) {
    failures.push(`${message} Could not extract ${entry} from ${path.relative(root, zipPath)} with unzip -p or JDK jar.`);
    return undefined;
  }
  return content.toString("utf8");
}

async function extractZipEntryBytes(zipPath, entry) {
  if (!isSafeZipEntryPath(entry)) {
    failures.push(`${path.relative(root, zipPath)} contains unsafe ZIP/JAR entry path ${JSON.stringify(entry)}.`);
    return undefined;
  }
  const result = spawnSync("unzip", ["-p", zipPath, entry], {
    cwd: root,
    encoding: "buffer",
    maxBuffer: archiveInspectMaxBuffer,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  if (result.status === 0) {
    return result.stdout;
  }
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "yet-ai-jetbrains-extract-"));
  try {
    const jarResult = spawnSync("jar", ["xf", zipPath, entry], {
      cwd: tempDir,
      encoding: "buffer",
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    if (jarResult.status !== 0) {
      return undefined;
    }
    const extractedPath = await resolveExtractedEntryPath(tempDir, entry);
    if (extractedPath === undefined) {
      failures.push(`${path.relative(root, zipPath)} extracted unsafe ZIP/JAR entry path ${JSON.stringify(entry)} outside the temporary directory.`);
      return undefined;
    }
    return await readFile(extractedPath);
  } catch {
    return undefined;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function isSafeZipEntryPath(entry) {
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

async function resolveExtractedEntryPath(tempDir, entry) {
  if (!isSafeZipEntryPath(entry)) {
    return undefined;
  }
  const resolvedTempDir = await realpath(tempDir);
  const resolvedPath = path.resolve(resolvedTempDir, ...entry.split(/[\\/]/));
  const relative = path.relative(resolvedTempDir, resolvedPath);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    return undefined;
  }
  const realExtractedPath = await realpath(resolvedPath);
  const realRelative = path.relative(resolvedTempDir, realExtractedPath);
  if (realRelative === "" || realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
    return undefined;
  }
  return realExtractedPath;
}

function validatePluginMetadata(pluginXml, zipPath) {
  const relativeZip = path.relative(root, zipPath);
  const pluginId = readPluginXmlTag(pluginXml, "id");
  const pluginName = readPluginXmlTag(pluginXml, "name");
  const pluginVersion = readPluginXmlTag(pluginXml, "version");
  if (pluginId !== identity.jetbrains.pluginId) {
    failures.push(`${relativeZip} packaged META-INF/plugin.xml plugin id must be ${identity.jetbrains.pluginId}.`);
  }
  if (pluginName !== identity.jetbrains.pluginName) {
    failures.push(`${relativeZip} packaged META-INF/plugin.xml plugin name must be ${identity.jetbrains.pluginName}.`);
  }
  if (pluginVersion !== expectedPluginVersion) {
    failures.push(`${relativeZip} packaged META-INF/plugin.xml version must be ${expectedPluginVersion}.`);
  }
}

function readPluginXmlTag(pluginXml, tagName) {
  const match = pluginXml.match(new RegExp(`<${tagName}>([^<]+)</${tagName}>`));
  return match?.[1]?.trim();
}

function requireReferencedGuiAssets(jarEntries, indexHtml, zipPath) {
  const references = collectLocalAssetReferences(indexHtml);
  const assetReferences = [...references].filter((reference) => /\.(?:js|css)$/i.test(reference));
  if (assetReferences.length === 0) {
    failures.push(`${path.relative(root, zipPath)} packaged GUI index.html must reference at least one JavaScript or CSS asset.`);
  }
  for (const reference of references) {
    if (!isSafeZipEntryPath(reference)) {
      failures.push(`${path.relative(root, zipPath)} packaged GUI index.html references unsafe local asset ${JSON.stringify(reference)}.`);
      continue;
    }
    const expected = `yet-ai-gui/${reference}`;
    if (!jarEntries.some((entry) => entry.endsWith(expected))) {
      failures.push(`${path.relative(root, zipPath)} plugin JAR must contain packaged GUI asset ${expected} referenced by yet-ai-gui/index.html.`);
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

function listZip(zipPath) {
  const commands = [
    ["zipinfo", ["-1", zipPath]],
    ["unzip", ["-Z1", zipPath]],
    ["jar", ["tf", zipPath]],
  ];
  for (const [command, args] of commands) {
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
  failures.push(`Could not inspect ${path.relative(root, zipPath)}. Install zipinfo/unzip or ensure jar is available with a JDK.`);
  return undefined;
}

async function checkFreshness(generatedPath, sourcePaths, staleMessage) {
  let generatedStat;
  try {
    generatedStat = await stat(generatedPath);
  } catch {
    return;
  }
  if (!generatedStat.isFile()) {
    return;
  }

  for (const sourcePath of sourcePaths) {
    let sourceStat;
    try {
      sourceStat = await stat(sourcePath);
    } catch {
      continue;
    }
    if (!sourceStat.isFile()) {
      continue;
    }
    if (generatedStat.mtimeMs + staleToleranceMs < sourceStat.mtimeMs) {
      failures.push(`${staleMessage} ${prepareMessage} Generated artifact: ${path.relative(root, generatedPath)}; newer input: ${path.relative(root, sourcePath)}.`);
    }
  }
}

function requireZipEntry(listing, needle, message) {
  if (!listing.split(/\r?\n/).some((entry) => entry.endsWith(needle))) {
    failures.push(message);
  }
}

async function checkDocs() {
  const rootReadme = await readText(path.join(root, "README.md"));
  const jetbrainsReadme = await readText(path.join(jetbrainsRoot, "README.md"));
  const combined = `${rootReadme}\n${jetbrainsReadme}`;
  requireDoc(combined, "Install Plugin from Disk", "Docs must mention IntelliJ IDEA Install Plugin from Disk steps.");
  requireDoc(combined, "Engine binary path", "Docs must mention Engine binary path expectations for the local runtime.");
  requireDoc(combined, "npm run prepare:jetbrains-preview", "Docs must mention the one-command JetBrains preview preparation command.");
  requireDoc(combined, "npm run smoke:jetbrains-installable", "Docs must mention the installable ZIP smoke command.");
  requireDoc(combined, "npm run smoke:jetbrains-gui-browser", "Docs must mention the packaged GUI browser smoke command.");
  requireDoc(combined, "npm run smoke:jetbrains-wrapper-browser", "Docs must mention the JetBrains wrapper browser smoke command.");
  requireDoc(combined, "dist/plugins/jetbrains/", "Docs must mention the stable root JetBrains dev-preview artifact directory.");
  requireDoc(combined, "yet-ai-jetbrains-<version>-dev-preview.zip", "Docs must mention the stable root JetBrains dev-preview ZIP naming pattern.");
  requireDoc(combined, "yet-ai-engine/yet-lsp", "Docs must mention the stable bundled engine resource path inside the plugin JAR.");
  requireDoc(combined, "No provider credentials", "Docs must state provider credentials are not required for the installable smoke.");
  requireDoc(combined, "no signing", "Docs must keep dev-preview limitations clear and avoid release overclaims.");
}

async function readText(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    failures.push(`Missing documentation file: ${path.relative(root, filePath)}.`);
    return "";
  }
}

function requireDoc(value, expected, message) {
  if (!value.includes(expected)) {
    failures.push(message);
  }
}
