import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const allowedKinds = new Set(["vscode", "jetbrains"]);
const allowedOs = new Set(["linux", "macos", "windows"]);
const allowedArch = new Set(["x64", "arm64", "x86", "arm"]);
const requiredDevPreviewStatus = Object.freeze({
  kind: "dev-preview",
  productionRelease: false,
  publishable: false,
  signing: "none",
  marketplaceUpload: false,
});

if (args.input === undefined || args.output === undefined) {
  console.error("Usage: combine-plugin-artifact-manifests.mjs --input <per-platform-dir> --output <combined-manifest.json>");
  process.exit(2);
}

try {
  const inputDir = path.resolve(args.input);
  const outputPath = path.resolve(args.output);
  const files = await findManifestFiles(inputDir);
  if (files.length === 0) {
    throw new Error(`No per-platform manifest.json files found under ${path.relative(root, inputDir)}.`);
  }

  const perPlatform = [];
  const productHeader = { id: null, name: null };
  let commit = undefined;
  let createdAtLatest = undefined;
  for (const filePath of files.sort()) {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    if (typeof parsed?.product?.id === "string") {
      productHeader.id ??= parsed.product.id;
    }
    if (typeof parsed?.product?.name === "string") {
      productHeader.name ??= parsed.product.name;
    }
    if (typeof parsed?.commit === "string") {
      commit = parsed.commit;
    }
    if (typeof parsed?.createdAt === "string") {
      if (createdAtLatest === undefined || parsed.createdAt > createdAtLatest) {
        createdAtLatest = parsed.createdAt;
      }
    }
    if (!/^[a-f0-9]{40}$/i.test(parsed?.commit ?? "")) {
      throw new Error(`${path.relative(root, filePath)} must include an exact 40-character commit SHA.`);
    }
    const status = parsed?.devPreviewStatus;
    for (const [field, expected] of Object.entries(requiredDevPreviewStatus)) {
      if (status?.[field] !== expected) {
        throw new Error(`${path.relative(root, filePath)} must declare devPreviewStatus.${field} as ${JSON.stringify(expected)} before combining public artifact metadata.`);
      }
    }
    const platform = parsed?.platform;
    if (platform === undefined || typeof platform !== "object") {
      throw new Error(`${path.relative(root, filePath)} is missing a top-level platform object.`);
    }
    if (!allowedOs.has(platform.os) || !allowedArch.has(platform.arch)) {
      throw new Error(`${path.relative(root, filePath)} has unsupported platform metadata; expected bounded linux/macos/windows and x64/arm64/x86/arm values.`);
    }
    const runtime = parsed?.runtime;
    if (runtime === undefined || typeof runtime !== "object" || !isBoundedPath(runtime.bundledEngineResource, "yet-ai-engine/")) {
      throw new Error(`${path.relative(root, filePath)} is missing bounded runtime.bundledEngineResource metadata under yet-ai-engine/.`);
    }
    const artifacts = Array.isArray(parsed?.artifacts) ? parsed.artifacts : [];
    if (artifacts.length !== 2) {
      throw new Error(`${path.relative(root, filePath)} must contain exactly two artifacts: one vscode and one jetbrains.`);
    }
    const kinds = new Set();
    for (const artifact of artifacts) {
      if (!allowedKinds.has(artifact?.kind)) {
        throw new Error(`${path.relative(root, filePath)} contains an unsupported artifact kind.`);
      }
      kinds.add(artifact.kind);
      if (artifact.os !== platform.os || artifact.arch !== platform.arch) {
        throw new Error(`${path.relative(root, filePath)} artifact platform metadata must match the top-level platform.`);
      }
      if (!isBoundedPath(artifact.path, `dist/plugins/${artifact.kind}/`) || artifact.sha256Path !== `${artifact.path}.sha256` || !/^[a-f0-9]{64}$/i.test(artifact.sha256 ?? "")) {
        throw new Error(`${path.relative(root, filePath)} artifact entries must include bounded path, sha256Path, and SHA-256 digest metadata.`);
      }
      if (artifact.kind === "jetbrains" && artifact.bundledEngineResource !== runtime.bundledEngineResource) {
        throw new Error(`${path.relative(root, filePath)} JetBrains artifact must carry bundledEngineResource matching runtime metadata.`);
      }
      if (artifact.kind === "vscode" && Object.hasOwn(artifact, "bundledEngineResource")) {
        throw new Error(`${path.relative(root, filePath)} VS Code artifact must not carry JetBrains bundledEngineResource metadata.`);
      }
    }
    if (!kinds.has("vscode") || !kinds.has("jetbrains")) {
      throw new Error(`${path.relative(root, filePath)} must contain one vscode and one jetbrains artifact entry.`);
    }
    perPlatform.push({
      platform,
      runtime,
      artifacts,
    });
  }

  const combined = {
    product: productHeader,
    commit,
    createdAt: createdAtLatest ?? new Date().toISOString(),
    platforms: perPlatform,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(combined, null, 2)}\n`, "utf8");

  console.log(`Combined plugin artifact manifest written: ${path.relative(root, outputPath)}`);
  for (const entry of perPlatform) {
    console.log(`  ${entry.platform.os}/${entry.platform.arch}: ${entry.artifacts.length} artifact(s)`);
  }
  console.log("This manifest is a local/CI metadata aggregate of per-platform entries; it does not sign, publish, or produce a production release.");
} catch (error) {
  console.error(`Combine plugin artifact manifest failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

function isBoundedPath(value, prefix) {
  if (typeof value !== "string" || !value.startsWith(prefix) || value.includes("\\") || path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || /^[A-Za-z]:/.test(value)) {
    return false;
  }
  return value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

async function findManifestFiles(inputDir) {
  const stack = [inputDir];
  const matches = [];
  while (stack.length > 0) {
    const directory = stack.pop();
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile() && entry.name === "manifest.json") {
        matches.push(entryPath);
      }
    }
  }
  return matches;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--input") {
      parsed.input = argv[index + 1];
      index += 1;
    } else if (arg.startsWith("--input=")) {
      parsed.input = arg.slice("--input=".length);
    } else if (arg === "--output") {
      parsed.output = argv[index + 1];
      index += 1;
    } else if (arg.startsWith("--output=")) {
      parsed.output = arg.slice("--output=".length);
    } else if (arg === "--help" || arg === "-h") {
      console.log("Usage: combine-plugin-artifact-manifests.mjs --input <per-platform-dir> --output <combined-manifest.json>");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}
