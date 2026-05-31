import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jetbrainsRoot = path.join(root, "apps", "plugins", "jetbrains");
const identity = JSON.parse(await readFile(path.join(root, "product", "identity.json"), "utf8"));
const binaryFileName = process.platform === "win32" ? `${identity.engine.binaryName}.exe` : identity.engine.binaryName;
const failures = [];
const warnings = [];
const staleToleranceMs = 2000;
const prepareMessage = "Run `npm run prepare:jetbrains-preview` from the repository root to rebuild generated JetBrains preview artifacts.";

await checkFile(path.join(jetbrainsRoot, "build.gradle.kts"), "JetBrains Gradle build file is missing.");
await checkFile(path.join(jetbrainsRoot, "settings.gradle.kts"), "JetBrains Gradle settings file is missing.");
await checkFile(path.join(jetbrainsRoot, "src", "main", "resources", "META-INF", "plugin.xml"), "JetBrains plugin.xml is missing.");
await checkDirectory(path.join(jetbrainsRoot, "src", "main", "kotlin", ...identity.jetbrains.packageNamespace.split(".")), "JetBrains Kotlin source root is missing.");
await checkFile(path.join(jetbrainsRoot, "src", "main", "kotlin", ...identity.jetbrains.packageNamespace.split("."), "runtime", "RuntimeConnectionManager.kt"), "JetBrains runtime connector source is missing.");
await checkFile(path.join(jetbrainsRoot, "src", "main", "kotlin", ...identity.jetbrains.packageNamespace.split("."), "ui", "YetToolWindowFactory.kt"), "JetBrains tool window source is missing.");
await checkFile(path.join(jetbrainsRoot, "scripts", "check-identity.mjs"), "JetBrains identity check script is missing.");

await checkEngineBinary();
await checkPluginConfig();
await checkGuiDist();
await checkGeneratedGuiResources();

if (failures.length > 0) {
  console.error("JetBrains dev-preview smoke failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  if (warnings.length > 0) {
    console.error("");
    console.error("Warnings:");
    for (const warning of warnings) {
      console.error(`- ${warning}`);
    }
  }
  process.exit(1);
}

console.log("JetBrains dev-preview smoke passed.");
console.log("Checked plugin project files, identity-aligned config, local engine binary, and GUI packaging readiness.");
if (warnings.length > 0) {
  console.log("");
  console.log("Actionable preview notes:");
  for (const warning of warnings) {
    console.log(`- ${warning}`);
  }
}
console.log("No JetBrains IDE, provider credentials, or hosted services were used.");

async function checkEngineBinary() {
  await checkFile(
    path.join(root, "target", "debug", binaryFileName),
    `Engine binary is missing. Run \`npm run prepare:ide-engine\` from the repository root to build ${binaryFileName}.`,
  );
}

async function checkPluginConfig() {
  const pluginXml = await readTextFile(path.join(jetbrainsRoot, "src", "main", "resources", "META-INF", "plugin.xml"), "JetBrains plugin.xml is missing.");
  const buildGradle = await readTextFile(path.join(jetbrainsRoot, "build.gradle.kts"), "JetBrains Gradle build file is missing.");
  if (pluginXml !== undefined) {
    requireIncludes(pluginXml, `<id>${identity.jetbrains.pluginId}</id>`, "plugin.xml id must match product/identity.json.");
    requireIncludes(pluginXml, `<name>${identity.jetbrains.pluginName}</name>`, "plugin.xml name must match product/identity.json.");
    requireIncludes(pluginXml, `factoryClass="${identity.jetbrains.packageNamespace}.ui.YetToolWindowFactory"`, "plugin.xml must register the Yet AI tool window factory.");
  }
  if (buildGradle !== undefined) {
    requireIncludes(buildGradle, `group = "${identity.jetbrains.pluginGroup}"`, "build.gradle.kts group must match product/identity.json.");
    requireIncludes(buildGradle, `id = "${identity.jetbrains.pluginId}"`, "build.gradle.kts plugin id must match product/identity.json.");
    requireIncludes(buildGradle, "generated/resources/yet-ai-gui", "build.gradle.kts must keep the generated packaged GUI resource path.");
    requireIncludes(buildGradle, "../../gui/dist", "build.gradle.kts must copy packaged GUI resources from apps/gui/dist.");
  }
}

async function checkGuiDist() {
  const guiRoot = path.join(root, "apps", "gui", "dist");
  const guiIndex = path.join(guiRoot, "index.html");
  const guiHtml = await readOptionalTextFile(guiIndex);
  if (guiHtml === undefined) {
    warnings.push("Packaged GUI source is not built. Run `cd apps/gui && npm run build` before `cd apps/plugins/jetbrains && gradle build --console=plain` to include the GUI in a dev-preview plugin build.");
    return;
  }
  await checkGuiAssetReferences(guiHtml, guiRoot, "apps/gui/dist");
}

async function checkGeneratedGuiResources() {
  const generatedRoot = path.join(jetbrainsRoot, "build", "generated", "resources", "yet-ai-gui", "yet-ai-gui");
  const generatedIndex = path.join(generatedRoot, "index.html");
  const generatedHtml = await readOptionalTextFile(generatedIndex);
  if (generatedHtml === undefined) {
    warnings.push("Generated JetBrains packaged GUI resources are absent. Run `npm run prepare:jetbrains-preview` when you need to verify copied GUI resources.");
    return;
  }
  await checkGuiAssetReferences(generatedHtml, generatedRoot, "apps/plugins/jetbrains/build/generated/resources/yet-ai-gui/yet-ai-gui");
  await checkFreshness(generatedIndex, [path.join(root, "apps", "gui", "dist", "index.html")], "Generated JetBrains packaged GUI index.html is older than apps/gui/dist/index.html.");
}

async function checkGuiAssetReferences(html, guiRootPath, label) {
  const references = collectLocalAssetReferences(html);
  for (const reference of references) {
    try {
      await access(path.join(guiRootPath, reference));
    } catch {
      failures.push(`${label}/index.html references missing asset ${reference}. Rebuild the GUI and JetBrains plugin resources.`);
    }
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

async function checkDirectory(directoryPath, message) {
  try {
    const directoryStat = await stat(directoryPath);
    if (!directoryStat.isDirectory()) {
      failures.push(`${message} Found ${relative(directoryPath)}, but it is not a directory.`);
    }
  } catch {
    failures.push(`${message} Expected directory: ${relative(directoryPath)}.`);
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

async function readOptionalTextFile(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function requireIncludes(value, expected, message) {
  if (!value.includes(expected)) {
    failures.push(message);
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
      failures.push(`${staleMessage} ${prepareMessage} Generated: ${relative(generatedPath)}; newer source: ${relative(sourcePath)}.`);
    }
  }
}

function relative(filePath) {
  return path.relative(root, filePath);
}
