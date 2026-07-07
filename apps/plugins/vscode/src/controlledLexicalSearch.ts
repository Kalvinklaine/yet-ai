import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { TextDecoder } from "node:util";
import { bridgeVersion } from "./identity";

export type ControlledLexicalSearchGuiMessage = {
  version: string;
  type: "gui.controlledAgentLexicalSearchRequest";
  requestId?: string;
  payload?: Record<string, unknown>;
};

export type ControlledLexicalSearchHostMessage = {
  version: string;
  type: "host.controlledAgentLexicalSearchResult";
  requestId: string;
  payload: ControlledLexicalSearchResultPayload;
};

type ControlledLexicalSearchRequest = {
  requestId: string;
  requestIdMintedBy: "gui";
  source: "gui";
  assistantMinted: false;
  controlledWorkspaceId: string;
  runId: string;
  runtimeSessionId?: string;
  sessionId?: string;
  workspaceReadinessId: string;
  explicitUserGesture: true;
  userGestureId: string;
  host: "vscode";
  query: string;
  queryMode: "literal_text";
  scope: ControlledLexicalSearchScope;
  limits: ControlledLexicalSearchLimits;
};

type ControlledLexicalSearchScope = {
  kind: "controlled_workspace_bounded";
  controlledWorkspaceOnly: true;
  includePathLabels: string[];
  excludeHidden: true;
  excludeDependencies: true;
  excludeGenerated: true;
  excludeBinary: true;
  excludeSecretLikePaths: true;
  recursiveAllowed: false;
  broadWorkspaceScanAllowed: false;
};

type ControlledLexicalSearchLimits = {
  maxFilesScanned: number;
  maxMatches: number;
  maxSnippetBytes: number;
  literalOnly: true;
  regexAllowed: false;
  globAllowed: false;
  pathQueryAllowed: false;
  indexingAllowed: false;
  backgroundAllowed: false;
};

type ControlledLexicalSearchStatus = "blocked" | "succeeded" | "truncated";
type ControlledLexicalSearchBlockedReason = "search_disabled" | "policy_denied" | "unsupported_host" | "unsafe_query" | "unsafe_scope" | "outside_workspace" | "budget_exceeded" | "assistant_minted";

type ControlledLexicalSearchSnippet = {
  pathLabel: string;
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  languageId: string;
  snippet: string;
  snippetByteCount: number;
  snippetHash: string;
  matchCount: number;
  truncated: boolean;
};

type ControlledLexicalSearchResultPayload = {
  requestId: string;
  requestIdMintedBy: "gui";
  userConfirmed: true;
  explicitUserGesture: true;
  controlledWorkspaceId: string;
  runId: string;
  runtimeSessionId?: string;
  sessionId?: string;
  workspaceReadinessId: string;
  host: "vscode";
  status: ControlledLexicalSearchStatus;
  authority: "explicit_literal_lexical_search_metadata";
  cloudRequired: false;
  executionAllowed: false;
  searchAllowed: boolean;
  privatePathExposed: false;
  rawContentIncluded: false;
  policyFlags: ReturnType<typeof createPolicyFlags>;
  resultCount: number;
  totalMatchCount: number;
  totalSnippetBytes: number;
  truncated: boolean;
  resultHash: string;
  snippets: ControlledLexicalSearchSnippet[];
  blockedReason?: ControlledLexicalSearchBlockedReason;
  message: string;
};

type ResolvedSearchFile = { workspaceRelativePath: string; filePath: string; size: number };

const maxSearchFileBytes = 1024 * 1024;
const maxFilesScanned = 200;
const maxMatches = 20;
const maxSnippetBytes = 600;
const maxTotalSnippetBytes = 4000;
const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const safeRequestIdPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const dependencySegments = new Set(["node_modules", "vendor"]);
const generatedSegments = new Set(["dist", "build", "out", "target", "coverage", "__pycache__", "generated", "tmp", "temp", "cache"]);
const unsafeQueryPattern = /[\u0000-\u001f\u007f-\u009f]|[*/\\~]|\.\.|[{}[\]()^$+?|]|[;&`$<>]|\b(?:cwd|env|shell|git|tool|provider|model|apiKey|requestId|assistant|regex|glob|path|raw|dump|output|command|prompt)\b|authorization|bearer|cookie|api[_-]?key|token|secret|password|private[_-]?path|[A-Za-z]:|(?:^|[^A-Za-z0-9_-])sk-(?:proj-)?[A-Za-z0-9_-]{8,}/i;
const unsafeTextPattern = /authorization|bearer|api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|credential|cookie|BEGIN [A-Z ]*PRIVATE KEY|sk-(?:proj-)?[A-Za-z0-9_-]{8,}/i;
const privatePathPattern = /(?:\/(?:Users|home|tmp|var|Volumes|Private|etc|opt|mnt)(?=\/|$|[^A-Za-z0-9_])|~[\/\\]|[A-Za-z]:[\/\\])/i;
const secretNamePattern = /^(?:auth|authorization|bearer|cookie|credential|credentials|password|secret|secrets|token|tokens|access[_-]?token|api[_-]?key|\.env)(?:[._-]|$)|(?:^|[._-])(?:credential|credentials|password|secret|secrets|token|tokens|access[_-]?token|api[_-]?key)(?:[._-]|$)/i;

export function isControlledLexicalSearchGuiMessage(value: unknown): value is ControlledLexicalSearchGuiMessage {
  return parseControlledLexicalSearchRequest(value) !== undefined;
}

export function isInvalidControlledLexicalSearchRequestMessage(value: unknown): value is ControlledLexicalSearchGuiMessage & { requestId: string } {
  if (!isPlainRecord(value)) {
    return false;
  }
  return hasOnlyKeys(value, ["version", "type", "requestId", "payload"]) &&
    value.version === bridgeVersion &&
    value.type === "gui.controlledAgentLexicalSearchRequest" &&
    isRequiredRequestId(value.requestId) &&
    parseControlledLexicalSearchRequest(value) === undefined;
}

export async function runControlledLexicalSearchRequest(message: ControlledLexicalSearchGuiMessage, workspaceRoots: readonly string[]): Promise<ControlledLexicalSearchHostMessage> {
  const parsed = parseControlledLexicalSearchRequest(message);
  if (!parsed) {
    const requestId = isRequiredRequestId(message.requestId) ? message.requestId : "invalid-request";
    return createHostMessage(createFallbackRequest(requestId), "blocked", "policy_denied", [], false, "Literal lexical search blocked by host policy.");
  }
  if (!isSafeQuery(parsed.query)) {
    return createHostMessage(parsed, "blocked", "unsafe_query", [], false, "Literal lexical search blocked by host policy.");
  }
  if (workspaceRoots.length === 0 || parsed.scope.includePathLabels.length > parsed.limits.maxFilesScanned || parsed.limits.maxFilesScanned > maxFilesScanned || parsed.limits.maxMatches > maxMatches || parsed.limits.maxSnippetBytes > maxSnippetBytes) {
    return createHostMessage(parsed, "blocked", "budget_exceeded", [], false, "Literal lexical search blocked by host policy.");
  }

  const resolvedFiles: ResolvedSearchFile[] = [];
  for (const workspaceRelativePath of parsed.scope.includePathLabels) {
    const pathCheck = validateControlledSearchPath(workspaceRelativePath);
    if (pathCheck !== "ok") {
      return createHostMessage(parsed, "blocked", pathCheck === "outside_workspace" ? "outside_workspace" : "unsafe_scope", [], false, "Literal lexical search blocked by host policy.");
    }
    const resolved = await resolveControlledWorkspaceFile(workspaceRelativePath, workspaceRoots);
    if (!resolved.ok) {
      return createHostMessage(parsed, "blocked", resolved.reason, [], false, "Literal lexical search blocked by host policy.");
    }
    resolvedFiles.push({ workspaceRelativePath, filePath: resolved.filePath, size: resolved.size });
  }

  const snippets: ControlledLexicalSearchSnippet[] = [];
  let truncated = false;
  let totalMatchCount = 0;
  for (const resolved of resolvedFiles.sort((left, right) => left.workspaceRelativePath.localeCompare(right.workspaceRelativePath, "en-US"))) {
    if (snippets.length >= parsed.limits.maxMatches) {
      truncated = true;
      break;
    }
    const text = await readSafeSearchText(resolved.filePath, resolved.size);
    if (!text.ok) {
      return createHostMessage(parsed, "blocked", text.reason, [], false, "Literal lexical search blocked by host policy.");
    }
    const fileSnippets = createSnippets(resolved.workspaceRelativePath, text.text, parsed.query, parsed.limits.maxSnippetBytes, parsed.limits.maxMatches - snippets.length);
    if (snippets.reduce((total, snippet) => total + snippet.snippetByteCount, 0) + fileSnippets.snippets.reduce((total, snippet) => total + snippet.snippetByteCount, 0) > maxTotalSnippetBytes) {
      return createHostMessage(parsed, "blocked", "budget_exceeded", [], false, "Literal lexical search blocked by host policy.");
    }
    totalMatchCount += countLiteralMatches(text.text, parsed.query);
    snippets.push(...fileSnippets.snippets);
    truncated = truncated || fileSnippets.truncated || totalMatchCount > snippets.length;
  }

  const status: ControlledLexicalSearchStatus = truncated ? "truncated" : "succeeded";
  return createHostMessage(parsed, status, undefined, snippets, truncated, status === "truncated" ? "Literal snippets returned as truncated sanitized metadata." : "Literal snippets returned as sanitized metadata.", totalMatchCount);
}

export function parseControlledLexicalSearchRequest(value: unknown): ControlledLexicalSearchRequest | undefined {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["version", "type", "requestId", "payload"]) || value.version !== bridgeVersion || value.type !== "gui.controlledAgentLexicalSearchRequest" || !isRequiredRequestId(value.requestId) || !isPlainRecord(value.payload)) {
    return undefined;
  }
  const payload = value.payload;
  if (!hasOnlyKeys(payload, ["requestId", "requestIdMintedBy", "source", "assistantMinted", "controlledWorkspaceId", "runId", "runtimeSessionId", "sessionId", "workspaceReadinessId", "explicitUserGesture", "userGestureId", "host", "query", "queryMode", "scope", "limits", "policyFlags"]) || payload.requestId !== value.requestId || !isSafeId(payload.requestId) || payload.requestIdMintedBy !== "gui" || payload.source !== "gui" || payload.assistantMinted !== false || !isSafeId(payload.controlledWorkspaceId) || !isSafeId(payload.runId) || (payload.runtimeSessionId !== undefined && !isSafeId(payload.runtimeSessionId)) || (payload.sessionId !== undefined && !isSafeId(payload.sessionId)) || !isSafeId(payload.workspaceReadinessId) || payload.explicitUserGesture !== true || !isSafeId(payload.userGestureId) || payload.host !== "vscode" || typeof payload.query !== "string" || !isSafeQuery(payload.query) || payload.queryMode !== "literal_text" || !isScope(payload.scope) || !isLimits(payload.limits) || !isPolicyFlags(payload.policyFlags)) {
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
    explicitUserGesture: true,
    userGestureId: payload.userGestureId,
    host: "vscode",
    query: payload.query,
    queryMode: "literal_text",
    scope: payload.scope,
    limits: payload.limits,
  };
}

function createHostMessage(request: ControlledLexicalSearchRequest, status: ControlledLexicalSearchStatus, blockedReason: ControlledLexicalSearchBlockedReason | undefined, snippets: ControlledLexicalSearchSnippet[], truncated: boolean, message: string, totalMatchCount = 0): ControlledLexicalSearchHostMessage {
  const totalSnippetBytes = snippets.reduce((total, snippet) => total + snippet.snippetByteCount, 0);
  return {
    version: bridgeVersion,
    type: "host.controlledAgentLexicalSearchResult",
    requestId: request.requestId,
    payload: {
      requestId: request.requestId,
      requestIdMintedBy: "gui",
      userConfirmed: true,
      explicitUserGesture: true,
      controlledWorkspaceId: request.controlledWorkspaceId,
      runId: request.runId,
      ...(request.runtimeSessionId === undefined ? {} : { runtimeSessionId: request.runtimeSessionId }),
      ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
      workspaceReadinessId: request.workspaceReadinessId,
      host: "vscode",
      status,
      authority: "explicit_literal_lexical_search_metadata",
      cloudRequired: false,
      executionAllowed: false,
      searchAllowed: status !== "blocked",
      privatePathExposed: false,
      rawContentIncluded: false,
      policyFlags: createPolicyFlags(),
      resultCount: snippets.length,
      totalMatchCount: Math.min(totalMatchCount, 200),
      totalSnippetBytes,
      truncated,
      resultHash: hashText(JSON.stringify(snippets)),
      snippets,
      ...(status === "blocked" ? { blockedReason: blockedReason ?? "policy_denied" } : {}),
      message,
    },
  };
}

function createPolicyFlags() {
  return {
    explicitLiteralSearchAllowed: true,
    hiddenSearchAllowed: false,
    backgroundSearchAllowed: false,
    indexingAllowed: false,
    regexAllowed: false,
    globAllowed: false,
    pathQueryAllowed: false,
    broadWorkspaceScanAllowed: false,
    fileReadBodyAllowed: false,
    fileWriteAllowed: false,
    shellAllowed: false,
    gitAllowed: false,
    providerAllowed: false,
    toolAllowed: false,
    autoSearchAllowed: false,
    autoApplyAllowed: false,
    autoRunAllowed: false,
  };
}

function createFallbackRequest(requestId: string): ControlledLexicalSearchRequest {
  return {
    requestId,
    requestIdMintedBy: "gui",
    source: "gui",
    assistantMinted: false,
    controlledWorkspaceId: "workspace-search-blocked",
    runId: "run-search-blocked",
    workspaceReadinessId: "ready-search-blocked",
    explicitUserGesture: true,
    userGestureId: "gesture-search-blocked",
    host: "vscode",
    query: "blocked",
    queryMode: "literal_text",
    scope: {
      kind: "controlled_workspace_bounded",
      controlledWorkspaceOnly: true,
      includePathLabels: ["blocked/search.txt"],
      excludeHidden: true,
      excludeDependencies: true,
      excludeGenerated: true,
      excludeBinary: true,
      excludeSecretLikePaths: true,
      recursiveAllowed: false,
      broadWorkspaceScanAllowed: false,
    },
    limits: { maxFilesScanned: 1, maxMatches: 1, maxSnippetBytes: 1, literalOnly: true, regexAllowed: false, globAllowed: false, pathQueryAllowed: false, indexingAllowed: false, backgroundAllowed: false },
  };
}

function isScope(value: unknown): value is ControlledLexicalSearchScope {
  return isPlainRecord(value) &&
    hasOnlyKeys(value, ["kind", "controlledWorkspaceOnly", "includePathLabels", "excludeHidden", "excludeDependencies", "excludeGenerated", "excludeBinary", "excludeSecretLikePaths", "recursiveAllowed", "broadWorkspaceScanAllowed"]) &&
    value.kind === "controlled_workspace_bounded" &&
    value.controlledWorkspaceOnly === true &&
    Array.isArray(value.includePathLabels) &&
    value.includePathLabels.length >= 1 &&
    value.includePathLabels.length <= 8 &&
    new Set(value.includePathLabels).size === value.includePathLabels.length &&
    value.includePathLabels.every((entry) => typeof entry === "string" && validateControlledSearchPath(entry) === "ok") &&
    value.excludeHidden === true &&
    value.excludeDependencies === true &&
    value.excludeGenerated === true &&
    value.excludeBinary === true &&
    value.excludeSecretLikePaths === true &&
    value.recursiveAllowed === false &&
    value.broadWorkspaceScanAllowed === false;
}

function isLimits(value: unknown): value is ControlledLexicalSearchLimits {
  return isPlainRecord(value) &&
    hasOnlyKeys(value, ["maxFilesScanned", "maxMatches", "maxSnippetBytes", "literalOnly", "regexAllowed", "globAllowed", "pathQueryAllowed", "indexingAllowed", "backgroundAllowed"]) &&
    boundedInteger(value.maxFilesScanned, 1, maxFilesScanned) &&
    boundedInteger(value.maxMatches, 0, maxMatches) &&
    boundedInteger(value.maxSnippetBytes, 1, maxSnippetBytes) &&
    value.literalOnly === true &&
    value.regexAllowed === false &&
    value.globAllowed === false &&
    value.pathQueryAllowed === false &&
    value.indexingAllowed === false &&
    value.backgroundAllowed === false;
}

function isPolicyFlags(value: unknown): boolean {
  const expected = createPolicyFlags();
  return isPlainRecord(value) && hasOnlyKeys(value, Object.keys(expected)) && Object.entries(expected).every(([key, expectedValue]) => value[key] === expectedValue);
}

function validateControlledSearchPath(value: string): "ok" | "unsafe_scope" | "outside_workspace" {
  if (value.length === 0 || value.length > 180 || value.startsWith("/") || value.startsWith("~") || /^[A-Za-z]:/.test(value) || value.includes("\\") || /[:*?"<>|{}[\]$^+]/.test(value) || value.includes("%") || /[\u0000-\u001f\u007f-\u009f]/.test(value) || value.includes("//") || value.endsWith("/")) {
    return "unsafe_scope";
  }
  const segments = value.split("/");
  for (const segment of segments) {
    if (segment.length === 0 || segment === "..") {
      return "unsafe_scope";
    }
    if (segment === "." || segment.startsWith(".")) {
      return "unsafe_scope";
    }
    if (dependencySegments.has(segment) || generatedSegments.has(segment) || secretNamePattern.test(segment)) {
      return "unsafe_scope";
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment)) {
      return "unsafe_scope";
    }
  }
  return "ok";
}

async function resolveControlledWorkspaceFile(workspaceRelativePath: string, workspaceRoots: readonly string[]): Promise<{ ok: true; filePath: string; size: number } | { ok: false; reason: ControlledLexicalSearchBlockedReason }> {
  const segments = workspaceRelativePath.split("/");
  const matches: { filePath: string; size: number }[] = [];
  for (const root of workspaceRoots) {
    const match = await resolveUnderRoot(root, segments);
    if (match.ok) {
      matches.push({ filePath: match.filePath, size: match.size });
    } else if (match.reason === "policy_denied" || match.reason === "budget_exceeded") {
      return match;
    }
  }
  if (matches.length !== 1) {
    return { ok: false, reason: matches.length === 0 ? "outside_workspace" : "policy_denied" };
  }
  return { ok: true, filePath: matches[0].filePath, size: matches[0].size };
}

async function resolveUnderRoot(root: string, segments: string[]): Promise<{ ok: true; filePath: string; size: number } | { ok: false; reason: ControlledLexicalSearchBlockedReason }> {
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
      return { ok: false, reason: "policy_denied" };
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
  if (stat.size > maxSearchFileBytes) {
    return { ok: false, reason: "budget_exceeded" };
  }
  const fileReal = await fs.realpath(current);
  const relative = path.relative(rootReal, fileReal);
  if (relative.length === 0 || relative.startsWith("..") || path.isAbsolute(relative)) {
    return { ok: false, reason: "outside_workspace" };
  }
  return { ok: true, filePath: current, size: stat.size };
}

async function readSafeSearchText(filePath: string, expectedSize: number): Promise<{ ok: true; text: string } | { ok: false; reason: ControlledLexicalSearchBlockedReason }> {
  let bytes: Uint8Array;
  try {
    bytes = await fs.readFile(filePath);
  } catch {
    return { ok: false, reason: "policy_denied" };
  }
  if (bytes.byteLength !== expectedSize || bytes.byteLength > maxSearchFileBytes || isBinaryBytes(bytes)) {
    return { ok: false, reason: bytes.byteLength > maxSearchFileBytes ? "budget_exceeded" : "policy_denied" };
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (hasBinaryLikeText(text) || unsafeTextPattern.test(text) || privatePathPattern.test(text)) {
      return { ok: false, reason: "policy_denied" };
    }
    return { ok: true, text };
  } catch {
    return { ok: false, reason: "policy_denied" };
  }
}

function createSnippets(workspaceRelativePath: string, text: string, query: string, snippetByteLimit: number, remainingMatches: number): { snippets: ControlledLexicalSearchSnippet[]; truncated: boolean } {
  const snippets: ControlledLexicalSearchSnippet[] = [];
  let truncated = false;
  let searchFrom = 0;
  while (remainingMatches > snippets.length) {
    const matchIndex = text.indexOf(query, searchFrom);
    if (matchIndex === -1) {
      break;
    }
    const snippet = createSnippet(workspaceRelativePath, text, query, matchIndex, snippetByteLimit);
    if (snippet === undefined) {
      truncated = true;
    } else {
      snippets.push(snippet);
    }
    searchFrom = matchIndex + Math.max(query.length, 1);
  }
  if (text.indexOf(query, searchFrom) !== -1) {
    truncated = true;
  }
  return { snippets, truncated };
}

function createSnippet(workspaceRelativePath: string, text: string, query: string, matchIndex: number, snippetByteLimit: number): ControlledLexicalSearchSnippet | undefined {
  const margin = Math.max(0, Math.floor((snippetByteLimit - Buffer.byteLength(query, "utf8")) / 2));
  const snippetStart = Math.max(0, matchIndex - margin);
  const rawEnd = Math.min(text.length, matchIndex + query.length + margin);
  const limited = limitUtf8Bytes(text.slice(snippetStart, rawEnd), snippetByteLimit);
  const snippet = sanitizeSnippetText(limited.text);
  if (snippet === undefined) {
    return undefined;
  }
  const start = positionAtTextOffset(text, matchIndex);
  const end = positionAtTextOffset(text, matchIndex + query.length);
  const snippetByteCount = Buffer.byteLength(snippet, "utf8");
  return {
    pathLabel: workspaceRelativePath,
    range: { start, end },
    languageId: languageIdForPath(workspaceRelativePath),
    snippet,
    snippetByteCount,
    snippetHash: hashText(snippet),
    matchCount: 1,
    truncated: limited.truncated || snippetStart > 0 || rawEnd < text.length,
  };
}

function countLiteralMatches(text: string, query: string): number {
  let count = 0;
  let searchFrom = 0;
  while (count < 200) {
    const matchIndex = text.indexOf(query, searchFrom);
    if (matchIndex === -1) {
      break;
    }
    count += 1;
    searchFrom = matchIndex + Math.max(query.length, 1);
  }
  return count;
}

function sanitizeSnippetText(value: string): string | undefined {
  const text = value.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "");
  if (text.length === 0 || Buffer.byteLength(text, "utf8") > maxSnippetBytes || unsafeTextPattern.test(text) || privatePathPattern.test(text) || hasBinaryLikeText(text)) {
    return undefined;
  }
  return text;
}

function languageIdForPath(workspaceRelativePath: string): string {
  const extension = path.posix.extname(workspaceRelativePath).toLowerCase();
  const languageIds: Record<string, string> = {
    ".css": "css",
    ".go": "go",
    ".html": "html",
    ".js": "javascript",
    ".json": "json",
    ".jsx": "javascriptreact",
    ".md": "markdown",
    ".py": "python",
    ".rs": "rust",
    ".ts": "typescript",
    ".tsx": "typescriptreact",
    ".txt": "plaintext",
  };
  return languageIds[extension] ?? "plaintext";
}

function positionAtTextOffset(text: string, targetOffset: number): { line: number; character: number } {
  let line = 0;
  let character = 0;
  const boundedOffset = Math.max(0, Math.min(targetOffset, text.length));
  for (let index = 0; index < boundedOffset; index += 1) {
    if (text[index] === "\n") {
      line += 1;
      character = 0;
    } else {
      character += 1;
    }
  }
  return { line, character };
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

function isSafeQuery(value: string): boolean {
  return value.length > 0 && value.length <= 120 && /\S/.test(value) && !unsafeQueryPattern.test(value) && !privatePathPattern.test(value);
}

function isBinaryBytes(bytes: Uint8Array): boolean {
  const sampleLength = Math.min(bytes.length, 8000);
  for (let index = 0; index < sampleLength; index += 1) {
    const byte = bytes[index];
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

function hashText(value: string): string {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}
