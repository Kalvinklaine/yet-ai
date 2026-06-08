import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, realpath, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vscodeRoot = path.join(root, "apps", "plugins", "vscode");
const rootDistDir = path.join(root, "dist", "plugins", "vscode");
const identity = JSON.parse(await readFile(path.join(root, "product", "identity.json"), "utf8"));
const vscodePackage = JSON.parse(await readFile(path.join(vscodeRoot, "package.json"), "utf8"));
const binaryFileName = process.platform === "win32" ? `${identity.engine.binaryName}.exe` : identity.engine.binaryName;
const failures = [];

const requiredCommands = [
  "yetaicmd.openChat",
  "yetaicmd.showRuntimeStatus",
  "yetaicmd.setLocalRuntimeSessionToken",
  "yetaicmd.clearLocalRuntimeSessionToken",
];
const requiredConfigurationProperties = [
  "yetai.runtimeUrl",
  "yetai.sessionToken",
  "yetai.guiDevUrl",
  "yetai.launchMode",
  "yetai.engineBinaryPath",
];

const vsixPath = await findRootVsix();
if (vsixPath === undefined) {
  failures.push("No root VS Code dev-preview VSIX found under dist/plugins/vscode/. Run `npm run prepare:vscode-preview` first.");
} else {
  await checkRootVsix(vsixPath);
}

if (failures.length > 0) {
  console.error("VS Code installable VSIX smoke failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("VS Code installable VSIX smoke passed.");
console.log(`Checked ${path.relative(root, vsixPath)} and checksum.`);
console.log("Verified archive structure, metadata, packaged GUI assets, engine binary, and bundled identity without launching VS Code, using provider credentials, calling providers, or contacting hosted services.");

async function findRootVsix() {
  try {
    const entries = await readdir(rootDistDir);
    const vsixFiles = [];
    for (const entry of entries) {
      if (!entry.endsWith("-dev-preview.vsix")) {
        continue;
      }
      const entryPath = path.join(rootDistDir, entry);
      const entryStat = await stat(entryPath);
      if (entryStat.isFile()) {
        vsixFiles.push(entryPath);
      }
    }
    if (vsixFiles.length > 1) {
      failures.push("dist/plugins/vscode/ must contain exactly one current dev-preview VSIX after prepare.");
    }
    return vsixFiles.sort()[0];
  } catch {
    return undefined;
  }
}

async function checkRootVsix(vsixPath) {
  const relativeVsix = path.relative(root, vsixPath);
  const expectedName = `${identity.product.id}-vscode-${vscodePackage.version}-dev-preview.vsix`;
  if (path.basename(vsixPath) !== expectedName) {
    failures.push(`${relativeVsix} must use the stable ${expectedName} naming pattern from product identity and VS Code package version.`);
  }

  await checkChecksum(vsixPath);

  const listing = listZip(vsixPath);
  if (listing === undefined) {
    return;
  }
  const entries = listing.split(/\r?\n/).filter(Boolean);
  for (const entry of entries) {
    if (!isSafeArchiveEntryPath(entry)) {
      failures.push(`${relativeVsix} contains unsafe archive entry path; entries must be non-empty POSIX relative paths without traversal, backslashes, absolute prefixes, or macOS metadata.`);
    }
  }

  requireArchiveEntry(entries, "extension/package.json", `${relativeVsix} must contain extension/package.json.`);
  requireArchiveEntry(entries, "extension/README.md", `${relativeVsix} must contain extension/README.md.`);
  requireArchiveEntry(entries, "extension/out/extension.js", `${relativeVsix} must contain extension/out/extension.js.`);
  requireArchiveEntry(entries, "extension/out/product/identity.json", `${relativeVsix} must contain extension/out/product/identity.json.`);
  requireArchiveEntry(entries, "extension/media/gui/index.html", `${relativeVsix} must contain extension/media/gui/index.html.`);
  requireArchiveEntry(entries, `extension/bin/${binaryFileName}`, `${relativeVsix} must contain the local engine binary under extension/bin/. Run npm run prepare:vscode-preview first.`);

  const packagedManifest = await extractJson(vsixPath, "extension/package.json", `${relativeVsix} must allow reading extension/package.json.`);
  if (packagedManifest !== undefined) {
    checkManifestSurfaces(packagedManifest, relativeVsix);
  }

  const bundledIdentity = await extractJson(vsixPath, "extension/out/product/identity.json", `${relativeVsix} must allow reading extension/out/product/identity.json.`);
  if (bundledIdentity !== undefined && JSON.stringify(bundledIdentity) !== JSON.stringify(identity)) {
    failures.push(`${relativeVsix} bundled product identity must match root product/identity.json.`);
  }

  const guiHtml = await extractText(vsixPath, "extension/media/gui/index.html", `${relativeVsix} must allow reading extension/media/gui/index.html.`);
  if (guiHtml !== undefined) {
    checkGuiAssetReferences(entries, guiHtml, relativeVsix);
  }
}

async function checkChecksum(vsixPath) {
  const checksumPath = `${vsixPath}.sha256`;
  let checksumText;
  try {
    checksumText = await readFile(checksumPath, "utf8");
  } catch {
    failures.push(`${path.relative(root, checksumPath)} must exist next to the root dev-preview VSIX.`);
    return;
  }
  const parts = checksumText.trim().split(/\s+/);
  const expected = parts[0];
  const checksumFileName = parts[1];
  if (!expected?.match(/^[a-f0-9]{64}$/i)) {
    failures.push(`${path.relative(root, checksumPath)} must contain a SHA-256 digest.`);
    return;
  }
  if (checksumFileName !== undefined && checksumFileName !== path.basename(vsixPath)) {
    failures.push(`${path.relative(root, checksumPath)} must reference ${path.basename(vsixPath)}.`);
  }
  const actual = createHash("sha256").update(await readFile(vsixPath)).digest("hex");
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    failures.push(`${path.relative(root, checksumPath)} does not match ${path.relative(root, vsixPath)}.`);
  }
}

function checkManifestSurfaces(manifest, relativeVsix) {
  if (manifest.name !== vscodePackage.name || manifest.publisher !== vscodePackage.publisher || manifest.version !== vscodePackage.version) {
    failures.push(`${relativeVsix} extension/package.json identity fields must match apps/plugins/vscode/package.json.`);
  }
  if (manifest.main !== "./out/extension.js") {
    failures.push(`${relativeVsix} extension/package.json must keep main set to ./out/extension.js.`);
  }

  const contributedCommands = new Set(
    Array.isArray(manifest.contributes?.commands)
      ? manifest.contributes.commands.map((command) => command?.command).filter((command) => typeof command === "string")
      : [],
  );
  for (const commandId of requiredCommands) {
    if (!contributedCommands.has(commandId)) {
      failures.push(`${relativeVsix} extension/package.json must contribute command ${commandId}.`);
    }
  }

  const activationEvents = new Set(Array.isArray(manifest.activationEvents) ? manifest.activationEvents.filter((event) => typeof event === "string") : []);
  for (const commandId of requiredCommands) {
    const activationEvent = `onCommand:${commandId}`;
    if (!activationEvents.has(activationEvent)) {
      failures.push(`${relativeVsix} extension/package.json must include activation event ${activationEvent}.`);
    }
  }

  const properties = manifest.contributes?.configuration?.properties ?? {};
  for (const propertyName of requiredConfigurationProperties) {
    if (!Object.hasOwn(properties, propertyName)) {
      failures.push(`${relativeVsix} extension/package.json must contribute configuration property ${propertyName}.`);
    }
  }
}

function checkGuiAssetReferences(entries, html, relativeVsix) {
  const references = collectLocalAssetReferences(html);
  const assetReferences = [...references].filter((reference) => /\.(?:js|css)$/i.test(reference));
  if (assetReferences.length === 0) {
    failures.push(`${relativeVsix} packaged GUI index.html must reference at least one local JS or CSS asset.`);
  }
  for (const reference of references) {
    if (!isSafeArchiveEntryPath(reference)) {
      failures.push(`${relativeVsix} packaged GUI index.html references unsafe local asset ${JSON.stringify(reference)}.`);
      continue;
    }
    const expected = `extension/media/gui/${reference}`;
    if (!entries.includes(expected)) {
      failures.push(`${relativeVsix} must contain packaged GUI asset ${expected} referenced by extension/media/gui/index.html.`);
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

async function extractJson(zipPath, entry, message) {
  const text = await extractText(zipPath, entry, message);
  if (text === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    failures.push(`${message} Expected valid JSON in ${entry}: ${detail}`);
    return undefined;
  }
}

async function extractText(zipPath, entry, message) {
  const bytes = await extractBytes(zipPath, entry);
  if (bytes === undefined) {
    failures.push(`${message} Could not extract ${entry} with unzip -p or JDK jar. Install unzip or ensure jar is available with a JDK to inspect VSIX entry contents.`);
    return undefined;
  }
  return bytes.toString("utf8");
}

async function extractBytes(zipPath, entry) {
  if (!isSafeArchiveEntryPath(entry)) {
    failures.push(`${path.relative(root, zipPath)} contains unsafe archive entry path ${JSON.stringify(entry)}.`);
    return undefined;
  }
  const result = spawnSync("unzip", ["-p", zipPath, entry], {
    cwd: root,
    encoding: "buffer",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  if (result.status === 0) {
    return result.stdout;
  }
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "yet-ai-vscode-extract-"));
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
      failures.push(`${path.relative(root, zipPath)} extracted unsafe VSIX entry path ${JSON.stringify(entry)} outside the temporary directory.`);
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

function requireArchiveEntry(entries, expected, message) {
  if (!entries.includes(expected)) {
    failures.push(message);
  }
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
