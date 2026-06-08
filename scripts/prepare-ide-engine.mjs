import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const profile = args.has("--release") ? "release" : "debug";
const skipBuild = args.has("--no-build");
const identity = JSON.parse(await readFile(path.join(root, "product", "identity.json"), "utf8"));
const crateName = identity.engine.rustCrate;
const binaryName = identity.engine.binaryName;
const binaryFileName = process.platform === "win32" ? `${binaryName}.exe` : binaryName;
const cargoArgs = ["build", "-p", crateName];

if (profile === "release") {
  cargoArgs.push("--release");
}

if (!skipBuild) {
  console.log(`Running cargo command: cargo ${cargoArgs.join(" ")}`);
  const result = spawnSync("cargo", cargoArgs, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    if (result.error.code === "ENOENT") {
      console.error("Cargo was not found on PATH, so the IDE engine could not be built.");
      console.error(`Platform: ${process.platform}/${process.arch}`);
      console.error("Install Rust/Cargo and ensure the Cargo bin directory is on PATH (for example, ~/.cargo/bin in bash-compatible shells). Then retry npm run prepare:ide-engine.");
    } else {
      console.error(`Failed to run cargo: ${result.error.message}`);
    }
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`Cargo command failed with exit status ${result.status ?? "unknown"}${result.signal ? ` and signal ${result.signal}` : ""}.`);
    console.error(`Command: cargo ${cargoArgs.join(" ")}`);
    console.error("Working directory: repository root");
    process.exit(result.status ?? 1);
  }
}

const source = path.join(root, "target", profile, binaryFileName);
try {
  const sourceStat = await stat(source);
  if (!sourceStat.isFile()) {
    throw new Error("not a file");
  }
} catch (error) {
  console.error(`Engine binary not found at ${source}. Run cargo build -p ${crateName}${profile === "release" ? " --release" : ""} first.`);
  process.exit(1);
}

const vscodeBin = path.join(root, "apps", "plugins", "vscode", "bin");
const vscodeTarget = path.join(vscodeBin, binaryFileName);
await mkdir(vscodeBin, { recursive: true });
await copyFile(source, vscodeTarget);
if (process.platform !== "win32") {
  await chmod(vscodeTarget, 0o755);
}

console.log(`Prepared ${binaryName} from ${path.relative(root, source)}.`);
console.log(`Copied VS Code dev binary to ${path.relative(root, vscodeTarget)}.`);
console.log("");
console.log("VS Code dev settings:");
console.log(`  yetai.launchMode = auto`);
console.log(`  yetai.engineBinaryPath = ${vscodeTarget}`);
console.log("");
console.log("JetBrains dev settings:");
console.log("  Launch mode = auto");
console.log(`  Engine binary path = ${source}`);
console.log("");
console.log("JetBrains can also discover the binary from PATH, for example:");
console.log(`  export PATH=\"${path.dirname(source)}:$PATH\"`);

if (process.platform === "win32") {
  console.log("");
  console.log("Windows support is not verified yet; use the printed absolute engineBinaryPath if executable discovery differs.");
}
