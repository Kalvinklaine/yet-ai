import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vscodeRoot = path.join(root, "apps", "plugins", "vscode");
const identity = JSON.parse(await readFile(path.join(root, "product", "identity.json"), "utf8"));
const vscodePackage = JSON.parse(await readFile(path.join(vscodeRoot, "package.json"), "utf8"));
const binaryFileName = process.platform === "win32" ? `${identity.engine.binaryName}.exe` : identity.engine.binaryName;
const failures = [];

await checkFile(
  path.join(vscodeRoot, "bin", binaryFileName),
  `Engine binary is missing. Run \`npm run prepare:vscode-preview\` from the repository root to build and copy ${binaryFileName}.`,
);

const main = typeof vscodePackage.main === "string" ? vscodePackage.main : "";
if (main !== "./out/extension.js") {
  failures.push("apps/plugins/vscode/package.json must keep main set to ./out/extension.js for the compiled dev-preview extension.");
}

await checkFile(
  path.join(vscodeRoot, main.length > 0 ? main : "out/extension.js"),
  "Compiled extension is missing. Run `npm run prepare:vscode-preview` so `cd apps/plugins/vscode && npm run compile` produces out/extension.js.",
);

const guiRoot = path.join(vscodeRoot, "media", "gui");
const guiIndex = path.join(guiRoot, "index.html");
const guiHtml = await readTextFile(
  guiIndex,
  "Packaged GUI index is missing. Run `npm run prepare:vscode-preview` so GUI dist is built and copied into apps/plugins/vscode/media/gui/.",
);

if (guiHtml !== undefined) {
  await checkGuiAssetReferences(guiHtml, guiRoot);
}

if (failures.length > 0) {
  console.error("VS Code dev-preview smoke failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("VS Code dev-preview smoke passed.");
console.log("Checked copied engine binary, packaged GUI, compiled extension entry, manifest main, and GUI asset references.");
console.log("No VS Code UI, provider credentials, or hosted services were used.");

async function checkFile(filePath, message) {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      failures.push(`${message} Found ${relative(filePath)}, but it is not a file.`);
    }
  } catch {
    failures.push(`${message} Expected file: ${relative(filePath)}.`);
  }
}

async function readTextFile(filePath, message) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    failures.push(`${message} Expected file: ${relative(filePath)}.`);
    return undefined;
  }
}

async function checkGuiAssetReferences(html, guiRootPath) {
  const references = collectLocalAssetReferences(html);
  for (const reference of references) {
    const assetPath = path.join(guiRootPath, reference);
    try {
      await access(assetPath);
    } catch {
      failures.push(`Packaged GUI references missing asset ${reference}. Re-run \`npm run prepare:vscode-preview\` to rebuild and copy GUI assets.`);
    }
  }
}

function collectLocalAssetReferences(html) {
  const references = new Set();
  const assetPattern = /\b(?:src|href)=("|')([^"']+)\1/g;
  for (const match of html.matchAll(assetPattern)) {
    const value = match[2];
    const localPath = toLocalAssetPath(value);
    if (localPath) {
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

function relative(filePath) {
  return path.relative(root, filePath);
}
