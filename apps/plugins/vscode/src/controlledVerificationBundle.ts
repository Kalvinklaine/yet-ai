import { spawn } from "node:child_process";
import * as crypto from "node:crypto";
import * as path from "node:path";
import { bridgeVersion } from "./identity";

export type ControlledVerificationBundleGuiMessage = {
  version: string;
  type: "gui.controlledAgentVerificationBundleRequest";
  requestId?: string;
  payload?: Record<string, unknown>;
};

export type ControlledVerificationBundleHostMessage = {
  version: string;
  type: "host.controlledAgentVerificationBundleResult";
  requestId: string;
  payload: ControlledVerificationBundleResultPayload;
};

type VerificationCommandId = "repository-check" | "gui-app-tests" | "engine-chat-tests";
type CommandState = "blocked" | "succeeded" | "failed" | "timed_out" | "killed";
type BundleState = CommandState;

type ControlledVerificationBundleRequest = {
  requestId: string;
  requestIdMintedBy: "gui";
  source: "gui";
  assistantMinted: false;
  controlledWorkspaceId: string;
  runId: string;
  workspaceReadinessId?: string;
  bundleId: string;
  userConfirmed: true;
  confirmationKind: "explicit_user_verification_bundle";
  commandIds: VerificationCommandId[];
  limits: {
    maxCommands: 3;
    maxTimeoutMs: number;
    maxOutputBytes: number;
    maxOutputLines: number;
    tailOnly: true;
    commandStringAllowed: false;
    argsAllowed: false;
    cwdAllowed: false;
    envAllowed: false;
    shellAllowed: false;
  };
};

type CommandResult = {
  stepId: string;
  sequenceIndex: number;
  commandId: VerificationCommandId;
  status: CommandState;
  exitCode?: number | null;
  durationMs?: number;
  outputTail?: string;
  outputByteCount?: number;
  outputLineCount?: number;
  resultHash?: string;
  truncated: boolean;
  summary: string;
};

type ControlledVerificationBundleResultPayload = {
  requestId: string;
  requestIdMintedBy: "gui";
  userConfirmed: true;
  controlledWorkspaceId: string;
  runId: string;
  workspaceReadinessId?: string;
  bundleId: string;
  status: BundleState;
  authority: "verification_bundle_fixed_command_ids";
  cloudRequired: false;
  executionAllowed: false;
  freeformCommandAllowed: false;
  commandCount: number;
  sequence: CommandResult[];
  policyFlags: ReturnType<typeof createPolicyFlags>;
  message: string;
  aggregateResultHash?: string;
  truncated: boolean;
};

type CommandMapping = {
  executable: string;
  args: string[];
  cwdSegments: string[];
};

type SpawnedProcess = {
  stdout?: { on(event: "data", listener: (chunk: Buffer | string) => void): void };
  stderr?: { on(event: "data", listener: (chunk: Buffer | string) => void): void };
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  kill(signal?: NodeJS.Signals): boolean;
};

type SpawnFunction = (command: string, args: readonly string[], options: { cwd: string; shell: false; windowsHide: true }) => SpawnedProcess;

type RunOptions = {
  spawn?: SpawnFunction;
  now?: () => number;
  setTimeout?: (callback: () => void, ms: number) => unknown;
  clearTimeout?: (timer: unknown) => void;
};

const commandMappings: Record<VerificationCommandId, CommandMapping> = {
  "repository-check": { executable: "npm", args: ["run", "check"], cwdSegments: [] },
  "gui-app-tests": { executable: "npm", args: ["test"], cwdSegments: ["apps", "gui"] },
  "engine-chat-tests": { executable: "cargo", args: ["test", "-p", "yet-lsp", "chat"], cwdSegments: [] },
};
const maxRequestedTimeoutMs = 1800000;
const maxRequestedOutputBytes = 20000;
const maxRequestedOutputLines = 400;
const maxOutputTailChars = 2000;
const safeIdPattern = /^(?!assistant(?:[._-]|$))(?!.*(?:assistant|sk-(?:proj-)?))[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/i;
const safeRequestIdPattern = /^(?!assistant(?:[._-]|$))(?!.*(?:assistant|sk-(?:proj-)?))[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/i;
const unsafeTextPattern = /authorization|bearer|api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|cookie|raw[_ -]?(?:command|output|log|file|prompt|diff)|provider|shell|\bcwd\b|\benv\b|\bgit\b|\btool\b|network|package[_ -]?install|auto[_ -]?(?:start|apply|run|verify|fix)|sk-(?:proj-)?[A-Za-z0-9_-]{8,}|BEGIN [A-Z ]*PRIVATE KEY/i;
const privatePathPattern = /(?:\/(?:Users|home|tmp|var|Volumes|Private|etc|opt|mnt)(?=\/|$|[^A-Za-z0-9_])|~[\/\\]|[A-Za-z]:[\/\\])/i;

export function isControlledVerificationBundleGuiMessage(value: unknown): value is ControlledVerificationBundleGuiMessage {
  return parseControlledVerificationBundleRequest(value) !== undefined;
}

export function isInvalidControlledVerificationBundleRequestMessage(value: unknown): value is ControlledVerificationBundleGuiMessage & { requestId: string } {
  if (!isPlainRecord(value)) return false;
  return hasOnlyKeys(value, ["version", "type", "requestId", "payload"]) &&
    value.version === bridgeVersion &&
    value.type === "gui.controlledAgentVerificationBundleRequest" &&
    isRequiredRequestId(value.requestId) &&
    parseControlledVerificationBundleRequest(value) === undefined;
}

export async function runControlledVerificationBundleRequest(message: ControlledVerificationBundleGuiMessage, workspaceRoots: readonly string[], options: RunOptions = {}): Promise<ControlledVerificationBundleHostMessage> {
  const parsed = parseControlledVerificationBundleRequest(message);
  if (!parsed) {
    const requestId = isRequiredRequestId(message.requestId) ? message.requestId : "invalid-request";
    return createHostMessage(createFallbackRequest(requestId), "blocked", [], "Verification bundle blocked by host policy.", false);
  }
  if (workspaceRoots.length !== 1 || (parsed.workspaceReadinessId !== undefined && privatePathPattern.test(parsed.workspaceReadinessId))) {
    return createHostMessage(parsed, "blocked", parsed.commandIds.map((commandId, index) => blockedStep(commandId, index)), "Verification bundle blocked by host policy.", false);
  }

  const sequence: CommandResult[] = [];
  for (const [index, commandId] of parsed.commandIds.entries()) {
    const result = await runCommand(parsed, commandId, index, workspaceRoots[0], options);
    sequence.push(result);
    if (result.status !== "succeeded") break;
  }
  const status = sequence.some((item) => item.status === "timed_out") ? "timed_out" : sequence.some((item) => item.status === "killed") ? "killed" : sequence.some((item) => item.status === "failed") ? "failed" : "succeeded";
  return createHostMessage(parsed, status, sequence, status === "succeeded" ? "Verification bundle succeeded." : "Verification bundle failed.", sequence.some((item) => item.truncated));
}

export function parseControlledVerificationBundleRequest(value: unknown): ControlledVerificationBundleRequest | undefined {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["version", "type", "requestId", "payload"]) || value.version !== bridgeVersion || value.type !== "gui.controlledAgentVerificationBundleRequest" || !isRequiredRequestId(value.requestId) || !isPlainRecord(value.payload)) return undefined;
  const payload = value.payload;
  if (!hasOnlyKeys(payload, ["requestId", "requestIdMintedBy", "source", "assistantMinted", "controlledWorkspaceId", "runId", "workspaceReadinessId", "bundleId", "userConfirmed", "confirmationKind", "commandIds", "limits", "policyFlags"])) return undefined;
  if (payload.requestId !== value.requestId || !isSafeId(payload.requestId) || payload.requestIdMintedBy !== "gui" || payload.source !== "gui" || payload.assistantMinted !== false || !isSafeId(payload.controlledWorkspaceId) || !isSafeId(payload.runId) || (payload.workspaceReadinessId !== undefined && !isSafeId(payload.workspaceReadinessId)) || !isSafeId(payload.bundleId) || payload.userConfirmed !== true || payload.confirmationKind !== "explicit_user_verification_bundle" || !isCommandIdSequence(payload.commandIds) || !isLimits(payload.limits) || !isRequestPolicyFlags(payload.policyFlags)) return undefined;
  return {
    requestId: value.requestId,
    requestIdMintedBy: "gui",
    source: "gui",
    assistantMinted: false,
    controlledWorkspaceId: payload.controlledWorkspaceId,
    runId: payload.runId,
    ...(payload.workspaceReadinessId === undefined ? {} : { workspaceReadinessId: payload.workspaceReadinessId }),
    bundleId: payload.bundleId,
    userConfirmed: true,
    confirmationKind: "explicit_user_verification_bundle",
    commandIds: payload.commandIds,
    limits: payload.limits,
  };
}

async function runCommand(request: ControlledVerificationBundleRequest, commandId: VerificationCommandId, sequenceIndex: number, workspaceRoot: string, options: RunOptions): Promise<CommandResult> {
  const mapping = commandMappings[commandId];
  const cwd = path.join(workspaceRoot, ...mapping.cwdSegments);
  const startedAt = (options.now ?? Date.now)();
  const spawnProcess = options.spawn ?? ((command, args, spawnOptions) => spawn(command, args, spawnOptions));
  const setTimer = options.setTimeout ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
  const clearTimer = options.clearTimeout ?? ((timer: unknown) => clearTimeout(timer as NodeJS.Timeout));
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let killed = false;
    const chunks: string[] = [];
    const append = (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk);
    const finish = (status: CommandState, exitCode: number | null | undefined, summary: string) => {
      if (settled) return;
      settled = true;
      clearTimer(timer);
      const durationMs = Math.max(0, Math.min((options.now ?? Date.now)() - startedAt, request.limits.maxTimeoutMs));
      const tail = sanitizeOutputTail(chunks.join(""), request.limits.maxOutputBytes, request.limits.maxOutputLines);
      resolve({ stepId: `step-${sequenceIndex + 1}`, sequenceIndex, commandId, status, ...(exitCode === undefined ? {} : { exitCode }), durationMs, outputTail: tail.outputTail, outputByteCount: tail.outputByteCount, outputLineCount: tail.outputLineCount, resultHash: hashText(tail.outputTail), truncated: tail.truncated, summary });
    };
    let child: SpawnedProcess | undefined;
    const timer = setTimer(() => {
      timedOut = true;
      killed = true;
      child?.kill("SIGTERM");
    }, request.limits.maxTimeoutMs);
    try {
      child = spawnProcess(mapping.executable, mapping.args, { cwd, shell: false, windowsHide: true });
    } catch {
      finish("failed", 1, "Verification step failed.");
      return;
    }
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.on("error", () => finish("failed", 1, "Verification step failed."));
    child.on("close", (code, signal) => {
      if (timedOut) {
        finish("timed_out", null, "Verification step timed out.");
        return;
      }
      if (killed || signal !== null) {
        finish("killed", null, "Verification step was killed.");
        return;
      }
      const safeCode = clampExitCode(code ?? 1);
      finish(safeCode === 0 ? "succeeded" : "failed", safeCode, safeCode === 0 ? "Verification step succeeded." : "Verification step failed.");
    });
  });
}

function createHostMessage(request: ControlledVerificationBundleRequest, status: BundleState, sequence: CommandResult[], message: string, truncated: boolean): ControlledVerificationBundleHostMessage {
  return {
    version: bridgeVersion,
    type: "host.controlledAgentVerificationBundleResult",
    requestId: request.requestId,
    payload: {
      requestId: request.requestId,
      requestIdMintedBy: "gui",
      userConfirmed: true,
      controlledWorkspaceId: request.controlledWorkspaceId,
      runId: request.runId,
      ...(request.workspaceReadinessId === undefined ? {} : { workspaceReadinessId: request.workspaceReadinessId }),
      bundleId: request.bundleId,
      status,
      authority: "verification_bundle_fixed_command_ids",
      cloudRequired: false,
      executionAllowed: false,
      freeformCommandAllowed: false,
      commandCount: request.commandIds.length,
      sequence,
      policyFlags: createPolicyFlags(),
      message,
      ...(sequence.length === 0 ? {} : { aggregateResultHash: hashText(sequence.map((item) => `${item.sequenceIndex}:${item.commandId}:${item.status}:${item.resultHash ?? ""}`).join("|")) }),
      truncated,
    },
  };
}

function blockedStep(commandId: VerificationCommandId, sequenceIndex: number): CommandResult {
  return { stepId: `step-${sequenceIndex + 1}`, sequenceIndex, commandId, status: "blocked", truncated: false, summary: "Verification step blocked by host policy." };
}

function sanitizeOutputTail(value: string, byteLimit: number, lineLimit: number): { outputTail: string; outputByteCount: number; outputLineCount: number; truncated: boolean } {
  let text = value.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "");
  let truncated = false;
  const lines = text.split("\n");
  if (lines.length > lineLimit) {
    text = lines.slice(lines.length - lineLimit).join("\n");
    truncated = true;
  }
  let bytes = Buffer.byteLength(text, "utf8");
  while (bytes > byteLimit || text.length > maxOutputTailChars) {
    text = text.slice(Math.max(1, Math.floor(text.length * 0.1)));
    bytes = Buffer.byteLength(text, "utf8");
    truncated = true;
  }
  if (text.length === 0 || unsafeTextPattern.test(text) || privatePathPattern.test(text)) {
    text = "Command output hidden by host policy.";
    bytes = Buffer.byteLength(text, "utf8");
    truncated = true;
  }
  return { outputTail: text, outputByteCount: bytes, outputLineCount: text.split("\n").length, truncated };
}

function isLimits(value: unknown): value is ControlledVerificationBundleRequest["limits"] {
  return isPlainRecord(value) && hasOnlyKeys(value, ["maxCommands", "maxTimeoutMs", "maxOutputBytes", "maxOutputLines", "tailOnly", "commandStringAllowed", "argsAllowed", "cwdAllowed", "envAllowed", "shellAllowed"]) && value.maxCommands === 3 && boundedInteger(value.maxTimeoutMs, 1000, maxRequestedTimeoutMs) && boundedInteger(value.maxOutputBytes, 1, maxRequestedOutputBytes) && boundedInteger(value.maxOutputLines, 1, maxRequestedOutputLines) && value.tailOnly === true && value.commandStringAllowed === false && value.argsAllowed === false && value.cwdAllowed === false && value.envAllowed === false && value.shellAllowed === false;
}

function isRequestPolicyFlags(value: unknown): boolean {
  const expected = createPolicyFlags();
  return isPlainRecord(value) && hasOnlyKeys(value, Object.keys(expected)) && Object.entries(expected).every(([key, expectedValue]) => value[key] === expectedValue);
}

function createFallbackRequest(requestId: string): ControlledVerificationBundleRequest {
  return { requestId, requestIdMintedBy: "gui", source: "gui", assistantMinted: false, controlledWorkspaceId: "workspace-bundle-blocked", runId: "run-bundle-blocked", bundleId: "bundle-blocked", userConfirmed: true, confirmationKind: "explicit_user_verification_bundle", commandIds: ["repository-check"], limits: { maxCommands: 3, maxTimeoutMs: 1000, maxOutputBytes: 1, maxOutputLines: 1, tailOnly: true, commandStringAllowed: false, argsAllowed: false, cwdAllowed: false, envAllowed: false, shellAllowed: false } };
}

function createPolicyFlags() {
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
  } as const;
}

function isCommandIdSequence(value: unknown): value is VerificationCommandId[] {
  return Array.isArray(value) && value.length >= 1 && value.length <= 3 && value.every(isVerificationCommandId);
}

function isVerificationCommandId(value: unknown): value is VerificationCommandId {
  return value === "repository-check" || value === "gui-app-tests" || value === "engine-chat-tests";
}

function isRequiredRequestId(value: unknown): value is string {
  return typeof value === "string" && safeRequestIdPattern.test(value) && !unsafeTextPattern.test(value) && !privatePathPattern.test(value);
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && safeIdPattern.test(value) && !unsafeTextPattern.test(value) && !privatePathPattern.test(value);
}

function boundedInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(record: Record<string, unknown>, allowedKeys: string[]): boolean {
  return Object.keys(record).every((key) => allowedKeys.includes(key));
}

function clampExitCode(value: number): number {
  return Math.max(0, Math.min(Number.isInteger(value) ? value : 1, 255));
}

function hashText(value: string): string {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}
