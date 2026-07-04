import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFile, rm, mkdir, writeFile, mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir, homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const guiSrcRoot = join(repoRoot, "apps", "gui", "src");
const vscodePluginRoot = join(repoRoot, "apps", "plugins", "vscode");
const forbiddenFragments = [
  "npm run check",
  "npm test",
  "cargo test",
  "Authorization",
  "Bearer",
  "SECRET_SENTINEL",
  "/Users/private/yet-real-verification",
];

async function main() {
  execFileSync("npm", ["run", "compile"], { cwd: vscodePluginRoot, encoding: "utf8", stdio: "pipe" });
  const { imports, cleanup } = await transpileGuiServices([
    "services/controlledAgentCommandRunRequest.ts",
    "services/controlledAgentRuntimeSession.ts",
    "services/controlledAgentWorkspaceReadiness.ts",
    "services/redaction.ts",
    "services/toolAuthorityPolicy.ts",
  ]);
  const report = { allowed: [], denied: [] };
  try {
    const { buildControlledAgentCommandRunRequest, correlateControlledAgentCommandRunResult } = imports.get("services/controlledAgentCommandRunRequest.ts");
    const { runControlledCommandRunRequest, parseControlledCommandRunRequest } = await import(`${pathToFileURL(join(vscodePluginRoot, "out", "controlledCommandRun.js")).href}?smoke=${Date.now()}`);
    const readyRuntime = await readJson(join(repoRoot, "packages", "contracts", "examples", "engine", "controlled-agent-runtime-session-ready-vscode-worktree.json"));
    const readyReadiness = await readJson(join(repoRoot, "packages", "contracts", "examples", "engine", "controlled-agent-workspace-readiness-worktree.json"));
    const request = buildControlledAgentCommandRunRequest({
      host: "vscode",
      runtimeSessionMetadata: runtimeMetadata(readyRuntime),
      workspaceReadinessMetadata: readinessMetadata(readyReadiness),
      commandId: "repository-check",
      userConfirmed: true,
      requestSeed: "real-verification-smoke",
    });

    assert.equal(request.state, "ready", JSON.stringify(request.diagnostics));
    assert.equal(request.bridgeRequest.type, "gui.controlledAgentCommandRunRequest");
    assert.equal(request.bridgeRequest.payload.requestIdMintedBy, "gui");
    assert.equal(request.bridgeRequest.payload.userConfirmed, true);
    assert.equal(request.bridgeRequest.payload.commandId, "repository-check");
    assert.equal("command" in request.bridgeRequest.payload, false);
    assert.equal("args" in request.bridgeRequest.payload, false);
    assert.equal("cwd" in request.bridgeRequest.payload, false);
    assert.equal("env" in request.bridgeRequest.payload, false);
    assert.equal("shell" in request.bridgeRequest.payload, false);
    assert.equal(request.bridgeRequest.payload.limits.tailOnly, true);
    assert.equal(request.bridgeRequest.payload.limits.timeoutMs, 600000);
    assert.equal(request.bridgeRequest.payload.limits.maxOutputBytes, 12000);
    assert.equal(request.bridgeRequest.payload.limits.maxOutputLines, 240);
    assert.equal(request.bridgeRequest.payload.policyFlags.allowlistedCommandIdOnly, true);
    assert.equal(request.bridgeRequest.payload.policyFlags.freeformCommandAllowed, false);
    assert.equal(request.bridgeRequest.payload.policyFlags.autoVerifyAllowed, false);
    assert.ok(parseControlledCommandRunRequest(request.bridgeRequest));

    const successChild = createChild();
    const spawnCalls = [];
    const successPromise = runControlledCommandRunRequest(request.bridgeRequest, [repoRoot], {
      spawn(command, args, options) {
        spawnCalls.push({ command, args: [...args], cwd: options.cwd, shell: options.shell });
        return successChild;
      },
      now: monotonicNow(10, 70),
    });
    successChild.stdout.emit("data", "repository validation passed\n");
    successChild.emit("close", 0, null);
    const success = await successPromise;

    assert.deepEqual(spawnCalls, [{ command: "npm", args: ["run", "check"], cwd: repoRoot, shell: false }]);
    assert.equal(success.type, "host.controlledAgentCommandRunResult");
    assert.equal(success.payload.status, "succeeded");
    assert.equal(success.payload.exitCode, 0);
    assert.equal(success.payload.outputTail, "repository validation passed\n");
    assert.equal(success.payload.outputByteCount, 29);
    assert.equal(success.payload.outputLineCount, 2);
    assert.equal(success.payload.resultHash.startsWith("sha256:"), true);
    assert.equal(success.payload.truncated, false);
    assert.equal(success.payload.freeformCommandAllowed, false);
    assert.equal(success.payload.policyFlags.shellAllowed, false);

    const correlated = correlateControlledAgentCommandRunResult({ current: request.correlation, hostMessage: success });
    assert.equal(correlated.state, "accepted", JSON.stringify(correlated.diagnostics));
    assert.equal(correlated.commandRun.status, "succeeded");
    report.allowed.push(sanitizeOutcome("vscode allowlisted repository-check", success, correlated.commandRun));

    const unsafeChild = createChild();
    const unsafePromise = runControlledCommandRunRequest(request.bridgeRequest, [repoRoot], {
      spawn() {
        return unsafeChild;
      },
      now: monotonicNow(0, 12),
    });
    unsafeChild.stderr.emit("data", "failure at /Users/private/yet-real-verification with Authorization Bearer SECRET_SENTINEL\n");
    unsafeChild.emit("close", 1, null);
    const unsafe = await unsafePromise;
    assert.equal(unsafe.payload.status, "failed");
    assert.equal(unsafe.payload.outputTail, "Command output hidden by host policy.");
    assert.equal(unsafe.payload.truncated, true);
    const unsafeCorrelation = correlateControlledAgentCommandRunResult({ current: request.correlation, hostMessage: unsafe });
    assert.equal(unsafeCorrelation.state, "accepted", JSON.stringify(unsafeCorrelation.diagnostics));
    report.allowed.push(sanitizeOutcome("sanitized failed tail", unsafe, unsafeCorrelation.commandRun));

    const deniedCases = [
      ["raw command field", { command: "npm run check" }],
      ["args field", { args: ["run", "check"] }],
      ["cwd field", { cwd: "/Users/private/yet-real-verification" }],
      ["env field", { env: { TOKEN: "SECRET_SENTINEL" } }],
      ["shell widened", { policyFlags: { ...request.bridgeRequest.payload.policyFlags, shellAllowed: true } }],
      ["unbounded output", { limits: { ...request.bridgeRequest.payload.limits, maxOutputBytes: 12001 } }],
      ["unknown command", { commandId: "npm-test" }],
      ["unconfirmed", { userConfirmed: false }],
    ];

    for (const [label, patch] of deniedCases) {
      const blocked = await runControlledCommandRunRequest(patchRequest(request.bridgeRequest, patch), [repoRoot], { spawn: failSpawn });
      assert.equal(blocked.payload.status, "blocked", label);
      assert.equal(blocked.payload.freeformCommandAllowed, false, label);
      assert.equal(blocked.payload.truncated, false, label);
      report.denied.push(sanitizeOutcome(label, blocked));
    }

    assert.equal(report.allowed.length, 2);
    assert.equal(report.denied.length, deniedCases.length);
    assertNoLeaks(report);
  } finally {
    await cleanup();
  }

  assertNoLeaks(report);
  console.log("Controlled agent real verification smoke passed.");
  console.log(`Verified ${report.allowed.length} VS Code allowlisted command-run outcomes and ${report.denied.length} fail-closed unsafe request cases with sanitized tail-only metadata.`);
}

function runtimeMetadata(value) {
  const input = clone(value);
  input.session.sessionId = "runtime-s85-smoke";
  input.workspace.controlledWorkspaceId = "workspace-s85-smoke";
  input.workspace.readinessId = "ready-s85-smoke";
  input.preconditions.workspaceReadiness.readinessId = "ready-s85-smoke";
  input.preconditions.correlation.readinessId = "ready-s85-smoke";
  input.host.kind = "vscode";
  return input;
}

function readinessMetadata(value) {
  const input = clone(value);
  input.isolation.readinessId = "ready-s85-smoke";
  input.summary = "Controlled readiness metadata is ready for verification";
  return input;
}

function patchRequest(message, patch) {
  return {
    ...message,
    payload: {
      ...message.payload,
      ...patch,
    },
  };
}

function sanitizeOutcome(label, hostMessage, commandRun) {
  const payload = hostMessage.payload;
  const outcome = {
    label,
    type: hostMessage.type,
    status: payload.status,
    commandId: payload.commandId,
    exitCode: payload.exitCode,
    durationMs: payload.durationMs,
    outputByteCount: payload.outputByteCount,
    outputLineCount: payload.outputLineCount,
    truncated: payload.truncated,
    hasOutputTail: typeof payload.outputTail === "string",
    hasHash: typeof payload.resultHash === "string",
    correlatedStatus: commandRun?.status,
    authority: {
      cloudRequired: payload.cloudRequired,
      executionAllowed: payload.executionAllowed,
      freeformCommandAllowed: payload.freeformCommandAllowed,
      allowlistedCommandIdOnly: payload.policyFlags.allowlistedCommandIdOnly,
      shellAllowed: payload.policyFlags.shellAllowed,
      argsAllowed: payload.policyFlags.argsAllowed,
      cwdAllowed: payload.policyFlags.cwdAllowed,
      envAllowed: payload.policyFlags.envAllowed,
      gitAllowed: payload.policyFlags.gitAllowed,
      networkAllowed: payload.policyFlags.networkAllowed,
      providerAllowed: payload.policyFlags.providerAllowed,
      toolAllowed: payload.policyFlags.toolAllowed,
      autoRunAllowed: payload.policyFlags.autoRunAllowed,
      autoVerifyAllowed: payload.policyFlags.autoVerifyAllowed,
      autoFixAllowed: payload.policyFlags.autoFixAllowed,
    },
  };
  assert.equal(JSON.stringify(outcome).includes("outputTail"), false, label);
  return outcome;
}

function assertNoLeaks(value) {
  const text = JSON.stringify(value);
  for (const fragment of [...forbiddenFragments, repoRoot, tmpdir(), homedir()]) {
    assert.equal(text.includes(fragment), false, `sanitized smoke report leaked ${fragment}`);
  }
  assert.equal(/\/(?:Users|home|tmp|private)\//i.test(text), false, "sanitized smoke report leaked a private path");
  assert.equal(/[A-Za-z]:\\/.test(text), false, "sanitized smoke report leaked a Windows drive path");
  assert.equal(/sk-(?:proj-)?[A-Za-z0-9_-]{8,}/.test(text), false, "sanitized smoke report leaked a provider-style secret");
}

function createChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = (signal) => {
    child.killed = true;
    child.killSignal = signal;
    return true;
  };
  return child;
}

function monotonicNow(...values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)] ?? 0;
}

function failSpawn() {
  throw new Error("spawn should not run");
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function requireTypescript() {
  const require = createRequire(import.meta.url);
  return require(join(repoRoot, "apps", "gui", "node_modules", "typescript"));
}

async function transpileGuiServices(entries) {
  const ts = requireTypescript();
  const outRoot = await mkdtemp(join(tmpdir(), "yet-controlled-real-verification-smoke-ts-"));
  const seen = new Set();

  async function emit(relativePath) {
    if (seen.has(relativePath)) return;
    seen.add(relativePath);
    const sourcePath = join(guiSrcRoot, relativePath);
    const source = await readFile(sourcePath, "utf8");
    for (const match of source.matchAll(/from\s+["'](\.?\.\/[^"']+)["']/g)) {
      const dependency = match[1];
      const dependencyPath = `${resolve(dirname(sourcePath), dependency)}.ts`;
      if (dependencyPath.startsWith(guiSrcRoot)) {
        await emit(relative(guiSrcRoot, dependencyPath));
      }
    }
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        esModuleInterop: true,
      },
    }).outputText;
    const rewritten = transpiled.replace(/(from\s+["'])(\.?\.\/[^"']+)(["'])/g, "$1$2.mjs$3");
    const outPath = join(outRoot, relative(guiSrcRoot, sourcePath)).replace(/\.ts$/, ".mjs");
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, rewritten, "utf8");
  }

  for (const entry of entries) {
    await emit(entry);
  }

  const imports = new Map();
  for (const entry of entries) {
    imports.set(entry, await import(pathToFileURL(join(outRoot, entry.replace(/\.ts$/, ".mjs"))).href));
  }
  return { imports, cleanup: () => rm(outRoot, { recursive: true, force: true }) };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

export { main as runSmoke };
