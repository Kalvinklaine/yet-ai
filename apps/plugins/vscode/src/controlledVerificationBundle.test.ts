import * as assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { isInvalidControlledVerificationBundleRequestMessage, parseControlledVerificationBundleRequest, runControlledVerificationBundleRequest } from "./controlledVerificationBundle";

type FakeChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  killed: boolean;
  killSignal?: NodeJS.Signals;
  kill(signal?: NodeJS.Signals): boolean;
};

async function main(): Promise<void> {
  await testSafeBundleExecutesSequenceWithSanitizedMetadata();
  await testUnsafeFreeformFieldsFailClosed();
  await testUnsupportedHostWorkspaceFailsClosed();
  await testRawOutputSanitization();
}

async function testSafeBundleExecutesSequenceWithSanitizedMetadata(): Promise<void> {
  const calls: { command: string; args: readonly string[]; cwd: string; shell: false }[] = [];
  const children = [createChild(), createChild()];
  const resultPromise = runControlledVerificationBundleRequest(createRequest(["repository-check", "gui-app-tests"]), ["/workspace"], {
    spawn(command, args, options) {
      calls.push({ command, args, cwd: options.cwd, shell: options.shell });
      return children[calls.length - 1];
    },
    now: monotonicNow(0, 15, 20, 45),
  });
  children[0].stdout.emit("data", "repository ok\n");
  children[0].emit("close", 0, null);
  children[1].stdout.emit("data", "gui ok\n");
  children[1].emit("close", 0, null);
  const result = await resultPromise;

  assert.deepEqual(calls, [
    { command: "npm", args: ["run", "check"], cwd: "/workspace", shell: false },
    { command: "npm", args: ["test"], cwd: "/workspace/apps/gui", shell: false },
  ]);
  assert.equal(result.type, "host.controlledAgentVerificationBundleResult");
  assert.equal(result.payload.status, "succeeded");
  assert.equal(result.payload.sequence.length, 2);
  assert.deepEqual(result.payload.sequence.map((item) => item.sequenceIndex), [0, 1]);
  assert.deepEqual(result.payload.sequence.map((item) => item.commandId), ["repository-check", "gui-app-tests"]);
  assert.equal(result.payload.freeformCommandAllowed, false);
  assert.equal(result.payload.policyFlags.allowlistedCommandIdsOnly, true);
  assert.equal(result.payload.policyFlags.shellAllowed, false);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("run check"), false);
  assert.equal(serialized.includes("/workspace"), false);
}

async function testUnsafeFreeformFieldsFailClosed(): Promise<void> {
  for (const payloadPatch of [
    { commandIds: ["npm-test"] },
    { userConfirmed: false },
    { requestIdMintedBy: "assistant" },
    { command: "npm test" },
    { args: ["test"] },
    { cwd: "/Users/alice/repo" },
    { env: { TOKEN: "secret" } },
    { shell: true },
    { git: true },
    { packageInstall: true },
    { network: true },
    { provider: true },
    { tool: true },
    { limits: { ...baseLimits(), maxCommands: 4 } },
    { limits: { ...baseLimits(), maxTimeoutMs: 1800001 } },
    { limits: { ...baseLimits(), maxOutputBytes: 20001 } },
    { commandIds: ["repository-check", "gui-app-tests", "engine-chat-tests", "repository-check"] },
    { policyFlags: { ...basePolicyFlags(), shellAllowed: true } },
  ]) {
    const message = createRequest(["repository-check"], payloadPatch);
    assert.equal(parseControlledVerificationBundleRequest(message), undefined);
    assert.equal(isInvalidControlledVerificationBundleRequestMessage(message), true);
    const result = await runControlledVerificationBundleRequest(message, ["/repo"], { spawn: failSpawn });
    assert.equal(result.payload.status, "blocked");
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes("npm test"), false);
    assert.equal(serialized.includes("/Users"), false);
    assert.equal(serialized.includes("TOKEN"), false);
    assert.equal(serialized.includes("secret"), false);
  }
}

async function testUnsupportedHostWorkspaceFailsClosed(): Promise<void> {
  const result = await runControlledVerificationBundleRequest(createRequest(["repository-check"]), [], { spawn: failSpawn });
  assert.equal(result.payload.status, "blocked");
  assert.equal(result.payload.sequence[0].status, "blocked");
  assert.equal(result.payload.freeformCommandAllowed, false);
}

async function testRawOutputSanitization(): Promise<void> {
  const child = createChild();
  const resultPromise = runControlledVerificationBundleRequest(createRequest(["repository-check"]), ["/repo"], {
    spawn() {
      return child;
    },
  });
  child.stdout.emit("data", "failure at /Users/alice/private/repo with token\n");
  child.emit("close", 1, null);
  const result = await resultPromise;
  assert.equal(result.payload.status, "failed");
  assert.equal(result.payload.sequence[0].outputTail, "Command output hidden by host policy.");
  assert.equal(result.payload.sequence[0].truncated, true);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("/Users/alice"), false);
  assert.equal(serialized.includes("token"), false);
}

function createRequest(commandIds: string[], overrides: Record<string, unknown> = {}): Parameters<typeof runControlledVerificationBundleRequest>[0] {
  const payload = {
    requestId: "bundle-safe",
    requestIdMintedBy: "gui",
    source: "gui",
    assistantMinted: false,
    controlledWorkspaceId: "workspace-bundle-safe",
    runId: "run-bundle-safe",
    workspaceReadinessId: "ready-bundle-safe",
    bundleId: "bundle-safe",
    userConfirmed: true,
    confirmationKind: "explicit_user_verification_bundle",
    commandIds,
    limits: baseLimits(),
    policyFlags: basePolicyFlags(),
    ...overrides,
  };
  return {
    version: "2026-05-15",
    type: "gui.controlledAgentVerificationBundleRequest",
    requestId: "bundle-safe",
    payload,
  };
}

function baseLimits(): Record<string, unknown> {
  return {
    maxCommands: 3,
    maxTimeoutMs: 5000,
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
    allowlistedCommandIdsOnly: true,
    boundedSequenceOnly: true,
    explicitUserConfirmationRequired: true,
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
    productionClaimAllowed: false,
    releaseClaimAllowed: false,
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
