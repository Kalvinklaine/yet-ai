import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { mkdir, rm } from "node:fs/promises";

const rootDir = process.cwd();
const runtimeToken = `smoke-runtime-${randomUUID()}`;
const authCode = `codex-loopback-code-${randomUUID()}`;
const accessToken = `codex-loopback-access-${randomUUID()}`;
const refreshToken = `codex-loopback-refresh-${randomUUID()}`;
const chatId = `smoke_codex_${randomUUID().replaceAll("-", "_")}`;
const requestId = `smoke-codex-request-${randomUUID()}`;
const firstChatSentinel = "SMOKE_CODEX_FIRST_CHAT";
const timeoutMs = 120_000;

let engine;
let tempHome;
let tokenEndpoint;
let chatEndpoint;
let tokenRequestCount = 0;
let chatRequestCount = 0;
let tokenRequestGrantType;
let chatAuthorizationHeader;
let chatRequestModel;
let chatRequestSentinelSeen = false;

try {
  tempHome = await makeTempHome();
  tokenEndpoint = await startMockTokenEndpoint();
  chatEndpoint = await startMockChatEndpoint();
  const enginePort = await freePort();
  engine = startEngine(enginePort, tempHome);
  const baseUrl = `http://127.0.0.1:${enginePort}`;
  await waitForEngine(baseUrl);

  const initial = await requestJson(baseUrl, "/v1/provider-auth/openai/status");
  assert(initial.status === "login_unavailable", "initial status was not login_unavailable");
  assert(initial.cloudRequired === false, "initial status unexpectedly required cloud");

  const start = await requestJson(baseUrl, "/v1/provider-auth/openai/start", {
    method: "POST",
    body: JSON.stringify({
      experimentalCodexLike: true,
      tokenEndpointUrl: tokenEndpoint.url,
      chatEndpointUrl: chatEndpoint.baseUrl
    })
  });
  assert(start.status === "pending", "experimental start did not enter pending state");
  assert(start.authSource === "oauth", "experimental start did not report oauth source");
  assert(start.supportsLogin === true, "experimental start did not report login support");
  assert(start.cloudRequired === false, "experimental start unexpectedly required cloud");
  assert(typeof start.sessionId === "string" && start.sessionId.startsWith("codex-"), "experimental start did not return a Codex-like session id");
  assert(start.authorizationUrl?.startsWith("https://auth.openai.com/oauth/authorize?"), "experimental start did not return the expected provider authorization shape");

  const state = new URL(start.authorizationUrl).searchParams.get("state");
  assert(typeof state === "string" && state.length > 20, "experimental start did not return pending state");

  const pending = await requestJson(baseUrl, "/v1/provider-auth/openai/status");
  assert(pending.status === "pending", "status did not preserve pending state");
  assert(pending.sessionId === start.sessionId, "pending status did not preserve session id");

  const exchange = await requestJson(baseUrl, "/v1/provider-auth/openai/exchange", {
    method: "POST",
    body: JSON.stringify({ sessionId: start.sessionId, state, code: authCode })
  });
  assert(exchange.status === "connected", "exchange did not enter connected state");
  assert(exchange.configured === true, "exchange did not configure experimental auth");
  assert(exchange.authSource === "oauth", "exchange did not report oauth source");
  assert(exchange.accountLabel === "loopback codex smoke account", "exchange returned unexpected account label");
  assert(exchange.sessionId === undefined, "connected exchange exposed session id");
  assert(exchange.authorizationUrl === undefined, "connected exchange exposed authorization URL");
  assert(tokenRequestCount === 1, "mock token endpoint was not called exactly once");
  assert(tokenRequestGrantType === "authorization_code", "mock token endpoint did not receive authorization-code grant");

  const connected = await requestJson(baseUrl, "/v1/provider-auth/openai/status");
  assert(connected.status === "connected", "status did not report connected state");
  assert(connected.configured === true, "connected status was not configured");
  assert(connected.accountLabel === "loopback codex smoke account", "connected status returned unexpected account label");

  const subscription = subscribe(baseUrl, chatId);
  const command = await requestJson(baseUrl, `/v1/chats/${encodeURIComponent(chatId)}/commands`, {
    method: "POST",
    body: JSON.stringify({
      requestId,
      type: "user_message",
      payload: { content: firstChatSentinel }
    })
  });
  assert(command.accepted === true, "first chat command was not accepted");

  const { events, raw } = await subscription;
  assert(events[0]?.type === "snapshot", "chat stream did not start with snapshot");
  assert(events.some((event) => event.type === "stream_started"), "chat stream did not start assistant stream");
  assert(events.some((event) => event.type === "stream_delta" && event.payload?.delta?.content === "Loopback"), "chat stream did not include first loopback delta");
  assert(events.some((event) => event.type === "stream_delta" && event.payload?.delta?.content === " connected"), "chat stream did not include connected delta");
  assert(events.some((event) => event.type === "stream_finished" && event.payload?.finishReason === "stop"), "chat stream did not finish cleanly");
  assertMonotonicSequence(events);
  assert(chatRequestCount === 1, "mock chat endpoint was not called exactly once");
  assert(chatAuthorizationHeader === `Bearer ${accessToken}`, "mock chat endpoint did not receive experimental bearer auth");
  assert(chatRequestModel === "gpt-5-codex", "mock chat endpoint received unexpected model");
  assert(chatRequestSentinelSeen === true, "mock chat endpoint did not receive first chat sentinel");

  const disconnect = await requestJson(baseUrl, "/v1/provider-auth/openai/disconnect", {
    method: "POST",
    body: JSON.stringify({})
  });
  assert(disconnect.success === true, "disconnect did not report success");
  assert(disconnect.status === "revoked", "disconnect did not report revoked state");
  assert(disconnect.authSource === "none", "disconnect did not clear oauth auth source");

  const afterDisconnect = await requestJson(baseUrl, "/v1/provider-auth/openai/status");
  assert(afterDisconnect.status === "login_unavailable", "post-disconnect status was not login_unavailable");
  assert(afterDisconnect.configured === false, "post-disconnect status remained configured");

  const evidence = {
    mode: "local-loopback-mock-only",
    lifecycle: [initial.status, start.status, pending.status, exchange.status, connected.status, disconnect.status, afterDisconnect.status],
    tokenEndpointCalls: tokenRequestCount,
    chatEndpointCalls: chatRequestCount,
    firstChat: "safe-sentinel-observed",
    disconnected: afterDisconnect.status === "login_unavailable",
    cloudRequired: false
  };
  const report = JSON.stringify(evidence, null, 2);
  assertNoUnsafeEvidence(report);
  assertNoUnsafeEvidence(raw);
  assertNoUnsafeEvidence(engine.output());
  console.log("Experimental Codex-like login smoke passed.");
  console.log(report);
} finally {
  if (engine) await stopProcess(engine);
  if (tokenEndpoint) await closeServer(tokenEndpoint.server);
  if (chatEndpoint) await closeServer(chatEndpoint.server);
  if (tempHome) await rm(tempHome, { recursive: true, force: true });
}

async function makeTempHome() {
  const home = path.join(os.tmpdir(), `yet-ai-codex-login-smoke-${process.pid}-${Date.now()}`);
  await mkdir(path.join(home, "Library", "Application Support"), { recursive: true });
  await mkdir(path.join(home, ".config"), { recursive: true });
  await mkdir(path.join(home, ".cache"), { recursive: true });
  return home;
}

function startEngine(port, home) {
  const child = spawn("cargo", ["run", "-p", "yet-lsp", "--quiet"], {
    cwd: rootDir,
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, ".config"),
      XDG_CACHE_HOME: path.join(home, ".cache"),
      CARGO_HOME: process.env.CARGO_HOME ?? path.join(process.env.HOME ?? home, ".cargo"),
      RUSTUP_HOME: process.env.RUSTUP_HOME ?? path.join(process.env.HOME ?? home, ".rustup"),
      NO_PROXY: appendNoProxy(process.env.NO_PROXY),
      no_proxy: appendNoProxy(process.env.no_proxy),
      YET_AI_AUTH_TOKEN: runtimeToken,
      YET_AI_HTTP_PORT: String(port)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.output = () => output;
  return child;
}

async function waitForEngine(baseUrl) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (engine.exitCode !== null) {
      throw new Error(`Engine exited before becoming ready.\n${redactUnsafe(engine.output())}`);
    }
    try {
      const response = await fetch(`${baseUrl}/v1/ping`, { headers: authHeaders() });
      if (response.ok) {
        await response.arrayBuffer();
        return;
      }
    } catch {
    }
    await delay(250);
  }
  throw new Error(`Engine did not become ready within ${timeoutMs}ms.\n${redactUnsafe(engine.output())}`);
}

async function startMockTokenEndpoint() {
  const server = http.createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/oauth/token") {
      response.writeHead(404).end();
      return;
    }
    tokenRequestCount += 1;
    request.setEncoding("utf8");
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const parsed = JSON.parse(body);
      tokenRequestGrantType = parsed.grant_type;
      assert(parsed.code === authCode, "mock token endpoint received unexpected auth code");
      assert(typeof parsed.code_verifier === "string" && parsed.code_verifier.length > 20, "mock token endpoint did not receive PKCE verifier");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: 1800,
        scope: "openid profile email offline_access",
        account_label: "loopback codex smoke account"
      }));
    });
  });
  await listen(server, "127.0.0.1", 0);
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}/oauth/token` };
}

async function startMockChatEndpoint() {
  const server = http.createServer((request, response) => {
    if (request.method !== "POST" || !["/chat/completions", "/v1/chat/completions"].includes(request.url)) {
      response.writeHead(404).end();
      return;
    }
    chatRequestCount += 1;
    chatAuthorizationHeader = request.headers.authorization;
    request.setEncoding("utf8");
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const parsed = JSON.parse(body);
      chatRequestModel = parsed.model;
      chatRequestSentinelSeen = parsed.messages?.[0]?.content === firstChatSentinel;
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache"
      });
      response.write('data: {"choices":[{"delta":{"content":"Loopback"}}]}\n\n');
      response.write('data: {"choices":[{"delta":{"content":" connected"}}]}\n\n');
      response.end("data: [DONE]\n\n");
    });
  });
  await listen(server, "127.0.0.1", 0);
  const address = server.address();
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function requestJson(baseUrl, route, init = {}) {
  const { expectedStatus, ...fetchInit } = init;
  const response = await fetch(`${baseUrl}${route}`, {
    ...fetchInit,
    headers: {
      ...authHeaders(),
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers
    }
  });
  const text = await response.text();
  if (expectedStatus === undefined ? !response.ok : response.status !== expectedStatus) {
    throw new Error(`Request ${route} returned unexpected HTTP status ${response.status}: ${redactUnsafe(text)}`);
  }
  return JSON.parse(text);
}

async function subscribe(baseUrl, id) {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/v1/chats/subscribe?chat_id=${encodeURIComponent(id)}`, {
    headers: { ...authHeaders(), Accept: "text/event-stream" },
    signal: controller.signal
  });
  if (!response.ok || !response.body) {
    throw new Error(`SSE subscribe failed with HTTP ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let raw = "";
  let buffer = "";
  const started = Date.now();
  try {
    while (Date.now() - started < timeoutMs) {
      const read = await Promise.race([
        reader.read(),
        delay(1_000).then(() => ({ timeout: true }))
      ]);
      if (read.timeout) continue;
      if (read.done) break;
      const chunk = decoder.decode(read.value, { stream: true });
      raw += chunk;
      buffer += chunk;
      const drained = drainSseFrames(buffer);
      buffer = drained.rest;
      for (const frame of drained.frames) {
        const event = parseSseFrame(frame);
        if (event) {
          events.push(event);
          if (event.type === "stream_finished" || event.type === "error") {
            controller.abort();
            return { events, raw };
          }
        }
      }
    }
  } finally {
    controller.abort();
    reader.releaseLock();
  }
  throw new Error(`SSE stream did not finish within ${timeoutMs}ms. Events: ${redactUnsafe(JSON.stringify(events))}`);
}

function parseSseFrame(frame) {
  const data = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""));
  if (data.length === 0) return null;
  return JSON.parse(data.join("\n"));
}

function drainSseFrames(buffer) {
  const parts = buffer.split(/\r?\n\r?\n/);
  return { frames: parts.slice(0, -1).filter((part) => part.trim() !== ""), rest: parts.at(-1) ?? "" };
}

function assertMonotonicSequence(events) {
  let expected = null;
  for (const event of events) {
    if (event.type === "snapshot") {
      expected = 1;
      continue;
    }
    if (expected !== null) {
      assert(event.seq === expected, `SSE sequence gap: expected ${expected}, received ${event.seq}`);
      expected += 1;
    }
  }
}

function authHeaders() {
  return { Authorization: `Bearer ${runtimeToken}` };
}

function appendNoProxy(value) {
  const entries = new Set(
    String(value ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
  for (const entry of ["127.0.0.1", "localhost", "::1"]) entries.add(entry);
  return [...entries].join(",");
}

function assertNoUnsafeEvidence(text) {
  const value = String(text);
  const lower = value.toLowerCase();
  const forbidden = [
    runtimeToken,
    authCode,
    accessToken,
    refreshToken,
    `bearer ${runtimeToken}`,
    `bearer ${accessToken}`,
    "code_verifier",
    "refresh_token",
    "access_token",
    "authorization: bearer",
    "cookie",
    "auth.json",
    "/users/",
    "/home/",
    "file://",
    firstChatSentinel
  ];
  for (const marker of forbidden) {
    assert(!lower.includes(String(marker).toLowerCase()), `unsafe evidence marker leaked: ${marker}`);
  }
}

function redactUnsafe(text) {
  let value = String(text);
  for (const marker of [runtimeToken, authCode, accessToken, refreshToken, firstChatSentinel]) {
    value = value.split(marker).join("[redacted]");
  }
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+/gi, "Bearer [redacted]")
    .replace(/code_verifier[\"']?\s*[:=]\s*[\"'][^\"']+[\"']/gi, "code_verifier:[redacted]")
    .replace(/\/Users\/[^\s)]+/g, "[redacted-path]")
    .replace(/file:\/\/[^\s)]+/g, "[redacted-file-url]");
}

async function freePort() {
  const server = net.createServer();
  await listen(server, "127.0.0.1", 0);
  const address = server.address();
  const port = address.port;
  await closeServer(server);
  return port;
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

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(5_000).then(() => false)
  ]);
  if (exited === false) {
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
