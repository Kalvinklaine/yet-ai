import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jetbrainsRoot = path.join(root, "apps", "plugins", "jetbrains");
const distributionsDir = path.join(jetbrainsRoot, "build", "distributions");
const rootDistDir = path.join(root, "dist", "plugins", "jetbrains");
const args = process.argv.slice(2);
const skipEnginePrepare = new Set(args).has("--skip-engine-prepare");
const identity = JSON.parse(await readFile(path.join(root, "product", "identity.json"), "utf8"));

function run(command, commandArgs, options = {}) {
  const printable = [command, ...commandArgs].join(" ");
  console.log(`\n> ${printable}`);
  const result = spawnSync(platformCommand(command), commandArgs, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
    env: process.env,
  });
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.error?.code === "ENOENT") {
    console.error(`Required command \`${command}\` was not found on PATH.`);
    console.error("Install Gradle/Cargo/Node prerequisites, or use an existing reviewed project wrapper if one is added later.");
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`Command failed with status ${result.status ?? "unknown"}${result.signal ? ` (signal ${result.signal})` : ""}: ${printable}`);
    if (options.diagnoseGradleFailure) {
      printGradleFailureDiagnostic(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
    }
    process.exit(result.status ?? 1);
  }
}

function printGradleFailureDiagnostic(output) {
  if (!isExternalGradleDependencyFailure(output)) {
    return;
  }
  console.error("\nJetBrains Gradle build appears blocked by external Gradle dependency or network resolution.");
  console.error("Suggestions:");
  console.error("- Retry with a stable network connection.");
  console.error("- Verify Gradle can resolve JetBrains dependencies for apps/plugins/jetbrains.");
  console.error("- Cached/offline Gradle may work only after these dependencies are already present locally.");
}

function isExternalGradleDependencyFailure(output) {
  const value = output.toLowerCase();
  const jetbrainsDependencyMarkers = [
    "cache-redirector.jetbrains.com",
    "java-compiler-ant-tasks",
  ];
  if (jetbrainsDependencyMarkers.some((marker) => value.includes(marker))) {
    return true;
  }
  const resolutionMarkers = [
    "instrumentcode",
    "dependency metadata",
    "could not resolve",
    "could not get resource",
    "could not download",
    "could not list versions",
    "failed to resolve",
  ];
  const networkMarkers = [
    "timeout",
    "timed out",
    "connect timed out",
    "read timed out",
    "connection reset",
    "connection refused",
    "temporary failure",
  ];
  return resolutionMarkers.some((marker) => value.includes(marker)) && networkMarkers.some((marker) => value.includes(marker));
}

function platformCommand(command) {
  if (process.platform !== "win32") {
    return command;
  }
  return {
    npm: "npm.cmd",
    gradle: "gradle.bat",
  }[command] ?? command;
}

const pluginVersion = await readGradleProjectVersion();
const gradleProjectName = await readGradleProjectName();
const expectedGradleZipName = `${gradleProjectName}-${pluginVersion}.zip`;

const profile = new Set(args).has("--release") ? "release" : "debug";
const binaryName = process.platform === "win32" ? `${identity.engine.binaryName}.exe` : identity.engine.binaryName;
const engineBinaryPath = path.join(root, "target", profile, binaryName);

if (skipEnginePrepare) {
  console.log("Skipping IDE engine preparation because --skip-engine-prepare was provided.");
  console.log("Assuming target engine and VS Code bin engine were already staged by the workflow.");
} else {
  run(process.execPath, [path.join(root, "scripts", "prepare-ide-engine.mjs"), ...args]);
}
run("npm", ["run", "build"], { cwd: path.join(root, "apps", "gui") });
await rm(path.join(jetbrainsRoot, "build", "generated", "resources", "yet-ai-gui"), { recursive: true, force: true });
await rm(path.join(jetbrainsRoot, "build", "generated", "resources", "yet-ai-engine"), { recursive: true, force: true });
await stageEngineBinary(engineBinaryPath, binaryName);
await clearDistributionZips();
run("gradle", ["buildPlugin", "--console=plain"], { cwd: jetbrainsRoot, diagnoseGradleFailure: true });

const zips = await findCurrentDistributionZips(expectedGradleZipName);
if (zips.length !== 1) {
  const found = zips.length === 0 ? "none" : zips.map((zip) => path.relative(root, zip)).join(", ");
  console.error(`JetBrains Gradle build must produce exactly one current installable ZIP named ${expectedGradleZipName} under ${distributionsDir}; found ${found}.`);
  process.exit(1);
}

const selectedZip = zips[0];
const distZipName = `${identity.product.id}-jetbrains-${pluginVersion}-dev-preview.zip`;
const distZipPath = path.join(rootDistDir, distZipName);
const distChecksumPath = `${distZipPath}.sha256`;
const checksum = await publishDevPreviewArtifact(selectedZip, distZipPath, distChecksumPath);
run("npm", ["run", "artifact:manifest"]);

console.log("\nJetBrains installable dev-preview ZIP prepared:");
for (const zip of zips) {
  console.log(`  ${zip}`);
}
console.log("\nStable root dev-preview artifact:");
console.log(`  ${distZipPath}`);
console.log(`  ${distChecksumPath}`);
console.log(`  sha256 ${checksum}`);
console.log(`\nThe ZIP also bundles the engine as a stable resource at yet-ai-engine/${binaryName} inside the plugin JAR. The IDE extracts it on first launch and prefers it over PATH lookup.`);
console.log("\nIf the plugin does not discover the bundled engine, configure:");
console.log("  Launch mode = auto");
console.log(`  Engine binary path = ${engineBinaryPath}`);
console.log("\nInstall from disk:");
console.log("  1. IntelliJ IDEA Settings/Preferences -> Plugins -> gear -> Install Plugin from Disk...");
console.log("  2. Choose one of the ZIP paths printed above.");
console.log("  3. Restart the IDE.");
console.log("  4. Open the Yet AI tool window and verify the packaged UI/chat path.");
console.log("\nThis is a local dev-preview ZIP only: the bundled yet-lsp engine is the local cargo build output packaged as a stable resource, with no signing, marketplace publishing, production installer, or notarized build of the engine.");

async function publishDevPreviewArtifact(sourceZip, distZipPath, distChecksumPath) {
  await mkdir(rootDistDir, { recursive: true });
  const entries = await readdir(rootDistDir).catch(() => []);
  await Promise.all(entries
    .filter((entry) => entry.endsWith("-dev-preview.zip") || entry.endsWith("-dev-preview.zip.sha256"))
    .map((entry) => rm(path.join(rootDistDir, entry), { force: true })));
  await copyFile(sourceZip, distZipPath);
  const checksum = createHash("sha256").update(await readFile(distZipPath)).digest("hex");
  await writeFile(distChecksumPath, `${checksum}  ${path.basename(distZipPath)}\n`, "utf8");
  return checksum;
}

async function readGradleProjectVersion() {
  const buildFile = await readFile(path.join(jetbrainsRoot, "build.gradle.kts"), "utf8");
  const match = buildFile.match(/^version\s*=\s*"([^"]+)"/m);
  if (match === null) {
    console.error("Could not read JetBrains plugin version from apps/plugins/jetbrains/build.gradle.kts.");
    process.exit(1);
  }
  return match[1];
}

async function readGradleProjectName() {
  const settingsFile = await readFile(path.join(jetbrainsRoot, "settings.gradle.kts"), "utf8");
  const match = settingsFile.match(/^rootProject\.name\s*=\s*"([^"]+)"/m);
  if (match === null) {
    console.error("Could not read JetBrains plugin project name from apps/plugins/jetbrains/settings.gradle.kts.");
    process.exit(1);
  }
  return match[1];
}

async function stageEngineBinary(sourceBinaryPath, binaryFileName) {
  let sourceStat;
  try {
    sourceStat = await stat(sourceBinaryPath);
  } catch (error) {
    console.error(`Engine binary not found at ${sourceBinaryPath}. Run cargo build -p ${identity.engine.rustCrate}${profile === "release" ? " --release" : ""} first.`);
    process.exit(1);
  }
  if (!sourceStat.isFile()) {
    console.error(`Engine binary path is not a file: ${sourceBinaryPath}.`);
    process.exit(1);
  }
  const resourceDir = path.join(jetbrainsRoot, "build", "generated", "resources", "yet-ai-engine", "yet-ai-engine");
  await mkdir(resourceDir, { recursive: true });
  const stagedPath = path.join(resourceDir, binaryFileName);
  await copyFile(sourceBinaryPath, stagedPath);
  if (process.platform !== "win32") {
    await chmod(stagedPath, 0o755);
  }
  console.log(`Staged ${binaryFileName} into ${path.relative(root, stagedPath)} (${sourceStat.size} bytes).`);
}

async function clearDistributionZips() {
  const zips = await findDistributionZips();
  await Promise.all(zips.map((zipPath) => rm(zipPath, { force: true })));
}

async function findCurrentDistributionZips(expectedZipName) {
  const zips = await findDistributionZips();
  return zips.filter((zipPath) => path.basename(zipPath) === expectedZipName);
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
