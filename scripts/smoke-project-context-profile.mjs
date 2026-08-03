import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(root, "apps", "gui", "dist");
const identity = JSON.parse(await readFile(path.join(root, "product", "identity.json"), "utf8"));
const binary = path.join(root, "target", "debug", process.platform === "win32" ? `${identity.engine.binaryName}.exe` : identity.engine.binaryName);
const token = `context-profile-${randomUUID()}`;
const timeoutMs = 30_000;
let tempRoot;
let child;
let childExit;
let browser;
let output = "";
let outputOverflow = false;
const maxOutputBytes = 1_000_000;

try {
  await requireFile(binary);
  await requireFile(path.join(distRoot, "index.html"));
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "yet-ai-context-profile-"));
  const home = path.join(tempRoot, "home");
  const projectRoot = path.join(home, "workspace");
  await mkdir(path.join(projectRoot, "src"), { recursive: true });
  await writeFile(path.join(projectRoot, "Cargo.toml"), "[package]\nname = \"context-smoke\"\nversion = \"0.1.0\"\n");
  await writeFile(path.join(projectRoot, "src", "main.rs"), "fn main() {}\n");
  const env = isolatedEnvironment(home);
  const project = JSON.parse(await runCli(env, ["project", "add", projectRoot, "--name", "Context Profile Project"]));
  await runCli(env, ["project", "open", project.projectId]);

  const port = await allocatePort();
  child = spawn(binary, [], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, YET_AI_HTTP_PORT: String(port), YET_AI_AUTH_TOKEN: token, YET_AI_WEB_UI_DIST_DIR: distRoot } });
  child.stdout.on("data", captureOutput);
  child.stderr.on("data", captureOutput);
  childExit = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  await waitForEngine(port);

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) failures.push(`non-loopback request: ${url.origin}`);
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  await page.goto(`${baseUrl}/projects`);
  await page.getByRole("link", { name: "Open project Context Profile Project" }).click();
  await page.waitForURL(`${baseUrl}/p/${project.projectId}/`);
  await expectText(page, "Not initialized");
  await expectText(page, "not automatically attached to chat");
  const rebuildResponse = page.waitForResponse((response) => new URL(response.url()).pathname === `/p/${project.projectId}/v1/context/rebuild` && response.request().method() === "POST");
  await page.getByRole("button", { name: "Rebuild project context" }).click();
  if (!(await rebuildResponse).ok()) throw new Error("Explicit project context rebuild was not accepted.");
  await expectText(page, "Primary languages");
  await expectText(page, "rust (1 files)");
  await expectText(page, "Cargo.toml");
  await expectText(page, "src/main.rs");
  const evidence = await page.locator("body").innerText();
  for (const forbidden of [projectRoot, home, token]) if (evidence.includes(forbidden)) throw new Error("Project context GUI exposed private runtime evidence.");
  if (failures.length) throw new Error(failures.join("; "));
  if (outputOverflow) throw new Error("Runtime output exceeded the bounded privacy evidence capture.");
  if (output.includes(projectRoot) || output.includes(home) || output.includes(token)) throw new Error("Runtime output exposed private smoke evidence.");
  console.log("Project context profile smoke passed.");
  console.log("Verified routed real-engine status, explicit rebuild, deterministic profile facts, and relative-only provenance.");
} catch (error) {
  console.error(redact(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => undefined);
  if (child && child.exitCode === null) {
    child.kill();
    await Promise.race([childExit, new Promise((resolve) => setTimeout(resolve, 2_000))]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
}

async function requireFile(candidate) { if (!(await stat(candidate)).isFile()) throw new Error(`Missing smoke prerequisite ${path.relative(root, candidate)}.`); }
function isolatedEnvironment(home) { return { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, ".config"), XDG_CACHE_HOME: path.join(home, ".cache") }; }
function runCli(env, args) { return new Promise((resolve, reject) => { const command = spawn(binary, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] }); let stdout = ""; let stderr = ""; command.stdout.on("data", (chunk) => { stdout += chunk; }); command.stderr.on("data", (chunk) => { stderr += chunk; }); command.once("error", reject); command.once("exit", (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(`Engine CLI failed (${code}): ${stderr.trim()}`))); }); }
async function expectText(page, text) { await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout: timeoutMs }); }
async function waitForEngine(port) { const deadline = Date.now() + timeoutMs; while (Date.now() < deadline) { try { if ((await fetch(`http://127.0.0.1:${port}/`)).ok) return; } catch {} await new Promise((resolve) => setTimeout(resolve, 150)); } throw new Error("Timed out waiting for the loopback runtime."); }
function allocatePort() { return new Promise((resolve, reject) => { const server = createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close((error) => error ? reject(error) : address && typeof address === "object" ? resolve(address.port) : reject(new Error("Could not allocate a port."))); }); }); }
function captureOutput(chunk) {
  if (outputOverflow) return;
  output += chunk.toString("utf8");
  if (Buffer.byteLength(output, "utf8") > maxOutputBytes) outputOverflow = true;
}
function redact(value) { return String(value).split(token).join("[REDACTED]").split(tempRoot ?? "never-match").join("[TEMP]"); }
