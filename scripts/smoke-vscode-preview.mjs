import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vscodeRoot = path.join(root, "apps", "plugins", "vscode");
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

const staleToleranceMs = 2000;
const prepareMessage = "Run `npm run prepare:vscode-preview` from the repository root to rebuild generated preview artifacts.";

checkManifestSurfaces(vscodePackage);

await checkFile(
  path.join(vscodeRoot, "bin", binaryFileName),
  `Engine binary is missing. Run \`npm run prepare:vscode-preview\` from the repository root to build and copy ${binaryFileName}.`,
);

const bundledIdentityPath = path.join(vscodeRoot, "out", "product", "identity.json");
const bundledIdentity = await readJsonFile(
  bundledIdentityPath,
  "Bundled VS Code product identity is missing. Run `npm run prepare:vscode-preview` so product/identity.json is copied into apps/plugins/vscode/out/product/.",
);
if (bundledIdentity !== undefined) {
  checkBundledIdentity(bundledIdentity);
}
await checkFreshness(bundledIdentityPath, [path.join(root, "product", "identity.json")], "Bundled VS Code product identity is older than root product/identity.json.");

const main = typeof vscodePackage.main === "string" ? vscodePackage.main : "";
if (main !== "./out/extension.js") {
  failures.push("apps/plugins/vscode/package.json must keep main set to ./out/extension.js for the compiled dev-preview extension.");
}

const extensionPath = path.join(vscodeRoot, main.length > 0 ? main : "out/extension.js");
await checkFile(
  extensionPath,
  "Compiled extension is missing. Run `npm run prepare:vscode-preview` so `cd apps/plugins/vscode && npm run compile` produces out/extension.js.",
);

const extensionJs = await readTextFile(
  extensionPath,
  "Compiled extension is missing. Run `npm run prepare:vscode-preview` so `cd apps/plugins/vscode && npm run compile` produces out/extension.js.",
);

if (extensionJs !== undefined) {
  checkCompiledExtensionSurfaces(extensionJs);
}

await checkFreshness(extensionPath, [
  path.join(vscodeRoot, "src", "extension.ts"),
  path.join(vscodeRoot, "src", "webview.ts"),
  path.join(vscodeRoot, "src", "engineConnection.ts"),
], "Compiled extension out/extension.js is older than VS Code source files.");

const guiRoot = path.join(vscodeRoot, "media", "gui");
const guiIndex = path.join(guiRoot, "index.html");
const guiHtml = await readTextFile(
  guiIndex,
  "Packaged GUI index is missing. Run `npm run prepare:vscode-preview` so GUI dist is built and copied into apps/plugins/vscode/media/gui/.",
);

if (guiHtml !== undefined) {
  await checkGuiAssetReferences(guiHtml, guiRoot);
}

await checkFreshness(guiIndex, [path.join(root, "apps", "gui", "dist", "index.html")], "Packaged GUI media/gui/index.html is older than apps/gui/dist/index.html.");

if (failures.length > 0) {
  console.error("VS Code dev-preview smoke failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("VS Code dev-preview smoke passed.");
console.log("Checked copied engine binary, bundled product identity, packaged GUI assets, compiled extension entry, manifest commands, activation events, configuration surfaces, and obvious stale generated artifacts.");
console.log("No VS Code UI, provider credentials, or hosted services were used.");

function checkManifestSurfaces(manifest) {
  const contributedCommands = new Set(
    Array.isArray(manifest.contributes?.commands)
      ? manifest.contributes.commands.map((command) => command?.command).filter((command) => typeof command === "string")
      : [],
  );
  for (const commandId of requiredCommands) {
    if (!contributedCommands.has(commandId)) {
      failures.push(`apps/plugins/vscode/package.json must contribute command ${commandId} for the dev-preview command palette flow.`);
    }
  }

  const activationEvents = new Set(Array.isArray(manifest.activationEvents) ? manifest.activationEvents.filter((event) => typeof event === "string") : []);
  for (const commandId of requiredCommands) {
    const activationEvent = `onCommand:${commandId}`;
    if (!activationEvents.has(activationEvent)) {
      failures.push(`apps/plugins/vscode/package.json must include activation event ${activationEvent} for the dev-preview command palette flow.`);
    }
  }

  const properties = manifest.contributes?.configuration?.properties ?? {};
  for (const propertyName of requiredConfigurationProperties) {
    if (!Object.hasOwn(properties, propertyName)) {
      failures.push(`apps/plugins/vscode/package.json must contribute configuration property ${propertyName} for the documented dev-preview flow.`);
    }
  }

  const guiDevUrlDescription = properties["yetai.guiDevUrl"]?.description;
  if (typeof guiDevUrlDescription !== "string" || !guiDevUrlDescription.toLowerCase().includes("loopback")) {
    failures.push("apps/plugins/vscode/package.json configuration yetai.guiDevUrl description must mention loopback URL requirements.");
  }
}

function checkCompiledExtensionSurfaces(source) {
  for (const commandId of requiredCommands) {
    const constantName = commandIdentifierName(commandId);
    if (!source.includes(commandId) && !source.includes(constantName)) {
      failures.push(`Compiled extension out/extension.js must include command registration surface for ${commandId}. Run \`npm run prepare:vscode-preview\` to rebuild generated artifacts.`);
    }
  }
  if (!source.includes("registerCommand")) {
    failures.push("Compiled extension out/extension.js must include VS Code command registration calls. Run `npm run prepare:vscode-preview` to rebuild generated artifacts.");
  }
}

function commandIdentifierName(commandId) {
  switch (commandId) {
    case "yetaicmd.openChat":
      return "extensionCommand";
    case "yetaicmd.showRuntimeStatus":
      return "runtimeStatusCommand";
    case "yetaicmd.setLocalRuntimeSessionToken":
      return "setSessionTokenCommand";
    case "yetaicmd.clearLocalRuntimeSessionToken":
      return "clearSessionTokenCommand";
    default:
      return commandId;
  }
}

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

async function readJsonFile(filePath, message) {
  const raw = await readTextFile(filePath, message);
  if (raw === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    failures.push(`${message} Expected valid JSON at ${relative(filePath)}: ${detail}`);
    return undefined;
  }
}

function checkBundledIdentity(bundledIdentity) {
  if (JSON.stringify(bundledIdentity) !== JSON.stringify(identity)) {
    failures.push("Bundled VS Code product identity must match root product/identity.json. Run `npm run prepare:vscode-preview` to refresh generated artifacts.");
  }
}

async function checkGuiAssetReferences(html, guiRootPath) {
  const references = collectLocalAssetReferences(html);
  const assetReferences = [...references].filter((reference) => /\.(?:js|css)$/i.test(reference));
  if (assetReferences.length === 0) {
    failures.push("Packaged GUI index.html must reference at least one local JS or CSS asset. Re-run `npm run prepare:vscode-preview` to rebuild and copy GUI assets.");
  }
  for (const reference of references) {
    const assetPath = path.join(guiRootPath, reference);
    try {
      const assetStat = await stat(assetPath);
      if (!assetStat.isFile()) {
        failures.push(`Packaged GUI references ${reference}, but it is not a file. Re-run \`npm run prepare:vscode-preview\` to rebuild and copy GUI assets.`);
      }
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
      if (await sameFileContent(generatedPath, sourcePath)) {
        continue;
      }
      failures.push(`${staleMessage} ${prepareMessage} Generated: ${relative(generatedPath)}; newer source: ${relative(sourcePath)}.`);
    }
  }
}

async function sameFileContent(leftPath, rightPath) {
  try {
    const [left, right] = await Promise.all([readFile(leftPath), readFile(rightPath)]);
    return left.equals(right);
  } catch {
    return false;
  }
}

function relative(filePath) {
  return path.relative(root, filePath);
}
