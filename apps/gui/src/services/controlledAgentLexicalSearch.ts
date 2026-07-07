import { evaluateControlledAgentRuntimeSession } from "./controlledAgentRuntimeSession";
import { evaluateControlledAgentWorkspaceReadiness } from "./controlledAgentWorkspaceReadiness";
import { sanitizeDisplayText, sanitizeDisplayValue, sanitizeTimelineText } from "./redaction";

export type ControlledAgentLexicalSearchDiagnosticCode =
  | "missing_input"
  | "malformed_input"
  | "browser_host"
  | "unsupported_host"
  | "runtime_session_not_ready"
  | "workspace_not_ready"
  | "assistant_authority_blocked"
  | "unsafe_query"
  | "unsafe_metadata"
  | "stale_result"
  | "duplicate_result"
  | "invalid_authority";

export type ControlledAgentLexicalSearchDiagnostic = {
  code: ControlledAgentLexicalSearchDiagnosticCode;
  message: string;
};

export type ControlledAgentLexicalSearchPolicyFlags = {
  explicitLiteralSearchAllowed: true;
  hiddenSearchAllowed: false;
  backgroundSearchAllowed: false;
  indexingAllowed: false;
  regexAllowed: false;
  globAllowed: false;
  pathQueryAllowed: false;
  broadWorkspaceScanAllowed: false;
  fileReadBodyAllowed: false;
  fileWriteAllowed: false;
  shellAllowed: false;
  gitAllowed: false;
  providerAllowed: false;
  toolAllowed: false;
  autoSearchAllowed: false;
  autoApplyAllowed: false;
  autoRunAllowed: false;
};

export type ControlledAgentLexicalSearchBridgeRequest = {
  version: "2026-05-15";
  type: "gui.controlledAgentLexicalSearchRequest";
  requestId: string;
  payload: {
    requestId: string;
    requestIdMintedBy: "gui";
    source: "gui";
    assistantMinted: false;
    controlledWorkspaceId: string;
    runId: string;
    runtimeSessionId: string;
    workspaceReadinessId: string;
    explicitUserGesture: true;
    userGestureId: string;
    host: "vscode";
    query: string;
    queryMode: "literal_text";
    scope: {
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
    limits: {
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
    policyFlags: ControlledAgentLexicalSearchPolicyFlags;
  };
};

export type ControlledAgentLexicalSearchCorrelation = {
  requestId: string;
  runId: string;
  controlledWorkspaceId: string;
  runtimeSessionId: string;
  workspaceReadinessId: string;
  userGestureId: string;
  query: string;
};

export type ControlledAgentLexicalSearchRequestInput = {
  host: "browser" | "vscode" | "jetbrains";
  runtimeSessionMetadata?: unknown;
  workspaceReadinessMetadata?: unknown;
  query?: unknown;
  includePathLabels?: unknown;
  explicitUserGesture?: unknown;
  userGestureId?: unknown;
  requestSeed?: unknown;
};

export type ControlledAgentLexicalSearchRequestResult = {
  state: "ready" | "blocked" | "unsupported";
  bridgeRequest?: ControlledAgentLexicalSearchBridgeRequest;
  correlation?: ControlledAgentLexicalSearchCorrelation;
  diagnostics: ControlledAgentLexicalSearchDiagnostic[];
  details: Record<string, string | number | boolean | string[]>;
  authority: ControlledAgentLexicalSearchAuthority;
};

export type ControlledAgentLexicalSearchSnippet = {
  pathLabel: string;
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  languageId?: string;
  snippet: string;
  snippetByteCount: number;
  snippetHash: string;
  matchCount: number;
  truncated: boolean;
};

export type ControlledAgentLexicalSearchSummary = {
  status: "succeeded" | "blocked" | "failed";
  resultCount: number;
  totalMatchCount: number;
  totalSnippetBytes: number;
  truncated: boolean;
  resultHash?: string;
  snippets: ControlledAgentLexicalSearchSnippet[];
  message: string;
};

export type ControlledAgentLexicalSearchResultInput = {
  current: ControlledAgentLexicalSearchCorrelation;
  hostMessage: { version?: string; type?: string; requestId?: string; payload?: unknown };
  existingResult?: ControlledAgentLexicalSearchSummary;
};

export type ControlledAgentLexicalSearchResultCorrelationResult = {
  state: "accepted" | "ignored" | "duplicate" | "blocked";
  lexicalSearch?: ControlledAgentLexicalSearchSummary;
  diagnostics: ControlledAgentLexicalSearchDiagnostic[];
  details: Record<string, string | number | boolean | string[]>;
  authority: ControlledAgentLexicalSearchAuthority;
};

export type ControlledAgentLexicalSearchAuthority = {
  cloudRequired: false;
  executionAllowed: false;
  searchAllowed: false;
  canReadFileBodies: false;
  canSearchHidden: false;
  canSearchInBackground: false;
  canUseIndexing: false;
  canUseRegex: false;
  canUseGlob: false;
  canQueryPaths: false;
  canRunCommands: false;
  canWriteFiles: false;
  canUseGit: false;
  canCallProvider: false;
  canUseTools: false;
  canAutoSearch: false;
  canAttachToPrompt: false;
};

const authority: ControlledAgentLexicalSearchAuthority = {
  cloudRequired: false,
  executionAllowed: false,
  searchAllowed: false,
  canReadFileBodies: false,
  canSearchHidden: false,
  canSearchInBackground: false,
  canUseIndexing: false,
  canUseRegex: false,
  canUseGlob: false,
  canQueryPaths: false,
  canRunCommands: false,
  canWriteFiles: false,
  canUseGit: false,
  canCallProvider: false,
  canUseTools: false,
  canAutoSearch: false,
  canAttachToPrompt: false,
};

const policyFlags: ControlledAgentLexicalSearchPolicyFlags = {
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

const safeIdPattern = /^(?!assistant(?:[._:-]|$))(?!.*(?:assistant|sk-(?:proj-)?))[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/i;
const safeHashPattern = /^sha256:[a-f0-9]{64}$/;
const unsafeKeyPattern = /^(?:command|cmd|args|arguments|cwd|env|environment|network|git|provider|tool|shell|rawCommand|raw_command|rawFile|raw_file|rawFileBody|raw_file_body|fileBody|file_body|fileContents|file_contents|rawContent|raw_content|rawPrompt|raw_prompt|rawOutput|raw_output|browserStorage|browser_storage|storageDump|storage_dump|hiddenRead|hidden_read|hiddenSearch|hidden_search|regex|glob|index|indexing|autoSearch|auto_search|autoApply|auto_apply|autoRun|auto_run)$/i;
const unsafeTextPattern = /authorization|bearer|api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|cookie|raw[_ -]?(?:file|prompt|command|output|log|body|content)|file[_ -]?(?:body|content|dump)|provider|shell|command|cwd|\benv\b|\bgit\b|\btool\b|network|hidden[_ -]?(?:scan|read|search)|index(?:ing)?|auto[_ -]?(?:search|apply|run)|sk-(?:proj-)?[A-Za-z0-9_-]{8,}|BEGIN [A-Z ]*PRIVATE KEY|\/(?:Users|home|tmp|var|etc|opt|mnt|Volumes|private)(?=\/|$)|[A-Za-z]:(?:\\|\/)|~(?:\\|\/)/i;
const queryPattern = /^[A-Za-z0-9][A-Za-z0-9 ._:@#-]{0,119}$/;
const safePathPattern = /^(?!\/)(?![A-Za-z]:)(?!~)(?!.*(?:^|\/)\.)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\/\/)(?!.*[\\:*?"<>|{}\[\]$^+])(?!(?:^|.*\/)(?:node_modules|vendor|dist|build|out|target|coverage|__pycache__|generated|tmp|temp|secrets?|credentials?|private)(?:\/|$))(?!.*(?:^|[._-])(?:auth|credentials?|password|secret|token|access[_-]?token|api[_-]?key)(?:[._-]|$))[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/i;

export function buildControlledAgentLexicalSearchRequest(input: unknown): ControlledAgentLexicalSearchRequestResult {
  const diagnostics: ControlledAgentLexicalSearchDiagnostic[] = [];
  if (!isPlainObject(input)) {
    diagnostics.push(diagnostic("missing_input", "Controlled lexical search request metadata is absent."));
    return requestBlocked("blocked", diagnostics, { displayOnly: true });
  }

  scanUnsafeMetadata(input, diagnostics);
  const metadata = input as ControlledAgentLexicalSearchRequestInput;
  const host = metadata.host;
  if (host === "browser") diagnostics.push(diagnostic("browser_host", "Browser preview cannot post controlled lexical search requests."));
  else if (host === "jetbrains") diagnostics.push(diagnostic("unsupported_host", "JetBrains controlled lexical search remains fail-closed until verified parity support exists."));
  else if (host !== "vscode") diagnostics.push(diagnostic("unsupported_host", "Controlled lexical search requests require VS Code host support."));

  const runtime = evaluateControlledAgentRuntimeSession(metadata.runtimeSessionMetadata);
  const readiness = evaluateControlledAgentWorkspaceReadiness(metadata.workspaceReadinessMetadata);
  if (runtime.status !== "ready_to_start" && runtime.status !== "start_requested_metadata" && runtime.status !== "session_open_metadata") diagnostics.push(diagnostic("runtime_session_not_ready", "Controlled lexical search requires ready runtime session metadata."));
  if (readiness.state !== "ready_for_future_controlled_mode") diagnostics.push(diagnostic("workspace_not_ready", "Controlled lexical search requires ready workspace metadata."));

  const source = extractSource(metadata.runtimeSessionMetadata, metadata.workspaceReadinessMetadata);
  if (source.assistantMinted) diagnostics.push(diagnostic("assistant_authority_blocked", "Assistant-minted metadata cannot request controlled lexical search."));
  if (source.host && source.host !== host) diagnostics.push(diagnostic("unsupported_host", "Controlled lexical search host metadata does not match the active host."));
  if (metadata.explicitUserGesture !== true) diagnostics.push(diagnostic("assistant_authority_blocked", "Controlled lexical search requires an explicit user gesture."));

  const query = safeQuery(metadata.query);
  if (!query) diagnostics.push(diagnostic("unsafe_query", "Controlled lexical search requires a safe bounded literal query."));
  const userGestureId = safeId(metadata.userGestureId) ?? buildGestureId(source.runId, metadata.requestSeed);
  const includePathLabels = safePathLabels(metadata.includePathLabels);
  const requestId = buildRequestId(source.runId, source.controlledWorkspaceId, query, metadata.requestSeed);
  const details = requestDetails(requestId, source.runId, source.controlledWorkspaceId, source.workspaceReadinessId, query, host);

  if (diagnostics.length > 0 || !source.runId || !source.controlledWorkspaceId || !source.runtimeSessionId || !source.workspaceReadinessId || !query || !requestId || !userGestureId) {
    return requestBlocked(diagnostics.some((item) => item.code === "unsupported_host" || item.code === "browser_host") ? "unsupported" : "blocked", diagnostics, details);
  }

  const bridgeRequest: ControlledAgentLexicalSearchBridgeRequest = {
    version: "2026-05-15",
    type: "gui.controlledAgentLexicalSearchRequest",
    requestId,
    payload: {
      requestId,
      requestIdMintedBy: "gui",
      source: "gui",
      assistantMinted: false,
      controlledWorkspaceId: source.controlledWorkspaceId,
      runId: source.runId,
      runtimeSessionId: source.runtimeSessionId,
      workspaceReadinessId: source.workspaceReadinessId,
      explicitUserGesture: true,
      userGestureId,
      host: "vscode",
      query,
      queryMode: "literal_text",
      scope: {
        kind: "controlled_workspace_bounded",
        controlledWorkspaceOnly: true,
        includePathLabels,
        excludeHidden: true,
        excludeDependencies: true,
        excludeGenerated: true,
        excludeBinary: true,
        excludeSecretLikePaths: true,
        recursiveAllowed: false,
        broadWorkspaceScanAllowed: false,
      },
      limits: {
        maxFilesScanned: 40,
        maxMatches: 10,
        maxSnippetBytes: 400,
        literalOnly: true,
        regexAllowed: false,
        globAllowed: false,
        pathQueryAllowed: false,
        indexingAllowed: false,
        backgroundAllowed: false,
      },
      policyFlags,
    },
  };
  return { state: "ready", bridgeRequest, correlation: { requestId, runId: source.runId, controlledWorkspaceId: source.controlledWorkspaceId, runtimeSessionId: source.runtimeSessionId, workspaceReadinessId: source.workspaceReadinessId, userGestureId, query }, diagnostics: [], details, authority };
}

export function correlateControlledAgentLexicalSearchResult(input: unknown): ControlledAgentLexicalSearchResultCorrelationResult {
  const diagnostics: ControlledAgentLexicalSearchDiagnostic[] = [];
  if (!isPlainObject(input)) {
    diagnostics.push(diagnostic("malformed_input", "Controlled lexical search result correlation metadata must be an object."));
    return resultBlocked(diagnostics, { displayOnly: true });
  }

  scanUnsafeMetadata(input, diagnostics, { allowSnippet: true });
  const metadata = input as Partial<ControlledAgentLexicalSearchResultInput>;
  const current = sanitizeCorrelation(metadata.current);
  if (!current) {
    diagnostics.push(diagnostic("malformed_input", "Controlled lexical search result requires current safe correlation metadata."));
    return resultBlocked(diagnostics, { displayOnly: true });
  }
  if (diagnostics.length > 0) return resultBlocked(diagnostics, resultDetails(current));

  const hostMessage = isPlainObject(metadata.hostMessage) ? metadata.hostMessage : undefined;
  const hostRequestId = safeId(hostMessage?.requestId);
  const payload = isPlainObject(hostMessage?.payload) ? sanitizeResultPayload(hostMessage.payload) : undefined;
  if (hostMessage?.type !== "host.controlledAgentLexicalSearchResult" || !hostRequestId || hostRequestId !== current.requestId || payload?.requestId !== current.requestId || payload.runId !== current.runId || payload.controlledWorkspaceId !== current.controlledWorkspaceId || payload.runtimeSessionId !== current.runtimeSessionId || payload.workspaceReadinessId !== current.workspaceReadinessId) {
    diagnostics.push(diagnostic("stale_result", "Ignored controlled lexical search result that does not match request, run, workspace, runtime, and readiness ids."));
    return { state: "ignored", diagnostics, details: resultDetails(current, payload?.status, hostRequestId, payload?.runId, payload?.controlledWorkspaceId), authority };
  }

  if (metadata.existingResult) {
    diagnostics.push(diagnostic("duplicate_result", "Duplicate controlled lexical search result ignored after the first result."));
    return { state: "duplicate", lexicalSearch: sanitizeExistingResult(metadata.existingResult), diagnostics, details: resultDetails(current, metadata.existingResult.status, hostRequestId, payload.runId, payload.controlledWorkspaceId), authority };
  }

  if (!payload || !resultAuthorityIsSafe(payload)) {
    diagnostics.push(diagnostic("invalid_authority", "Controlled lexical search host result is blocked because authority widened or metadata is malformed."));
    return resultBlocked(diagnostics, resultDetails(current, payload?.status, hostRequestId, payload?.runId, payload?.controlledWorkspaceId));
  }

  if (payload.status === "succeeded" && payload.snippets.length === 0 && payload.resultCount > 0) {
    diagnostics.push(diagnostic("unsafe_metadata", "Controlled lexical search snippets were omitted because host metadata was unsafe."));
    return resultBlocked(diagnostics, resultDetails(current, payload.status, hostRequestId, payload.runId, payload.controlledWorkspaceId));
  }

  return { state: "accepted", lexicalSearch: normalizeResult(payload), diagnostics: [], details: resultDetails(current, payload.status, hostRequestId, payload.runId, payload.controlledWorkspaceId), authority };
}

function extractSource(runtimeInput: unknown, readinessInput: unknown): { runId?: string; controlledWorkspaceId?: string; runtimeSessionId?: string; workspaceReadinessId?: string; host?: "vscode" | "jetbrains" | "browser"; assistantMinted: boolean } {
  const runtime = isPlainObject(runtimeInput) ? runtimeInput : undefined;
  const workspace = isPlainObject(runtime?.workspace) ? runtime.workspace : undefined;
  const session = isPlainObject(runtime?.session) ? runtime.session : undefined;
  const hostRecord = isPlainObject(runtime?.host) ? runtime.host : undefined;
  const preconditions = isPlainObject(runtime?.preconditions) ? runtime.preconditions : undefined;
  const optIn = isPlainObject(preconditions?.optIn) ? preconditions.optIn : undefined;
  const readiness = isPlainObject(readinessInput) ? readinessInput : undefined;
  const readinessOptIn = isPlainObject(readiness?.optIn) ? readiness.optIn : undefined;
  const isolation = isPlainObject(readiness?.isolation) ? readiness.isolation : undefined;
  return {
    runId: safeId(session?.sessionId),
    controlledWorkspaceId: safeId(workspace?.controlledWorkspaceId),
    runtimeSessionId: safeId(session?.sessionId),
    workspaceReadinessId: safeId(workspace?.readinessId) ?? safeId(isolation?.readinessId),
    host: hostRecord?.kind === "vscode" || hostRecord?.kind === "jetbrains" || hostRecord?.kind === "browser" ? hostRecord.kind : undefined,
    assistantMinted: optIn?.assistantMinted === true || optIn?.origin === "assistant" || optIn?.confirmedBy === "assistant" || optIn?.requestIdMintedBy === "assistant" || readinessOptIn?.origin === "assistant" || readinessOptIn?.confirmedBy === "assistant" || readinessOptIn?.requestIdMintedBy === "assistant",
  };
}

function sanitizeResultPayload(value: Record<string, unknown>) {
  const status = value.status === "succeeded" || value.status === "blocked" || value.status === "failed" ? value.status : undefined;
  const requestId = safeId(value.requestId);
  const runId = safeId(value.runId);
  const controlledWorkspaceId = safeId(value.controlledWorkspaceId);
  const runtimeSessionId = safeId(value.runtimeSessionId);
  const workspaceReadinessId = safeId(value.workspaceReadinessId);
  const message = safeDisplayText(value.message, 240);
  const snippets = sanitizeSnippets(value.snippets);
  if (Array.isArray(value.snippets) && value.snippets.length > 0 && snippets === undefined) return undefined;
  const resultHash = typeof value.resultHash === "string" && safeHashPattern.test(value.resultHash) ? value.resultHash : undefined;
  const policy = isPlainObject(value.policyFlags) ? value.policyFlags : undefined;
  if (!status || !requestId || !runId || !controlledWorkspaceId || !runtimeSessionId || !workspaceReadinessId || !message || !snippets || !policy || value.requestIdMintedBy !== "gui" || value.userConfirmed !== true || value.explicitUserGesture !== true || value.host !== "vscode" || value.authority !== "explicit_literal_lexical_search_metadata" || value.cloudRequired !== false || value.executionAllowed !== false || value.privatePathExposed !== false || value.rawContentIncluded !== false) return undefined;
  const resultCount = boundedInteger(value.resultCount, 0, 10) ? value.resultCount : undefined;
  const totalMatchCount = boundedInteger(value.totalMatchCount, 0, 100) ? value.totalMatchCount : undefined;
  const totalSnippetBytes = boundedInteger(value.totalSnippetBytes, 0, 4000) ? value.totalSnippetBytes : undefined;
  const truncated = typeof value.truncated === "boolean" ? value.truncated : undefined;
  if (resultCount === undefined || totalMatchCount === undefined || totalSnippetBytes === undefined || truncated === undefined) return undefined;
  if (status === "succeeded" && value.searchAllowed !== true) return undefined;
  if (status !== "succeeded" && value.searchAllowed !== false) return undefined;
  if (status === "succeeded" && snippets.length !== resultCount) return undefined;
  if (status !== "succeeded" && snippets.length !== 0) return undefined;
  return stripUndefined({ status, requestId, runId, controlledWorkspaceId, runtimeSessionId, workspaceReadinessId, resultCount, totalMatchCount, totalSnippetBytes, truncated, resultHash, snippets, message, policyFlags: policy, searchAllowed: value.searchAllowed });
}

function resultAuthorityIsSafe(payload: ReturnType<typeof sanitizeResultPayload>): boolean {
  if (!payload) return false;
  for (const [key, value] of Object.entries(payload.policyFlags)) {
    if (key === "explicitLiteralSearchAllowed") {
      if (value !== true) return false;
    } else if (value !== false) return false;
  }
  return true;
}

function normalizeResult(payload: NonNullable<ReturnType<typeof sanitizeResultPayload>>): ControlledAgentLexicalSearchSummary {
  return stripUndefined({ status: payload.status as "succeeded" | "blocked" | "failed", resultCount: payload.resultCount, totalMatchCount: payload.totalMatchCount, totalSnippetBytes: payload.totalSnippetBytes, truncated: payload.truncated, resultHash: payload.resultHash, snippets: payload.snippets, message: payload.message });
}

function sanitizeExistingResult(value: ControlledAgentLexicalSearchSummary): ControlledAgentLexicalSearchSummary {
  return { status: value.status === "succeeded" || value.status === "blocked" || value.status === "failed" ? value.status : "blocked", resultCount: 0, totalMatchCount: 0, totalSnippetBytes: 0, truncated: false, snippets: [], message: safeDisplayText(value.message, 240) ?? "Controlled lexical search result." };
}

function sanitizeSnippets(value: unknown): ControlledAgentLexicalSearchSnippet[] | undefined {
  if (!Array.isArray(value) || value.length > 10) return undefined;
  const snippets = value.map(sanitizeSnippet);
  return snippets.every((item): item is ControlledAgentLexicalSearchSnippet => item !== undefined) ? snippets : undefined;
}

function sanitizeSnippet(value: unknown): ControlledAgentLexicalSearchSnippet | undefined {
  if (!isPlainObject(value)) return undefined;
  const pathLabel = safePath(value.pathLabel);
  const range = sanitizeRange(value.range);
  const languageId = typeof value.languageId === "string" && /^[A-Za-z0-9_.+-]{1,64}$/.test(value.languageId) ? value.languageId : undefined;
  const snippet = safeSnippet(value.snippet);
  const snippetByteCount = boundedInteger(value.snippetByteCount, 0, 400) ? value.snippetByteCount : undefined;
  const snippetHash = typeof value.snippetHash === "string" && safeHashPattern.test(value.snippetHash) ? value.snippetHash : undefined;
  const matchCount = boundedInteger(value.matchCount, 0, 20) ? value.matchCount : undefined;
  const truncated = typeof value.truncated === "boolean" ? value.truncated : undefined;
  if (!pathLabel || !range || !snippet || snippetByteCount === undefined || !snippetHash || matchCount === undefined || truncated === undefined) return undefined;
  return stripUndefined({ pathLabel, range, languageId, snippet, snippetByteCount, snippetHash, matchCount, truncated });
}

function sanitizeRange(value: unknown): ControlledAgentLexicalSearchSnippet["range"] | undefined {
  if (!isPlainObject(value) || !isPlainObject(value.start) || !isPlainObject(value.end)) return undefined;
  const startLine = boundedInteger(value.start.line, 0, 1000000) ? value.start.line : undefined;
  const startCharacter = boundedInteger(value.start.character, 0, 1000000) ? value.start.character : undefined;
  const endLine = boundedInteger(value.end.line, 0, 1000000) ? value.end.line : undefined;
  const endCharacter = boundedInteger(value.end.character, 0, 1000000) ? value.end.character : undefined;
  if (startLine === undefined || startCharacter === undefined || endLine === undefined || endCharacter === undefined) return undefined;
  if (endLine < startLine || (endLine === startLine && endCharacter < startCharacter)) return undefined;
  return { start: { line: startLine, character: startCharacter }, end: { line: endLine, character: endCharacter } };
}

function sanitizeCorrelation(value: unknown): ControlledAgentLexicalSearchCorrelation | undefined {
  if (!isPlainObject(value)) return undefined;
  const requestId = safeId(value.requestId);
  const runId = safeId(value.runId);
  const controlledWorkspaceId = safeId(value.controlledWorkspaceId);
  const runtimeSessionId = safeId(value.runtimeSessionId);
  const workspaceReadinessId = safeId(value.workspaceReadinessId);
  const userGestureId = safeId(value.userGestureId);
  const query = safeQuery(value.query);
  return requestId && runId && controlledWorkspaceId && runtimeSessionId && workspaceReadinessId && userGestureId && query ? { requestId, runId, controlledWorkspaceId, runtimeSessionId, workspaceReadinessId, userGestureId, query } : undefined;
}

function safePathLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(safePath).filter((item): item is string => item !== undefined).slice(0, 8);
}

function safeQuery(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const sanitized = sanitizeDisplayText(value).trim().replace(/\s+/g, " ");
  return queryPattern.test(sanitized) && !/[*/\\~]|\.\.|[{}[\]()^$+?|]|[;&`$<>]/.test(sanitized) && !/\b(?:cwd|env|shell|git|tool|provider|model|apiKey|requestId|assistant|regex|glob|path|token|secret)\b/i.test(sanitized) && !unsafeTextPattern.test(sanitized) ? sanitized : undefined;
}

function safePath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const sanitized = sanitizeDisplayText(value).trim();
  return safePathPattern.test(sanitized) && !unsafeTextPattern.test(sanitized) ? sanitized : undefined;
}

function safeSnippet(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (unsafeTextPattern.test(value)) return undefined;
  const sanitized = sanitizeTimelineText(value).trim();
  return sanitized.length > 0 && sanitized.length <= 400 && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(sanitized) && !unsafeTextPattern.test(sanitized) ? sanitized : undefined;
}

function buildRequestId(runId: string | undefined, workspaceId: string | undefined, query: string | undefined, seed: unknown): string | undefined {
  if (!runId || !workspaceId || !query) return undefined;
  const safeSeed = typeof seed === "string" && safeIdPattern.test(seed) ? seed : "lexical-search";
  return `gui-s110-${stableHash(`${runId}:${workspaceId}:${query}:${safeSeed}`)}`;
}

function buildGestureId(runId: string | undefined, seed: unknown): string | undefined {
  if (!runId) return undefined;
  const safeSeed = typeof seed === "string" && safeIdPattern.test(seed) ? seed : "gesture";
  return `gesture-s110-${stableHash(`${runId}:${safeSeed}`)}`;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function requestDetails(requestId: string | undefined, runId: string | undefined, workspaceId: string | undefined, readinessId: string | undefined, query: string | undefined, host: unknown): Record<string, string | number | boolean | string[]> {
  return sanitizeDetails({ displayOnly: true, requestId, runId, controlledWorkspaceId: workspaceId, workspaceReadinessId: readinessId, query, host, requestReady: requestId !== undefined });
}

function resultDetails(correlation: ControlledAgentLexicalSearchCorrelation, state?: string, hostRequestId?: string, hostRunId?: string, hostWorkspaceId?: string): Record<string, string | number | boolean | string[]> {
  return sanitizeDetails({ displayOnly: true, requestId: correlation.requestId, hostRequestId, runId: correlation.runId, hostRunId, controlledWorkspaceId: correlation.controlledWorkspaceId, hostWorkspaceId, workspaceReadinessId: correlation.workspaceReadinessId, query: correlation.query, resultState: state });
}

function requestBlocked(state: "blocked" | "unsupported", diagnostics: ControlledAgentLexicalSearchDiagnostic[], details: Record<string, string | number | boolean | string[]>): ControlledAgentLexicalSearchRequestResult {
  return { state, diagnostics: diagnostics.map((item) => diagnostic(item.code, item.message)).slice(0, 24), details: sanitizeDetails(diagnostics.some((item) => item.code === "unsafe_metadata") ? { ...details, redacted: "[redacted]" } : details), authority };
}

function resultBlocked(diagnostics: ControlledAgentLexicalSearchDiagnostic[], details: Record<string, string | number | boolean | string[]>): ControlledAgentLexicalSearchResultCorrelationResult {
  return { state: "blocked", diagnostics: diagnostics.map((item) => diagnostic(item.code, item.message)).slice(0, 24), details: sanitizeDetails(diagnostics.some((item) => item.code === "unsafe_metadata") ? { ...details, redacted: "[redacted]" } : details), authority };
}

function scanUnsafeMetadata(value: unknown, diagnostics: ControlledAgentLexicalSearchDiagnostic[], options: { allowSnippet?: boolean } = {}, keyPath = "", depth = 0, seen = new WeakSet<object>()): void {
  if (depth > 8) return;
  const currentKey = (keyPath.split(".").pop() ?? "").replace(/\[\d+\]$/u, "");
  if (typeof value === "string") {
    const allowed = (currentKey === "type" && (value === "host.controlledAgentLexicalSearchResult" || value === "gui.controlledAgentLexicalSearchRequest")) || (currentKey === "authority" && value === "explicit_literal_lexical_search_metadata") || (currentKey === "queryMode" && value === "literal_text") || (currentKey === "kind" && value === "controlled_workspace_bounded");
    if (options.allowSnippet && currentKey === "snippet") {
      if (!safeSnippet(value)) diagnostics.push(diagnostic("unsafe_metadata", "Unsafe controlled lexical search snippet omitted."));
      return;
    }
    if (!allowed && unsafeTextPattern.test(value)) diagnostics.push(diagnostic("unsafe_metadata", `Unsafe controlled lexical search metadata omitted near ${sanitizeDisplayText(keyPath || "value")}.`));
    return;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    value.slice(0, 50).forEach((item, index) => scanUnsafeMetadata(item, diagnostics, options, `${keyPath}[${index}]`, depth + 1, seen));
    return;
  }
  if (isPlainObject(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    for (const [key, item] of Object.entries(value).slice(0, 50)) {
      if (unsafeKeyPattern.test(key) && !(key === "policyFlags" || key.endsWith("Allowed"))) diagnostics.push(diagnostic("unsafe_metadata", `Unsupported controlled lexical search field ${sanitizeDisplayText(key)}.`));
      scanUnsafeMetadata(item, diagnostics, options, keyPath ? `${keyPath}.${key}` : key, depth + 1, seen);
    }
  }
}

function sanitizeDetails(input: Record<string, unknown>): Record<string, string | number | boolean | string[]> {
  const sanitized = sanitizeDisplayValue(input);
  if (!isPlainObject(sanitized)) return { displayOnly: true };
  const details: Record<string, string | number | boolean | string[]> = {};
  for (const [key, value] of Object.entries(sanitized).slice(0, 32)) {
    const safeKey = sanitizeDisplayText(key);
    if (typeof value === "string") details[safeKey] = safeText(value, 180);
    if (typeof value === "number" && Number.isFinite(value)) details[safeKey] = value;
    if (typeof value === "boolean") details[safeKey] = value;
    if (Array.isArray(value)) details[safeKey] = value.filter((item): item is string => typeof item === "string").map((item) => safeText(item, 80)).slice(0, 8);
  }
  return details;
}

function safeId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const sanitized = sanitizeDisplayText(value).trim();
  return safeIdPattern.test(sanitized) ? sanitized : undefined;
}

function safeDisplayText(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const sanitized = sanitizeTimelineText(value).replace(/[\r\n\t<>]+/g, " ").trim();
  return sanitized.length > 0 && sanitized.length <= limit && !unsafeTextPattern.test(sanitized) ? sanitizeDisplayText(sanitized) : undefined;
}

function safeText(value: string, limit: number): string {
  const sanitized = sanitizeTimelineText(value).trim();
  const safe = sanitized.length > 0 ? sanitized : "[redacted]";
  return safe.length > limit ? `${safe.slice(0, limit)}…` : safe;
}

function diagnostic(code: ControlledAgentLexicalSearchDiagnosticCode, message: string): ControlledAgentLexicalSearchDiagnostic {
  return { code, message: safeText(message, 200) };
}

function boundedInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
