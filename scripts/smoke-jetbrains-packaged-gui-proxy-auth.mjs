import { randomUUID } from "node:crypto";
import http from "node:http";

const token = `proxy-smoke-${randomUUID().replaceAll("-", "")}`;
const panelId = "panel_smoke_001";
const endpoints = ["/v1/demo-mode", "/v1/ping", "/v1/models", "/v1/caps"];
const upstreamRequests = [];
const output = [];
let runtimeServer;
let proxyServer;

try {
  runtimeServer = await startRuntimeServer();
  proxyServer = await startProxyServer(`http://127.0.0.1:${runtimeServer.port}`);

  const directResponse = await fetch(`http://127.0.0.1:${runtimeServer.port}/v1/ping`);
  assert(directResponse.status === 401, `upstream accepted unauthenticated request with ${directResponse.status}`);
  upstreamRequests.length = 0;

  for (const endpoint of endpoints) {
    const response = await fetch(`http://127.0.0.1:${proxyServer.port}/panel/${panelId}${endpoint}`);
    assert(response.status === 200, `${endpoint} returned ${response.status}`);
    await response.json();
  }

  assert(upstreamRequests.length === endpoints.length, `expected ${endpoints.length} upstream requests, observed ${upstreamRequests.length}`);
  for (const endpoint of endpoints) {
    const request = upstreamRequests.find((item) => item.path === endpoint);
    assert(request, `missing upstream request for ${endpoint}`);
    assert(request.authorization === `Bearer ${token}`, `missing injected Authorization for ${endpoint}`);
  }

  record("JetBrains packaged GUI proxy auth smoke passed.");
  record(`Verified ${endpoints.length} proxied runtime requests with server-side Authorization injection.`);
  record(`Endpoints: ${endpoints.join(", ")}`);

  const transcript = output.join("\n");
  assert(!transcript.includes(token), "smoke output contains raw token");
  assert(!/Bearer\s+[A-Za-z0-9._~+/=-]+/.test(transcript), "smoke output contains raw Bearer token");
  console.log(transcript);
} finally {
  await proxyServer?.close().catch(() => undefined);
  await runtimeServer?.close().catch(() => undefined);
}

async function startRuntimeServer() {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (!endpoints.includes(url.pathname)) return json(response, 404, { error: "not found" });

    const authorization = request.headers.authorization ?? null;
    upstreamRequests.push({ method: request.method, path: url.pathname, authorization });
    if (authorization !== `Bearer ${token}`) return json(response, 401, { error: "authorization required" });

    if (request.method !== "GET") return json(response, 405, { error: "method not allowed" });
    if (url.pathname === "/v1/demo-mode") return json(response, 200, { enabled: true, providerId: "yet-demo", modelId: "yet-demo-chat" });
    if (url.pathname === "/v1/ping") return json(response, 200, { productId: "yet-ai", ready: true });
    if (url.pathname === "/v1/models") return json(response, 200, { models: [{ id: "yet-demo-chat", providerId: "yet-demo" }] });
    if (url.pathname === "/v1/caps") return json(response, 200, { productId: "yet-ai", protocolVersion: "2026-05-15", runtime: { mode: "local", cloudRequired: false } });
  });
  return listen(server);
}

async function startProxyServer(runtimeBaseUrl) {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const match = new RegExp(`^/panel/${panelId}(/v1/.+)$`).exec(url.pathname);
    if (!match) return json(response, 404, { error: "not found" });

    const proxiedPath = match[1];
    if (!endpoints.includes(proxiedPath)) return json(response, 404, { error: "not found" });

    const upstream = await fetch(new URL(proxiedPath, `${runtimeBaseUrl}/`), {
      method: request.method,
      headers: { Authorization: `Bearer ${token}` },
    });
    response.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/json" });
    response.end(await upstream.text());
  });
  return listen(server);
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind to a TCP port.");
  return { port: address.port, close: () => new Promise((resolve) => server.close(resolve)) };
}

function record(message) {
  output.push(sanitizeText(message));
}

function json(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

function sanitizeText(text) {
  return String(text).replaceAll(token, "[redacted-runtime-token]").replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]");
}

function assert(condition, message) {
  if (!condition) throw new Error(sanitizeText(message));
}
