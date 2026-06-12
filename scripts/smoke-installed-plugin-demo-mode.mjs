import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const headed = process.argv.includes("--headed");

await runSmoke("VS Code installed-plugin Demo Mode first message", "smoke:vscode-wrapper-browser");
await runSmoke("JetBrains installed-plugin Demo Mode first message", "smoke:jetbrains-wrapper-browser");

console.log("Installed-plugin Demo Mode first-message smoke passed.");
console.log("Verified runtime-owned Demo Mode first-message chat UX through VS Code and JetBrains packaged-GUI wrapper browser smokes.");
console.log("This smoke is local/mock-only: it uses no real provider credentials, makes no OpenAI/ChatGPT or other provider calls, contacts no hosted Yet AI services, performs no real IDE/JCEF automation, and does not sign, publish, or create a release.");
console.log("Run `npm run smoke:installed-plugin-demo-mode -- --headed` for human headed browser review; CI remains headless by default.");

function runSmoke(label, scriptName) {
  return new Promise((resolve, reject) => {
    console.log(`\n==> ${label}`);
    const args = ["run", scriptName, "--", "--demo-mode-first-message"];
    if (headed) args.push("--headed");
    const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
    const child = spawn(npmCommand, args, { cwd: root, stdio: "inherit" });
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
