import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { mkdir, rm } from "node:fs/promises";

const rootDir = process.cwd();
const token = `smoke-token-${crypto.randomUUID()}`;
const fakeApiKey = `sk-smoke-secret-${crypto.randomUUID()}`;
const chatId = `smoke-chat-${crypto.randomUUID()}`;
const providerId = `smoke-provider-${Date.now()}`;
const timeoutMs = 120_000;

let engine;
let mockProvider;
let tempHome;
let providerAuth;
let providerRequestBody = "";

try {
  tempHome = await makeTempHome();
  const enginePort = await freePort();
  mockProvider = await startMockProvider();
  engine = startEngine(enginePort, tempHome);
  const baseUrl = `http://127.0.0.1:${enginePort}`;
  await waitForEngine(baseUrl);

  const ping = await requestJson(baseUrl, "/v1/ping");
  assert(ping.ready === true, "ping did not report ready runtime");
  assert(ping.productId === "yet-ai", "ping returned unexpected product identity");

  const caps = await requestJson(baseUrl, "/v1/caps");
  assert(caps.runtime?.mode === "local", "caps did not report local runtime mode");
  assert(caps.runtime?.cloudRequired === false, "caps unexpectedly require cloud runtime");
  assert(caps.runtime?.providerAccess === "direct", "caps did not report direct provider access");
  assert(Array.isArray(caps.capabilities) && caps.capabilities.includes("chat"), "caps did not include chat capability");

  const providerAuthStatus = await requestJson(baseUrl, "/v1/provider-auth/openai/status");
  assert(providerAuthStatus.provider === "openai", "provider-auth status returned unexpected provider");
  assert(providerAuthStatus.configured === false, "provider-auth default status was unexpectedly configured");
  assert(providerAuthStatus.status === "login_unavailable", "provider-auth default status was not login_unavailable");
  assert(providerAuthStatus.authSource === "none", "provider-auth default auth source was not none");
  assert(providerAuthStatus.supportsLogin === false, "provider-auth default status unexpectedly supports login");
  assert(providerAuthStatus.supportsApiKey === true, "provider-auth default status did not support API-key fallback");
  assert(providerAuthStatus.cloudRequired === false, "provider-auth default status unexpectedly requires cloud");

  const providerAuthStart = await requestJson(baseUrl, "/v1/provider-auth/openai/start", {
    method: "POST",
    body: JSON.stringify({ mock: true })
  });
  assert(providerAuthStart.status === "pending", "provider-auth mock start did not return pending status");
  assert(providerAuthStart.authSource === "oauth", "provider-auth mock start did not use oauth auth source");
  assert(providerAuthStart.supportsLogin === true, "provider-auth mock start did not support login");
  assert(providerAuthStart.cloudRequired === false, "provider-auth mock start unexpectedly requires cloud");
  assert(providerAuthStart.authorizationUrl?.startsWith("http://127.0.0.1/mock-oauth/authorize"), "provider-auth mock start returned unexpected authorization URL");
  assert(typeof providerAuthStart.sessionId === "string" && providerAuthStart.sessionId.length > 0, "provider-auth mock start did not return a session id");
  const providerAuthState = new URL(providerAuthStart.authorizationUrl).searchParams.get("state");
  assert(providerAuthState?.startsWith("mock-state-"), "provider-auth mock start did not return mock state");

  const providerAuthExchange = await requestJson(baseUrl, "/v1/provider-auth/openai/exchange", {
    method: "POST",
    body: JSON.stringify({
      sessionId: providerAuthStart.sessionId,
      state: providerAuthState,
      code: "mock-code-smoke"
    })
  });
  assert(providerAuthExchange.configured === true, "provider-auth mock exchange did not configure auth");
  assert(providerAuthExchange.status === "connected", "provider-auth mock exchange did not return connected status");
  assert(providerAuthExchange.authSource === "oauth", "provider-auth mock exchange did not use oauth auth source");
  assert(providerAuthExchange.redacted === "mock-oauth-...connected", "provider-auth mock exchange returned unexpected redacted hint");
  assert(providerAuthExchange.cloudRequired === false, "provider-auth mock exchange unexpectedly requires cloud");

  const providerAuthConnected = await requestJson(baseUrl, "/v1/provider-auth/openai/status");
  assert(providerAuthConnected.configured === true, "provider-auth connected status was not configured");
  assert(providerAuthConnected.status === "connected", "provider-auth connected status was not connected");
  assert(providerAuthConnected.authSource === "oauth", "provider-auth connected status did not use oauth auth source");

  const providerAuthDisconnect = await requestJson(baseUrl, "/v1/provider-auth/openai/disconnect", {
    method: "POST",
    body: JSON.stringify({})
  });
  assert(providerAuthDisconnect.success === true, "provider-auth disconnect did not report success");
  assert(providerAuthDisconnect.status === "revoked", "provider-auth disconnect did not return revoked status");

  const providerAuthCleared = await requestJson(baseUrl, "/v1/provider-auth/openai/status");
  assert(providerAuthCleared.configured === false, "provider-auth cleared status was unexpectedly configured");
  assert(providerAuthCleared.status === "login_unavailable", "provider-auth cleared status was not login_unavailable");

  const providerResponse = await requestJson(baseUrl, "/v1/providers", {
    method: "POST",
    body: JSON.stringify({
      id: providerId,
      kind: "openai-compatible",
      displayName: "Smoke OpenAI Compatible",
      enabled: true,
      baseUrl: `${mockProvider.baseUrl}/v1`,
      auth: { type: "api_key", apiKey: fakeApiKey },
      models: [{ id: "smoke-model", displayName: "Smoke Model" }],
      capabilities: { chat: true, completion: false, embeddings: false }
    })
  });
  assert(providerResponse.id === providerId, "provider create returned unexpected provider id");
  assert(providerResponse.auth?.configured === true, "provider create did not report configured auth");

  const subscription = subscribe(baseUrl, chatId);
  const commandResponse = await requestJson(baseUrl, `/v1/chats/${encodeURIComponent(chatId)}/commands`, {
    method: "POST",
    body: JSON.stringify({
      requestId: `smoke-command-${crypto.randomUUID()}`,
      type: "user_message",
      payload: { content: "Say hello from local smoke test." }
    })
  });
  assert(commandResponse.accepted === true, "chat command was not accepted");

  const { events, raw } = await subscription;
  assert(events[0]?.type === "snapshot" && events[0]?.seq === 0, "SSE did not start with snapshot");
  assert(events.some((event) => event.type === "stream_started"), "SSE stream_started event was not received");
  assert(events.some((event) => event.type === "stream_delta" && event.payload?.delta?.content === "Hello"), "SSE Hello delta was not received");
  assert(events.some((event) => event.type === "stream_delta" && event.payload?.delta?.content === " smoke"), "SSE smoke delta was not received");
  assert(events.some((event) => event.type === "stream_finished"), "SSE stream_finished event was not received");
  assertMonotonicSequence(events);

  assert(providerAuth === `Bearer ${fakeApiKey}`, "mock provider did not receive bearer API key");
  const parsedProviderBody = JSON.parse(providerRequestBody);
  assert(parsedProviderBody.stream === true, "provider request was not streaming");
  assert(parsedProviderBody.model === "smoke-model", "provider request used unexpected model");

  const clientVisible = JSON.stringify({
    ping,
    caps,
    providerAuthStatus,
    providerAuthStart,
    providerAuthExchange,
    providerAuthConnected,
    providerAuthDisconnect,
    providerAuthCleared,
    providerResponse,
    commandResponse,
    events,
    raw
  });
  assert(!clientVisible.includes(fakeApiKey), "raw fake provider API key leaked to client-visible output");
  assert(!clientVisible.includes("fake-access-token"), "raw fake provider-auth access token leaked to client-visible output");
  assert(!clientVisible.includes("fake-refresh-token"), "raw fake provider-auth refresh token leaked to client-visible output");
  assert(!clientVisible.includes("mock-verifier"), "provider-auth PKCE verifier leaked to client-visible output");
  assert(!clientVisible.includes("mock-code-smoke"), "provider-auth exchange code leaked to client-visible output");

  console.log("Local smoke test passed.");
} finally {
  if (engine) {
    await stopProcess(engine);
  }
  if (mockProvider) {
    await closeServer(mockProvider.server);
  }
  if (tempHome) {
    await rm(tempHome, { recursive: true, force: true });
  }
}

async function makeTempHome() {
  const home = path.join(os.tmpdir(), `yet-ai-smoke-${process.pid}-${Date.now()}`);
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
      YET_AI_AUTH_TOKEN: token,
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
  child.on("exit", (code, signal) => {
    if (code !== null && code !== 0) {
      console.error(`Engine exited with code ${code}.`);
    } else if (signal && signal !== "SIGTERM") {
      console.error(`Engine exited with signal ${signal}.`);
    }
  });
  return child;
}

async function waitForEngine(baseUrl) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (engine.exitCode !== null) {
      throw new Error(`Engine exited before becoming ready.\n${engine.output()}`);
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
  throw new Error(`Engine did not become ready within ${timeoutMs}ms.\n${engine.output()}`);
}

async function startMockProvider() {
  const server = http.createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    providerAuth = request.headers.authorization;
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      providerRequestBody += chunk;
    });
    request.on("end", () => {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache"
      });
      response.write('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n');
      response.write('data: {"choices":[{"delta":{"content":" smoke"}}]}\n\n');
      response.end("data: [DONE]\n\n");
    });
  });
  await listen(server, "127.0.0.1", 0);
  const address = server.address();
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function requestJson(baseUrl, route, init = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...init,
    headers: {
      ...authHeaders(),
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers
    }
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Request ${route} failed with HTTP ${response.status}: ${text}`);
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
      if (read.timeout) {
        continue;
      }
      if (read.done) {
        break;
      }
      const chunk = decoder.decode(read.value, { stream: true });
      raw += chunk;
      buffer += chunk;
      const drained = drainSseFrames(buffer);
      buffer = drained.rest;
      for (const frame of drained.frames) {
        const event = parseSseFrame(frame);
        if (event) {
          events.push(event);
          if (event.type === "stream_finished") {
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
  throw new Error(`SSE stream did not finish within ${timeoutMs}ms. Events: ${JSON.stringify(events)}`);
}

function parseSseFrame(frame) {
  const data = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""));
  if (data.length === 0) {
    return null;
  }
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
  return { Authorization: `Bearer ${token}` };
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
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
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
  if (!condition) {
    throw new Error(message);
  }
}
