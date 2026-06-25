import { spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { npmRunInvocation } from "./npm-spawn.mjs";

export const agentRunBuiltGuiSmokeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const agentRunBuiltGuiRoot = path.join(agentRunBuiltGuiSmokeRoot, "apps", "gui");
export const agentRunBuiltGuiDistRoot = path.join(agentRunBuiltGuiRoot, "dist");
export const agentRunBuiltGuiIndexPath = path.join(agentRunBuiltGuiDistRoot, "index.html");
export const agentRunBuiltGuiRuntimeOrigin = "http://127.0.0.1:8001";

export async function buildAgentRunBuiltGui({ smokeName, smokeCommand, redact = String }) {
  const env = { ...process.env, NO_PROXY: "127.0.0.1,localhost,::1", no_proxy: "127.0.0.1,localhost,::1" };
  const { command, args } = npmRunInvocation("build", [], { env });
  const result = spawnSync(command, args, { cwd: agentRunBuiltGuiRoot, stdio: "inherit", env });
  if (result.status !== 0) {
    failAgentRunBuiltGuiSmokeActionable(smokeName, "GUI build failed.", [
      `Run \`cd apps/gui && npm install\` if dependencies are missing, then retry \`npm run ${smokeCommand ?? smokeName}\`.`,
    ], redact);
  }
}

export async function requireAgentRunBuiltGui({ smokeName, failures, redact = String }) {
  try {
    const fileStat = await stat(agentRunBuiltGuiIndexPath);
    if (!fileStat.isFile()) {
      throw new Error("not a file");
    }
    const html = await readFile(agentRunBuiltGuiIndexPath, "utf8");
    if (!html.includes("/assets/") && !html.includes("./assets/")) {
      failures.push("Built GUI index.html does not reference Vite assets.");
    }
  } catch {
    failAgentRunBuiltGuiSmokeActionable(smokeName, "built GUI is missing after build.", [
      `Expected file: ${path.relative(agentRunBuiltGuiSmokeRoot, agentRunBuiltGuiIndexPath)}`,
    ], redact);
  }
}

export async function requireAgentRunChromium({ smokeName, redact = String }) {
  try {
    return await import("playwright");
  } catch (error) {
    failAgentRunBuiltGuiSmokeActionable(smokeName, "Playwright is not installed or cannot be loaded.", [
      "Run `npm install` from the repository root.",
      "Run `npx playwright install chromium` if Chromium is not installed yet.",
      `Load error: ${messageOf(error)}`,
    ], redact);
  }
}

export async function startAgentRunStaticServer(staticRoot) {
  const server = http.createServer(async (request, response) => {
    let pathname;
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      pathname = decodeURIComponent(requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname);
    } catch {
      response.writeHead(400).end("Bad request");
      return;
    }
    const requestedPath = path.normalize(path.join(staticRoot, pathname));
    if (!requestedPath.startsWith(staticRoot + path.sep) && requestedPath !== staticRoot) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    try {
      const fileStat = await stat(requestedPath);
      if (!fileStat.isFile()) {
        response.writeHead(404).end("Not found");
        return;
      }
      response.writeHead(200, { "content-type": agentRunContentType(requestedPath) });
      createReadStream(requestedPath).pipe(response);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
  await listen(server, "127.0.0.1", 0);
  const address = server.address();
  return { port: address.port, close: () => closeServer(server) };
}

export function isAgentRunAllowedNetworkUrl(value, guiBaseUrl) {
  return isAgentRunStaticServerAsset(value, guiBaseUrl) || isAgentRunRuntimeOriginUrl(value);
}

export function isAgentRunRuntimeOriginUrl(value) {
  try {
    return new URL(value).origin === agentRunBuiltGuiRuntimeOrigin;
  } catch {
    return false;
  }
}

export function isAgentRunStaticServerAsset(url, guiBaseUrl) {
  return url.startsWith(`${guiBaseUrl}/`);
}

export function isAgentRunJsOrCssAssetRequest(url, resourceType) {
  return resourceType === "script" || resourceType === "stylesheet" || new URL(url).pathname.endsWith(".js") || new URL(url).pathname.endsWith(".css");
}

export function isExpectedAgentRunFetchConsoleError(text) {
  return /^Failed to load resource: (net::ERR_CONNECTION_REFUSED|the server responded with a status of (401 \(Unauthorized\)|404 \(Not Found\)))$/.test(text);
}

export function redactAgentRunUrl(value, redact = String) {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return redact(value);
  }
}

export function failAgentRunBuiltGuiSmokeActionable(smokeName, summary, lines, redact = String) {
  console.error(`${smokeName} failed: ${summary}`);
  for (const line of lines) {
    if (line) {
      console.error(redact(line));
    }
  }
  process.exit(1);
}

export function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function agentRunContentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}
