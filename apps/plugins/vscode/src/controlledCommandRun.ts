import { spawn } from "node:child_process";
import * as crypto from "node:crypto";
import * as path from "node:path";
import { bridgeVersion } from "./identity";

export type ControlledCommandRunGuiMessage = {
  version: string;
  type: "gui.controlledAgentCommandRunRequest";
  requestId?: string;
  payload?: Record<string, unknown>;
};

export type ControlledCommandRunHostMessage = {
  version: string;
  type: "host.controlledAgentCommandRunResult";
  requestId: string;
  payload: ControlledCommandRunResultPayload;
};

type VerificationCommandId = "repository-check" | "gui-app-tests" | "engine-chat-tests";
type ControlledCommandRunState = "blocked" | "succeeded" | "failed" | "timed_out" | "killed";
type BlockedReason = "policy_denied" | "unknown_command_id" | "missing_user_confirmation" | "workspace_not_ready" | "timeout_exceeds_limit" | "output_limit_exceeds_limit";

type ControlledCommandRunRequest = {
  requestId: string;
  requestIdMintedBy: "gui";
  source: "gui";
  assistantMinted: false;
  controlledWorkspaceId: string;
  runId: string;
  runtimeSessionId?: string;
  sessionId?: string;
  workspaceReadinessId: string;
  userConfirmed: true;
  correlation: {
    origin: "user";
    confirmedBy: "user";
    confirmationId: string;
    hostCorrelationId: string;
  };
  commandId: VerificationCommandId;
  limits: {
    timeoutMs: number;
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

type ControlledCommandRunResultPayload = {
  type: "controlled_agent_command_runner";
  schemaVersion: "2026-07-04";
  state: ControlledCommandRunState;
  authority: "allowlisted_command_id";
  cloudRequired: false;
  controlledWorkspaceId: string;
  runId: string;
  runtimeSessionId?: string;
  sessionId?: string;
  workspaceReadinessId: string;
  requestId: string;
  requestIdMintedBy: "gui";
  userConfirmed: true;
  commandId: VerificationCommandId;
  limits: ControlledCommandRunRequest["limits"];
  policyFlags: {
    allowlistedCommandIdOnly: true;
    freeformCommandAllowed: false;
    argsAllowed: false;
    cwdAllowed: false;
    envAllowed: false;
    shellAllowed: false;
    gitAllowed: false;
    networkAllowed: false;
    providerAllowed: false;
    toolAllowed: false;
    fileReadAllowed: false;
    fileWriteAllowed: false;
    autoRunAllowed: false;
  };
  result: {
    status: ControlledCommandRunState;
    cloudRequired: false;
    freeformCommandAllowed: false;
    privatePathExposed: false;
    rawOutputIncluded: false;
    fullLogIncluded: false;
    authority: "allowlisted_command_id";
    message: string;
    exitCode?: number | null;
    durationMs?: number;
    outputTail?: string;
    outputByteCount?: number;
    outputLineCount?: number;
    resultHash?: string;
    truncated: boolean;
    killed: boolean;
    blockedReason?: BlockedReason;
  };
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
const maxTimeoutMs = 30 * 60 * 1000;
const maxOutputBytes = 20000;
const maxOutputLines = 400;
const maxOutputTailChars = 2000;
const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const safeRequestIdPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const unsafeTextPattern = /authorization|bearer|api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|cookie|private[_-]?path|raw[_ -]?(?:command|output|log|file|prompt|diff)|provider|shell|\bcwd\b|\benv\b|sk-(?:proj-)?[A-Za-z0-9_-]{8,}|BEGIN [A-Z ]*PRIVATE KEY/i;
const privatePathPattern = /(?:\/(?:Users|home|tmp|var|Volumes|Private|etc|opt|mnt)(?=\/|$|[^A-Za-z0-9_])|~[\/\\]|[A-Za-z]:[\/\\])/i;

export function isControlledCommandRunGuiMessage(value: unknown): value is ControlledCommandRunGuiMessage {
  return parseControlledCommandRunRequest(value) !== undefined;
}

export function isInvalidControlledCommandRunRequestMessage(value: unknown): value is ControlledCommandRunGuiMessage & { requestId: string } {
  if (!isPlainRecord(value)) {
    return false;
  }
  return hasOnlyKeys(value, ["version", "type", "requestId", "payload"]) &&
    value.version === bridgeVersion &&
    value.type === "gui.controlledAgentCommandRunRequest" &&
    isRequiredRequestId(value.requestId) &&
    parseControlledCommandRunRequest(value) === undefined;
}

export async function runControlledCommandRunRequest(message: ControlledCommandRunGuiMessage, workspaceRoots: readonly string[], options: RunOptions = {}): Promise<ControlledCommandRunHostMessage> {
  const parsed = parseControlledCommandRunRequest(message);
  if (!parsed) {
    const requestId = isRequiredRequestId(message.requestId) ? message.requestId : "invalid-request";
    return createHostMessage(createFallbackRequest(requestId), "blocked", "policy_denied", "Controlled command run blocked by host policy.", { truncated: false, killed: false });
  }
  if (workspaceRoots.length !== 1 || privatePathPattern.test(parsed.workspaceReadinessId)) {
    return createHostMessage(parsed, "blocked", "workspace_not_ready", "Controlled command run blocked by host policy.", { truncated: false, killed: false });
  }
  const mapping = commandMappings[parsed.commandId];
  const cwd = path.join(workspaceRoots[0], ...mapping.cwdSegments);
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
    const finish = (state: ControlledCommandRunState, exitCode: number | null | undefined, messageText: string, signalKilled: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimer(timer);
      const durationMs = Math.max(0, Math.min((options.now ?? Date.now)() - startedAt, maxTimeoutMs));
      const tail = sanitizeOutputTail(chunks.join(""), parsed.limits.maxOutputBytes, parsed.limits.maxOutputLines);
      resolve(createHostMessage(parsed, state, undefined, messageText, {
        exitCode,
        durationMs,
        outputTail: tail.outputTail,
        outputByteCount: tail.outputByteCount,
        outputLineCount: tail.outputLineCount,
        resultHash: hashText(tail.outputTail),
        truncated: tail.truncated,
        killed: signalKilled,
      }));
    };
    let child: SpawnedProcess;
    const timer = setTimer(() => {
      timedOut = true;
      killed = true;
      if (child) {
        child.kill("SIGTERM");
      }
    }, parsed.limits.timeoutMs);
    try {
      child = spawnProcess(mapping.executable, mapping.args, { cwd, shell: false, windowsHide: true });
    } catch {
      finish("failed", 1, "Controlled command run failed.", false);
      return;
    }
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.on("error", () => finish("failed", 1, "Controlled command run failed.", false));
    child.on("close", (code, signal) => {
      if (timedOut) {
        finish("timed_out", null, "Controlled command run timed out.", true);
        return;
      }
      if (killed || signal !== null) {
        finish("killed", null, "Controlled command run was killed.", true);
        return;
      }
      const safeCode = clampExitCode(code ?? 1);
      finish(safeCode === 0 ? "succeeded" : "failed", safeCode, safeCode === 0 ? "Controlled command run succeeded." : "Controlled command run failed.", false);
    });
  });
}

export function parseControlledCommandRunRequest(value: unknown): ControlledCommandRunRequest | undefined {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["version", "type", "requestId", "payload"]) || value.version !== bridgeVersion || value.type !== "gui.controlledAgentCommandRunRequest" || !isRequiredRequestId(value.requestId) || !isPlainRecord(value.payload)) {
    return undefined;
  }
  const payload = value.payload;
  if (!hasOnlyKeys(payload, ["requestId", "requestIdMintedBy", "source", "assistantMinted", "controlledWorkspaceId", "runId", "runtimeSessionId", "sessionId", "workspaceReadinessId", "userConfirmed", "correlation", "commandId", "limits"]) || payload.requestId !== value.requestId || !isSafeId(payload.requestId) || payload.requestIdMintedBy !== "gui" || payload.source !== "gui" || payload.assistantMinted !== false || !isSafeId(payload.controlledWorkspaceId) || !isSafeId(payload.runId) || (payload.runtimeSessionId !== undefined && !isSafeId(payload.runtimeSessionId)) || (payload.sessionId !== undefined && !isSafeId(payload.sessionId)) || !isSafeId(payload.workspaceReadinessId) || payload.userConfirmed !== true || !isVerificationCommandId(payload.commandId) || !isCorrelation(payload.correlation) || !isLimits(payload.limits)) {
    return undefined;
  }
  return {
    requestId: value.requestId,
    requestIdMintedBy: "gui",
    source: "gui",
    assistantMinted: false,
    controlledWorkspaceId: payload.controlledWorkspaceId,
    runId: payload.runId,
    ...(payload.runtimeSessionId === undefined ? {} : { runtimeSessionId: payload.runtimeSessionId }),
    ...(payload.sessionId === undefined ? {} : { sessionId: payload.sessionId }),
    workspaceReadinessId: payload.workspaceReadinessId,
    userConfirmed: true,
    correlation: payload.correlation,
    commandId: payload.commandId,
    limits: payload.limits,
  };
}

function createHostMessage(request: ControlledCommandRunRequest, state: ControlledCommandRunState, blockedReason: BlockedReason | undefined, message: string, result: { exitCode?: number | null; durationMs?: number; outputTail?: string; outputByteCount?: number; outputLineCount?: number; resultHash?: string; truncated: boolean; killed: boolean }): ControlledCommandRunHostMessage {
  return {
    version: bridgeVersion,
    type: "host.controlledAgentCommandRunResult",
    requestId: request.requestId,
    payload: {
      type: "controlled_agent_command_runner",
      schemaVersion: "2026-07-04",
      state,
      authority: "allowlisted_command_id",
      cloudRequired: false,
      controlledWorkspaceId: request.controlledWorkspaceId,
      runId: request.runId,
      ...(request.runtimeSessionId === undefined ? {} : { runtimeSessionId: request.runtimeSessionId }),
      ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
      workspaceReadinessId: request.workspaceReadinessId,
      requestId: request.requestId,
      requestIdMintedBy: "gui",
      userConfirmed: true,
      commandId: request.commandId,
      limits: request.limits,
      policyFlags: createPolicyFlags(),
      result: {
        status: state,
        cloudRequired: false,
        freeformCommandAllowed: false,
        privatePathExposed: false,
        rawOutputIncluded: false,
        fullLogIncluded: false,
        authority: "allowlisted_command_id",
        message,
        ...(result.exitCode === undefined ? {} : { exitCode: result.exitCode }),
        ...(result.durationMs === undefined ? {} : { durationMs: result.durationMs }),
        ...(result.outputTail === undefined ? {} : { outputTail: result.outputTail }),
        ...(result.outputByteCount === undefined ? {} : { outputByteCount: result.outputByteCount }),
        ...(result.outputLineCount === undefined ? {} : { outputLineCount: result.outputLineCount }),
        ...(result.resultHash === undefined ? {} : { resultHash: result.resultHash }),
        truncated: result.truncated,
        killed: result.killed,
        ...(blockedReason === undefined ? {} : { blockedReason }),
      },
    },
  };
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
  return {
    outputTail: text,
    outputByteCount: bytes,
    outputLineCount: text.split("\n").length,
    truncated,
  };
}

function isCorrelation(value: unknown): value is ControlledCommandRunRequest["correlation"] {
  return isPlainRecord(value) && hasOnlyKeys(value, ["origin", "confirmedBy", "confirmationId", "hostCorrelationId"]) && value.origin === "user" && value.confirmedBy === "user" && isSafeId(value.confirmationId) && isSafeId(value.hostCorrelationId) && value.confirmationId !== value.hostCorrelationId;
}

function isLimits(value: unknown): value is ControlledCommandRunRequest["limits"] {
  return isPlainRecord(value) && hasOnlyKeys(value, ["timeoutMs", "maxOutputBytes", "maxOutputLines", "tailOnly", "commandStringAllowed", "argsAllowed", "cwdAllowed", "envAllowed", "shellAllowed"]) && boundedInteger(value.timeoutMs, 1000, maxTimeoutMs) && boundedInteger(value.maxOutputBytes, 1, maxOutputBytes) && boundedInteger(value.maxOutputLines, 1, maxOutputLines) && value.tailOnly === true && value.commandStringAllowed === false && value.argsAllowed === false && value.cwdAllowed === false && value.envAllowed === false && value.shellAllowed === false;
}

function createFallbackRequest(requestId: string): ControlledCommandRunRequest {
  return {
    requestId,
    requestIdMintedBy: "gui",
    source: "gui",
    assistantMinted: false,
    controlledWorkspaceId: "workspace-command-blocked",
    runId: "run-command-blocked",
    workspaceReadinessId: "ready-command-blocked",
    userConfirmed: true,
    correlation: { origin: "user", confirmedBy: "user", confirmationId: "confirmation-command-blocked", hostCorrelationId: "host-command-blocked" },
    commandId: "repository-check",
    limits: { timeoutMs: 1000, maxOutputBytes: 1, maxOutputLines: 1, tailOnly: true, commandStringAllowed: false, argsAllowed: false, cwdAllowed: false, envAllowed: false, shellAllowed: false },
  };
}

function createPolicyFlags(): ControlledCommandRunResultPayload["policyFlags"] {
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
    fileReadAllowed: false,
    fileWriteAllowed: false,
    autoRunAllowed: false,
  };
}

function isVerificationCommandId(value: unknown): value is VerificationCommandId {
  return value === "repository-check" || value === "gui-app-tests" || value === "engine-chat-tests";
}

function isRequiredRequestId(value: unknown): value is string {
  return typeof value === "string" && safeRequestIdPattern.test(value) && !unsafeTextPattern.test(value);
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && safeIdPattern.test(value) && !/assistant|sk-(?:proj-)?/i.test(value) && !unsafeTextPattern.test(value);
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
