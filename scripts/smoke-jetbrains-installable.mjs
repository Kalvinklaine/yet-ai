import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jetbrainsRoot = path.join(root, "apps", "plugins", "jetbrains");
const distributionsDir = path.join(jetbrainsRoot, "build", "distributions");
const failures = [];

const zipPaths = await findDistributionZips();
if (zipPaths.length === 0) {
  failures.push("No JetBrains installable ZIP found. Run `npm run prepare:jetbrains-preview` from the repository root first.");
} else {
  for (const zipPath of zipPaths) {
    await checkZip(zipPath);
  }
}

await checkDocs();

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
console.log("Verified installable ZIP structure and manual install docs without launching an IDE, using provider credentials, calling OpenAI, or contacting hosted Yet AI services.");

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
  const pluginJar = await extractZipEntry(zipPath, pluginJarEntry);
  if (pluginJar === undefined) {
    return;
  }
  const jarListing = listZip(pluginJar);
  if (jarListing === undefined) {
    await rm(path.dirname(pluginJar), { recursive: true, force: true });
    return;
  }
  requireZipEntry(jarListing, "META-INF/plugin.xml", `${path.relative(root, zipPath)} plugin JAR must contain META-INF/plugin.xml.`);
  requireZipEntry(jarListing, "yet-ai-gui/index.html", `${path.relative(root, zipPath)} plugin JAR must contain packaged GUI resources with yet-ai-gui/index.html. Run npm run prepare:jetbrains-preview after building GUI assets.`);
  const indexHtml = await extractZipEntryText(pluginJar, "yet-ai-gui/index.html", `${path.relative(root, zipPath)} plugin JAR must allow reading yet-ai-gui/index.html.`);
  if (indexHtml !== undefined) {
    requireReferencedGuiScripts(jarListing, indexHtml, zipPath);
  }
  await rm(path.dirname(pluginJar), { recursive: true, force: true });
}

async function extractZipEntry(zipPath, entry) {
  const result = spawnSync("unzip", ["-p", zipPath, entry], {
    cwd: root,
    encoding: "buffer",
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    failures.push(`Could not extract ${entry} from ${path.relative(root, zipPath)}. Install unzip to inspect nested plugin JARs.`);
    return undefined;
  }
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "yet-ai-jetbrains-"));
  const jarPath = path.join(tempDir, path.basename(entry));
  await writeFile(jarPath, result.stdout);
  return jarPath;
}

async function extractZipEntryText(zipPath, entry, message) {
  const result = spawnSync("unzip", ["-p", zipPath, entry], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    failures.push(message);
    return undefined;
  }
  return result.stdout;
}

function requireReferencedGuiScripts(jarListing, indexHtml, zipPath) {
  const scriptPaths = [...indexHtml.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => match[1])
    .filter((src) => src.endsWith(".js") && !URL.canParse(src))
    .map((src) => src.replace(/^\.\//, "").replace(/^\//, ""));
  if (scriptPaths.length === 0) {
    failures.push(`${path.relative(root, zipPath)} packaged GUI index.html must reference at least one JavaScript asset.`);
    return;
  }
  const entries = jarListing.split(/\r?\n/);
  for (const scriptPath of scriptPaths) {
    const expected = `yet-ai-gui/${scriptPath}`;
    if (!entries.some((entry) => entry.endsWith(expected))) {
      failures.push(`${path.relative(root, zipPath)} plugin JAR must contain packaged GUI script asset ${expected} referenced by yet-ai-gui/index.html.`);
    }
  }
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
      shell: process.platform === "win32",
    });
    if (result.status === 0) {
      return result.stdout;
    }
  }
  failures.push(`Could not inspect ${path.relative(root, zipPath)}. Install zipinfo/unzip or ensure jar is available with a JDK.`);
  return undefined;
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
