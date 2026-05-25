import { spawnSync } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jetbrainsRoot = path.join(root, "apps", "plugins", "jetbrains");
const distributionsDir = path.join(jetbrainsRoot, "build", "distributions");
const args = process.argv.slice(2);
const identity = JSON.parse(await readFile(path.join(root, "product", "identity.json"), "utf8"));

function run(command, commandArgs, options = {}) {
  const printable = [command, ...commandArgs].join(" ");
  console.log(`\n> ${printable}`);
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? root,
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });
  if (result.error?.code === "ENOENT") {
    console.error(`Required command \`${command}\` was not found on PATH.`);
    console.error("Install Gradle/Cargo/Node prerequisites, or use an existing reviewed project wrapper if one is added later.");
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("npm", ["run", "prepare:ide-engine", "--", ...args]);
run("npm", ["run", "build"], { cwd: path.join(root, "apps", "gui") });
run("gradle", ["buildPlugin", "--console=plain"], { cwd: jetbrainsRoot });

const zips = await findDistributionZips();
if (zips.length === 0) {
  console.error(`JetBrains Gradle build finished, but no installable ZIP was found under ${distributionsDir}.`);
  process.exit(1);
}

const profile = new Set(args).has("--release") ? "release" : "debug";
const binaryName = process.platform === "win32" ? `${identity.engine.binaryName}.exe` : identity.engine.binaryName;
const engineBinaryPath = path.join(root, "target", profile, binaryName);

console.log("\nJetBrains installable dev-preview ZIP prepared:");
for (const zip of zips) {
  console.log(`  ${zip}`);
}
console.log("\nIf the plugin does not discover the engine from PATH, configure:");
console.log("  Launch mode = auto");
console.log(`  Engine binary path = ${engineBinaryPath}`);
console.log("\nInstall from disk:");
console.log("  1. IntelliJ IDEA Settings/Preferences -> Plugins -> gear -> Install Plugin from Disk...");
console.log("  2. Choose one of the ZIP paths printed above.");
console.log("  3. Restart the IDE.");
console.log("  4. Open the Yet AI tool window and verify the packaged UI/chat path.");
console.log("\nThis is a local dev-preview ZIP only: no signing, marketplace publishing, production installer, or notarized bundled engine is produced.");

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
