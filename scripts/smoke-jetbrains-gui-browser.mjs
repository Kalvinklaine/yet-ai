import { spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jetbrainsRoot = path.join(root, "apps", "plugins", "jetbrains");
const distributionsDir = path.join(jetbrainsRoot, "build", "distributions");
const archiveInspectMaxBuffer = 128 * 1024 * 1024;
const spaRoute = "/settings";
const requiredVisibleText = ["Yet AI", "Local runtime connection", "Provider setup", "Chat with Yet AI"];
const failures = [];

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch (error) {
  console.error("JetBrains packaged GUI browser smoke failed: Playwright is not installed or cannot be loaded.");
  console.error("Run `npm install` from the repository root, then run `npx playwright install chromium` if Chromium is not installed yet.");
  console.error(`Load error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const zipPath = await findCurrentDistributionZip();
if (zipPath === undefined) {
  console.error("JetBrains packaged GUI browser smoke failed: no JetBrains installable ZIP found.");
  console.error("Run `npm run prepare:jetbrains-preview` from the repository root first.");
  console.error(`Expected ZIP under: ${path.relative(root, distributionsDir)}/*.zip`);
  process.exit(1);
}

const tempDir = await mkdtemp(path.join(os.tmpdir(), "yet-ai-jetbrains-gui-browser-"));
let server;
let browser;

try {
  const staticRoot = path.join(tempDir, "static");
  await extractPackagedGui(zipPath, staticRoot);
  if (failures.length > 0) {
    reportFailures();
  }

  server = await startStaticServer(staticRoot);
  const baseUrl = `http://127.0.0.1:${server.port}`;

  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    console.error("JetBrains packaged GUI browser smoke failed: Playwright Chromium is not installed or cannot be launched.");
    console.error("Run `npm install` from the repository root if needed, then run `npx playwright install chromium`.");
    console.error(`Launch error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const page = await browser.newPage();
  page.on("pageerror", (error) => {
    failures.push(`Page JavaScript error: ${error.message}`);
  });
  page.on("requestfailed", (request) => {
    if (isJsOrCssAssetRequest(request.url(), request.resourceType())) {
      failures.push(`Failed JS/CSS asset request: ${request.method()} ${request.url()} (${request.failure()?.errorText ?? "unknown failure"})`);
    }
  });
  page.on("response", (response) => {
    const url = response.url();
    if (isStaticServerAsset(url) && (isJsOrCssAssetUrl(url) || response.status() === 404 || response.status() >= 500)) {
      if (response.status() === 404 || response.status() >= 500) {
        failures.push(`Broken local asset response: ${response.status()} ${url}`);
      }
    }
  });

  await page.goto(`${baseUrl}${spaRoute}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.trim().length > 0, undefined, { timeout: 5000 });

  const initialBodyText = (await page.locator("body").innerText()).trim();
  const notFoundVisible = await page.getByRole("heading", { name: "Not Found", exact: true }).isVisible().catch(() => false);
  if (notFoundVisible) {
    failures.push(`Packaged GUI route ${spaRoute} rendered Not Found. Body: ${JSON.stringify(initialBodyText.slice(0, 500))}`);
    reportFailures();
  }

  for (const text of requiredVisibleText) {
    const visible = await page.getByText(text, { exact: true }).first().isVisible().catch(() => false);
    if (!visible) {
      failures.push(`Missing visible GUI text: ${text}`);
    }
  }

  await assertBridgeDiagnostics(page);

  const bodyText = (await page.locator("body").innerText()).trim();
  if (bodyText.length < 80) {
    failures.push(`GUI body text is too short or blank (${bodyText.length} characters).`);
  }

  await page.waitForTimeout(250);

  if (failures.length > 0) {
    reportFailures();
  }

  console.log("JetBrains packaged GUI browser smoke passed.");
  console.log(`Checked ${path.relative(root, zipPath)} packaged GUI rendering, visible core sections, JavaScript execution, and local JS/CSS asset responses.`);
  console.log("No engine, provider credentials, OpenAI/ChatGPT, hosted Yet AI services, JetBrains IDE, or JCEF automation were used.");
} finally {
  await browser?.close().catch(() => undefined);
  await server?.close().catch(() => undefined);
  await rm(tempDir, { recursive: true, force: true });
}

async function findCurrentDistributionZip() {
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
        zips.push({ path: zipPath, mtimeMs: zipStat.mtimeMs });
      }
    }
    return zips.sort((left, right) => right.mtimeMs - left.mtimeMs || left.path.localeCompare(right.path))[0]?.path;
  } catch {
    return undefined;
  }
}

async function extractPackagedGui(zipPath, staticRoot) {
  const zipListing = listZip(zipPath);
  if (zipListing === undefined) {
    return;
  }
  const zipEntries = zipListing.split(/\r?\n/).filter(Boolean);
  const pluginJarEntry = zipEntries.find((entry) => entry.endsWith(".jar") && entry.includes("/lib/yet-ai-jetbrains-") && !entry.includes("searchableOptions"));
  if (pluginJarEntry === undefined) {
    failures.push(`${path.relative(root, zipPath)} must contain a main plugin JAR under lib/.`);
    return;
  }

  const pluginJar = await extractZipEntry(zipPath, pluginJarEntry, tempDir);
  if (pluginJar === undefined) {
    return;
  }

  const jarListing = listZip(pluginJar);
  if (jarListing === undefined) {
    return;
  }
  const jarEntries = jarListing.split(/\r?\n/).filter(Boolean);
  if (!jarEntries.some((entry) => entry.endsWith("yet-ai-gui/index.html"))) {
    failures.push(`${path.relative(root, zipPath)} plugin JAR must contain packaged GUI resources with yet-ai-gui/index.html. Run npm run prepare:jetbrains-preview after building GUI assets.`);
    return;
  }

  const assetEntries = jarEntries.filter((entry) => entry.startsWith("yet-ai-gui/assets/") && !entry.endsWith("/"));
  if (assetEntries.length === 0) {
    failures.push(`${path.relative(root, zipPath)} plugin JAR must contain packaged GUI assets under yet-ai-gui/assets/.`);
    return;
  }

  await mkdir(staticRoot, { recursive: true });
  const indexHtml = await extractZipEntryBuffer(pluginJar, "yet-ai-gui/index.html");
  if (indexHtml === undefined) {
    failures.push(`${path.relative(root, zipPath)} plugin JAR must allow reading yet-ai-gui/index.html.`);
    return;
  }
  await writeFile(path.join(staticRoot, "index.html"), indexHtml);

  for (const entry of assetEntries) {
    const relativeEntry = entry.slice("yet-ai-gui/".length);
    const targetPath = path.normalize(path.join(staticRoot, relativeEntry));
    if (!targetPath.startsWith(staticRoot + path.sep)) {
      failures.push(`${path.relative(root, zipPath)} plugin JAR contains an unsafe GUI asset path: ${entry}`);
      continue;
    }
    const content = await extractZipEntryBuffer(pluginJar, entry);
    if (content === undefined) {
      failures.push(`${path.relative(root, zipPath)} plugin JAR must allow reading packaged GUI asset ${entry}.`);
      continue;
    }
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, content);
  }

  const html = indexHtml.toString("utf8");
  if (!html.includes("/assets/") && !html.includes("./assets/")) {
    failures.push(`${path.relative(root, zipPath)} packaged GUI index.html does not reference Vite assets.`);
  }
}

async function extractZipEntry(zipPath, entry, outputRoot) {
  const content = await extractZipEntryBuffer(zipPath, entry);
  if (content === undefined) {
    failures.push(`Could not extract ${entry} from ${path.relative(root, zipPath)}. Install unzip to inspect nested plugin JARs.`);
    return undefined;
  }
  const filePath = path.join(outputRoot, path.basename(entry));
  await writeFile(filePath, content);
  return filePath;
}

async function extractZipEntryBuffer(zipPath, entry) {
  const result = spawnSync("unzip", ["-p", zipPath, entry], {
    cwd: root,
    encoding: "buffer",
    maxBuffer: archiveInspectMaxBuffer,
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    return undefined;
  }
  return result.stdout;
}

function listZip(zipPath) {
  const commands = [
    ["zipinfo", ["-1", zipPath]],
    ["unzip", ["-Z1", zipPath]],
    ["jar", ["tf", zipPath]],
  ];
  for (const [command, args] of commands) {
    const result = spawnSync(command, args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: archiveInspectMaxBuffer,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    if (result.status === 0) {
      return result.stdout;
    }
  }
  failures.push(`Could not inspect ${path.relative(root, zipPath)}. Install zipinfo/unzip or ensure jar is available with a JDK.`);
  return undefined;
}

async function startStaticServer(staticRoot) {
  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const pathname = decodeURIComponent(requestUrl.pathname === "/" || requestUrl.pathname === spaRoute ? "/index.html" : requestUrl.pathname);
    const requestedPath = path.normalize(path.join(staticRoot, pathname));
    if (!requestedPath.startsWith(staticRoot + path.sep) && requestedPath !== staticRoot) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    try {
      const fileStat = await stat(requestedPath);
      if (!fileStat.isFile()) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      response.writeHead(200, { "content-type": contentType(requestedPath) });
      createReadStream(requestedPath).pipe(response);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Static server did not bind to a TCP port.");
  }

  return {
    port: address.port,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }
  if (filePath.endsWith(".js")) {
    return "text/javascript; charset=utf-8";
  }
  if (filePath.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }
  if (filePath.endsWith(".svg")) {
    return "image/svg+xml";
  }
  return "application/octet-stream";
}

function isJsOrCssAssetRequest(url, resourceType) {
  return isStaticServerAsset(url) && (resourceType === "script" || resourceType === "stylesheet" || isJsOrCssAssetUrl(url));
}

function isStaticServerAsset(url) {
  return url.startsWith("http://127.0.0.1:");
}

function isJsOrCssAssetUrl(value) {
  const pathname = new URL(value).pathname;
  return pathname.endsWith(".js") || pathname.endsWith(".css");
}

async function assertBridgeDiagnostics(page) {
  const bridgeDebugDetails = page.getByTestId("bridge-debug-details");
  const bridgeDebugState = await bridgeDebugDetails.evaluate((details) => ({ open: details.open, text: details.textContent ?? "" })).catch(() => null);
  if (!bridgeDebugState) {
    return;
  }
  if (bridgeDebugState.open) {
    failures.push("Bridge diagnostics disclosure should be collapsed by default.");
  }
  if (!/Diagnostics\s*\/\s*bridge debug/i.test(bridgeDebugState.text)) {
    return;
  }
  if (/token|secret|authorization|cookie|raw prompt|provider response/i.test(bridgeDebugState.text)) {
    failures.push("Bridge diagnostics disclosure contains sensitive wording while collapsed.");
  }

  await bridgeDebugDetails.locator("summary").first().click();
  const openedBridgeDebugState = await bridgeDebugDetails.evaluate((details) => ({ open: details.open, text: details.textContent ?? "" })).catch(() => null);
  if (!openedBridgeDebugState?.open) {
    failures.push("Bridge diagnostics disclosure did not open.");
    return;
  }
  if (!openedBridgeDebugState.text.includes("Inspect bridge message log") || !/No bridge messages logged|bridge messages/i.test(openedBridgeDebugState.text)) {
    failures.push("Bridge diagnostics disclosure does not expose bridge diagnostic evidence.");
  }
  if (/token|secret|authorization|cookie|raw prompt|provider response/i.test(openedBridgeDebugState.text)) {
    failures.push("Bridge diagnostics disclosure contains sensitive wording after opening.");
  }
}

function reportFailures() {
  console.error("JetBrains packaged GUI browser smoke failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}
