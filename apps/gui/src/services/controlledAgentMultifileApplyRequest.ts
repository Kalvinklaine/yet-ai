import { evaluateControlledAgentMultifilePatchPlan } from "./controlledAgentMultifilePatchPlan";
import { isRawContentLikeKey, isSecretLikeKey, sanitizeDisplayText, sanitizeTimelineText } from "./redaction";

export type ControlledAgentMultifileApplyDiagnosticCode =
  | "missing_input"
  | "malformed_input"
  | "browser_host"
  | "unsupported_host"
  | "plan_not_ready"
  | "explicit_confirmation_required"
  | "assistant_authority_blocked"
  | "unsafe_metadata"
  | "unsafe_path"
  | "missing_hash"
  | "over_budget"
  | "stale_result"
  | "duplicate_result"
  | "invalid_result";

export type ControlledAgentMultifileApplyDiagnostic = {
  code: ControlledAgentMultifileApplyDiagnosticCode;
  message: string;
};

export type ControlledAgentMultifileApplyEdit = {
  editId: string;
  operation: "replace";
  workspaceRelativePath: string;
  fileLabel: string;
  existingTextFile: true;
  expectedPreEditHash: string;
  expectedRangeHash: string;
  replacementContentHash: string;
  startLine: number;
  endLine: number;
  replacementByteCount: number;
  sanitizedSummary: string;
};

export type ControlledAgentMultifileApplyBridgeRequest = {
  version: "2026-05-15";
  type: "gui.controlledAgentMultifileApplyRequest";
  requestId: string;
  payload: {
    requestId: string;
    requestIdMintedBy: "gui";
    source: "gui";
    assistantMinted: false;
    controlledWorkspaceId: string;
    runId: string;
    runtimeSessionId?: string;
    workspaceReadinessId: string;
    patchPlanId: string;
    userConfirmed: true;
    confirmationKind: "explicit_user_multifile_apply";
    limits: ControlledAgentMultifileApplyLimits;
    policy: ControlledAgentMultifileApplyPolicy;
    edits: ControlledAgentMultifileApplyEdit[];
  };
};

export type ControlledAgentMultifileApplyLimits = {
  maxFiles: number;
  maxEdits: number;
  maxReplacementBytesPerEdit: number;
  maxTotalReplacementBytes: number;
};

export type ControlledAgentMultifileApplyPolicy = {
  host: "vscode";
  browserSupported: false;
  jetbrainsSupported: false;
  vscodeExecutionOnly: true;
  existingTextFilesOnly: true;
  boundedReplacementOnly: true;
  rawReplacementIncluded: false;
  rawDiffIncluded: false;
  fileBodyIncluded: false;
  createAllowed: false;
  deleteAllowed: false;
  renameAllowed: false;
  moveAllowed: false;
  dependencyEditAllowed: false;
  generatedEditAllowed: false;
  hiddenPathAllowed: false;
  commandAllowed: false;
  providerAllowed: false;
  toolAllowed: false;
  automaticApplyAllowed: false;
};

export type ControlledAgentMultifileApplyCorrelation = {
  requestId: string;
  controlledWorkspaceId: string;
  runId: string;
  runtimeSessionId?: string;
  workspaceReadinessId: string;
  patchPlanId: string;
  expectedFileCount: number;
  expectedEditCount: number;
  expectedFiles: string[];
};

export type ControlledAgentMultifileApplyRequestInput = {
  host: "browser" | "vscode" | "jetbrains";
  patchPlanMetadata?: unknown;
  userConfirmed?: boolean;
  requestSeed?: string;
  runtimeSessionId?: string;
  workspaceReadinessId?: string;
  replacementContentHashes?: Record<string, string>;
};

export type ControlledAgentMultifileApplyRequestResult = {
  state: "ready" | "blocked" | "unsupported";
  bridgeRequest?: ControlledAgentMultifileApplyBridgeRequest;
  correlation?: ControlledAgentMultifileApplyCorrelation;
  diagnostics: ControlledAgentMultifileApplyDiagnostic[];
  details: Record<string, string | number | boolean | string[]>;
  authority: ControlledAgentMultifileApplyAuthority;
};

export type ControlledAgentMultifileApplyFileSummary = {
  editId: string;
  workspaceRelativePath: string;
  fileLabel: string;
  status: "applied" | "blocked" | "failed";
  startLine: number;
  endLine: number;
  replacementByteCount: number;
  expectedPreEditHashLabel: string;
  expectedRangeHashLabel: string;
  replacementContentHashLabel: string;
  actualPostEditHashLabel?: string;
  sanitizedSummary: string;
};

export type ControlledAgentMultifileApplySummary = {
  state: "applied" | "blocked" | "failed";
  message: string;
  patchPlanId: string;
  appliedFileCount: number;
  appliedEditCount: number;
  blockedFileCount: number;
  failedEditCount: number;
  affectedFiles: string[];
  files: ControlledAgentMultifileApplyFileSummary[];
  metadataOnly: true;
  rawReplacementIncluded: false;
  rawDiffIncluded: false;
  fileBodyIncluded: false;
};

export type ControlledAgentMultifileApplyResultInput = {
  current?: ControlledAgentMultifileApplyCorrelation;
  hostMessage?: { version?: string; type?: string; requestId?: string; payload?: unknown };
  existingResult?: ControlledAgentMultifileApplySummary;
};

export type ControlledAgentMultifileApplyResultCorrelationResult = {
  state: "accepted" | "ignored" | "duplicate" | "blocked";
  summary?: ControlledAgentMultifileApplySummary;
  diagnostics: ControlledAgentMultifileApplyDiagnostic[];
  details: Record<string, string | number | boolean | string[]>;
  authority: ControlledAgentMultifileApplyAuthority;
};

export type ControlledAgentMultifileApplyAuthority = {
  cloudRequired: false;
  executionAllowed: false;
  requestBuilderOnly: true;
  hostApplyImplemented: false;
  canCreateFiles: false;
  canDeleteFiles: false;
  canRenameFiles: false;
  canMoveFiles: false;
  canRunCommands: false;
  canCallProvider: false;
  canUseTools: false;
  canUseNetwork: false;
  canAutoApply: false;
};

const authority: ControlledAgentMultifileApplyAuthority = {
  cloudRequired: false,
  executionAllowed: false,
  requestBuilderOnly: true,
  hostApplyImplemented: false,
  canCreateFiles: false,
  canDeleteFiles: false,
  canRenameFiles: false,
  canMoveFiles: false,
  canRunCommands: false,
  canCallProvider: false,
  canUseTools: false,
  canUseNetwork: false,
  canAutoApply: false,
};

const safeIdPattern = /^(?!assistant(?:[._:-]|$))(?!.*(?:assistant|sk-(?:proj-)?))[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/i;
const safePathPattern = /^(?!\/)(?![A-Za-z]:)(?!~)(?!.*(?:^|\/)\.)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\/\/)(?!.*[\\:*?"<>|{}\[\]$^+])(?!(?:^|.*\/)(?:node_modules|vendor|dist|build|out|target|coverage|__pycache__|generated|tmp|temp|secrets?|credentials?|private)(?:\/|$))[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/i;
const hashPattern = /^sha256:[a-f0-9]{64}$/;
const unsafeTextPattern = /authorization|bearer|api[_ -]?key|access[_ -]?token|token|secret|password|cookie|raw[_ -]?(?:file|body|diff|patch|replacement|prompt|command|output)|file[_ -]?(?:body|content)|provider|shell|command|cwd|\benv\b|\bgit\b|\btool\b|network|hidden[_ -]?(?:scan|read|search)|index(?:ing)?|auto[_ -]?(?:start|apply|run|repair)|create|delete|rename|move|chmod|symlink|binary|sk-(?:proj-)?[A-Za-z0-9_-]{8,}|BEGIN [A-Z ]*PRIVATE KEY|\/(?:Users|home|tmp|var|etc|opt|mnt|Volumes|private)(?=\/|$)|[A-Za-z]:(?:\\|\/)|~(?:\\|\/)/i;
const unsafeKeyPattern = /^(?:command|cmd|args|arguments|cwd|env|environment|network|git|provider|tool|shell|raw|rawCommand|raw_command|rawFile|raw_file|rawFileBody|raw_file_body|fileBody|file_body|fileContents|file_contents|rawPrompt|raw_prompt|rawOutput|raw_output|rawBody|raw_body|rawDiff|raw_diff|rawPatch|raw_patch|rawReplacement|raw_replacement|diff|patch|browserStorage|browser_storage|storageDump|storage_dump|hiddenRead|hidden_read|hiddenSearch|hidden_search|search|glob|regex|index|indexing|autoStart|auto_start|autoApply|auto_apply|autoRun|auto_run|autoRepair|auto_repair|create|delete|rename|move|chmod|symlink|binary)$/i;

export function buildControlledAgentMultifileApplyRequest(input: unknown): ControlledAgentMultifileApplyRequestResult {
  const diagnostics: ControlledAgentMultifileApplyDiagnostic[] = [];
  if (!isPlainObject(input)) {
    diagnostics.push(diagnostic("missing_input", "Multi-file apply request metadata is absent."));
    return requestBlocked("blocked", diagnostics, { displayOnly: true });
  }
  scanUnsafeMetadata(input, diagnostics);
  const metadata = input as ControlledAgentMultifileApplyRequestInput;
  if (metadata.host === "browser") {
    diagnostics.push(diagnostic("browser_host", "Browser preview cannot request bounded multi-file apply."));
  } else if (metadata.host === "jetbrains") {
    diagnostics.push(diagnostic("unsupported_host", "JetBrains multi-file apply remains fail-closed until separately verified."));
  } else if (metadata.host !== "vscode") {
    diagnostics.push(diagnostic("unsupported_host", "Bounded multi-file apply requests require the VS Code host."));
  }
  if (metadata.userConfirmed !== true) {
    diagnostics.push(diagnostic("explicit_confirmation_required", "Bounded multi-file apply requires explicit user confirmation."));
  }

  const planResult = evaluateControlledAgentMultifilePatchPlan(metadata.patchPlanMetadata);
  if (planResult.state !== "ready") {
    diagnostics.push(diagnostic("plan_not_ready", "Bounded multi-file apply requires a ready multi-file patch plan."));
    for (const item of planResult.diagnostics) {
      diagnostics.push(diagnostic(item.code === "over_budget" ? "over_budget" : item.code === "missing_hash" ? "missing_hash" : item.code === "unsafe_metadata" ? "unsafe_metadata" : "malformed_input", item.message));
    }
  }
  const plan = isPlainObject(metadata.patchPlanMetadata) ? metadata.patchPlanMetadata : undefined;
  const source = extractPlanSource(plan);
  if (source.assistantMinted) {
    diagnostics.push(diagnostic("assistant_authority_blocked", "Assistant-minted apply authority is not accepted."));
  }
  if (source.host && source.host !== "vscode") {
    diagnostics.push(diagnostic("unsupported_host", "Multi-file apply request is VS Code-only."));
  }
  const workspaceReadinessId = safeId(metadata.workspaceReadinessId) ?? (source.workspaceReadinessId ? safeId(source.workspaceReadinessId) : undefined);
  if (!workspaceReadinessId) {
    diagnostics.push(diagnostic("malformed_input", "Multi-file apply requires safe workspace readiness correlation metadata."));
  }
  const runtimeSessionId = metadata.runtimeSessionId === undefined ? undefined : safeId(metadata.runtimeSessionId);
  if (metadata.runtimeSessionId !== undefined && !runtimeSessionId) {
    diagnostics.push(diagnostic("malformed_input", "Multi-file apply runtime session id is unsafe."));
  }
  const edits = plan ? sanitizePlanEdits(plan, metadata.replacementContentHashes, diagnostics) : [];
  const limits = plan ? sanitizeLimits(plan, diagnostics) : undefined;
  if (limits) {
    validateBudgets(edits, limits, diagnostics);
  }
  const requestId = buildRequestId(source.planId, metadata.requestSeed);
  if (!requestId) {
    diagnostics.push(diagnostic("assistant_authority_blocked", "GUI-minted request id is missing or unsafe."));
  }
  const details = requestDetails(requestId, source.controlledWorkspaceId, source.runId, workspaceReadinessId, source.planId, edits.length, metadata.host);
  if (diagnostics.length > 0 || !requestId || !source.controlledWorkspaceId || !source.runId || !workspaceReadinessId || !source.planId || !limits || edits.length === 0) {
    return requestBlocked(diagnostics.some((item) => item.code === "browser_host" || item.code === "unsupported_host") ? "unsupported" : "blocked", diagnostics, details);
  }

  const bridgeRequest: ControlledAgentMultifileApplyBridgeRequest = {
    version: "2026-05-15",
    type: "gui.controlledAgentMultifileApplyRequest",
    requestId,
    payload: {
      requestId,
      requestIdMintedBy: "gui",
      source: "gui",
      assistantMinted: false,
      controlledWorkspaceId: source.controlledWorkspaceId,
      runId: source.runId,
      ...(runtimeSessionId ? { runtimeSessionId } : {}),
      workspaceReadinessId,
      patchPlanId: source.planId,
      userConfirmed: true,
      confirmationKind: "explicit_user_multifile_apply",
      limits,
      policy: applyPolicy(),
      edits,
    },
  };
  const correlation: ControlledAgentMultifileApplyCorrelation = {
    requestId,
    controlledWorkspaceId: source.controlledWorkspaceId,
    runId: source.runId,
    ...(runtimeSessionId ? { runtimeSessionId } : {}),
    workspaceReadinessId,
    patchPlanId: source.planId,
    expectedFileCount: new Set(edits.map((edit) => edit.workspaceRelativePath)).size,
    expectedEditCount: edits.length,
    expectedFiles: Array.from(new Set(edits.map((edit) => edit.workspaceRelativePath))),
  };
  return { state: "ready", bridgeRequest, correlation, diagnostics: [], details, authority };
}

export function correlateControlledAgentMultifileApplyResult(input: unknown): ControlledAgentMultifileApplyResultCorrelationResult {
  const diagnostics: ControlledAgentMultifileApplyDiagnostic[] = [];
  if (!isPlainObject(input)) {
    diagnostics.push(diagnostic("malformed_input", "Multi-file apply result correlation metadata must be an object."));
    return resultBlocked(diagnostics, { displayOnly: true });
  }
  const metadata = input as ControlledAgentMultifileApplyResultInput;
  const current = sanitizeCorrelation(metadata.current);
  if (!current) {
    diagnostics.push(diagnostic("malformed_input", "Multi-file apply result requires current correlation metadata."));
    return resultBlocked(diagnostics, { displayOnly: true });
  }
  const hostMessage = isPlainObject(metadata.hostMessage) ? metadata.hostMessage : undefined;
  const payload = isPlainObject(hostMessage?.payload) ? hostMessage.payload : undefined;
  if (hostMessage?.version !== "2026-05-15" || hostMessage?.type !== "host.controlledAgentMultifileApplyResult" || hostMessage.requestId !== current.requestId || !payloadMatchesCorrelation(payload, current)) {
    diagnostics.push(diagnostic("stale_result", "Ignored multi-file apply result that does not match request, run, workspace, and plan ids."));
    return { state: "ignored", diagnostics, details: resultDetails(current, safeText(payload?.state, 32)), authority };
  }
  scanUnsafeMetadata(input, diagnostics, { allowResultMessage: true });
  if (diagnostics.length > 0) {
    return resultBlocked(diagnostics, resultDetails(current, undefined));
  }
  if (metadata.existingResult) {
    diagnostics.push(diagnostic("duplicate_result", "Duplicate multi-file apply result ignored after the first terminal result."));
    return { state: "duplicate", summary: metadata.existingResult, diagnostics, details: resultDetails(current, metadata.existingResult.state), authority };
  }
  const summary = sanitizeResultPayload(payload, current, diagnostics);
  if (!summary || diagnostics.length > 0) {
    return resultBlocked(diagnostics.length > 0 ? diagnostics : [diagnostic("invalid_result", "Multi-file apply host result is malformed.")], resultDetails(current, safeText(payload.state, 32)));
  }
  return { state: "accepted", summary, diagnostics: [], details: resultDetails(current, summary.state), authority };
}

function sanitizePlanEdits(plan: Record<string, unknown>, replacementHashes: Record<string, string> | undefined, diagnostics: ControlledAgentMultifileApplyDiagnostic[]): ControlledAgentMultifileApplyEdit[] {
  const planBody = isPlainObject(plan.plan) ? plan.plan : undefined;
  const files = Array.isArray(planBody?.files) ? planBody.files : [];
  const edits: ControlledAgentMultifileApplyEdit[] = [];
  for (const file of files.slice(0, 12)) {
    if (!isPlainObject(file)) {
      diagnostics.push(diagnostic("malformed_input", "Multi-file apply file metadata is malformed."));
      continue;
    }
    const workspaceRelativePath = safePath(file.workspaceRelativePath);
    const fileLabel = safeLabel(file.fileLabel);
    const expectedPreEditHash = safeHash(file.expectedPreEditHash);
    if (!workspaceRelativePath || !fileLabel) diagnostics.push(diagnostic("unsafe_path", "Multi-file apply requires safe workspace-relative file labels."));
    if (!expectedPreEditHash) diagnostics.push(diagnostic("missing_hash", "Multi-file apply requires expected pre-edit hashes."));
    const fileEdits = Array.isArray(file.edits) ? file.edits : [];
    for (const edit of fileEdits.slice(0, 12)) {
      if (!isPlainObject(edit)) {
        diagnostics.push(diagnostic("malformed_input", "Multi-file apply edit metadata is malformed."));
        continue;
      }
      const editId = safeId(edit.editId);
      const range = isPlainObject(edit.range) ? edit.range : undefined;
      const expectedRangeHash = safeHash(edit.expectedRangeHash);
      const replacementContentHash = editId && replacementHashes ? safeHash(replacementHashes[editId]) : undefined;
      const startLine = boundedInt(range?.startLine, 1, 1000000) ? range.startLine : undefined;
      const endLine = boundedInt(range?.endLine, 1, 1000000) ? range.endLine : undefined;
      const replacementByteCount = boundedInt(edit.replacementByteCount, 1, 12000) ? edit.replacementByteCount : undefined;
      const sanitizedSummary = safeSummary(edit.replacementSummary);
      if (!editId || edit.operation !== "replace" || !startLine || !endLine || endLine < startLine || !replacementByteCount || !sanitizedSummary) diagnostics.push(diagnostic("malformed_input", "Multi-file apply edit metadata is missing bounded replacement details."));
      if (!expectedRangeHash || !replacementContentHash) diagnostics.push(diagnostic("missing_hash", "Multi-file apply requires expected range and replacement content hashes."));
      if (workspaceRelativePath && fileLabel && expectedPreEditHash && editId && edit.operation === "replace" && expectedRangeHash && replacementContentHash && startLine && endLine && endLine >= startLine && replacementByteCount && sanitizedSummary) {
        edits.push({ editId, operation: "replace", workspaceRelativePath, fileLabel, existingTextFile: true, expectedPreEditHash, expectedRangeHash, replacementContentHash, startLine, endLine, replacementByteCount, sanitizedSummary });
      }
    }
  }
  return edits;
}

function sanitizeLimits(plan: Record<string, unknown>, diagnostics: ControlledAgentMultifileApplyDiagnostic[]): ControlledAgentMultifileApplyLimits | undefined {
  const limits = isPlainObject(plan.limits) ? plan.limits : undefined;
  if (!limits) {
    diagnostics.push(diagnostic("over_budget", "Multi-file apply limits are missing."));
    return undefined;
  }
  const sanitized = {
    maxFiles: boundedInt(limits.maxFiles, 1, 4) ? limits.maxFiles : undefined,
    maxEdits: boundedInt(limits.maxEdits, 1, 12) ? limits.maxEdits : undefined,
    maxReplacementBytesPerEdit: boundedInt(limits.maxReplacementBytesPerEdit, 1, 12000) ? limits.maxReplacementBytesPerEdit : undefined,
    maxTotalReplacementBytes: boundedInt(limits.maxTotalReplacementBytes, 1, 48000) ? limits.maxTotalReplacementBytes : undefined,
  };
  if (!sanitized.maxFiles || !sanitized.maxEdits || !sanitized.maxReplacementBytesPerEdit || !sanitized.maxTotalReplacementBytes) {
    diagnostics.push(diagnostic("over_budget", "Multi-file apply limits are outside bounded apply budgets."));
    return undefined;
  }
  return sanitized as ControlledAgentMultifileApplyLimits;
}

function validateBudgets(edits: ControlledAgentMultifileApplyEdit[], limits: ControlledAgentMultifileApplyLimits, diagnostics: ControlledAgentMultifileApplyDiagnostic[]): void {
  const fileCount = new Set(edits.map((edit) => edit.workspaceRelativePath)).size;
  const replacementBytes = edits.reduce((sum, edit) => sum + edit.replacementByteCount, 0);
  if (fileCount > limits.maxFiles || edits.length > limits.maxEdits || replacementBytes > limits.maxTotalReplacementBytes || edits.some((edit) => edit.replacementByteCount > limits.maxReplacementBytesPerEdit)) {
    diagnostics.push(diagnostic("over_budget", "Multi-file apply request exceeds bounded file, edit, or replacement byte limits."));
  }
}

function sanitizeResultPayload(payload: Record<string, unknown>, current: ControlledAgentMultifileApplyCorrelation, diagnostics: ControlledAgentMultifileApplyDiagnostic[]): ControlledAgentMultifileApplySummary | undefined {
  if (payload.type !== "controlled_agent_multifile_apply" || payload.schemaVersion !== "2026-07-07" || payload.authority !== "vscode_bounded_multifile_replacement_apply" || payload.cloudRequired !== false || payload.requestIdMintedBy !== "gui" || payload.userConfirmed !== true) {
    diagnostics.push(diagnostic("invalid_result", "Multi-file apply result widened authority or missed required confirmation."));
    return undefined;
  }
  if (!isSafeResultPolicy(payload.policyFlags)) {
    diagnostics.push(diagnostic("invalid_result", "Multi-file apply result policy flags are unsafe."));
    return undefined;
  }
  const result = isPlainObject(payload.result) ? payload.result : undefined;
  const state = payload.state === "applied" || payload.state === "blocked" || payload.state === "failed" ? payload.state : undefined;
  if (!result || !state || result.status !== state || result.cloudRequired !== false || result.privatePathExposed !== false || result.rawReplacementIncluded !== false || result.rawDiffIncluded !== false || result.fileBodyIncluded !== false) {
    diagnostics.push(diagnostic("invalid_result", "Multi-file apply result metadata is malformed or contains unsafe raw fields."));
    return undefined;
  }
  const files = Array.isArray(payload.edits) ? payload.edits.map((edit) => sanitizeResultEdit(edit, diagnostics)).filter((edit): edit is ControlledAgentMultifileApplyFileSummary => edit !== undefined) : [];
  if (!Array.isArray(payload.edits) || files.length !== payload.edits.length || files.length !== current.expectedEditCount) {
    diagnostics.push(diagnostic("invalid_result", "Multi-file apply result edit summaries do not match expected bounded edits."));
  }
  const affectedFiles = Array.isArray(result.affectedFiles) ? result.affectedFiles.map(safePath).filter((path): path is string => path !== undefined) : [];
  const message = safeResultMessage(result.message);
  const appliedFileCount = boundedInt(result.appliedFileCount, 0, 4) ? result.appliedFileCount : undefined;
  const appliedEditCount = boundedInt(result.appliedEditCount, 0, 12) ? result.appliedEditCount : undefined;
  const blockedFileCount = boundedInt(result.blockedFileCount, 0, 4) ? result.blockedFileCount : undefined;
  const failedEditCount = boundedInt(result.failedEditCount, 0, 12) ? result.failedEditCount : undefined;
  if (!message || appliedFileCount === undefined || appliedEditCount === undefined || blockedFileCount === undefined || failedEditCount === undefined) {
    diagnostics.push(diagnostic("invalid_result", "Multi-file apply result summary counts are malformed."));
    return undefined;
  }
  if (diagnostics.length > 0) {
    return undefined;
  }
  return { state, message, patchPlanId: current.patchPlanId, appliedFileCount, appliedEditCount, blockedFileCount, failedEditCount, affectedFiles, files, metadataOnly: true, rawReplacementIncluded: false, rawDiffIncluded: false, fileBodyIncluded: false };
}

function sanitizeResultEdit(value: unknown, diagnostics: ControlledAgentMultifileApplyDiagnostic[]): ControlledAgentMultifileApplyFileSummary | undefined {
  if (!isPlainObject(value)) return undefined;
  const editId = safeId(value.editId);
  const workspaceRelativePath = safePath(value.workspaceRelativePath);
  const fileLabel = safeLabel(value.fileLabel);
  const status = value.status === "applied" || value.status === "blocked" || value.status === "failed" ? value.status : undefined;
  const expectedPreEditHash = safeHash(value.expectedPreEditHash);
  const expectedRangeHash = safeHash(value.expectedRangeHash);
  const replacementContentHash = safeHash(value.replacementContentHash);
  const actualPostEditHash = value.actualPostEditHash === undefined ? undefined : safeHash(value.actualPostEditHash);
  const startLine = boundedInt(value.startLine, 1, 1000000) ? value.startLine : undefined;
  const endLine = boundedInt(value.endLine, 1, 1000000) ? value.endLine : undefined;
  const replacementByteCount = boundedInt(value.replacementByteCount, 0, 12000) ? value.replacementByteCount : undefined;
  const sanitizedSummary = safeSummary(value.sanitizedSummary);
  if (!editId || value.operation !== "replace" || !workspaceRelativePath || !fileLabel || !status || !expectedPreEditHash || !expectedRangeHash || !replacementContentHash || (value.actualPostEditHash !== undefined && !actualPostEditHash) || !startLine || !endLine || endLine < startLine || replacementByteCount === undefined || !sanitizedSummary) {
    diagnostics.push(diagnostic("invalid_result", "Multi-file apply result edit summary is malformed."));
    return undefined;
  }
  return { editId, workspaceRelativePath, fileLabel, status, startLine, endLine, replacementByteCount, expectedPreEditHashLabel: hashLabel(expectedPreEditHash), expectedRangeHashLabel: hashLabel(expectedRangeHash), replacementContentHashLabel: hashLabel(replacementContentHash), ...(actualPostEditHash ? { actualPostEditHashLabel: hashLabel(actualPostEditHash) } : {}), sanitizedSummary };
}

function payloadMatchesCorrelation(payload: unknown, current: ControlledAgentMultifileApplyCorrelation): payload is Record<string, unknown> {
  if (!isPlainObject(payload)) return false;
  return payload.requestId === current.requestId && payload.controlledWorkspaceId === current.controlledWorkspaceId && payload.runId === current.runId && payload.workspaceReadinessId === current.workspaceReadinessId && payload.patchPlanId === current.patchPlanId && (current.runtimeSessionId === undefined || payload.runtimeSessionId === current.runtimeSessionId);
}

function sanitizeCorrelation(value: unknown): ControlledAgentMultifileApplyCorrelation | undefined {
  if (!isPlainObject(value)) return undefined;
  const requestId = safeId(value.requestId);
  const controlledWorkspaceId = safeId(value.controlledWorkspaceId);
  const runId = safeId(value.runId);
  const runtimeSessionId = value.runtimeSessionId === undefined ? undefined : safeId(value.runtimeSessionId);
  const workspaceReadinessId = safeId(value.workspaceReadinessId);
  const patchPlanId = safeId(value.patchPlanId);
  const expectedFileCount = boundedInt(value.expectedFileCount, 1, 4) ? value.expectedFileCount : undefined;
  const expectedEditCount = boundedInt(value.expectedEditCount, 1, 12) ? value.expectedEditCount : undefined;
  const expectedFiles = Array.isArray(value.expectedFiles) ? value.expectedFiles.map(safePath).filter((path): path is string => path !== undefined).slice(0, 4) : undefined;
  return requestId && controlledWorkspaceId && runId && (value.runtimeSessionId === undefined || runtimeSessionId) && workspaceReadinessId && patchPlanId && expectedFileCount && expectedEditCount && expectedFiles ? { requestId, controlledWorkspaceId, runId, ...(runtimeSessionId ? { runtimeSessionId } : {}), workspaceReadinessId, patchPlanId, expectedFileCount, expectedEditCount, expectedFiles } : undefined;
}

function extractPlanSource(plan: Record<string, unknown> | undefined): { controlledWorkspaceId?: string; runId?: string; workspaceReadinessId?: string; planId?: string; host?: string; assistantMinted: boolean } {
  const workspace = isPlainObject(plan?.workspace) ? plan.workspace : undefined;
  const planBody = isPlainObject(plan?.plan) ? plan.plan : undefined;
  const applyAuthority = isPlainObject(plan?.applyAuthority) ? plan.applyAuthority : undefined;
  return {
    controlledWorkspaceId: safeId(workspace?.controlledWorkspaceId),
    runId: safeId(workspace?.runId),
    workspaceReadinessId: safeId(workspace?.workspaceReadinessId),
    planId: safeId(planBody?.planId),
    host: typeof workspace?.host === "string" ? workspace.host : undefined,
    assistantMinted: applyAuthority?.assistantMintedApplyAllowed === true || applyAuthority?.modelMintedApplyAuthorityAllowed === true,
  };
}

function buildRequestId(planId: string | undefined, seed: unknown): string | undefined {
  if (typeof seed === "string") return safeId(seed);
  if (!planId) return undefined;
  return safeId(`multifile-apply-${planId}`);
}

function applyPolicy(): ControlledAgentMultifileApplyPolicy {
  return { host: "vscode", browserSupported: false, jetbrainsSupported: false, vscodeExecutionOnly: true, existingTextFilesOnly: true, boundedReplacementOnly: true, rawReplacementIncluded: false, rawDiffIncluded: false, fileBodyIncluded: false, createAllowed: false, deleteAllowed: false, renameAllowed: false, moveAllowed: false, dependencyEditAllowed: false, generatedEditAllowed: false, hiddenPathAllowed: false, commandAllowed: false, providerAllowed: false, toolAllowed: false, automaticApplyAllowed: false };
}

function isSafeResultPolicy(value: unknown): boolean {
  const policy = applyPolicy();
  if (!isPlainObject(value)) return false;
  const entries = Object.entries(policy).filter(([key]) => key !== "host");
  return Object.keys(value).length === entries.length && entries.every(([key, expected]) => value[key] === expected);
}

function requestBlocked(state: "blocked" | "unsupported", diagnostics: ControlledAgentMultifileApplyDiagnostic[], details: Record<string, unknown>): ControlledAgentMultifileApplyRequestResult {
  return { state, diagnostics, details: sanitizeDetails(details), authority };
}

function resultBlocked(diagnostics: ControlledAgentMultifileApplyDiagnostic[], details: Record<string, unknown>): ControlledAgentMultifileApplyResultCorrelationResult {
  return { state: "blocked", diagnostics, details: sanitizeDetails(details), authority };
}

function requestDetails(requestId: string | undefined, controlledWorkspaceId: string | undefined, runId: string | undefined, workspaceReadinessId: string | undefined, patchPlanId: string | undefined, editCount: number, host: string | undefined): Record<string, string | number | boolean | string[]> {
  return sanitizeDetails({ requestId, controlledWorkspaceId, runId, workspaceReadinessId, patchPlanId, editCount, host, metadataOnly: true });
}

function resultDetails(current: ControlledAgentMultifileApplyCorrelation, state: string | undefined): Record<string, string | number | boolean | string[]> {
  return { requestId: current.requestId, controlledWorkspaceId: current.controlledWorkspaceId, runId: current.runId, workspaceReadinessId: current.workspaceReadinessId, patchPlanId: current.patchPlanId, ...(state ? { state } : {}), expectedEditCount: current.expectedEditCount, metadataOnly: true };
}

function scanUnsafeMetadata(value: unknown, diagnostics: ControlledAgentMultifileApplyDiagnostic[], options: { allowResultMessage?: boolean } = {}, keyPath = "", depth = 0, seen = new WeakSet<object>()): void {
  if (depth > 8) return;
  const currentKey = keyPath.split(".").pop();
  if (typeof value === "string") {
    if (!(options.allowResultMessage && currentKey === "message") && unsafeTextPattern.test(value)) {
      diagnostics.push(diagnostic("unsafe_metadata", `Unsafe multi-file apply metadata omitted near ${sanitizeDisplayText(keyPath || "value")}.`));
    }
    return;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    value.slice(0, 50).forEach((item, index) => scanUnsafeMetadata(item, diagnostics, options, `${keyPath}[${index}]`, depth + 1, seen));
    return;
  }
  if (!isPlainObject(value)) return;
  if (seen.has(value)) return;
  seen.add(value);
  for (const [key, item] of Object.entries(value).slice(0, 50)) {
    if ((isSecretLikeKey(key) || isRawContentLikeKey(key) || unsafeKeyPattern.test(key)) && key !== "patchPlanId") {
      diagnostics.push(diagnostic("unsafe_metadata", `Unsupported multi-file apply field ${sanitizeDisplayText(key)}.`));
    }
    scanUnsafeMetadata(item, diagnostics, options, keyPath ? `${keyPath}.${key}` : key, depth + 1, seen);
  }
}

function sanitizeDetails(input: Record<string, unknown>): Record<string, string | number | boolean | string[]> {
  const details: Record<string, string | number | boolean | string[]> = {};
  for (const [key, value] of Object.entries(input).slice(0, 32)) {
    const safeKey = sanitizeDisplayText(key);
    if (typeof value === "string") details[safeKey] = safeLine(value, 180);
    if (typeof value === "number" && Number.isFinite(value)) details[safeKey] = value;
    if (typeof value === "boolean") details[safeKey] = value;
    if (Array.isArray(value)) details[safeKey] = value.filter((item): item is string => typeof item === "string").map((item) => safeLine(item, 80)).slice(0, 8);
  }
  return Object.keys(details).length > 0 ? details : { displayOnly: true };
}

function safeId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const sanitized = sanitizeDisplayText(value).trim();
  return safeIdPattern.test(sanitized) ? sanitized : undefined;
}

function safePath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const sanitized = sanitizeDisplayText(value).trim();
  return safePathPattern.test(sanitized) && !unsafeTextPattern.test(sanitized) ? sanitized : undefined;
}

function safeHash(value: unknown): string | undefined {
  return typeof value === "string" && hashPattern.test(value) ? value : undefined;
}

function safeLabel(value: unknown): string | undefined {
  return typeof value === "string" && value.length >= 1 && value.length <= 160 && !unsafeTextPattern.test(value) ? safeLine(value, 160) : undefined;
}

function safeSummary(value: unknown): string | undefined {
  return typeof value === "string" && value.length >= 1 && value.length <= 240 && !unsafeTextPattern.test(value) ? safeLine(value, 240) : undefined;
}

function safeResultMessage(value: unknown): string | undefined {
  return typeof value === "string" && value.length >= 1 && value.length <= 1000 && !unsafeTextPattern.test(value) ? safeLine(value, 240) : undefined;
}

function safeText(value: unknown, limit: number): string | undefined {
  return typeof value === "string" && value.length <= limit && !unsafeTextPattern.test(value) ? safeLine(value, limit) : undefined;
}

function safeLine(value: string, limit: number): string {
  const sanitized = sanitizeTimelineText(sanitizeDisplayText(value)).replace(/[\r\n\t<>]+/g, " ").trim();
  return sanitized.length > limit ? `${sanitized.slice(0, limit)}…` : sanitized;
}

function hashLabel(hash: string): string {
  return `${hash.slice(0, 18)}…`;
}

function diagnostic(code: ControlledAgentMultifileApplyDiagnosticCode, message: string): ControlledAgentMultifileApplyDiagnostic {
  return { code, message: safeLine(message, 200) };
}

function boundedInt(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
