import * as assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { isInvalidControlledCommandRunRequestMessage, parseControlledCommandRunRequest, runControlledCommandRunRequest } from "./controlledCommandRun";

type FakeTimer = { callback: () => void; ms: number; cleared: boolean };

type FakeChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  killed: boolean;
  killSignal?: NodeJS.Signals;
  kill(signal?: NodeJS.Signals): boolean;
};

async function main(): Promise<void> {
  await testSuccessUsesFixedMappingAndSanitizedTail();
  await testFailureKeepsTailOnlyResult();
  await testMalformedUnknownAndUnconfirmedRequestsBlock();
  await testTimeoutKillsAndReportsTimedOut();
  await testKillAfterStopReportsKilledOnce();
  await testOutputTruncationAndPrivateOutputSanitization();
}

async function testSuccessUsesFixedMappingAndSanitizedTail(): Promise<void> {
  const calls: { command: string; args: readonly string[]; cwd: string; shell: false }[] = [];
  const child = createChild();
  const resultPromise = runControlledCommandRunRequest(createRequest("repository-check"), ["/workspace"], {
    spawn(command, args, options) {
      calls.push({ command, args, cwd: options.cwd, shell: options.shell });
      return child;
    },
    now: monotonicNow(0, 42),
  });
  child.stdout.emit("data", "safe output\n");
  child.emit("close", 0, null);
  const result = await resultPromise;

  assert.deepEqual(calls, [{ command: "npm", args: ["run", "check"], cwd: "/workspace", shell: false }]);
  assert.equal(result.type, "host.controlledAgentCommandRunResult");
  assert.equal(result.payload.status, "succeeded");
  assert.equal(result.payload.exitCode, 0);
  assert.equal(result.payload.durationMs, 42);
  assert.equal(result.payload.outputTail, "safe output\n");
  assert.equal(result.payload.freeformCommandAllowed, false);
  assert.equal(result.payload.policyFlags.allowlistedCommandIdOnly, true);
  assert.equal(result.payload.policyFlags.shellAllowed, false);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("run check"), false);
  assert.equal(serialized.includes("/workspace"), false);
}

async function testFailureKeepsTailOnlyResult(): Promise<void> {
  const child = createChild();
  const resultPromise = runControlledCommandRunRequest(createRequest("gui-app-tests"), ["/repo"], {
    spawn(command, args, options) {
      assert.equal(command, "npm");
      assert.deepEqual(args, ["test"]);
      assert.equal(options.cwd, "/repo/apps/gui");
      return child;
    },
    now: monotonicNow(10, 30),
  });
  child.stderr.emit("data", "test failed\n");
  child.emit("close", 2, null);
  const result = await resultPromise;

  assert.equal(result.payload.status, "failed");
  assert.equal(result.payload.exitCode, 2);
  assert.equal(result.payload.outputTail, "test failed\n");
  assert.equal(result.payload.resultHash?.startsWith("sha256:"), true);
}

async function testMalformedUnknownAndUnconfirmedRequestsBlock(): Promise<void> {
  for (const payloadPatch of [
    { commandId: "npm-test" },
    { userConfirmed: false },
    { command: "npm test" },
    { args: ["test"] },
    { cwd: "/Users/alice/repo" },
    { policyFlags: { ...basePolicyFlags(), shellAllowed: true } },
    { limits: { ...baseLimits(), shellAllowed: true } },
  ]) {
    const message = createRequest("repository-check", payloadPatch);
    assert.equal(parseControlledCommandRunRequest(message), undefined);
    assert.equal(isInvalidControlledCommandRunRequestMessage(message), true);
    const result = await runControlledCommandRunRequest(message, ["/repo"], { spawn: failSpawn });
    assert.equal(result.payload.status, "blocked");
    assert.equal(JSON.stringify(result).includes("npm test"), false);
    assert.equal(JSON.stringify(result).includes("/Users"), false);
  }
}

async function testTimeoutKillsAndReportsTimedOut(): Promise<void> {
  const child = createChild();
  let timer: FakeTimer | undefined;
  const resultPromise = runControlledCommandRunRequest(createRequest("engine-chat-tests", { limits: { ...baseLimits(), timeoutMs: 1000 } }), ["/repo"], {
    spawn() {
      return child;
    },
    setTimeout(callback, ms) {
      timer = { callback, ms, cleared: false };
      return timer;
    },
    clearTimeout(value) {
      (value as FakeTimer).cleared = true;
    },
    now: monotonicNow(0, 1000),
  });
  assert.equal(timer?.ms, 1000);
  timer?.callback();
  assert.equal(child.killed, true);
  assert.equal(child.killSignal, "SIGTERM");
  child.emit("close", null, "SIGTERM");
  const result = await resultPromise;

  assert.equal(result.payload.status, "timed_out");
  assert.equal(result.payload.exitCode, null);
  assert.equal(timer?.cleared, true);
}

async function testKillAfterStopReportsKilledOnce(): Promise<void> {
  const child = createChild();
  let resolveCount = 0;
  const resultPromise = runControlledCommandRunRequest(createRequest("repository-check"), ["/repo"], {
    spawn() {
      return child;
    },
    now: monotonicNow(0, 12, 30),
  }).then((result) => {
    resolveCount += 1;
    return result;
  });
  child.kill("SIGTERM");
  child.emit("close", null, "SIGTERM");
  child.emit("close", 0, null);
  const result = await resultPromise;

  assert.equal(result.payload.status, "killed");
  assert.equal(result.payload.exitCode, null);
  assert.equal(resolveCount, 1);
  assert.equal(JSON.stringify(result).includes("SIGTERM"), false);
}

async function testOutputTruncationAndPrivateOutputSanitization(): Promise<void> {
  const longChild = createChild();
  const longResultPromise = runControlledCommandRunRequest(createRequest("repository-check", { limits: { ...baseLimits(), maxOutputBytes: 80, maxOutputLines: 3 } }), ["/repo"], {
    spawn() {
      return longChild;
    },
  });
  longChild.stdout.emit("data", "line1\nline2\nline3\nline4\n" + "x".repeat(200));
  longChild.emit("close", 0, null);
  const longResult = await longResultPromise;
  assert.equal(longResult.payload.truncated, true);
  assert.ok((longResult.payload.outputByteCount ?? 0) <= 80);
  assert.ok((longResult.payload.outputLineCount ?? 0) <= 3);

  const privateChild = createChild();
  const privateResultPromise = runControlledCommandRunRequest(createRequest("repository-check"), ["/repo"], {
    spawn() {
      return privateChild;
    },
  });
  privateChild.stdout.emit("data", "failure at /Users/alice/private/repo with token\n");
  privateChild.emit("close", 1, null);
  const privateResult = await privateResultPromise;
  assert.equal(privateResult.payload.outputTail, "Command output hidden by host policy.");
  assert.equal(privateResult.payload.truncated, true);
  assert.equal(JSON.stringify(privateResult).includes("/Users/alice"), false);
  assert.equal(JSON.stringify(privateResult).includes("token"), false);
}

function createRequest(commandId: string, overrides: Record<string, unknown> = {}): Parameters<typeof runControlledCommandRunRequest>[0] {
  const payload = {
    requestId: "command-safe",
    requestIdMintedBy: "gui",
    source: "gui",
    assistantMinted: false,
    controlledWorkspaceId: "workspace-command-safe",
    runId: "run-command-safe",
    runtimeSessionId: "runtime-command-safe",
    workspaceReadinessId: "ready-command-safe",
    userConfirmed: true,
    commandId,
    limits: baseLimits(),
    policyFlags: basePolicyFlags(),
    ...overrides,
  };
  return {
    version: "2026-05-15",
    type: "gui.controlledAgentCommandRunRequest",
    requestId: "command-safe",
    payload,
  };
}

function baseLimits(): Record<string, unknown> {
  return {
    timeoutMs: 5000,
    maxOutputBytes: 2000,
    maxOutputLines: 40,
    tailOnly: true,
    commandStringAllowed: false,
    argsAllowed: false,
    cwdAllowed: false,
    envAllowed: false,
    shellAllowed: false,
  };
}

function basePolicyFlags(): Record<string, unknown> {
  return {
    allowlistedCommandIdOnly: true,
    freeformCommandAllowed: false,
    argsAllowed: false,
    cwdAllowed: false,
    envAllowed: false,
    shellAllowed: false,
    gitAllowed: false,
    networkAllowed: false,
    providerAllowed: false,
    toolAllowed: false,
    packageInstallAllowed: false,
    fileReadAllowed: false,
    fileWriteAllowed: false,
    hiddenSearchAllowed: false,
    indexingAllowed: false,
    autoStartAllowed: false,
    autoApplyAllowed: false,
    autoRunAllowed: false,
    autoVerifyAllowed: false,
    autoFixAllowed: false,
  };
}

function createChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = (signal?: NodeJS.Signals) => {
    child.killed = true;
    child.killSignal = signal;
    return true;
  };
  return child;
}

function monotonicNow(...values: number[]): () => number {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)] ?? 0;
}

function failSpawn(): never {
  throw new Error("spawn should not run");
}

void main();
