import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { npmRunInvocation } from "./lib/npm-spawn.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const headed = process.argv.includes("--headed");

await runSmoke("JetBrains installed-plugin chat visual", "smoke:jetbrains-wrapper-browser");
await runSmoke("VS Code installed-plugin chat visual", "smoke:vscode-wrapper-browser");

console.log("Installed-plugin chat visual smoke passed.");
console.log("Evidence is written by the focused wrapper smokes under dist/visual-smoke/jetbrains-wrapper-browser/ and dist/visual-smoke/vscode-wrapper-browser/.");
console.log("Run `npm run smoke:installed-plugin-chat-visual -- --headed` for human headed browser review; CI remains headless by default.");

function runSmoke(label, scriptName) {
  return new Promise((resolve, reject) => {
    console.log(`\n==> ${label}`);
    const forwardedArgs = headed ? ["--headed"] : [];
    const { command, args } = npmRunInvocation(scriptName, forwardedArgs);
    const child = spawn(command, args, { cwd: root, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${scriptName} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}`));
    });
  });
}
