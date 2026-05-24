import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

function run(command, commandArgs, options = {}) {
  const printable = [command, ...commandArgs].join(" ");
  console.log(`\n> ${printable}`);
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? root,
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("npm", ["run", "prepare:ide-engine", "--", ...args]);
run("npm", ["run", "build"], { cwd: path.join(root, "apps", "gui") });
run("npm", ["run", "prepare:preview"], { cwd: path.join(root, "apps", "plugins", "vscode") });

console.log("\nVS Code dev preview is prepared.");
console.log("Open apps/plugins/vscode in VS Code, start an Extension Development Host, then run Yet AI: Open Chat.");
console.log("Generated GUI assets and engine binaries are ignored and must not be committed.");
