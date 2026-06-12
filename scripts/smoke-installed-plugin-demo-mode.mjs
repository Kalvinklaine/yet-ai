import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const forwardedArgs = process.argv.slice(2);
const unknownArgs = forwardedArgs.filter((arg) => arg !== "--headed");
if (unknownArgs.length > 0) {
  console.error(`Unknown argument(s): ${unknownArgs.join(", ")}`);
  console.error("Usage: npm run smoke:installed-plugin-demo-mode -- [--headed]");
  process.exit(2);
}
const headed = forwardedArgs.includes("--headed");
const smokeEnv = sanitizedSmokeEnvironment(process.env);

try {
  await runSmoke("VS Code installed-plugin Demo Mode first message", "smoke:vscode-wrapper-browser");
  await runSmoke("JetBrains installed-plugin Demo Mode first message", "smoke:jetbrains-wrapper-browser");

  console.log("Installed-plugin Demo Mode first-message smoke passed.");
  console.log("Verified runtime-owned Demo Mode first-message chat UX through VS Code and JetBrains packaged-GUI wrapper browser smokes.");
  console.log("This smoke is local/mock-only: it uses no real provider credentials, makes no OpenAI/ChatGPT or other provider calls, contacts no hosted Yet AI services, performs no real IDE/JCEF automation, and does not sign, publish, or create a release.");
  console.log("Run `npm run smoke:installed-plugin-demo-mode -- --headed` for human headed browser review; CI remains headless by default.");
} catch (error) {
  console.error(`Installed-plugin Demo Mode smoke failed: ${error?.message ?? error}`);
  process.exit(1);
}

function runSmoke(label, scriptName) {
  return new Promise((resolve, reject) => {
    console.log(`\n==> ${label}`);
    const args = ["run", scriptName, "--", "--demo-mode-first-message"];
    if (headed) args.push("--headed");
    const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
    const child = spawn(npmCommand, args, { cwd: root, stdio: "inherit", env: smokeEnv });
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

function sanitizedSmokeEnvironment(baseEnv) {
  const safeNames = new Set([
    "PATH",
    "HOME",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "LC_COLLATE",
    "LC_MESSAGES",
    "LC_MONETARY",
    "LC_NUMERIC",
    "LC_TIME",
    "LC_ADDRESS",
    "LC_IDENTIFICATION",
    "LC_MEASUREMENT",
    "LC_NAME",
    "LC_PAPER",
    "LC_TELEPHONE",
    "NPM_CONFIG_CACHE",
    "PLAYWRIGHT_BROWSERS_PATH",
  ]);
  const unsafeName = /(^|[_-])(?:access[_-]?token|refresh[_-]?token|session[_-]?token|auth[_-]?token|token|api[_-]?key|authorization|bearer|cookie|client[_-]?secret|secret|provider|openai|anthropic|github|aws|azure|google)(?:$|[_-])/i;
  return Object.fromEntries(
    Object.entries(baseEnv).filter(([name]) => !unsafeName.test(name) && safeNames.has(name.toUpperCase())),
  );
}
