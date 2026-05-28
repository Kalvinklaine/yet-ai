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
let mockCodexTokenEndpoint;
let mockCodexChatEndpoint;
let tempHome;
let providerAuth;
let providerRequestBody = "";
let codexTokenRequestBody = "";
let codexTokenRequestCount = 0;
let codexChatAuth;
let codexChatRequestBody = "";
let codexChatRequestCount = 0;

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

  mockCodexTokenEndpoint = await startMockCodexTokenEndpoint();
  mockCodexChatEndpoint = await startMockCodexChatEndpoint();
  const codexStart = await requestJson(baseUrl, "/v1/provider-auth/openai/start", {
    method: "POST",
    body: JSON.stringify({
      experimentalCodexLike: true,
      tokenEndpointUrl: mockCodexTokenEndpoint.url,
      chatEndpointUrl: mockCodexChatEndpoint.baseUrl
    })
  });
  assert(codexStart.status === "pending", "experimental Codex-like start did not return pending status");
  assert(codexStart.authSource === "oauth", "experimental Codex-like start did not use oauth auth source");
  assert(codexStart.supportsLogin === true, "experimental Codex-like start did not support login");
  assert(codexStart.cloudRequired === false, "experimental Codex-like start unexpectedly requires cloud");
  assert(codexStart.authorizationUrl?.startsWith("https://auth.openai.com/oauth/authorize?"), "experimental Codex-like start returned unexpected authorization URL");
  assert(typeof codexStart.sessionId === "string" && codexStart.sessionId.startsWith("codex-"), "experimental Codex-like start did not return a Codex-like session id");
  assert(String(codexStart.message ?? "").includes("Experimental Codex-like"), "experimental Codex-like start did not return risk message");
  const codexAuthorizeUrl = new URL(codexStart.authorizationUrl);
  const codexState = codexAuthorizeUrl.searchParams.get("state");
  const codexChallenge = codexAuthorizeUrl.searchParams.get("code_challenge");
  assert(typeof codexState === "string" && codexState.length > 20, "experimental Codex-like start did not return state");
  assert(typeof codexChallenge === "string" && codexChallenge.length > 20, "experimental Codex-like start did not return PKCE challenge");
  assert(codexStart.sessionId !== codexState, "experimental Codex-like session id and state were not distinct");
  assert(codexStart.sessionId !== codexChallenge, "experimental Codex-like session id and challenge were not distinct");
  assert(codexState !== codexChallenge, "experimental Codex-like state and challenge were not distinct");

  const codexExchange = await requestJson(baseUrl, "/v1/provider-auth/openai/exchange", {
    method: "POST",
    body: JSON.stringify({
      sessionId: codexStart.sessionId,
      state: codexState,
      code: "codex-code-smoke-secret"
    })
  });
  assert(codexExchange.configured === true, "experimental Codex-like exchange did not configure auth");
  assert(codexExchange.status === "connected", "experimental Codex-like exchange did not return connected status");
  assert(codexExchange.authSource === "oauth", "experimental Codex-like exchange did not use oauth auth source");
  assert(codexExchange.accountLabel === "smoke-user@example.test", "experimental Codex-like exchange returned unexpected account label");
  assert(codexExchange.cloudRequired === false, "experimental Codex-like exchange unexpectedly requires cloud");

  assert(codexTokenRequestCount === 1, "experimental Codex-like exchange did not call mock token endpoint exactly once");
  const parsedCodexTokenBody = JSON.parse(codexTokenRequestBody);
  assert(parsedCodexTokenBody.grant_type === "authorization_code", "experimental Codex-like exchange used unexpected grant type");
  assert(parsedCodexTokenBody.code === "codex-code-smoke-secret", "experimental Codex-like exchange did not send auth code to mock token endpoint");
  assert(typeof parsedCodexTokenBody.code_verifier === "string" && parsedCodexTokenBody.code_verifier.length > 20, "experimental Codex-like exchange did not send PKCE verifier to mock token endpoint");
  assert(parsedCodexTokenBody.code_verifier !== codexState, "experimental Codex-like verifier reused state");
  assert(parsedCodexTokenBody.code_verifier !== codexChallenge, "experimental Codex-like verifier reused challenge");

  const codexStatus = await requestJson(baseUrl, "/v1/provider-auth/openai/status");
  assert(codexStatus.configured === true, "experimental Codex-like status was not configured");
  assert(codexStatus.status === "connected", "experimental Codex-like status was not connected");
  assert(codexStatus.authSource === "oauth", "experimental Codex-like status did not use oauth auth source");
  assert(codexStatus.sessionId === undefined, "experimental Codex-like connected status exposed session id");
  assert(codexStatus.authorizationUrl === undefined, "experimental Codex-like connected status exposed authorization URL");
  assert(codexStatus.redacted === "co...et", "experimental Codex-like connected status returned unexpected redacted hint");
  assert(codexStatus.accountLabel === "smoke-user@example.test", "experimental Codex-like connected status returned unexpected account label");

  const codexChatId = `smoke-codex-chat-${crypto.randomUUID()}`;
  const codexSubscription = subscribe(baseUrl, codexChatId);
  const codexCommandResponse = await requestJson(baseUrl, `/v1/chats/${encodeURIComponent(codexChatId)}/commands`, {
    method: "POST",
    body: JSON.stringify({
      requestId: `smoke-codex-command-${crypto.randomUUID()}`,
      type: "user_message",
      payload: { content: "Say hello through experimental mock OAuth." }
    })
  });
  assert(codexCommandResponse.accepted === true, "experimental Codex-like chat command was not accepted");

  const { events: codexEvents, raw: codexRaw } = await codexSubscription;
  assert(codexEvents[0]?.type === "snapshot" && codexEvents[0]?.seq === 0, "experimental Codex-like SSE did not start with snapshot");
  assert(codexEvents[0]?.payload?.thread?.id === codexChatId, "experimental Codex-like SSE snapshot used unexpected chat id");
  assert(codexEvents[0]?.payload?.runtime?.streaming === false, "experimental Codex-like SSE snapshot did not expose non-streaming initial state");
  assert(codexEvents[1]?.type === "stream_started" && codexEvents[1]?.payload?.role === "assistant", "experimental Codex-like SSE stream_started event was not received");
  assert(codexEvents[2]?.type === "stream_delta" && codexEvents[2]?.payload?.delta?.content === "OAuth", "experimental Codex-like SSE OAuth delta was not received");
  assert(codexEvents[3]?.type === "stream_delta" && codexEvents[3]?.payload?.delta?.content === " smoke", "experimental Codex-like SSE smoke delta was not received");
  assert(codexEvents[4]?.type === "stream_finished" && codexEvents[4]?.payload?.finishReason === "stop", "experimental Codex-like SSE stream_finished event was not received");
  assert(codexEvents.length === 5, "experimental Codex-like SSE produced unexpected extra events");
  assertMonotonicSequence(codexEvents);

  assert(codexChatRequestCount === 1, "experimental Codex-like mock chat endpoint was not called exactly once");
  assert(codexChatAuth === "Bearer codex-smoke-access-token-secret", "experimental Codex-like mock chat did not receive bearer OAuth token");
  const parsedCodexChatBody = JSON.parse(codexChatRequestBody);
  assert(parsedCodexChatBody.stream === true, "experimental Codex-like chat request was not streaming");
  assert(parsedCodexChatBody.model === "gpt-5-codex", "experimental Codex-like chat request used unexpected model");
  assert(parsedCodexChatBody.messages?.[0]?.role === "user", "experimental Codex-like chat request did not send user role");
  assert(parsedCodexChatBody.messages?.[0]?.content === "Say hello through experimental mock OAuth.", "experimental Codex-like chat request did not send first message content");

  const codexDisconnect = await requestJson(baseUrl, "/v1/provider-auth/openai/disconnect", {
    method: "POST",
    body: JSON.stringify({})
  });
  assert(codexDisconnect.success === true, "experimental Codex-like disconnect did not report success");
  assert(codexDisconnect.status === "revoked", "experimental Codex-like disconnect did not return revoked status");
  assert(codexDisconnect.authSource === "none", "experimental Codex-like disconnect did not return sanitized auth source");
  assert(codexDisconnect.sessionId === undefined, "experimental Codex-like disconnect exposed session id");
  assert(codexDisconnect.authorizationUrl === undefined, "experimental Codex-like disconnect exposed authorization URL");
  assert(codexDisconnect.redacted === undefined, "experimental Codex-like disconnect exposed redacted credential hint");

  const codexClearedStatus = await requestJson(baseUrl, "/v1/provider-auth/openai/status");
  assert(codexClearedStatus.configured === false, "experimental Codex-like cleared status was unexpectedly configured");
  assert(codexClearedStatus.status === "login_unavailable", "experimental Codex-like cleared status was not login_unavailable");
  assert(codexClearedStatus.authSource === "none", "experimental Codex-like cleared status did not return sanitized auth source");

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
    codexStart,
    codexExchange,
    codexStatus,
    codexCommandResponse,
    codexEvents,
    codexRaw,
    codexDisconnect,
    codexClearedStatus,
    providerResponse,
    commandResponse,
    events,
    raw
  });
  const secretMarkers = [
    { label: "runtime token", value: token },
    { label: "provider API key", value: fakeApiKey },
    { label: "mock access token", value: "fake-access-token" },
    { label: "mock refresh token", value: "fake-refresh-token" },
    { label: "mock verifier", value: "mock-verifier" },
    { label: "mock auth code", value: "mock-code-smoke" },
    { label: "Codex-like access token", value: "codex-smoke-access-token-secret" },
    { label: "Codex-like refresh token", value: "codex-smoke-refresh-token-secret" },
    { label: "Codex-like auth code", value: "codex-code-smoke-secret" },
    { label: "Codex-like PKCE verifier", value: parsedCodexTokenBody.code_verifier },
    { label: "authorization header marker", value: "authorization: bearer" },
    { label: "Codex-like bearer marker", value: "bearer codex-smoke-access-token-secret" },
    { label: "cookie marker", value: "cookie" },
    { label: "auth file marker", value: "auth.json" },
    { label: "Codex auth file marker", value: ".codex/auth.json" },
    { label: "client secret marker", value: "client_secret" },
    { label: "authorization code marker", value: "authorization_code" }
  ];
  const logSecretMarkers = [
    ...secretMarkers,
    { label: "Codex-like session id", value: codexStart.sessionId },
    { label: "Codex-like state", value: codexState },
    { label: "Codex-like challenge", value: codexChallenge }
  ];
  assertNoSecretLeak(clientVisible, secretMarkers);
  assertNoSecretLeak(engine.output(), logSecretMarkers);

  console.log("Local smoke test passed.");
} finally {
  if (engine) {
    await stopProcess(engine);
  }
  if (mockProvider) {
    await closeServer(mockProvider.server);
  }
  if (mockCodexTokenEndpoint) {
    await closeServer(mockCodexTokenEndpoint.server);
  }
  if (mockCodexChatEndpoint) {
    await closeServer(mockCodexChatEndpoint.server);
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

async function startMockCodexTokenEndpoint() {
  const server = http.createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/oauth/token") {
      response.writeHead(404).end();
      return;
    }
    codexTokenRequestCount += 1;
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      codexTokenRequestBody += chunk;
    });
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        access_token: "codex-smoke-access-token-secret",
        refresh_token: "codex-smoke-refresh-token-secret",
        expires_in: 1800,
        scope: "openid profile email offline_access",
        account_label: "smoke-user@example.test"
      }));
    });
  });
  await listen(server, "127.0.0.1", 0);
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}/oauth/token` };
}

async function startMockCodexChatEndpoint() {
  const server = http.createServer((request, response) => {
    if (request.method !== "POST" || !["/chat/completions", "/v1/chat/completions"].includes(request.url)) {
      response.writeHead(404).end();
      return;
    }
    codexChatRequestCount += 1;
    codexChatAuth = request.headers.authorization;
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      codexChatRequestBody += chunk;
    });
    request.on("end", () => {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache"
      });
      response.write('data: {"choices":[{"delta":{"content":"OAuth"}}]}\n\n');
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

function assertNoSecretLeak(text, markers) {
  const lower = text.toLowerCase();
  for (const marker of markers) {
    if (!marker?.value) {
      continue;
    }
    assert(!lower.includes(String(marker.value).toLowerCase()), `secret marker leaked to client-visible output: ${marker.label}`);
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
