import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { mkdir, rm } from "node:fs/promises";

const rootDir = process.cwd();
const token = `provider-error-token-${randomUUID()}`;
const fakeApiKey = `sk-provider-error-secret-${randomUUID()}`;
const providerId = `provider-errors-${Date.now()}`;
const timeoutMs = 120_000;

const expectedMessages = {
  provider_unauthorized: "Provider credentials were rejected.",
  provider_rate_limited: "Provider rate limit or quota reached.",
  provider_context_too_large: "The request is too large for the selected model context window.",
  provider_invalid_request: "Provider rejected the request.",
  provider_upstream_error: "Provider service returned an error.",
  provider_malformed_stream: "Provider stream ended unexpectedly."
};

const scenarios = [
  {
    name: "401 unauthorized",
    status: 401,
    expectedCode: "provider_unauthorized",
    body: jsonBody({ error: { type: "invalid_api_key", message: "raw-provider-body sk-upstream-secret access_token=secret Bearer token Cookie: session /Users/example/private auth-code-secret request_body_secret_marker" } })
  },
  {
    name: "403 unauthorized",
    status: 403,
    expectedCode: "provider_unauthorized",
    body: jsonBody({ error: { message: "forbidden raw-provider-body sk-forbidden-secret authorization: Bearer secret /home/example/private" } })
  },
  {
    name: "429 rate limited",
    status: 429,
    expectedCode: "provider_rate_limited",
    body: jsonBody({ error: { type: "rate_limit_exceeded", message: "quota exhausted raw-provider-body sk-rate-secret" } })
  },
  {
    name: "413 context too large",
    status: 413,
    expectedCode: "provider_context_too_large",
    body: jsonBody({ error: { message: "payload too large raw-provider-body sk-413-secret" } })
  },
  {
    name: "400 context signal",
    status: 400,
    expectedCode: "provider_context_too_large",
    body: jsonBody({ error: { code: "context_length_exceeded", message: "maximum context length raw-provider-body sk-context-secret" } })
  },
  {
    name: "400 invalid request",
    status: 400,
    expectedCode: "provider_invalid_request",
    body: jsonBody({ error: { message: "bad request raw-provider-body sk-invalid-secret api_key=secret" } })
  },
  {
    name: "422 invalid request",
    status: 422,
    expectedCode: "provider_invalid_request",
    body: jsonBody({ error: { message: "unprocessable raw-provider-body sk-422-secret client_secret=secret" } })
  },
  {
    name: "500 upstream",
    status: 500,
    expectedCode: "provider_upstream_error",
    body: "raw-provider-body upstream exploded sk-500-secret Cookie: secret /Users/example/private"
  },
  {
    name: "503 upstream",
    status: 503,
    expectedCode: "provider_upstream_error",
    body: "raw-provider-body service unavailable sk-503-secret access_token=secret /home/example/private"
  },
  {
    name: "malformed SSE",
    status: 200,
    expectedCode: "provider_malformed_stream",
    body: "data: { not-json, raw-provider-body, api_key=secret, url=http://user:pass@127.0.0.1, /Users/example/private }\n\n"
  },
  {
    name: "stream error frame",
    status: 200,
    expectedCode: "provider_rate_limited",
    body: "data: {\"error\":{\"type\":\"rate_limit_exceeded\",\"message\":\"quota raw-provider-body sk-frame-secret access_token=secret Authorization: Bearer secret Cookie: secret /Users/example/private /home/example/private auth-code-secret request_body_secret_marker\"}}\n\n"
  }
];

let engine;
let mockProvider;
let tempHome;

try {
  tempHome = await makeTempHome();
  mockProvider = await startMockProvider(scenarios);
  const enginePort = await freePort();
  engine = startEngine(enginePort, tempHome);
  const baseUrl = `http://127.0.0.1:${enginePort}`;
  await waitForEngine(baseUrl);

  const ping = await requestJson(baseUrl, "/v1/ping");
  assert(ping.ready === true, "ping did not report ready runtime");
  assert(ping.productId === "yet-ai", "ping returned unexpected product identity");

  const created = await requestJson(baseUrl, "/v1/providers", {
    method: "POST",
    body: JSON.stringify({
      id: providerId,
      kind: "openai-compatible",
      displayName: "Provider Error Smoke",
      enabled: true,
      baseUrl: `${mockProvider.baseUrl}/v1`,
      auth: { type: "api_key", apiKey: fakeApiKey },
      models: [{ id: "provider-error-model", displayName: "Provider Error Model" }],
      capabilities: { chat: true, completion: false, embeddings: false }
    })
  });
  assert(created.id === providerId, "provider create returned unexpected provider id");
  assert(created.auth?.configured === true, "provider create did not report configured auth");
  assertNoForbiddenText(JSON.stringify(created), "provider create response");

  const clientVisible = { ping, created, cases: [] };
  for (const scenario of scenarios) {
    const chatId = `chat-provider-errors-${scenario.expectedCode.replaceAll("_", "-")}-${randomUUID()}`;
    const subscription = subscribe(baseUrl, chatId, { finishOnError: true });
    const command = await requestJson(baseUrl, `/v1/chats/${encodeURIComponent(chatId)}/commands`, {
      method: "POST",
      body: JSON.stringify({
        requestId: `req-${randomUUID()}`,
        type: "user_message",
        payload: { content: `Run provider error smoke scenario ${scenario.name}.` }
      })
    });
    assert(command.accepted === true, `${scenario.name}: chat command was not accepted`);

    const { events, raw } = await subscription;
    assert(events[0]?.type === "snapshot", `${scenario.name}: SSE did not start with snapshot`);
    assert(events.some((event) => event.type === "stream_started"), `${scenario.name}: SSE stream_started event was not received`);
    const error = events.find((event) => event.type === "error");
    assert(error, `${scenario.name}: SSE error event was not received`);
    const expectedMessage = expectedMessages[scenario.expectedCode];
    assert(error.payload?.code === scenario.expectedCode, `${scenario.name}: unexpected SSE error code ${error.payload?.code}`);
    assert(error.payload?.message === expectedMessage, `${scenario.name}: unexpected SSE error message`);
    assertNoForbiddenText(raw, `${scenario.name}: SSE output`);
    assertNoForbiddenText(JSON.stringify(events), `${scenario.name}: SSE events`);

    const history = await waitForChatMessages(baseUrl, chatId, 2);
    assert(history.chatId === chatId, `${scenario.name}: history returned unexpected chat id`);
    assert(history.messages?.[0]?.role === "user", `${scenario.name}: first history message was not user`);
    assert(history.messages?.[1]?.role === "error", `${scenario.name}: second history message was not error`);
    assert(history.messages?.[1]?.status === "error", `${scenario.name}: error history message was not marked error`);
    assert(history.messages?.[1]?.content === expectedMessage, `${scenario.name}: persisted error message was not stable`);
    assertNoForbiddenText(JSON.stringify(history), `${scenario.name}: persisted history`);

    clientVisible.cases.push({ command, events, raw, history });
  }

  assert(mockProvider.requestCount === scenarios.length, "mock provider did not receive the expected number of chat requests");
  assert(mockProvider.authHeaders.length === scenarios.length, "mock provider did not record every auth header");
  for (const auth of mockProvider.authHeaders) {
    assert(auth === `Bearer ${fakeApiKey}`, "mock provider did not receive the configured bearer key");
  }
  assertNoForbiddenText(JSON.stringify(clientVisible), "combined client-visible output");
  assertNoForbiddenText(engine.output(), "engine output");

  console.log("Provider error smoke test passed.");
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

function jsonBody(value) {
  return JSON.stringify(value);
}

async function makeTempHome() {
  const home = path.join(os.tmpdir(), `yet-ai-provider-errors-${process.pid}-${Date.now()}`);
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

async function startMockProvider(queuedScenarios) {
  let requestCount = 0;
  const authHeaders = [];
  const server = http.createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    const scenario = queuedScenarios[requestCount];
    requestCount += 1;
    authHeaders.push(request.headers.authorization);
    request.resume();
    request.on("end", () => {
      if (!scenario) {
        response.writeHead(500, { "content-type": "text/plain" });
        response.end("unexpected provider smoke request");
        return;
      }
      if (scenario.status === 200) {
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache"
        });
      } else {
        response.writeHead(scenario.status, { "content-type": "application/json" });
      }
      response.end(scenario.body);
    });
  });
  await listen(server, "127.0.0.1", 0);
  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    authHeaders,
    get requestCount() {
      return requestCount;
    }
  };
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
    throw new Error(`Request ${route} returned unexpected HTTP status ${response.status}`);
  }
  return JSON.parse(text);
}

async function waitForChatMessages(baseUrl, chatId, count) {
  for (let index = 0; index < 60; index += 1) {
    const history = await requestJson(baseUrl, `/v1/chats/${encodeURIComponent(chatId)}`);
    if (Array.isArray(history.messages) && history.messages.length >= count) {
      return history;
    }
    await delay(50);
  }
  throw new Error(`Chat history did not reach ${count} messages for scenario chat`);
}

async function subscribe(baseUrl, id, options = {}) {
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
          if (event.type === "stream_finished" || (options.finishOnError && event.type === "error")) {
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

function authHeaders() {
  return { Authorization: `Bearer ${token}` };
}

function appendNoProxy(value) {
  const entries = new Set(
    String(value ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
  for (const entry of ["127.0.0.1", "localhost", "::1"]) {
    entries.add(entry);
  }
  return [...entries].join(",");
}

function assertNoForbiddenText(text, label) {
  const lower = String(text).toLowerCase();
  const markers = [
    { label: "runtime token", value: token },
    { label: "provider API key", value: fakeApiKey },
    { label: "raw provider body marker", value: "raw-provider-body" },
    { label: "raw unauthorized secret", value: "sk-upstream-secret" },
    { label: "raw forbidden secret", value: "sk-forbidden-secret" },
    { label: "raw rate secret", value: "sk-rate-secret" },
    { label: "raw 413 secret", value: "sk-413-secret" },
    { label: "raw context secret", value: "sk-context-secret" },
    { label: "raw invalid secret", value: "sk-invalid-secret" },
    { label: "raw 422 secret", value: "sk-422-secret" },
    { label: "raw 500 secret", value: "sk-500-secret" },
    { label: "raw 503 secret", value: "sk-503-secret" },
    { label: "raw frame secret", value: "sk-frame-secret" },
    { label: "bearer marker", value: "bearer " },
    { label: "authorization marker", value: "authorization" },
    { label: "access token marker", value: "access_token" },
    { label: "refresh token marker", value: "refresh_token" },
    { label: "api key secret marker", value: "api_key=secret" },
    { label: "client secret marker", value: "client_secret" },
    { label: "cookie marker", value: "cookie" },
    { label: "auth code marker", value: "auth-code-secret" },
    { label: "request body secret marker", value: "request_body_secret_marker" },
    { label: "private macOS path marker", value: "/users/example" },
    { label: "private Linux path marker", value: "/home/example" },
    { label: "userinfo marker", value: "user:pass@" },
    { label: "invalid API key raw type", value: "invalid_api_key" },
    { label: "rate limit raw type", value: "rate_limit_exceeded" },
    { label: "context raw code", value: "context_length_exceeded" },
    { label: "quota raw text", value: "quota exhausted" },
    { label: "upstream raw text", value: "upstream exploded" }
  ];
  for (const marker of markers) {
    assert(!lower.includes(marker.value.toLowerCase()), `${label}: forbidden marker leaked: ${marker.label}`);
  }
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
