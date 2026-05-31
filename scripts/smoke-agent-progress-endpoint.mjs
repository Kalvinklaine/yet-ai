import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { appendProgressEvent, readProgressState, resolveAgentProgressStatePath, snapshotProgressState } from "./planner-agent-progress-state.mjs";
import { run as runProgressCommand } from "./planner-agent-progress-run.mjs";

const rootDir = process.cwd();
const token = `agent-progress-endpoint-${randomUUID()}`;
const timeoutMs = 120_000;
const rawMarkers = [
  "sk-agent-progress-endpoint-secret",
  "Bearer agent-progress-endpoint-secret",
  "api_key=agent-progress-endpoint-secret",
  "cookie=agent-progress-endpoint-secret",
  "/Users/example/.codex/auth.json",
  "/private/tmp/agent-progress-endpoint-secret",
  "raw prompt: private workspace dump",
  "provider response raw body"
];

let engine;
let tempHome;

try {
  tempHome = await makeTempHome();
  const enginePort = await freePort();
  engine = startEngine(enginePort, tempHome);
  const baseUrl = `http://127.0.0.1:${enginePort}`;
  await waitForEngine(baseUrl);

  const missing = await requestJson(baseUrl, "/v1/agent-progress");
  assert(missing.cloudRequired === false, "missing source cloud flag mismatch");
  assert(missing.providerAccess === "direct", "missing source provider access mismatch");
  assert(Array.isArray(missing.snapshots) && missing.snapshots.length === 0, "missing source did not return empty snapshots");
  assertNoRawMarkers(missing, "missing source response");

  await writeLiveProgressSource(tempHome);

  const populated = await requestJson(baseUrl, "/v1/agent-progress");
  assert(populated.cloudRequired === false, "populated source cloud flag mismatch");
  assert(populated.providerAccess === "direct", "populated source provider access mismatch");
  assert(populated.generatedAt === "2026-05-31T10:00:02Z", "populated source generatedAt mismatch");
  assert(Array.isArray(populated.snapshots) && populated.snapshots.length === 1, "populated source snapshot count mismatch");
  const healthy = populated.snapshots[0];
  assert(healthy.cardId === "T373", "writer snapshot card id mismatch");
  assert(healthy.runId === "run-endpoint-writer", "writer snapshot run id mismatch");
  assert(healthy.status === "healthy_running", "writer snapshot status mismatch");
  assert(healthy.message === "Wrapped endpoint smoke command is running.", "writer snapshot message mismatch");
  assert(healthy.lastHeartbeatAt === "2026-05-31T10:00:01Z", "writer snapshot heartbeat timestamp mismatch");
  assert(healthy.heartbeatAgeMs === 1000, "writer snapshot heartbeat age mismatch");
  assert(healthy.lastToolOutputAt === "2026-05-31T10:00:00Z", "writer snapshot tool output timestamp mismatch");
  assert(healthy.toolOutputAgeMs === 2000, "writer snapshot tool output age mismatch");
  assertNoRawMarkers(populated, "populated response");

  await writeRawProgressSource(tempHome, `{"cloudRequired":false,"providerAccess":"direct","snapshots":[{"message":"${rawMarkers.join(" ")}"}`);
  const corrupt = await requestJson(baseUrl, "/v1/agent-progress", { expectedStatus: 503 });
  assert(corrupt.error === "agent progress unavailable", "corrupt source error mismatch");
  assertNoRawMarkers(corrupt, "corrupt source response");

  console.log("Agent progress endpoint smoke passed.");
} finally {
  if (engine) {
    await stopProcess(engine);
  }
  if (tempHome) {
    await rm(tempHome, { recursive: true, force: true });
  }
}

async function writeLiveProgressSource(home) {
  const cacheRoot = endpointCacheRoot(home);
  const statePath = resolveAgentProgressStatePath({ cacheRoot, env: {} });
  const now = "2026-05-31T10:00:02Z";
  assert(statePath === path.join(endpointCacheRoot(home), "yet-ai", "agent-progress", "progress.json"), "endpoint smoke resolved unexpected canonical path");
  const wrapperCode = await runProgressCommand(
    [
      "--card",
      "T373",
      "--run",
      "run-endpoint-wrapper",
      "--state",
      statePath,
      "--phase",
      "running_command",
      "--tool-kind",
      "command",
      "--tool-label",
      "endpoint smoke wrapper",
      "--heartbeat-interval-ms",
      "100",
      "--",
      process.execPath,
      "-e",
      "process.stdout.write('safe wrapper output')"
    ],
    {
      stdout: { write() {} },
      stderr: { write(value) { throw new Error(`wrapper wrote stderr: ${value}`); } },
      env: process.env
    }
  );
  assert(wrapperCode === 0, "live wrapper command failed");
  await appendProgressEvent(
    statePath,
    progressEvent({
      eventId: "evt-endpoint-writer-1",
      runId: "run-endpoint-writer",
      cardId: "T373",
      timestamp: "2026-05-31T10:00:00Z",
      phase: "started",
      status: "running",
      message: "Command wrapper started."
    }),
    { now }
  );
  await appendProgressEvent(
    statePath,
    progressEvent({
      eventId: "evt-endpoint-writer-2",
      runId: "run-endpoint-writer",
      cardId: "T373",
      timestamp: "2026-05-31T10:00:01Z",
      phase: "running_command",
      status: "running",
      message: "Wrapped endpoint smoke command is running.",
      tool: {
        kind: "command",
        label: "endpoint smoke writer",
        startedAt: "2026-05-31T10:00:00Z"
      },
      heartbeat: {
        lastHeartbeatAt: "2026-05-31T10:00:01Z",
        lastToolOutputAt: "2026-05-31T10:00:00Z"
      },
      outputTail: "safe writer output"
    }),
    { now }
  );
  const state = await readProgressState(statePath);
  assert(state.events.some((event) => event.runId === "run-endpoint-wrapper"), "wrapper event was not written to canonical state");
  const snapshot = snapshotProgressState({ ...state, events: state.events.filter((event) => event.runId === "run-endpoint-writer") }, { now });
  await writeProgressSource(home, {
    cloudRequired: false,
    providerAccess: "direct",
    generatedAt: now,
    snapshots: [snapshot]
  });
  assert(statePath === resolveAgentProgressStatePath({ cacheRoot, env: {} }), "canonical writer path drifted");
}

function progressEvent(overrides) {
  return {
    protocolVersion: "2026-05-29",
    eventId: "evt-endpoint-default",
    runId: "run-endpoint-writer",
    cardId: "T373",
    timestamp: "2026-05-31T10:00:00Z",
    phase: "running_command",
    status: "running",
    message: "Endpoint smoke progress event.",
    ...overrides
  };
}

async function makeTempHome() {
  const home = path.join(os.tmpdir(), `yet-ai-agent-progress-endpoint-${process.pid}-${Date.now()}`);
  await mkdir(path.join(home, "Library", "Application Support"), { recursive: true });
  await mkdir(path.join(home, "Library", "Caches"), { recursive: true });
  await mkdir(path.join(home, ".config"), { recursive: true });
  await mkdir(path.join(home, ".cache"), { recursive: true });
  return home;
}

async function writeProgressSource(home, value) {
  await writeRawProgressSource(home, `${JSON.stringify(value)}\n`);
}

async function writeRawProgressSource(home, value) {
  const sourcePath = resolveAgentProgressStatePath({ cacheRoot: endpointCacheRoot(home), env: {} });
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, value);
}

function endpointCacheRoot(home) {
  return path.join(home, "Library", "Caches");
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
      throw new Error(`Engine exited before becoming ready. ${safeEngineOutput(engine.output())}`);
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
  throw new Error(`Engine did not become ready within ${timeoutMs}ms. ${safeEngineOutput(engine.output())}`);
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

function assertNoRawMarkers(value, label) {
  const lower = JSON.stringify(value).toLowerCase();
  rawMarkers.forEach((marker, index) => {
    assert(!lower.includes(marker.toLowerCase()), `${label} leaked raw marker ${index + 1}`);
  });
  assert(!lower.includes(token.toLowerCase()), `${label} leaked runtime token`);
}

function safeEngineOutput(output) {
  return output.split("\n").slice(-20).join("\n");
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
