import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(root, "dist", "plugins");
const manifestPath = path.join(distRoot, "manifest.json");
const supportedKinds = ["vscode", "jetbrains"];

const args = parseArgs(process.argv.slice(2));
const identity = JSON.parse(await readFile(path.join(root, "product", "identity.json"), "utf8"));
const vscodePackage = await readJsonIfPresent(path.join(root, "apps", "plugins", "vscode", "package.json"));
const jetbrainsBuild = await readTextIfPresent(path.join(root, "apps", "plugins", "jetbrains", "build.gradle.kts"));

try {
  const artifacts = [];
  artifacts.push(...await scanKind("vscode"));
  artifacts.push(...await scanKind("jetbrains"));
  artifacts.sort((left, right) => left.kind.localeCompare(right.kind) || left.path.localeCompare(right.path));

  const presentKinds = new Set(artifacts.map((artifact) => artifact.kind));
  const missingRequired = args.require.filter((kind) => !presentKinds.has(kind));
  if (missingRequired.length > 0) {
    throw new Error(`Missing required dev-preview artifact kind(s): ${missingRequired.join(", ")}. Run the matching prepare script(s) first.`);
  }
  if (artifacts.length === 0) {
    throw new Error("No dev-preview plugin artifacts found under dist/plugins/vscode or dist/plugins/jetbrains. Run a prepare:*preview script first.");
  }

  const manifest = {
    product: {
      id: identity.product.id,
      name: identity.product.displayName,
    },
    commit: gitCommit(),
    createdAt: new Date().toISOString(),
    artifacts,
  };

  await mkdir(distRoot, { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log(`Plugin artifact manifest written: ${relative(manifestPath)}`);
  for (const artifact of artifacts) {
    console.log(`  ${artifact.kind}: ${artifact.path} (${artifact.sha256})`);
  }
  console.log("Validated dev-preview artifact files and sha256 checksums. This manifest is local/CI metadata only: it does not sign, publish, or produce a production release.");
} catch (error) {
  console.error(`Plugin artifact manifest failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

function parseArgs(argv) {
  const parsed = { require: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--require") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--require expects a comma-separated list, e.g. --require vscode,jetbrains");
      }
      parsed.require = parseKindList(value);
      index += 1;
    } else if (arg.startsWith("--require=")) {
      parsed.require = parseKindList(arg.slice("--require=".length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function parseKindList(value) {
  const kinds = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  const invalid = kinds.filter((kind) => !supportedKinds.includes(kind));
  if (invalid.length > 0) {
    throw new Error(`Unsupported required artifact kind(s): ${invalid.join(", ")}. Supported kinds: ${supportedKinds.join(", ")}.`);
  }
  return [...new Set(kinds)];
}

async function scanKind(kind) {
  const directory = path.join(distRoot, kind);
  const extension = kind === "vscode" ? ".vsix" : ".zip";
  const suffix = `-dev-preview${extension}`;
  const entries = await readdir(directory).catch((error) => {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  });
  const artifactNames = entries.filter((entry) => entry.endsWith(suffix)).sort();
  const artifacts = [];
  for (const name of artifactNames) {
    artifacts.push(await artifactEntry(kind, path.join(directory, name)));
  }
  return artifacts;
}

async function artifactEntry(kind, artifactPath) {
  await requireFile(artifactPath, `${kind} artifact`);
  const checksumPath = `${artifactPath}.sha256`;
  await requireFile(checksumPath, `${kind} checksum`);

  const actualSha256 = createHash("sha256").update(await readFile(artifactPath)).digest("hex");
  const expectedSha256 = await readChecksum(checksumPath, artifactPath);
  if (actualSha256 !== expectedSha256) {
    throw new Error(`${relative(checksumPath)} does not match ${relative(artifactPath)}: expected ${expectedSha256}, actual ${actualSha256}`);
  }

  return removeUndefined({
    kind,
    path: relative(artifactPath),
    version: versionFor(kind, artifactPath),
    target: targetFor(kind),
    sha256Path: relative(checksumPath),
    sha256: actualSha256,
  });
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

function versionFor(kind, artifactPath) {
  if (kind === "vscode") {
    return stringOrUndefined(vscodePackage?.version) ?? versionFromFilename(artifactPath, "vscode", ".vsix");
  }
  return gradleString(jetbrainsBuild, /^version\s*=\s*"([^"]+)"/m) ?? versionFromFilename(artifactPath, "jetbrains", ".zip");
}

function targetFor(kind) {
  if (kind === "vscode") {
    return stringOrUndefined(vscodePackage?.engines?.vscode);
  }
  const sinceBuild = gradleString(jetbrainsBuild, /sinceBuild\s*=\s*"([^"]+)"/m);
  const untilBuild = gradleString(jetbrainsBuild, /untilBuild\s*=\s*"([^"]+)"/m);
  if (sinceBuild === undefined && untilBuild === undefined) {
    return undefined;
  }
  return removeUndefined({ sinceBuild, untilBuild });
}

function versionFromFilename(artifactPath, kind, extension) {
  const name = path.basename(artifactPath);
  const prefix = `${identity.product.id}-${kind}-`;
  const suffix = `-dev-preview${extension}`;
  if (name.startsWith(prefix) && name.endsWith(suffix)) {
    return name.slice(prefix.length, -suffix.length);
  }
  return undefined;
}

async function readJsonIfPresent(filePath) {
  const text = await readTextIfPresent(filePath);
  return text === undefined ? undefined : JSON.parse(text);
}

async function readTextIfPresent(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function gitCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || undefined;
  } catch {
    return undefined;
  }
}

function gradleString(text, pattern) {
  if (typeof text !== "string") {
    return undefined;
  }
  return text.match(pattern)?.[1];
}

function stringOrUndefined(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function removeUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entryValue]) => entryValue !== undefined));
}

function relative(filePath) {
  return path.relative(root, filePath).replaceAll(path.sep, "/");
}
