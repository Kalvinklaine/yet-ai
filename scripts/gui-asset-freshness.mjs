import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export class GuiAssetFreshnessError extends Error {
  constructor(message, failures = []) {
    super(message);
    this.name = "GuiAssetFreshnessError";
    this.failures = failures;
  }
}

export async function assertPackagedGuiFreshness(options) {
  const result = await comparePackagedGuiFreshness(options);
  if (!result.ok) {
    throw new GuiAssetFreshnessError(formatGuiFreshnessFailure(result), result.failures);
  }
  return result;
}

export async function assertPackagedGuiFreshnessInArchive(options) {
  const result = await comparePackagedGuiFreshnessInArchive(options);
  if (!result.ok) {
    throw new GuiAssetFreshnessError(formatGuiFreshnessFailure(result, options.guidance), result.failures);
  }
  return result;
}

export async function comparePackagedGuiFreshness(options) {
  const sourceRoot = path.resolve(options.sourceRoot);
  const packagedRoot = path.resolve(options.packagedRoot);
  const label = options.label ?? "packaged GUI";
  const failures = [];
  const checkedFiles = new Set();

  const sourceIndex = path.join(sourceRoot, "index.html");
  const packagedIndex = path.join(packagedRoot, "index.html");
  const [sourceIndexBytes, packagedIndexBytes] = await Promise.all([
    readRequiredFile(sourceIndex, "Built GUI dist is missing index.html at apps/gui/dist/index.html."),
    readRequiredFile(packagedIndex, `${label} is missing index.html.`),
  ]);

  checkedFiles.add("index.html");
  if (!sourceIndexBytes.equals(packagedIndexBytes)) {
    failures.push(`${label} index.html differs from apps/gui/dist/index.html.`);
  }

  const sourceHtml = sourceIndexBytes.toString("utf8");
  const assetReferences = collectLocalJsCssAssetReferences(sourceHtml);
  if (assetReferences.length === 0) {
    failures.push("apps/gui/dist/index.html does not reference local JS/CSS Vite assets.");
  }

  for (const relativePath of assetReferences) {
    checkedFiles.add(relativePath);
    const [sourceBytes, packagedBytes] = await Promise.all([
      readRequiredFile(path.join(sourceRoot, relativePath), `apps/gui/dist/index.html references missing dist asset ${relativePath}.`),
      readFileIfFile(path.join(packagedRoot, relativePath)),
    ]);
    if (packagedBytes === undefined) {
      failures.push(`${label} is missing asset ${relativePath} referenced by apps/gui/dist/index.html.`);
      continue;
    }
    if (!sourceBytes.equals(packagedBytes)) {
      failures.push(`${label} asset ${relativePath} differs from apps/gui/dist.`);
    }
  }

  for (const relativePath of await listFiles(path.join(sourceRoot, "assets"), "assets")) {
    if (!isJsOrCss(relativePath) || checkedFiles.has(relativePath)) continue;
    checkedFiles.add(relativePath);
    const [sourceBytes, packagedBytes] = await Promise.all([
      readRequiredFile(path.join(sourceRoot, relativePath), `apps/gui/dist asset disappeared while checking freshness: ${relativePath}.`),
      readFileIfFile(path.join(packagedRoot, relativePath)),
    ]);
    if (packagedBytes === undefined) {
      failures.push(`${label} is missing JS/CSS asset ${relativePath} from apps/gui/dist.`);
      continue;
    }
    if (!sourceBytes.equals(packagedBytes)) {
      failures.push(`${label} JS/CSS asset ${relativePath} differs from apps/gui/dist.`);
    }
  }

  const sourceAssetFiles = new Set(await listFiles(path.join(sourceRoot, "assets"), "assets"));
  for (const relativePath of await listFiles(path.join(packagedRoot, "assets"), "assets")) {
    if (isJsOrCss(relativePath) && !sourceAssetFiles.has(relativePath)) {
      failures.push(`${label} contains stale extra JS/CSS asset ${relativePath} not present in apps/gui/dist.`);
    }
  }

  return { ok: failures.length === 0, failures, checkedFiles: checkedFiles.size, sourceRoot, packagedRoot, label };
}

export async function comparePackagedGuiFreshnessInArchive(options) {
  const sourceRoot = path.resolve(options.sourceRoot);
  const packagedPrefix = normalizeArchivePrefix(options.packagedPrefix);
  const label = options.label ?? "packaged GUI archive";
  const entryMap = new Map([...options.entries].map((entry) => [normalizeArchiveEntry(entry), entry]).filter(([normalized]) => normalized));
  const entries = new Set(entryMap.keys());
  const readEntryBytes = options.readEntryBytes;
  const failures = [];
  const checkedFiles = new Set();

  const sourceIndexBytes = await readRequiredFile(path.join(sourceRoot, "index.html"), "Built GUI dist is missing index.html at apps/gui/dist/index.html.");
  const packagedIndexEntry = `${packagedPrefix}index.html`;
  const packagedIndexBytes = await readArchiveFileIfPresent(packagedIndexEntry);
  checkedFiles.add("index.html");
  if (packagedIndexBytes === undefined) {
    failures.push(`${label} is missing ${packagedIndexEntry}.`);
  } else if (!sourceIndexBytes.equals(packagedIndexBytes)) {
    failures.push(`${label} ${packagedIndexEntry} differs from apps/gui/dist/index.html.`);
  }

  const sourceReferences = collectLocalJsCssAssetReferences(sourceIndexBytes.toString("utf8"));
  const packagedReferences = packagedIndexBytes === undefined ? [] : collectLocalJsCssAssetReferences(packagedIndexBytes.toString("utf8"));
  const assetReferences = new Set([...sourceReferences, ...packagedReferences]);
  if (assetReferences.size === 0) {
    failures.push("apps/gui/dist/index.html and packaged GUI index.html do not reference local JS/CSS Vite assets.");
  }

  for (const relativePath of [...assetReferences].sort()) {
    checkedFiles.add(relativePath);
    if (!isSafeRelativeAssetPath(relativePath)) {
      failures.push(`${label} index.html references unsafe local JS/CSS asset ${JSON.stringify(relativePath)}.`);
      continue;
    }
    const sourceBytes = await readFileIfFile(path.join(sourceRoot, relativePath));
    if (sourceBytes === undefined) {
      failures.push(`${label} references JS/CSS asset ${relativePath} that is missing from apps/gui/dist.`);
      continue;
    }
    const entry = `${packagedPrefix}${relativePath}`;
    const packagedBytes = await readArchiveFileIfPresent(entry);
    if (packagedBytes === undefined) {
      failures.push(`${label} is missing ${entry} referenced by apps/gui/dist/index.html or packaged index.html.`);
      continue;
    }
    if (!sourceBytes.equals(packagedBytes)) {
      failures.push(`${label} ${entry} differs from apps/gui/dist/${relativePath}.`);
    }
  }

  const sourceAssetFiles = new Set(await listFiles(path.join(sourceRoot, "assets"), "assets"));

  for (const relativePath of [...sourceAssetFiles].sort()) {
    if (!isJsOrCss(relativePath) || checkedFiles.has(relativePath)) continue;
    checkedFiles.add(relativePath);
    const sourceBytes = await readRequiredFile(path.join(sourceRoot, relativePath), `apps/gui/dist asset disappeared while checking archive freshness: ${relativePath}.`);
    const entry = `${packagedPrefix}${relativePath}`;
    const packagedBytes = await readArchiveFileIfPresent(entry);
    if (packagedBytes === undefined) {
      failures.push(`${label} is missing JS/CSS asset ${entry} from apps/gui/dist.`);
      continue;
    }
    if (!sourceBytes.equals(packagedBytes)) {
      failures.push(`${label} ${entry} differs from apps/gui/dist/${relativePath}.`);
    }
  }

  for (const entry of [...entries].sort()) {
    if (!entry.startsWith(`${packagedPrefix}assets/`) || entry.endsWith("/")) {
      continue;
    }
    const relativePath = entry.slice(packagedPrefix.length);
    if (isJsOrCss(relativePath) && !sourceAssetFiles.has(relativePath)) {
      failures.push(`${label} contains stale extra JS/CSS asset ${entry} not present in apps/gui/dist.`);
    }
  }

  return { ok: failures.length === 0, failures, checkedFiles: checkedFiles.size, sourceRoot, packagedRoot: packagedPrefix, label };

  async function readArchiveFileIfPresent(entry) {
    if (!entries.has(entry)) {
      return undefined;
    }
    return readEntryBytes(entryMap.get(entry));
  }
}

export function formatGuiFreshnessFailure(result, guidance = "Rebuild and recopy the packaged GUI assets before running the wrapper smoke.") {
  const details = result.failures.map((failure) => `- ${failure}`).join("\n");
  return `${result.label} is not byte-for-byte fresh against apps/gui/dist. ${guidance}\n${details}`;
}

export function collectLocalJsCssAssetReferences(html) {
  const references = new Set();
  const assetPattern = /\b(?:src|href)=("|')([^"']+)\1/g;
  for (const match of html.matchAll(assetPattern)) {
    const value = match[2];
    if (value.length === 0 || value.startsWith("#") || value.startsWith("data:") || /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//")) {
      continue;
    }
    const normalized = value.split(/[?#]/, 1)[0].replace(/^\.\//, "").replace(/^\//, "");
    if (normalized.length > 0 && !normalized.includes("..") && isJsOrCss(normalized)) {
      references.add(path.posix.normalize(normalized.replaceAll(path.sep, "/")));
    }
  }
  return [...references].sort();
}

async function readRequiredFile(filePath, message) {
  const bytes = await readFileIfFile(filePath);
  if (bytes === undefined) throw new Error(message);
  return bytes;
}

async function readFileIfFile(filePath) {
  const fileStat = await stat(filePath).catch(() => undefined);
  if (!fileStat?.isFile()) return undefined;
  return readFile(filePath);
}

async function listFiles(rootPath, relativeDir = "") {
  const entries = await readdir(rootPath, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const relativePath = path.posix.join(relativeDir.replaceAll(path.sep, "/"), entry.name);
    const absolutePath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(absolutePath, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files.sort();
}

function isJsOrCss(relativePath) {
  return /\.(?:js|css)$/i.test(relativePath);
}

function normalizeArchivePrefix(prefix) {
  const normalized = String(prefix ?? "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/");
  return normalized.length === 0 || normalized.endsWith("/") ? normalized : `${normalized}/`;
}

function normalizeArchiveEntry(entry) {
  const normalized = String(entry ?? "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/");
  return normalized.length > 0 ? normalized : undefined;
}

function isSafeRelativeAssetPath(relativePath) {
  const normalized = String(relativePath ?? "").replace(/\\/g, "/");
  return normalized.length > 0 && !normalized.startsWith("/") && !/^[A-Za-z]:/.test(normalized) && normalized.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}
