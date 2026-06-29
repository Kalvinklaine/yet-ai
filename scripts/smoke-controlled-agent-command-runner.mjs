import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir, homedir } from "node:os";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_TIMEOUT_MS = 800;
const MAX_OUTPUT_BYTES = 256;
const MAX_OUTPUT_LINES = 8;
const KILL_GRACE_MS = 50;
const SECRET_MARKER = "controlled-command-runner-secret-should-not-leak";
const PRIVATE_PATH_MARKER = "/Users/private/controlled-command-runner";
const RAW_MARKERS = [SECRET_MARKER, PRIVATE_PATH_MARKER, "npm test", "git status", "curl https://example.invalid", "API_KEY=", "Bearer token"];
const BLOCKED_KEYS = new Set(["command", "cmd", "args", "arguments", "cwd", "env", "environment", "shell", "git", "network", "provider", "tool", "rawCommand", "raw_command", "rawOutput", "raw_output"]);

const commandActions = new Map([
  ["repository-check", { label: "Repository check", timeoutMs: 500, action: "success" }],
  ["gui-app-tests", { label: "GUI app tests", timeoutMs: 500, action: "failure" }],
  ["engine-chat-tests", { label: "Engine chat tests", timeoutMs: 80, action: "timeout" }],
]);

class ControlledCommandRunnerError extends Error {
  constructor(reason) {
    super(`Controlled command runner blocked: ${reason}`);
    this.name = "ControlledCommandRunnerError";
    this.reason = reason;
  }
}

async function runControlledCommand(payload) {
  validatePayload(payload);
  const mapping = commandActions.get(payload.commandId);
  if (!mapping) {
    throw new ControlledCommandRunnerError("unknown_command_id");
  }
  const timeoutMs = boundedLimit(payload.timeoutMs ?? mapping.timeoutMs, 1, MAX_TIMEOUT_MS, "timeout_exceeds_limit");
  const maxOutputBytes = boundedLimit(payload.maxOutputBytes ?? MAX_OUTPUT_BYTES, 1, MAX_OUTPUT_BYTES, "output_limit_exceeds_limit");
  const maxOutputLines = boundedLimit(payload.maxOutputLines ?? MAX_OUTPUT_LINES, 1, MAX_OUTPUT_LINES, "output_limit_exceeds_limit");
  return executeMappedNodeAction({ commandId: payload.commandId, mapping, timeoutMs, maxOutputBytes, maxOutputLines });
}

function validatePayload(payload) {
  if (!isPlainObject(payload)) {
    throw new ControlledCommandRunnerError("malformed_payload");
  }
  for (const key of Object.keys(payload)) {
    if (BLOCKED_KEYS.has(key)) {
      throw new ControlledCommandRunnerError("raw_authority_rejected");
    }
  }
  if (typeof payload.commandId !== "string" || payload.commandId.length === 0) {
    throw new ControlledCommandRunnerError("missing_command_id");
  }
}

function boundedLimit(value, min, max, reason) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ControlledCommandRunnerError(reason);
  }
  return value;
}

function executeMappedNodeAction({ commandId, mapping, timeoutMs, maxOutputBytes, maxOutputLines }) {
  return new Promise((resolve, reject) => {
    let output = "";
    let settled = false;
    let timedOut = false;
    const startedAt = Date.now();
    const child = spawn(process.execPath, ["-e", nodeActionSource(mapping.action)], { stdio: ["ignore", "pipe", "pipe"] });
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!settled && child.exitCode === null) {
          child.kill("SIGKILL");
        }
      }, KILL_GRACE_MS).unref();
    }, timeoutMs);
    timeout.unref();

    child.stdout.on("data", (chunk) => {
      output = appendBounded(output, chunk, maxOutputBytes * 4);
    });
    child.stderr.on("data", (chunk) => {
      output = appendBounded(output, chunk, maxOutputBytes * 4);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      if (settled) {
        return;
      }
      settled = true;
      const status = timedOut ? "timed_out" : signal ? "killed" : code === 0 ? "succeeded" : "failed";
      const exitCode = timedOut || signal ? null : code;
      resolve(sanitizeResult({ commandId, label: mapping.label, status, exitCode, durationMs: Date.now() - startedAt, output, maxOutputBytes, maxOutputLines }));
    });
  });
}

function nodeActionSource(action) {
  if (action === "success") {
    return "console.log('repository validation passed'); console.log('bounded local action complete');";
  }
  if (action === "failure") {
    return `console.log('gui test summary failed'); console.error('${SECRET_MARKER} ${PRIVATE_PATH_MARKER} Authorization: Bearer token'); process.exit(2);`;
  }
  return "console.log('engine chat tests started'); setTimeout(() => console.log('still running'), 1000);";
}

function appendBounded(current, chunk, maxBytes) {
  const combined = `${current}${chunk.toString("utf8")}`;
  const bytes = Buffer.from(combined, "utf8");
  if (bytes.byteLength <= maxBytes) {
    return combined;
  }
  return bytes.subarray(bytes.byteLength - maxBytes).toString("utf8");
}

function sanitizeResult({ commandId, label, status, exitCode, durationMs, output, maxOutputBytes, maxOutputLines }) {
  const sanitizedOutput = sanitizeText(output);
  const lineBounded = sanitizedOutput.split("\n").slice(-maxOutputLines).join("\n").trim();
  const byteBounded = boundBytes(lineBounded, maxOutputBytes);
  const rawBytes = Buffer.byteLength(output, "utf8");
  return {
    commandId,
    label,
    status,
    exitCode,
    durationMs,
    outputTail: byteBounded,
    outputByteCount: Math.min(Buffer.byteLength(byteBounded, "utf8"), maxOutputBytes),
    outputLineCount: byteBounded.length === 0 ? 0 : byteBounded.split("\n").length,
    resultHash: `sha256:${createHash("sha256").update(output).digest("hex")}`,
    truncated: rawBytes > maxOutputBytes || sanitizedOutput.split("\n").length > maxOutputLines,
  };
}

function sanitizeText(value) {
  return value
    .replaceAll(SECRET_MARKER, "[redacted]")
    .replaceAll(PRIVATE_PATH_MARKER, "[redacted]")
    .replace(/Authorization:\s*Bearer\s+\S+/gi, "Authorization: [redacted]")
    .replace(/\b(?:API_KEY|TOKEN|SECRET)=[^\s]+/gi, "[redacted]")
    .replace(/\/(?:Users|home|tmp|var|private)\/[^\s]+/gi, "[redacted]");
}

function boundBytes(value, maxBytes) {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= maxBytes) {
    return value;
  }
  return bytes.subarray(bytes.byteLength - maxBytes).toString("utf8");
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function assertDenied(fn, expectedReason, label, report) {
  await assert.rejects(fn, (error) => {
    assert.equal(error?.name, "ControlledCommandRunnerError", `${label} used unexpected error type`);
    assert.equal(error.reason, expectedReason, `${label} used unexpected denial reason`);
    assertNoRawMarkers({ message: error.message, reason: error.reason }, `${label} error`);
    report.blocked.push({ label, reason: error.reason });
    return true;
  });
}

function assertNoRawMarkers(value, label) {
  const text = JSON.stringify(value);
  for (const marker of [...RAW_MARKERS, tmpdir(), homedir(), dirname(process.argv[1] ?? "")]) {
    assert.equal(text.includes(marker), false, `${label} leaked ${marker}`);
  }
  assert.equal(/\/(?:Users|home)\//.test(text), false, `${label} leaked a private path`);
  assert.equal(/sk-[A-Za-z0-9_-]{8,}/.test(text), false, `${label} leaked a provider-style secret`);
}

async function runSmoke() {
  const report = { allowed: [], blocked: [] };

  const success = await runControlledCommand({ commandId: "repository-check", maxOutputBytes: 128, maxOutputLines: 4 });
  assert.equal(success.status, "succeeded");
  assert.equal(success.exitCode, 0);
  assert.equal(success.outputTail.includes("repository validation passed"), true);
  report.allowed.push({ label: "allowed success", result: success });

  const failure = await runControlledCommand({ commandId: "gui-app-tests", maxOutputBytes: 96, maxOutputLines: 4 });
  assert.equal(failure.status, "failed");
  assert.equal(failure.exitCode, 2);
  assert.equal(failure.outputTail.includes("[redacted]"), true);
  assertNoRawMarkers(failure, "failure result");
  report.allowed.push({ label: "allowed failure", result: failure });

  const timeout = await runControlledCommand({ commandId: "engine-chat-tests", timeoutMs: 40, maxOutputBytes: 96, maxOutputLines: 4 });
  assert.equal(timeout.status, "timed_out");
  assert.equal(timeout.exitCode, null);
  report.allowed.push({ label: "timeout kill", result: timeout });

  await assertDenied(() => runControlledCommand({ commandId: "npm-test" }), "unknown_command_id", "unknown command", report);
  await assertDenied(() => runControlledCommand({ commandId: "repository-check", command: "npm test" }), "raw_authority_rejected", "raw command", report);
  await assertDenied(() => runControlledCommand({ commandId: "repository-check", cwd: PRIVATE_PATH_MARKER }), "raw_authority_rejected", "raw cwd", report);
  await assertDenied(() => runControlledCommand({ commandId: "repository-check", env: { API_KEY: SECRET_MARKER } }), "raw_authority_rejected", "raw env", report);
  await assertDenied(() => runControlledCommand({ commandId: "repository-check", timeoutMs: MAX_TIMEOUT_MS + 1 }), "timeout_exceeds_limit", "timeout bound", report);
  await assertDenied(() => runControlledCommand({ commandId: "repository-check", maxOutputBytes: MAX_OUTPUT_BYTES + 1 }), "output_limit_exceeds_limit", "output byte bound", report);

  assert.equal(report.allowed.length, 3);
  assert.equal(report.blocked.length, 6);
  assertNoRawMarkers(report, "smoke report");
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await runSmoke();
  assertNoRawMarkers(report, "final smoke output");
  console.log("Controlled agent command runner smoke passed.");
  console.log(`Verified ${report.allowed.length} allowlisted local/mock outcomes and ${report.blocked.length} blocked unsafe command-runner requests with sanitized bounded output only.`);
}

export { runSmoke };
