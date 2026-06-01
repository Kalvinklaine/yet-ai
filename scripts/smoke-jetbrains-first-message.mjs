import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
console.log("JetBrains first-message smoke delegates to the wrapper browser first-message preview coverage.");
const child = spawn(process.execPath, [path.join(root, "scripts", "smoke-jetbrains-wrapper-browser.mjs")], {
  cwd: root,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`JetBrains first-message smoke failed: delegated smoke exited from signal ${signal}.`);
    process.exit(1);
  }
  if (code === 0) {
    console.log("JetBrains first-message smoke passed.");
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(`JetBrains first-message smoke failed: ${error.message}`);
  process.exit(1);
});
