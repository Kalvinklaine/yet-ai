import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

await import("./smoke-vscode-preview.mjs");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPath = path.join(root, "package.json");
const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
const failures = [];

if (packageJson.scripts?.["smoke:gui-runtime-e2e"] !== "node scripts/smoke-gui-runtime-e2e.mjs") {
  failures.push("Root package.json must keep smoke:gui-runtime-e2e available as the deeper local mock-provider runtime/chat verification path.");
}

if (failures.length > 0) {
  console.error("VS Code first-message preview smoke failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("VS Code first-message preview smoke passed: ready for manual first GPT message smoke with no real provider credentials used.");
console.log("Verified VS Code preview readiness and confirmed the deeper GUI runtime e2e smoke command is available for local mock-provider chat verification.");
console.log("No OpenAI, ChatGPT, hosted Yet AI service, real provider credential, non-loopback provider call, or VS Code launch was used.");
