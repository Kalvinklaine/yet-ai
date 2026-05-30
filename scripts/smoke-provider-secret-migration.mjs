import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";

const rootDir = process.cwd();
const token = `smoke-provider-secret-token-${randomUUID()}`;
const migratedProviderId = `smoke-migrated-${Date.now()}`;
const storedWinsProviderId = `smoke-stored-wins-${Date.now()}`;
const migratedInlineKey = `sk-smoke-migrated-${randomUUID()}`;
const storedWinsInlineKey = `sk-smoke-inline-loser-${randomUUID()}`;
const storedWinsStoredKey = `sk-smoke-stored-winner-${randomUUID()}`;
const timeoutMs = 120_000;

let engine;
let mockProvider;
let tempHome;
let migratedProviderAuth;
let storedWinsProviderAuth;
let providerRequestCount = 0;

try {
  tempHome = await makeTempHome();
  mockProvider = await startMockProvider();
  await seedLegacyProvider(tempHome, migratedProviderId, migratedInlineKey, mockProvider.baseUrl);
  await seedLegacyProvider(tempHome, storedWinsProviderId, storedWinsInlineKey, mockProvider.baseUrl);
  await seedStoredSecret(tempHome, storedWinsProviderId, storedWinsStoredKey);

  const enginePort = await freePort();
  engine = startEngine(enginePort, tempHome);
  const baseUrl = `http://127.0.0.1:${enginePort}`;
  await waitForEngine(baseUrl);

  const models = await requestJson(baseUrl, "/v1/models");
  const migratedModel = models.models?.find((model) => model.providerId === migratedProviderId);
  const storedWinsModel = models.models?.find((model) => model.providerId === storedWinsProviderId);
  assert(migratedModel?.readiness?.status === "ready", "migrated provider model was not ready");
  assert(storedWinsModel?.readiness?.status === "ready", "stored-key-wins provider model was not ready");

  const registry = await requestJson(baseUrl, "/v1/providers");
  assert(registry.cloudRequired === false, "provider registry unexpectedly required cloud");
  assert(registry.providerAccess === "direct", "provider registry did not report direct provider access");
  assertSanitizedProvider(registry, migratedProviderId);
  assertSanitizedProvider(registry, storedWinsProviderId);

  await assertLegacyConfigScrubbed(tempHome, migratedProviderId, migratedInlineKey);
  await assertLegacyConfigScrubbed(tempHome, storedWinsProviderId, storedWinsInlineKey);
  await assertSecretFileExists(tempHome, migratedProviderId);
  await assertSecretFileExists(tempHome, storedWinsProviderId);

  const migratedTest = await requestJson(baseUrl, `/v1/providers/${encodeURIComponent(migratedProviderId)}/test`, { method: "POST" });
  assert(migratedTest.ok === true, "migrated provider test did not pass");
  assert(migratedTest.status === "reachable", "migrated provider test was not reachable");
  assertBearerMatches(migratedProviderAuth, migratedInlineKey, "migrated provider authorization");

  const storedWinsTest = await requestJson(baseUrl, `/v1/providers/${encodeURIComponent(storedWinsProviderId)}/test`, { method: "POST" });
  assert(storedWinsTest.ok === true, "stored-key-wins provider test did not pass");
  assert(storedWinsTest.status === "reachable", "stored-key-wins provider test was not reachable");
  assertBearerMatches(storedWinsProviderAuth, storedWinsStoredKey, "stored-key-wins provider authorization");
  assertBearerDoesNotMatch(storedWinsProviderAuth, storedWinsInlineKey, "stored-key-wins provider authorization used legacy inline key");

  const migratedConfigText = await readProviderConfigText(tempHome, migratedProviderId);
  const storedWinsConfigText = await readProviderConfigText(tempHome, storedWinsProviderId);
  const migratedSecret = JSON.parse(await readSecretText(tempHome, migratedProviderId));
  const storedWinsSecret = JSON.parse(await readSecretText(tempHome, storedWinsProviderId));
  assertSecretRecordMatches(migratedSecret, migratedInlineKey, "migrated secret store record");
  assertSecretRecordMatches(storedWinsSecret, storedWinsStoredKey, "stored-key-wins secret store record");
  assertSecretRecordDoesNotMatch(storedWinsSecret, storedWinsInlineKey, "stored-key-wins secret store record used legacy inline key");
  const clientVisible = JSON.stringify({ models, registry, migratedTest, storedWinsTest });
  const markers = [
    { label: "runtime token", value: token },
    { label: "migrated inline key", value: migratedInlineKey },
    { label: "stored-wins inline key", value: storedWinsInlineKey },
    { label: "stored-wins stored key", value: storedWinsStoredKey },
    { label: "authorization bearer marker", value: `Bearer ${migratedInlineKey}` },
    { label: "stored authorization bearer marker", value: `Bearer ${storedWinsStoredKey}` }
  ];
  assertNoSecretLeak(clientVisible, markers);
  assertNoSecretLeak(migratedConfigText, markers);
  assertNoSecretLeak(storedWinsConfigText, markers);
  assertNoSecretLeak(engine.output(), markers);
  assertNoSecretLeak(mockProvider.output(), markers);
  assert(providerRequestCount === 2, "mock provider did not observe both provider tests");

  console.log("Provider secret migration smoke passed.");
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
  const home = path.join(os.tmpdir(), `yet-ai-provider-secret-smoke-${process.pid}-${Date.now()}`);
  await mkdir(path.join(home, "Library", "Application Support"), { recursive: true });
  await mkdir(configDir(home), { recursive: true });
  await mkdir(path.join(home, ".cache"), { recursive: true });
  return home;
}

function configDir(home) {
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "yet-ai");
  }
  return path.join(home, ".config", "yet-ai");
}

function providerConfigPath(home, providerId) {
  return path.join(configDir(home), "providers.d", `${providerId}.json`);
}

function secretPath(home, providerId) {
  return path.join(configDir(home), "provider-secrets", providerId, "api-key.json");
}

async function seedLegacyProvider(home, providerId, apiKey, baseUrl) {
  const filePath = providerConfigPath(home, providerId);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify({
    id: providerId,
    kind: "openai-compatible",
    displayName: `Smoke Provider ${providerId}`,
    enabled: true,
    baseUrl: `${baseUrl}/v1`,
    auth: { type: "api_key", apiKey },
    models: [{ id: "smoke-model", displayName: "Smoke Model" }],
    capabilities: { chat: true, completion: false, embeddings: false }
  }, null, 2)}\n`, { mode: 0o600 });
}

async function seedStoredSecret(home, providerId, value) {
  const filePath = secretPath(home, providerId);
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await writeFile(filePath, `${JSON.stringify({ kind: "api_key", value }, null, 2)}\n`, { mode: 0o600 });
}

async function assertLegacyConfigScrubbed(home, providerId, rawKey) {
  const text = await readProviderConfigText(home, providerId);
  assert(!text.includes(rawKey), `legacy provider config still contains raw key for ${providerId}`);
  const parsed = JSON.parse(text);
  assert(parsed.auth?.type === "api_key", `legacy provider config lost auth type for ${providerId}`);
  assert(parsed.auth?.apiKey === undefined, `legacy provider config still contains apiKey field for ${providerId}`);
}

async function assertSecretFileExists(home, providerId) {
  const metadata = await stat(secretPath(home, providerId));
  assert(metadata.isFile(), `secret store file was not created for ${providerId}`);
}

async function readProviderConfigText(home, providerId) {
  return readFile(providerConfigPath(home, providerId), "utf8");
}

async function readSecretText(home, providerId) {
  return readFile(secretPath(home, providerId), "utf8");
}

function assertSanitizedProvider(registry, providerId) {
  const provider = registry.providers?.find((entry) => entry.id === providerId);
  assert(provider, `provider summary missing for ${providerId}`);
  assert(provider.enabled === true, `provider summary disabled for ${providerId}`);
  assert(provider.auth?.type === "api_key", `provider summary auth type mismatch for ${providerId}`);
  assert(provider.auth?.configured === true, `provider summary not configured for ${providerId}`);
  assert(typeof provider.auth?.redacted === "string" && provider.auth.redacted.length > 0, `provider summary redacted hint missing for ${providerId}`);
}

async function startMockProvider() {
  const observed = [];
  const server = http.createServer((request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      providerRequestCount += 1;
      observed.push(request.headers.authorization ?? "");
      if (request.headers.authorization === `Bearer ${migratedInlineKey}`) {
        migratedProviderAuth = request.headers.authorization;
      }
      if (request.headers.authorization === `Bearer ${storedWinsStoredKey}` || request.headers.authorization === `Bearer ${storedWinsInlineKey}`) {
        storedWinsProviderAuth = request.headers.authorization;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "smoke-model" }] }));
      return;
    }
    response.writeHead(404).end();
  });
  await listen(server, "127.0.0.1", 0);
  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    output: () => observed.map((value) => `${digest(value)}:${String(value).length}`).join("\n")
  };
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
      throw new Error(`Engine exited before becoming ready. Output digest ${digest(engine.output())}`);
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
  throw new Error(`Engine did not become ready within ${timeoutMs}ms. Output digest ${digest(engine.output())}`);
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

function assertSecretRecordMatches(record, expected, label) {
  assert(record?.kind === "api_key", `${label} kind mismatch`);
  assert(typeof record.value === "string", `${label} value missing`);
  assert(record.value.length === expected.length, `${label} length mismatch`);
  assert(digest(record.value) === digest(expected), `${label} digest mismatch`);
}

function assertSecretRecordDoesNotMatch(record, unexpected, label) {
  assert(record?.kind === "api_key", `${label} kind mismatch`);
  assert(typeof record.value === "string", `${label} value missing`);
  assert(record.value.length !== unexpected.length || digest(record.value) !== digest(unexpected), label);
}

function assertBearerMatches(actual, expected, label) {
  const actualValue = String(actual ?? "");
  const expectedValue = `Bearer ${expected}`;
  assert(actualValue.length === expectedValue.length, `${label} length mismatch`);
  assert(digest(actualValue) === digest(expectedValue), `${label} digest mismatch`);
}

function assertBearerDoesNotMatch(actual, unexpected, label) {
  const actualValue = String(actual ?? "");
  const unexpectedValue = `Bearer ${unexpected}`;
  assert(actualValue.length !== unexpectedValue.length || digest(actualValue) !== digest(unexpectedValue), label);
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

function assertNoSecretLeak(text, markers) {
  const lower = String(text).toLowerCase();
  for (const marker of markers) {
    if (!marker?.value) {
      continue;
    }
    assert(!lower.includes(String(marker.value).toLowerCase()), `secret marker leaked to smoke-visible output: ${marker.label}`);
  }
}

function digest(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
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
