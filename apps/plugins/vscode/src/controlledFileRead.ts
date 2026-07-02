import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { TextDecoder } from "node:util";
import { bridgeVersion } from "./identity";

export type ControlledFileReadGuiMessage = {
  version: string;
  type: "gui.controlledAgentFileReadRequest";
  requestId?: string;
  payload?: Record<string, unknown>;
};

export type ControlledFileReadHostMessage = {
  version: string;
  type: "host.controlledAgentFileReadResult";
  requestId: string;
  payload: ControlledFileReadMetadata;
};

type ControlledFileReadRequest = {
  requestId: string;
  requestIdMintedBy: "gui" | "host";
  source: "gui" | "host";
  assistantMinted: false;
  controlledWorkspaceId: string;
  runId: string;
  workspaceRelativePath: string;
  maxBytes: number;
  maxLines: number;
  allowBody: boolean;
  singleFileOnly: true;
  recursive: false;
  globAllowed: false;
  regexAllowed: false;
  indexingAllowed: false;
};

type ControlledFileReadBlockedReason = "read_disabled" | "policy_denied" | "unsafe_path" | "outside_workspace" | "hidden_path" | "dependency_path" | "generated_path" | "binary_file" | "symlink_denied" | "too_large" | "budget_exceeded";

type ControlledFileReadMetadata = {
  kind: "controlled_agent_file_read";
  version: "2026-06-29";
  authority: "bounded_text_file_read";
  cloudRequired: false;
  executionAllowed: false;
  agentStartAllowed: false;
  workspace: {
    controlledWorkspaceId: string;
    runId: string;
    workspaceMode: "worktree";
    host: "vscode";
    privatePathExposed: false;
    workspaceLabel: "Controlled worktree";
  };
  request: {
    requestId: string;
    source: "gui" | "host";
    requestIdMintedBy: "gui" | "host";
    assistantMinted: false;
    workspaceRelativePath: string;
    textOnly: true;
    maxBytes: number;
    budget: {
      scope: "single_explicit_file";
      maxBytes: number;
      maxLines: number;
      allowBody: boolean;
      singleFileOnly: true;
      recursive: false;
      globAllowed: false;
      regexAllowed: false;
      indexingAllowed: false;
      budgetLabel: string;
    };
    requestedAt: string;
    reason: string;
  };
  policyFlags: {
    fileReadAllowed: boolean;
    fileWriteAllowed: false;
    shellAllowed: false;
    gitAllowed: false;
    providerAllowed: false;
    toolAllowed: false;
    hiddenSearchAllowed: false;
    indexingAllowed: false;
    binaryReadAllowed: false;
    symlinkAllowed: false;
    autoStartAllowed: false;
    autoApplyAllowed: false;
    autoRunAllowed: false;
  };
  result: {
    status: "blocked" | "success" | "truncated";
    cloudRequired: false;
    executionAllowed: false;
    bodyIncluded: boolean;
    truncated: boolean;
    sanitizedPathLabel?: string;
    byteCount?: number;
    lineCount?: number;
    contentHash?: string;
    text?: string;
    blockedReason?: ControlledFileReadBlockedReason;
    message: string;
  };
};

const maxControlledFileReadBytes = 8192;
const maxControlledFileReadLines = 240;
const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const safeRequestIdPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const dependencySegments = new Set(["node_modules", "vendor"]);
const generatedSegments = new Set(["dist", "build", "out", "target", "coverage", "generated", "tmp", "temp"]);
const secretNamePattern = /auth|credential|password|secret|token|access[_-]?token|api[_-]?key|^\.env$/i;
const secretTextPattern = /authorization|bearer|api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|credential|cookie|BEGIN [A-Z ]*PRIVATE KEY|sk-(?:proj-)?[A-Za-z0-9_-]{8,}/i;

export function isControlledFileReadGuiMessage(value: unknown): value is ControlledFileReadGuiMessage {
  return parseControlledFileReadRequest(value) !== undefined;
}

export function isInvalidControlledFileReadRequestMessage(value: unknown): value is ControlledFileReadGuiMessage & { requestId: string } {
  if (!isPlainRecord(value)) {
    return false;
  }
  return hasOnlyKeys(value, ["version", "type", "requestId", "payload"]) &&
    value.version === bridgeVersion &&
    value.type === "gui.controlledAgentFileReadRequest" &&
    isRequiredRequestId(value.requestId) &&
    parseControlledFileReadRequest(value) === undefined;
}

export async function runControlledFileReadRequest(message: ControlledFileReadGuiMessage, workspaceRoots: readonly string[]): Promise<ControlledFileReadHostMessage> {
  const parsed = parseControlledFileReadRequest(message);
  if (!parsed) {
    const requestId = isRequiredRequestId(message.requestId) ? message.requestId : "invalid-request";
    return createControlledFileReadHostMessage(createFallbackRequest(requestId), "blocked", "policy_denied", "Host policy denied the explicit bounded read");
  }
  if (!parsed.allowBody) {
    return createControlledFileReadHostMessage(parsed, "blocked", "read_disabled", "Host policy denied the explicit bounded read");
  }
  const pathCheck = validateControlledWorkspaceRelativePath(parsed.workspaceRelativePath);
  if (pathCheck !== "ok") {
    return createControlledFileReadHostMessage(parsed, "blocked", pathCheck, "Host policy denied the explicit bounded read");
  }
  const resolved = await resolveControlledWorkspaceFile(parsed.workspaceRelativePath, workspaceRoots);
  if (!resolved.ok) {
    return createControlledFileReadHostMessage(parsed, "blocked", resolved.reason, "Host policy denied the explicit bounded read");
  }
  if (resolved.size > maxControlledFileReadBytes) {
    return createControlledFileReadHostMessage(parsed, "blocked", "too_large", "Host policy denied the explicit bounded read");
  }

  let bytes: Uint8Array;
  try {
    bytes = await fs.readFile(resolved.filePath);
  } catch {
    return createControlledFileReadHostMessage(parsed, "blocked", "policy_denied", "Host policy denied the explicit bounded read");
  }
  if (bytes.byteLength !== resolved.size || bytes.byteLength > maxControlledFileReadBytes || isBinaryBytes(bytes)) {
    return createControlledFileReadHostMessage(parsed, "blocked", bytes.byteLength > maxControlledFileReadBytes ? "too_large" : "binary_file", "Host policy denied the explicit bounded read");
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return createControlledFileReadHostMessage(parsed, "blocked", "binary_file", "Host policy denied the explicit bounded read");
  }
  if (hasBinaryLikeText(text) || secretTextPattern.test(text)) {
    return createControlledFileReadHostMessage(parsed, "blocked", hasBinaryLikeText(text) ? "binary_file" : "policy_denied", "Host policy denied the explicit bounded read");
  }

  const limited = limitText(text, parsed.maxBytes, parsed.maxLines);
  return createControlledFileReadHostMessage(parsed, limited.truncated ? "truncated" : "success", undefined, limited.truncated ? "Bounded text read returned a truncated preview" : "Bounded text read completed within budget", limited.text, limited.byteCount, limited.lineCount);
}

export function parseControlledFileReadRequest(value: unknown): ControlledFileReadRequest | undefined {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["version", "type", "requestId", "payload"]) || value.version !== bridgeVersion || value.type !== "gui.controlledAgentFileReadRequest" || !isRequiredRequestId(value.requestId) || !isPlainRecord(value.payload)) {
    return undefined;
  }
  const payload = value.payload;
  if (!hasOnlyKeys(payload, ["requestIdMintedBy", "source", "assistantMinted", "controlledWorkspaceId", "runId", "runtimeSessionId", "sessionId", "workspaceRelativePath", "maxBytes", "maxLines", "allowBody", "singleFileOnly", "recursive", "globAllowed", "regexAllowed", "indexingAllowed"]) || payload.requestIdMintedBy !== "gui" || payload.source !== "gui" || payload.assistantMinted !== false || !isSafeId(payload.controlledWorkspaceId) || !isSafeId(payload.runId) || (payload.runtimeSessionId !== undefined && !isSafeId(payload.runtimeSessionId)) || (payload.sessionId !== undefined && !isSafeId(payload.sessionId)) || typeof payload.workspaceRelativePath !== "string" || !boundedInteger(payload.maxBytes, 1, maxControlledFileReadBytes) || !boundedInteger(payload.maxLines, 1, maxControlledFileReadLines) || typeof payload.allowBody !== "boolean" || payload.singleFileOnly !== true || payload.recursive !== false || payload.globAllowed !== false || payload.regexAllowed !== false || payload.indexingAllowed !== false) {
    return undefined;
  }
  if (validateControlledWorkspaceRelativePath(payload.workspaceRelativePath) !== "ok") {
    return undefined;
  }
  return {
    requestId: value.requestId,
    requestIdMintedBy: payload.requestIdMintedBy,
    source: payload.source,
    assistantMinted: payload.assistantMinted,
    controlledWorkspaceId: payload.controlledWorkspaceId,
    runId: payload.runId,
    workspaceRelativePath: payload.workspaceRelativePath,
    maxBytes: payload.maxBytes,
    maxLines: payload.maxLines,
    allowBody: payload.allowBody,
    singleFileOnly: payload.singleFileOnly,
    recursive: payload.recursive,
    globAllowed: payload.globAllowed,
    regexAllowed: payload.regexAllowed,
    indexingAllowed: payload.indexingAllowed,
  };
}

function createControlledFileReadHostMessage(request: ControlledFileReadRequest, status: "blocked" | "success" | "truncated", blockedReason: ControlledFileReadBlockedReason | undefined, message: string, text?: string, byteCount?: number, lineCount?: number): ControlledFileReadHostMessage {
  const bodyIncluded = text !== undefined && status !== "blocked";
  return {
    version: bridgeVersion,
    type: "host.controlledAgentFileReadResult",
    requestId: request.requestId,
    payload: {
      kind: "controlled_agent_file_read",
      version: "2026-06-29",
      authority: "bounded_text_file_read",
      cloudRequired: false,
      executionAllowed: false,
      agentStartAllowed: false,
      workspace: {
        controlledWorkspaceId: request.controlledWorkspaceId,
        runId: request.runId,
        workspaceMode: "worktree",
        host: "vscode",
        privatePathExposed: false,
        workspaceLabel: "Controlled worktree",
      },
      request: {
        requestId: request.requestId,
        source: request.source,
        requestIdMintedBy: request.requestIdMintedBy,
        assistantMinted: false,
        workspaceRelativePath: request.workspaceRelativePath,
        textOnly: true,
        maxBytes: request.maxBytes,
        budget: {
          scope: "single_explicit_file",
          maxBytes: request.maxBytes,
          maxLines: request.maxLines,
          allowBody: request.allowBody,
          singleFileOnly: true,
          recursive: false,
          globAllowed: false,
          regexAllowed: false,
          indexingAllowed: false,
          budgetLabel: "Small explicit text read budget",
        },
        requestedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
        reason: bodyIncluded ? "User approved one bounded text read for review" : "Host blocked this explicit read before returning text",
      },
      policyFlags: {
        fileReadAllowed: true,
        fileWriteAllowed: false,
        shellAllowed: false,
        gitAllowed: false,
        providerAllowed: false,
        toolAllowed: false,
        hiddenSearchAllowed: false,
        indexingAllowed: false,
        binaryReadAllowed: false,
        symlinkAllowed: false,
        autoStartAllowed: false,
        autoApplyAllowed: false,
        autoRunAllowed: false,
      },
      result: {
        status,
        cloudRequired: false,
        executionAllowed: false,
        bodyIncluded,
        truncated: status === "truncated",
        ...(bodyIncluded ? {
          sanitizedPathLabel: request.workspaceRelativePath,
          byteCount: byteCount ?? 0,
          lineCount: lineCount ?? 0,
          contentHash: `sha256:${crypto.createHash("sha256").update(text).digest("hex")}`,
          text,
        } : { blockedReason: blockedReason ?? "policy_denied" }),
        message,
      },
    },
  };
}

function createFallbackRequest(requestId: string): ControlledFileReadRequest {
  return {
    requestId,
    requestIdMintedBy: "gui",
    source: "gui",
    assistantMinted: false,
    controlledWorkspaceId: "workspace-read-blocked",
    runId: "run-read-blocked",
    workspaceRelativePath: "blocked/read.txt",
    maxBytes: 1,
    maxLines: 1,
    allowBody: false,
    singleFileOnly: true,
    recursive: false,
    globAllowed: false,
    regexAllowed: false,
    indexingAllowed: false,
  };
}

function validateControlledWorkspaceRelativePath(value: string): "ok" | ControlledFileReadBlockedReason {
  if (value.length === 0 || value.length > 180 || value.startsWith("/") || value.startsWith("~") || /^[A-Za-z]:/.test(value) || value.includes("\\") || value.includes(":") || value.includes("?") || value.includes("#") || value.includes("%") || /[\u0000-\u001f\u007f-\u009f]/.test(value) || value.includes("//") || value.endsWith("/")) {
    return "unsafe_path";
  }
  const segments = value.split("/");
  for (const segment of segments) {
    if (segment.length === 0 || segment === "." || segment === "..") {
      return "unsafe_path";
    }
    if (segment.startsWith(".")) {
      return "hidden_path";
    }
    if (dependencySegments.has(segment)) {
      return "dependency_path";
    }
    if (generatedSegments.has(segment)) {
      return "generated_path";
    }
    if (secretNamePattern.test(segment)) {
      return "unsafe_path";
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment)) {
      return "unsafe_path";
    }
  }
  return "ok";
}

async function resolveControlledWorkspaceFile(workspaceRelativePath: string, workspaceRoots: readonly string[]): Promise<{ ok: true; filePath: string; size: number } | { ok: false; reason: ControlledFileReadBlockedReason }> {
  const segments = workspaceRelativePath.split("/");
  const matches: { filePath: string; size: number }[] = [];
  for (const root of workspaceRoots) {
    const match = await resolveUnderRoot(root, segments);
    if (match.ok) {
      matches.push({ filePath: match.filePath, size: match.size });
    } else if (match.reason === "symlink_denied" || match.reason === "binary_file" || match.reason === "too_large") {
      return match;
    }
  }
  if (matches.length !== 1) {
    return { ok: false, reason: matches.length === 0 ? "outside_workspace" : "policy_denied" };
  }
  return { ok: true, filePath: matches[0].filePath, size: matches[0].size };
}

async function resolveUnderRoot(root: string, segments: string[]): Promise<{ ok: true; filePath: string; size: number } | { ok: false; reason: ControlledFileReadBlockedReason }> {
  let rootReal: string;
  try {
    rootReal = await fs.realpath(root);
  } catch {
    return { ok: false, reason: "outside_workspace" };
  }
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    let entry;
    try {
      entry = await fs.lstat(current);
    } catch {
      return { ok: false, reason: "outside_workspace" };
    }
    if (entry.isSymbolicLink()) {
      return { ok: false, reason: "symlink_denied" };
    }
  }
  let stat;
  try {
    stat = await fs.stat(current);
  } catch {
    return { ok: false, reason: "outside_workspace" };
  }
  if (!stat.isFile()) {
    return { ok: false, reason: "outside_workspace" };
  }
  const fileReal = await fs.realpath(current);
  const relative = path.relative(rootReal, fileReal);
  if (relative.length === 0 || relative.startsWith("..") || path.isAbsolute(relative)) {
    return { ok: false, reason: "outside_workspace" };
  }
  return { ok: true, filePath: current, size: stat.size };
}

function limitText(text: string, maxBytes: number, maxLines: number): { text: string; byteCount: number; lineCount: number; truncated: boolean } {
  const lines = text.split("\n");
  const lineLimited = lines.length > maxLines ? lines.slice(0, maxLines).join("\n") : text;
  const byteLimited = limitUtf8Bytes(lineLimited, maxBytes);
  const lineCount = byteLimited.text.length === 0 ? 0 : byteLimited.text.split("\n").length;
  return {
    text: byteLimited.text,
    byteCount: Buffer.byteLength(byteLimited.text, "utf8"),
    lineCount,
    truncated: lines.length > maxLines || byteLimited.truncated,
  };
}

function limitUtf8Bytes(value: string, maxBytes: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) {
    return { text: value, truncated: false };
  }
  let text = value;
  while (text.length > 0 && Buffer.byteLength(text, "utf8") > maxBytes) {
    text = text.slice(0, -1);
  }
  return { text, truncated: true };
}

function isBinaryBytes(bytes: Uint8Array): boolean {
  for (const byte of bytes) {
    if (byte === 0 || (byte < 9 || (byte > 13 && byte < 32))) {
      return true;
    }
  }
  return false;
}

function hasBinaryLikeText(value: string): boolean {
  return value.includes("\u0000") || /[\u0001-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
}

function isRequiredRequestId(value: unknown): value is string {
  return typeof value === "string" && safeRequestIdPattern.test(value) && !secretTextPattern.test(value);
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && safeIdPattern.test(value) && !/assistant|sk-(?:proj-)?/i.test(value);
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
