import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { npmRunInvocation } from "./lib/npm-spawn.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const headed = process.argv.includes("--headed");

try {
  await runSmoke("JetBrains installed-plugin chat visual", "smoke:jetbrains-wrapper-browser");
  await runSmoke("VS Code installed-plugin chat visual", "smoke:vscode-wrapper-browser");

  console.log("Installed-plugin chat visual smoke passed.");
  console.log("Evidence is written by the focused wrapper smokes under dist/visual-smoke/jetbrains-wrapper-browser/ and dist/visual-smoke/vscode-wrapper-browser/.");
  console.log("Run `npm run smoke:installed-plugin-chat-visual -- --headed` for human headed browser review; CI remains headless by default.");
} catch (error) {
  console.error("Installed-plugin chat visual smoke failed.");
  console.error(sanitizeDiagnosticText(error instanceof Error ? error.message : String(error)));
  process.exit(1);
}

function runSmoke(label, scriptName) {
  return new Promise((resolve, reject) => {
    console.log(`\n==> ${label}`);
    const forwardedArgs = headed ? ["--headed"] : [];
    const { command, args } = npmRunInvocation(scriptName, forwardedArgs);
    const outputTail = [];
    const child = spawn(command, args, { cwd: root, stdio: ["inherit", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => forwardChildOutput(chunk, process.stdout, outputTail));
    child.stderr.on("data", (chunk) => forwardChildOutput(chunk, process.stderr, outputTail));
    child.on("error", (error) => reject(new Error(`${scriptName} could not start on ${process.platform}: ${sanitizeDiagnosticText(error.message)}`)));
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(formatChildFailure({ label, scriptName, command, args, code, signal, outputTail })));
    });
  });
}

function forwardChildOutput(chunk, stream, outputTail) {
  const text = sanitizeDiagnosticText(chunk.toString("utf8"));
  stream.write(text);
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    outputTail.push(line.slice(0, 600));
    while (outputTail.length > 40) outputTail.shift();
  }
}

function formatChildFailure({ label, scriptName, command, args, code, signal, outputTail }) {
  const fatalTail = outputTail.filter((line) => !isNonFatalJetBrainsNoise(line));
  const noisyTailCount = outputTail.length - fatalTail.length;
  const tail = (fatalTail.length > 0 ? fatalTail : outputTail).slice(-20);
  return [
    `${scriptName} failed during ${label} on ${process.platform}/${process.arch} with ${signal ? `signal ${signal}` : `exit code ${code}`}.`,
    `Spawn: ${command} ${args.map(formatSpawnArg).join(" ")}`,
    noisyTailCount > 0 ? `Suppressed ${noisyTailCount} known non-fatal JetBrains desktop credential/DBus warning line(s) from the root-cause tail.` : undefined,
    tail.length > 0 ? `Sanitized child output tail:\n${tail.map((line) => `  ${line}`).join("\n")}` : "No child output was captured before failure.",
  ].filter(Boolean).join("\n");
}

function isNonFatalJetBrainsNoise(line) {
  return /\b(DBus|D-Bus|libsecret|PasswordSafe|Secret Service|org\.freedesktop\.secrets|gnome-keyring|kwallet)\b/i.test(line)
    && !/\b(error|failed|fatal|exception|assert|timeout)\b/i.test(line.replace(/libsecret|PasswordSafe/i, ""));
}

function formatSpawnArg(arg) {
  return /\s/.test(arg) ? JSON.stringify(arg) : arg;
}

function sanitizeDiagnosticText(text) {
  return String(text)
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[redacted-email]")
    .replace(/\/Users\/[^\s)]+/g, "[redacted-absolute-path]")
    .replace(/[A-Z]:\\[^\s)]+/g, "[redacted-absolute-path]")
    .replace(/file:\/\/[^\s)]+/g, "[redacted-file-url]");
}
