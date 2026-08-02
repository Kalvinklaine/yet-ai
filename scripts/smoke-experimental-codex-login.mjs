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
const refreshedAccessToken = `codex-loopback-refreshed-access-${randomUUID()}`;
const refreshToken = `codex-loopback-refresh-${randomUUID()}`;
const accountId = "acct-loopback-smoke";
const idToken = jwtWithPayload({ chatgpt_account_id: accountId });
let chatId;
const invalidChatId = `smoke_codex_invalid_${randomUUID().replaceAll("-", "_")}`;
const requestId = `smoke-codex-request-${randomUUID()}`;
const invalidRequestId = `smoke-codex-invalid-request-${randomUUID()}`;
const firstChatSentinel = "SMOKE_CODEX_FIRST_CHAT";
const invalidChatSentinel = "SMOKE_CODEX_INVALID_CHAT";
const fixedModel = "gpt-5.4";
const invalidProviderFragment = `raw-mock-provider-fragment-${randomUUID()}`;
const timeoutMs = 120_000;

let engine;
let tempHome;
let tokenEndpoint;
let chatEndpoint;
let tokenRequestCount = 0;
let chatRequestCount = 0;
let modelDiscoveryRequestCount = 0;
let chatCreateRequestCount = 0;
const tokenRequestGrantTypes = [];
let tokenRequestContentType;
const chatAuthorizationHeaders = [];
let chatAccountHeaderSeen = false;
let chatOriginatorHeader;
let chatSessionHeader;
let chatBetaHeader;
let chatAcceptHeader;
let chatContentTypeHeader;
const chatRequestBodies = [];

try {
  tempHome = await makeTempHome();
  tokenEndpoint = await startMockTokenEndpoint();
  chatEndpoint = await startMockChatEndpoint();
  const enginePort = await freePort();
  const callbackPort = await freePort();
  engine = startEngine(enginePort, callbackPort, tempHome);
  const baseUrl = `http://127.0.0.1:${enginePort}`;
  await waitForEngine(baseUrl);

  const existingChat = await requestJson(baseUrl, "/v1/chats", { method: "POST" });
  chatId = existingChat.chatId;
  assert(typeof chatId === "string" && chatId.startsWith("chat_"), "pre-login chat creation returned an invalid chat id");
  assert(chatCreateRequestCount === 1, "pre-login chat was not created exactly once");

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
  assert(tokenRequestCount === 1, "mock token endpoint was not called exactly once during login");
  assert(tokenRequestContentType?.startsWith("application/x-www-form-urlencoded"), "mock token endpoint did not receive form-urlencoded exchange");
  assert(tokenRequestGrantTypes[0] === "authorization_code", "mock token endpoint did not receive authorization-code grant");
  assert(modelDiscoveryRequestCount === 0, "login unexpectedly called model discovery");

  const connected = await requestJson(baseUrl, "/v1/provider-auth/openai/status");
  assert(connected.status === "connected", "status did not report connected state");
  assert(connected.configured === true, "connected status was not configured");
  assert(connected.accountLabel === "loopback codex smoke account", "connected status returned unexpected account label");
  assert(chatCreateRequestCount === 1, "login created a replacement chat");

  const sameChat = await requestJson(baseUrl, `/v1/chats/${encodeURIComponent(chatId)}`);
  assert(sameChat.chatId === chatId, "login did not preserve the pre-login chat id");

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
  assert(chatRequestCount === 2, "mock responses endpoint did not perform exactly one bounded auth retry");
  assert(tokenRequestCount === 2, "expired account auth did not refresh exactly once");
  assert(tokenRequestGrantTypes[1] === "refresh_token", "mock token endpoint did not receive refresh-token grant");
  assert(modelDiscoveryRequestCount === 0, "send or auth refresh unexpectedly called model discovery");
  assert(chatCreateRequestCount === 1, "auth refresh created a replacement chat");
  assert(chatAuthorizationHeaders[0] === `Bearer ${accessToken}`, "first responses request did not receive original bearer auth");
  assert(chatAuthorizationHeaders[1] === `Bearer ${refreshedAccessToken}`, "retried responses request did not receive refreshed bearer auth");
  assert(chatAccountHeaderSeen === true, "mock responses endpoint did not receive account metadata header");
  assert(chatOriginatorHeader === "codex_cli_rs", "mock responses endpoint received unexpected originator header");
  assert(chatSessionHeader === chatId, "mock responses endpoint received unexpected session header");
  assert(chatBetaHeader === "responses=experimental", "mock responses endpoint received unexpected beta header");
  assert(chatAcceptHeader === "text/event-stream", "mock responses endpoint received unexpected accept header");
  assert(chatContentTypeHeader?.startsWith("application/json"), "mock responses endpoint did not receive JSON content type");
  assertResponsesBody(chatRequestBodies[0], firstChatSentinel, fixedModel);
  assertResponsesBody(chatRequestBodies[1], firstChatSentinel, fixedModel);
  assert(chatRequestBodies.every((body) => body.model === fixedModel), "auth recovery changed the fixed account model");

  const invalidSubscription = subscribe(baseUrl, invalidChatId);
  const invalidCommand = await requestJson(baseUrl, `/v1/chats/${encodeURIComponent(invalidChatId)}/commands`, {
    method: "POST",
    body: JSON.stringify({
      requestId: invalidRequestId,
      type: "user_message",
      payload: { content: invalidChatSentinel }
    })
  });
  assert(invalidCommand.accepted === true, "invalid-request chat command was not accepted");

  const invalidStream = await invalidSubscription;
  const invalidEvent = invalidStream.events.find((event) => event.type === "error");
  assert(invalidEvent?.payload?.code === "experimental_account_model_unavailable", "fixed-model rejection did not produce the stable account-model error code");
  assert(invalidEvent?.payload?.message === "The fixed experimental account model is temporarily unavailable. Retry later, reconnect the account login, or use the API-key fallback.", "fixed-model rejection did not provide truthful sanitized recovery");
  assert(invalidEvent?.payload?.reason === undefined, "fixed-model rejection exposed a generic model-selection reason");
  assertMonotonicSequence(invalidStream.events);
  assert(chatRequestCount === 3, "mock responses endpoint was not called for auth retry and fixed-model rejection cases");
  assertResponsesBody(chatRequestBodies[2], invalidChatSentinel, fixedModel);
  assert(chatRequestBodies.filter((body) => body.input[0]?.content[0]?.text === invalidChatSentinel).length === 1, "fixed-model rejection was retried");
  assert(modelDiscoveryRequestCount === 0, "fixed-model rejection unexpectedly called model discovery");
  assert(chatCreateRequestCount === 1, "later chat command created a replacement chat");
  assert(!invalidStream.raw.includes(invalidProviderFragment), "raw mock provider body leaked into live SSE");

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
    tokenExchange: "form-urlencoded-authorization-code",
    fixedModel: "gpt-5.4-without-discovery-or-alternate-persistence",
    responsesSse: "dedicated-responses-endpoint",
    tokenEndpointCalls: tokenRequestCount,
    modelDiscoveryCalls: modelDiscoveryRequestCount,
    responsesEndpointCalls: chatRequestCount,
    existingChat: "created-before-login-and-reused-without-replacement",
    firstChat: "same-pre-login-chat-auth-refreshed-once-with-fixed-model",
    chatCreateCalls: chatCreateRequestCount,
    fixedModelUnavailable: "one-terminal-request-with-sanitized-manual-recovery",
    disconnected: afterDisconnect.status === "login_unavailable",
    cloudRequired: false
  };
  const report = JSON.stringify(evidence, null, 2);
  assertNoUnsafeEvidence(report);
  assertNoUnsafeEvidence(raw);
  assertNoUnsafeEvidence(invalidStream.raw);
  assertNoUnsafeEvidence(engine.output());
  console.log("Experimental Codex-like login smoke passed.");
  console.log(report);
} finally {
  if (engine) await stopProcess(engine);
  if (tokenEndpoint) await closeServer(tokenEndpoint.server);
  if (chatEndpoint) await closeServer(chatEndpoint.server);
  if (tempHome) await rm(tempHome, { recursive: true, force: true });
}

function jwtWithPayload(payload) {
  return `${base64UrlJson({ alg: "none" })}.${base64UrlJson(payload)}.signature`;
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

async function makeTempHome() {
  const home = path.join(os.tmpdir(), `yet-ai-codex-login-smoke-${process.pid}-${Date.now()}`);
  await mkdir(path.join(home, "Library", "Application Support"), { recursive: true });
  await mkdir(path.join(home, ".config"), { recursive: true });
  await mkdir(path.join(home, ".cache"), { recursive: true });
  return home;
}

function startEngine(port, callbackPort, home) {
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
      YET_AI_HTTP_PORT: String(port),
      YET_AI_PROVIDER_AUTH_CALLBACK_PORT: String(callbackPort)
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
    tokenRequestContentType = request.headers["content-type"];
    request.setEncoding("utf8");
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const parsed = new URLSearchParams(body);
      const grantType = parsed.get("grant_type");
      tokenRequestGrantTypes.push(grantType);
      assert(typeof parsed.get("client_id") === "string" && parsed.get("client_id").length > 10, "mock token endpoint did not receive client id");
      if (grantType === "authorization_code") {
        assert(parsed.get("code") === authCode, "mock token endpoint received unexpected auth code");
        assert(typeof parsed.get("code_verifier") === "string" && parsed.get("code_verifier").length > 20, "mock token endpoint did not receive PKCE verifier");
      } else {
        assert(grantType === "refresh_token", "mock token endpoint received unexpected grant type");
        assert(parsed.get("refresh_token") === refreshToken, "mock token endpoint received unexpected refresh token");
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        access_token: grantType === "refresh_token" ? refreshedAccessToken : accessToken,
        refresh_token: refreshToken,
        expires_in: 1800,
        scope: "openid profile email offline_access",
        id_token: idToken,
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
    if (request.method === "GET" && request.url?.startsWith("/models?")) {
      modelDiscoveryRequestCount += 1;
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "model discovery is forbidden in this smoke" }));
      return;
    }
    if (request.method !== "POST" || request.url !== "/responses") {
      response.writeHead(404).end();
      return;
    }
    chatRequestCount += 1;
    chatAuthorizationHeaders.push(request.headers.authorization);
    chatAccountHeaderSeen = request.headers["chatgpt-account-id"] === accountId;
    chatOriginatorHeader = request.headers.originator;
    chatSessionHeader = request.headers.session_id;
    chatBetaHeader = request.headers["openai-beta"];
    chatAcceptHeader = request.headers.accept;
    chatContentTypeHeader = request.headers["content-type"];
    request.setEncoding("utf8");
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const parsed = JSON.parse(body);
      chatRequestBodies.push(parsed);
      if (chatRequestCount === 1) {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({
          error: {
            code: "expired_token",
            message: `credential expired ${invalidProviderFragment}`
          }
        }));
        return;
      }
      if (chatRequestCount === 3) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({
          error: {
            code: "unsupported_model",
            message: `model is not supported ${invalidProviderFragment}`
          }
        }));
        return;
      }
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache"
      });
      response.write('data: {"type":"response.output_text.delta","delta":"Loopback"}\n\n');
      response.write('data: {"type":"response.output_text.delta","delta":" connected"}\n\n');
      response.end('data: {"type":"response.completed"}\n\n');
    });
  });
  await listen(server, "127.0.0.1", 0);
  const address = server.address();
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

function assertResponsesBody(body, expectedText, expectedModel) {
  assert(body && typeof body === "object" && !Array.isArray(body), "mock responses endpoint did not receive an object body");
  assert(JSON.stringify(Object.keys(body).sort()) === JSON.stringify(["input", "instructions", "model", "store", "stream"]), "mock responses endpoint received incompatible fields");
  assert(body.model === expectedModel, "mock responses endpoint did not use the expected safe model");
  assert(typeof body.instructions === "string" && body.instructions.trim().length > 0, "mock responses endpoint received empty instructions");
  assert(body.store === false, "mock responses endpoint did not disable storage");
  assert(body.stream === true, "mock responses endpoint did not request streaming");
  assert(body.input?.length === 1, "mock responses endpoint received unexpected input count");
  assert(body.input[0]?.role === "user", "mock responses endpoint received unexpected input role");
  assert(body.input[0]?.content?.length === 1, "mock responses endpoint received unexpected content count");
  assert(body.input[0].content[0]?.type === "input_text", "mock responses endpoint received unexpected content type");
  assert(body.input[0].content[0]?.text === expectedText, "mock responses endpoint received unexpected user input");
}

async function requestJson(baseUrl, route, init = {}) {
  const { expectedStatus, ...fetchInit } = init;
  if (route === "/v1/chats" && init.method === "POST") chatCreateRequestCount += 1;
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
    refreshedAccessToken,
    refreshToken,
    idToken,
    accountId,
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
    firstChatSentinel,
    invalidChatSentinel,
    invalidProviderFragment
  ];
  for (const marker of forbidden) {
    assert(!lower.includes(String(marker).toLowerCase()), `unsafe evidence marker leaked: ${marker}`);
  }
}

function redactUnsafe(text) {
  let value = String(text);
  for (const marker of [runtimeToken, authCode, accessToken, refreshedAccessToken, refreshToken, idToken, accountId, firstChatSentinel, invalidChatSentinel, invalidProviderFragment]) {
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
