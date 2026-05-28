import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jetbrainsRoot = path.join(root, "apps", "plugins", "jetbrains");
const distributionsDir = path.join(jetbrainsRoot, "build", "distributions");
const rootDistDir = path.join(root, "dist", "plugins", "jetbrains");
const args = process.argv.slice(2);
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

run("npm", ["run", "prepare:ide-engine", "--", ...args]);
run("npm", ["run", "build"], { cwd: path.join(root, "apps", "gui") });
run("gradle", ["buildPlugin", "--console=plain"], { cwd: jetbrainsRoot, diagnoseGradleFailure: true });

const zips = await findDistributionZips();
if (zips.length === 0) {
  console.error(`JetBrains Gradle build finished, but no installable ZIP was found under ${distributionsDir}.`);
  process.exit(1);
}

const profile = new Set(args).has("--release") ? "release" : "debug";
const binaryName = process.platform === "win32" ? `${identity.engine.binaryName}.exe` : identity.engine.binaryName;
const engineBinaryPath = path.join(root, "target", profile, binaryName);
const selectedZip = zips[zips.length - 1];
const pluginVersion = await readGradleProjectVersion();
const distZipName = `${identity.product.id}-jetbrains-${pluginVersion}-dev-preview.zip`;
const distZipPath = path.join(rootDistDir, distZipName);
const distChecksumPath = `${distZipPath}.sha256`;
const checksum = await publishDevPreviewArtifact(selectedZip, distZipPath, distChecksumPath);

console.log("\nJetBrains installable dev-preview ZIP prepared:");
for (const zip of zips) {
  console.log(`  ${zip}`);
}
console.log("\nStable root dev-preview artifact:");
console.log(`  ${distZipPath}`);
console.log(`  ${distChecksumPath}`);
console.log(`  sha256 ${checksum}`);
console.log("\nIf the plugin does not discover the engine from PATH, configure:");
console.log("  Launch mode = auto");
console.log(`  Engine binary path = ${engineBinaryPath}`);
console.log("\nInstall from disk:");
console.log("  1. IntelliJ IDEA Settings/Preferences -> Plugins -> gear -> Install Plugin from Disk...");
console.log("  2. Choose one of the ZIP paths printed above.");
console.log("  3. Restart the IDE.");
console.log("  4. Open the Yet AI tool window and verify the packaged UI/chat path.");
console.log("\nThis is a local dev-preview ZIP only: no signing, marketplace publishing, production installer, or notarized bundled engine is produced.");

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
