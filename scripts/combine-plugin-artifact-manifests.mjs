import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));

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
    const platform = parsed?.platform;
    if (platform === undefined) {
      throw new Error(`${path.relative(root, filePath)} is missing a top-level platform object.`);
    }
    const artifacts = Array.isArray(parsed?.artifacts) ? parsed.artifacts : [];
    if (artifacts.length === 0) {
      throw new Error(`${path.relative(root, filePath)} contains no artifacts.`);
    }
    perPlatform.push({
      platform,
      runtime: parsed?.runtime,
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
