import { evaluateControlledAgentWorkspaceReadiness } from "./controlledAgentWorkspaceReadiness";
import { sanitizeDisplayText, sanitizeDisplayValue, sanitizeTimelineText } from "./redaction";

export type ControlledAgentRuntimeSessionStatus =
  | "disabled"
  | "opt_in_required"
  | "unsupported_host"
  | "preconditions_blocked"
  | "ready_to_start"
  | "start_requested_metadata"
  | "session_open_metadata"
  | "stop_requested_metadata"
  | "stopped"
  | "blocked";

export type ControlledAgentRuntimeSessionNextUserAction = "none" | "review_opt_in" | "review_preconditions" | "request_start" | "review_session" | "review_stop" | "review_blocker";
export type ControlledAgentRuntimeSessionDiagnosticCode = "missing_input" | "malformed_input" | "unknown_or_invalid_field" | "unsafe_metadata" | "invalid_authority" | "unsupported_host" | "missing_user_opt_in" | "preconditions_blocked" | "assistant_minted_request";

export type ControlledAgentRuntimeSessionDiagnostic = {
  code: ControlledAgentRuntimeSessionDiagnosticCode;
  message: string;
};

export type ControlledAgentRuntimeSessionEvaluation = {
  status: ControlledAgentRuntimeSessionStatus;
  label: string;
  hostSupport: {
    host: "unknown" | HostKind;
    supported: boolean;
    surface: "unknown" | "browser_preview" | "ide_extension";
    futureCapable: boolean;
    label: string;
  };
  preconditions: {
    optIn: "missing" | "confirmed" | "not_required" | "blocked";
    workspaceReadiness: "not_applicable" | "missing" | "blocked" | "ready";
    checkpoint: "not_applicable" | "missing" | "pending" | "verified" | "blocked";
    rollback: "not_applicable" | "missing" | "planned" | "ready" | "blocked";
    workspaceReady: boolean;
    readinessState: string;
  };
  session: {
    state: ControlledAgentRuntimeSessionStatus;
    sessionId?: string;
    sequence: number;
    metadataOnly: boolean;
    terminal: boolean;
    startRequested: boolean;
    stopRequested: boolean;
  };
  nextUserAction: ControlledAgentRuntimeSessionNextUserAction;
  diagnostics: ControlledAgentRuntimeSessionDiagnostic[];
  details: Record<string, string | number | boolean | string[]>;
  safetyFlags: ControlledAgentRuntimeSessionSafetyFlags;
};

export type ControlledAgentRuntimeSessionSafetyFlags = {
  authority: "runtime_session_metadata_only";
  cloudRequired: false;
  executionAllowed: false;
  agentStartAllowed: false;
  autoStartAllowed: false;
  canReadFiles: false;
  canWriteFiles: false;
  canRunCommands: false;
  canApplyEdits: false;
  canCallProvider: false;
  canUseTools: false;
  canUseGit: false;
  canUseNetwork: false;
  canAutoRollback: false;
  canStartAutonomousLoop: false;
};

type HostKind = "browser" | "vscode" | "jetbrains";
type WorkspaceMode = "none" | "disposable" | "worktree" | "existing";
type OptInStatus = "not_required" | "missing" | "confirmed";
type Actor = "none" | "user" | "host" | "gui";
type WorkspaceReadinessStatus = "not_applicable" | "missing" | "blocked" | "ready";
type CheckpointStatus = "not_applicable" | "missing" | "pending" | "verified" | "blocked";
type RollbackStatus = "not_applicable" | "missing" | "planned" | "ready" | "blocked";

type RuntimeSessionRecord = {
  kind: "controlled_agent_runtime_session";
  version: "2026-07-02";
  authority: unknown;
  cloudRequired: unknown;
  executionAllowed: unknown;
  agentStartAllowed: unknown;
  autoStartAllowed: unknown;
  host: HostMetadata;
  workspace: WorkspaceMetadata;
  preconditions: PreconditionMetadata;
  session: SessionMetadata;
  limits: LimitsMetadata;
  policyFlags: PolicyFlags;
  details: DetailsMetadata;
};

type HostMetadata = {
  kind: HostKind;
  supported: boolean;
  surface: "browser_preview" | "ide_extension";
  label: string;
};

type WorkspaceMetadata = {
  workspaceMode: WorkspaceMode;
  workspaceReady: boolean;
  privatePathExposed: boolean;
  hostOwned: boolean;
  controlledWorkspaceId?: string;
  readinessId?: string;
  label: string;
};

type PreconditionMetadata = {
  optIn: {
    status: OptInStatus;
    origin: Actor;
    confirmedBy: Actor;
    requestIdMintedBy: Actor;
    assistantMinted: boolean;
    grantsStartAuthority: boolean;
    confirmedAt?: string;
    label?: string;
  };
  workspaceReadiness: {
    status: WorkspaceReadinessStatus;
    readinessId: string;
    metadataOnly: boolean;
    label?: string;
  };
  checkpoint: {
    status: CheckpointStatus;
    verified: boolean;
    metadataOnly: boolean;
    autoCreateAllowed: boolean;
    checkpointId?: string;
    checkedAt?: string;
    label?: string;
  };
  rollback: {
    status: RollbackStatus;
    metadataOnly: boolean;
    autoRollbackAllowed: boolean;
    requiresUserConfirmation: boolean;
    planId?: string;
    label?: string;
  };
  correlation?: {
    correlationId: string;
    readinessId: string;
    checkpointId: string;
    rollbackPlanId: string;
    label?: string;
  };
};

type SessionMetadata = {
  state: ControlledAgentRuntimeSessionStatus;
  sessionId: string;
  metadataOnly: boolean;
  sequence: number;
  enteredAt: string;
  startRequest?: SessionRequest;
  stopRequest?: SessionRequest;
  label?: string;
};

type SessionRequest = {
  requestId: string;
  requestedBy: "user" | "host" | "gui";
  requestIdMintedBy: "user" | "host" | "gui";
  assistantMinted: boolean;
  correlationId: string;
  requestedAt: string;
  reason?: string;
};

type LimitsMetadata = {
  maxSteps: number;
  maxFileReads: number;
  maxTouchedFiles: number;
  maxPatchBytes: number;
  maxVerificationRuns: number;
  maxRuntimeSeconds: number;
  limitLabel?: string;
};

type PolicyFlags = Record<PolicyFlagKey, boolean>;
type PolicyFlagKey = typeof policyFlagKeys[number];

type DetailsMetadata = {
  summary: string;
  sanitized: boolean;
  nextUserAction?: ControlledAgentRuntimeSessionNextUserAction;
  evidenceLabel?: string;
};

const safetyFlags: ControlledAgentRuntimeSessionSafetyFlags = {
  authority: "runtime_session_metadata_only",
  cloudRequired: false,
  executionAllowed: false,
  agentStartAllowed: false,
  autoStartAllowed: false,
  canReadFiles: false,
  canWriteFiles: false,
  canRunCommands: false,
  canApplyEdits: false,
  canCallProvider: false,
  canUseTools: false,
  canUseGit: false,
  canUseNetwork: false,
  canAutoRollback: false,
  canStartAutonomousLoop: false,
};

const statusValues = new Set<unknown>(["disabled", "opt_in_required", "unsupported_host", "preconditions_blocked", "ready_to_start", "start_requested_metadata", "session_open_metadata", "stop_requested_metadata", "stopped", "blocked"]);
const hostKinds = new Set<unknown>(["browser", "vscode", "jetbrains"]);
const workspaceModes = new Set<unknown>(["none", "disposable", "worktree", "existing"]);
const optInStatuses = new Set<unknown>(["not_required", "missing", "confirmed"]);
const actors = new Set<unknown>(["none", "user", "host", "gui"]);
const workspaceReadinessStatuses = new Set<unknown>(["not_applicable", "missing", "blocked", "ready"]);
const checkpointStatuses = new Set<unknown>(["not_applicable", "missing", "pending", "verified", "blocked"]);
const rollbackStatuses = new Set<unknown>(["not_applicable", "missing", "planned", "ready", "blocked"]);
const requestActors = new Set<unknown>(["user", "host", "gui"]);
const nextUserActions = new Set<unknown>(["none", "review_opt_in", "review_preconditions", "request_start", "review_session", "review_stop", "review_blocker"]);
const topLevelKeys = new Set(["kind", "version", "authority", "cloudRequired", "executionAllowed", "agentStartAllowed", "autoStartAllowed", "host", "workspace", "preconditions", "session", "limits", "policyFlags", "details"]);
const hostKeys = new Set(["kind", "supported", "surface", "label"]);
const workspaceKeys = new Set(["workspaceMode", "workspaceReady", "privatePathExposed", "hostOwned", "controlledWorkspaceId", "readinessId", "label"]);
const preconditionKeys = new Set(["optIn", "workspaceReadiness", "checkpoint", "rollback", "correlation"]);
const optInKeys = new Set(["status", "origin", "confirmedBy", "requestIdMintedBy", "assistantMinted", "grantsStartAuthority", "confirmedAt", "label"]);
const readinessKeys = new Set(["status", "readinessId", "metadataOnly", "label"]);
const checkpointKeys = new Set(["status", "verified", "metadataOnly", "autoCreateAllowed", "checkpointId", "checkedAt", "label"]);
const rollbackKeys = new Set(["status", "metadataOnly", "autoRollbackAllowed", "requiresUserConfirmation", "planId", "label"]);
const correlationKeys = new Set(["correlationId", "readinessId", "checkpointId", "rollbackPlanId", "label"]);
const sessionKeys = new Set(["state", "sessionId", "metadataOnly", "sequence", "enteredAt", "startRequest", "stopRequest", "label"]);
const requestKeys = new Set(["requestId", "requestedBy", "requestIdMintedBy", "assistantMinted", "correlationId", "requestedAt", "reason"]);
const limitsKeys = new Set(["maxSteps", "maxFileReads", "maxTouchedFiles", "maxPatchBytes", "maxVerificationRuns", "maxRuntimeSeconds", "limitLabel"]);
const policyFlagKeys = ["runtimeSessionMetadataOnly", "autoStartAllowed", "autoApplyAllowed", "autoRunAllowed", "autoVerifyAllowed", "autoFixAllowed", "autoRollbackAllowed", "fileReadAllowed", "fileWriteAllowed", "shellAllowed", "gitAllowed", "networkAllowed", "providerAllowed", "toolAllowed", "rawPromptAllowed", "rawFileAllowed", "rawDiffAllowed", "rawCommandAllowed", "rawLogAllowed"] as const;
const policyFlagKeySet = new Set<string>(policyFlagKeys);
const detailsKeys = new Set(["summary", "sanitized", "nextUserAction", "evidenceLabel"]);
const blockedKeyPattern = /^(?:command|cmd|args|arguments|cwd|env|environment|shell|git|network|provider|providerTool|provider_tool|tool|toolCall|tool_call|rawCommand|raw_command|rawArgs|raw_args|rawCwd|raw_cwd|rawEnv|raw_env|rawOutput|raw_output|rawLog|raw_log|rawFile|raw_file|rawFileBody|raw_file_body|fileBody|file_body|fileContents|file_contents|rawPrompt|raw_prompt|rawDiff|raw_diff|privatePath|private_path|browserStorage|browser_storage|storageDump|storage_dump|autoStart|auto_start|autoApply|auto_apply|autoRun|auto_run|autoVerify|auto_verify|autoFix|auto_fix|autoRepair|auto_repair|execute|execution|actionExecution|action_execution)$/i;
const unsafeTextPattern = /authorization|bearer|api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|cookie|raw[_ -]?(?:file|prompt|command|output|log|diff)|file[_ -]?(?:body|content)|provider|shell|\bcommand\b|\bcwd\b|\benv\b|\bgit\b|\btool\b|network|hidden[_ -]?(?:scan|read|search)|auto[_ -]?(?:start|apply|run|verify|fix|repair|rollback)|action[_ -]?execution|sk-(?:proj-)?[A-Za-z0-9_-]{8,}|BEGIN [A-Z ]*PRIVATE KEY|\/(?:Users|home|tmp|var|etc|opt|mnt|Volumes|private)(?=\/|$)|[A-Za-z]:(?:\\|\/)|~(?:\\|\/)/i;
const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

export function evaluateControlledAgentRuntimeSession(input: unknown): ControlledAgentRuntimeSessionEvaluation {
  const diagnostics: ControlledAgentRuntimeSessionDiagnostic[] = [];
  if (input === undefined || input === null) {
    diagnostics.push(diagnostic("missing_input", "Controlled runtime session metadata is absent and remains disabled."));
    return buildEvaluation("disabled", "Controlled runtime session is disabled.", undefined, diagnostics);
  }

  scanUnsafeMetadata(input, diagnostics);
  const metadata = parseRuntimeSession(input, diagnostics);
  if (!metadata) {
    return buildEvaluation("blocked", "Controlled runtime session metadata is blocked because it is malformed.", undefined, diagnostics);
  }

  validateAuthority(metadata, diagnostics);
  validatePolicyFlags(metadata.policyFlags, diagnostics);
  validateRequests(metadata, diagnostics);

  if (hasBlockingDiagnostics(diagnostics)) {
    return buildEvaluation("blocked", "Controlled runtime session metadata is blocked. Raw payload omitted.", metadata, diagnostics);
  }

  const status = determineStatus(metadata, diagnostics);
  if (hasBlockingDiagnostics(diagnostics)) {
    return buildEvaluation("blocked", "Controlled runtime session metadata is blocked. Raw payload omitted.", metadata, diagnostics);
  }

  return buildEvaluation(status, metadata.details.summary || defaultLabel(status), metadata, diagnostics);
}

function parseRuntimeSession(input: unknown, diagnostics: ControlledAgentRuntimeSessionDiagnostic[]): RuntimeSessionRecord | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push(diagnostic("malformed_input", "Controlled runtime session metadata must be an object."));
    return undefined;
  }
  rejectUnknownKeys(input, topLevelKeys, diagnostics, "runtime session");
  const host = parseHost(input.host, diagnostics);
  const workspace = parseWorkspace(input.workspace, diagnostics);
  const preconditions = parsePreconditions(input.preconditions, diagnostics);
  const session = parseSession(input.session, diagnostics);
  const limits = parseLimits(input.limits, diagnostics);
  const policyFlags = parsePolicyFlags(input.policyFlags, diagnostics);
  const details = parseDetails(input.details, diagnostics);
  if (input.kind !== "controlled_agent_runtime_session" || input.version !== "2026-07-02" || !host || !workspace || !preconditions || !session || !limits || !policyFlags || !details) {
    diagnostics.push(diagnostic("malformed_input", "Controlled runtime session metadata does not match the S82 contract."));
    return undefined;
  }
  return {
    kind: "controlled_agent_runtime_session",
    version: "2026-07-02",
    authority: input.authority,
    cloudRequired: input.cloudRequired,
    executionAllowed: input.executionAllowed,
    agentStartAllowed: input.agentStartAllowed,
    autoStartAllowed: input.autoStartAllowed,
    host,
    workspace,
    preconditions,
    session,
    limits,
    policyFlags,
    details,
  };
}

function parseHost(input: unknown, diagnostics: ControlledAgentRuntimeSessionDiagnostic[]): HostMetadata | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push(diagnostic("malformed_input", "Controlled runtime host metadata must be an object."));
    return undefined;
  }
  rejectUnknownKeys(input, hostKeys, diagnostics, "host");
  if (!hostKinds.has(input.kind) || typeof input.supported !== "boolean" || (input.surface !== "browser_preview" && input.surface !== "ide_extension") || typeof input.label !== "string") {
    diagnostics.push(diagnostic("malformed_input", "Controlled runtime host metadata is invalid."));
    return undefined;
  }
  return { kind: input.kind as HostKind, supported: input.supported, surface: input.surface, label: input.label };
}

function parseWorkspace(input: unknown, diagnostics: ControlledAgentRuntimeSessionDiagnostic[]): WorkspaceMetadata | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push(diagnostic("malformed_input", "Controlled runtime workspace metadata must be an object."));
    return undefined;
  }
  rejectUnknownKeys(input, workspaceKeys, diagnostics, "workspace");
  if (!workspaceModes.has(input.workspaceMode) || typeof input.workspaceReady !== "boolean" || typeof input.privatePathExposed !== "boolean" || typeof input.hostOwned !== "boolean" || typeof input.label !== "string" || !optionalSafeId(input.controlledWorkspaceId) || !optionalSafeId(input.readinessId)) {
    diagnostics.push(diagnostic("malformed_input", "Controlled runtime workspace metadata is invalid."));
    return undefined;
  }
  return { workspaceMode: input.workspaceMode as WorkspaceMode, workspaceReady: input.workspaceReady, privatePathExposed: input.privatePathExposed, hostOwned: input.hostOwned, controlledWorkspaceId: input.controlledWorkspaceId, readinessId: input.readinessId, label: input.label };
}

function parsePreconditions(input: unknown, diagnostics: ControlledAgentRuntimeSessionDiagnostic[]): PreconditionMetadata | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push(diagnostic("malformed_input", "Controlled runtime precondition metadata must be an object."));
    return undefined;
  }
  rejectUnknownKeys(input, preconditionKeys, diagnostics, "preconditions");
  const optIn = parseOptIn(input.optIn, diagnostics);
  const workspaceReadiness = parseWorkspaceReadiness(input.workspaceReadiness, diagnostics);
  const checkpoint = parseCheckpoint(input.checkpoint, diagnostics);
  const rollback = parseRollback(input.rollback, diagnostics);
  const correlation = input.correlation === undefined ? undefined : parseCorrelation(input.correlation, diagnostics);
  if (!optIn || !workspaceReadiness || !checkpoint || !rollback || (input.correlation !== undefined && !correlation)) {
    return undefined;
  }
  return { optIn, workspaceReadiness, checkpoint, rollback, correlation };
}

function parseOptIn(input: unknown, diagnostics: ControlledAgentRuntimeSessionDiagnostic[]): PreconditionMetadata["optIn"] | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push(diagnostic("malformed_input", "Controlled runtime opt-in metadata must be an object."));
    return undefined;
  }
  rejectUnknownKeys(input, optInKeys, diagnostics, "opt-in");
  if (!optInStatuses.has(input.status) || !actors.has(input.origin) || !actors.has(input.confirmedBy) || !actors.has(input.requestIdMintedBy) || typeof input.assistantMinted !== "boolean" || typeof input.grantsStartAuthority !== "boolean" || (input.confirmedAt !== undefined && typeof input.confirmedAt !== "string") || (input.label !== undefined && typeof input.label !== "string")) {
    diagnostics.push(diagnostic("malformed_input", "Controlled runtime opt-in metadata is invalid."));
    return undefined;
  }
  return { status: input.status as OptInStatus, origin: input.origin as Actor, confirmedBy: input.confirmedBy as Actor, requestIdMintedBy: input.requestIdMintedBy as Actor, assistantMinted: input.assistantMinted, grantsStartAuthority: input.grantsStartAuthority, confirmedAt: input.confirmedAt, label: input.label };
}

function parseWorkspaceReadiness(input: unknown, diagnostics: ControlledAgentRuntimeSessionDiagnostic[]): PreconditionMetadata["workspaceReadiness"] | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push(diagnostic("malformed_input", "Controlled runtime workspace readiness metadata must be an object."));
    return undefined;
  }
  rejectUnknownKeys(input, readinessKeys, diagnostics, "workspace readiness");
  if (!workspaceReadinessStatuses.has(input.status) || typeof input.readinessId !== "string" || !safeIdPattern.test(input.readinessId) || typeof input.metadataOnly !== "boolean" || (input.label !== undefined && typeof input.label !== "string")) {
    diagnostics.push(diagnostic("malformed_input", "Controlled runtime workspace readiness metadata is invalid."));
    return undefined;
  }
  return { status: input.status as WorkspaceReadinessStatus, readinessId: input.readinessId, metadataOnly: input.metadataOnly, label: input.label };
}

function parseCheckpoint(input: unknown, diagnostics: ControlledAgentRuntimeSessionDiagnostic[]): PreconditionMetadata["checkpoint"] | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push(diagnostic("malformed_input", "Controlled runtime checkpoint metadata must be an object."));
    return undefined;
  }
  rejectUnknownKeys(input, checkpointKeys, diagnostics, "checkpoint");
  if (!checkpointStatuses.has(input.status) || typeof input.verified !== "boolean" || typeof input.metadataOnly !== "boolean" || typeof input.autoCreateAllowed !== "boolean" || !optionalSafeId(input.checkpointId) || (input.checkedAt !== undefined && typeof input.checkedAt !== "string") || (input.label !== undefined && typeof input.label !== "string")) {
    diagnostics.push(diagnostic("malformed_input", "Controlled runtime checkpoint metadata is invalid."));
    return undefined;
  }
  return { status: input.status as CheckpointStatus, verified: input.verified, metadataOnly: input.metadataOnly, autoCreateAllowed: input.autoCreateAllowed, checkpointId: input.checkpointId, checkedAt: input.checkedAt, label: input.label };
}

function parseRollback(input: unknown, diagnostics: ControlledAgentRuntimeSessionDiagnostic[]): PreconditionMetadata["rollback"] | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push(diagnostic("malformed_input", "Controlled runtime rollback metadata must be an object."));
    return undefined;
  }
  rejectUnknownKeys(input, rollbackKeys, diagnostics, "rollback");
  if (!rollbackStatuses.has(input.status) || typeof input.metadataOnly !== "boolean" || typeof input.autoRollbackAllowed !== "boolean" || typeof input.requiresUserConfirmation !== "boolean" || !optionalSafeId(input.planId) || (input.label !== undefined && typeof input.label !== "string")) {
    diagnostics.push(diagnostic("malformed_input", "Controlled runtime rollback metadata is invalid."));
    return undefined;
  }
  return { status: input.status as RollbackStatus, metadataOnly: input.metadataOnly, autoRollbackAllowed: input.autoRollbackAllowed, requiresUserConfirmation: input.requiresUserConfirmation, planId: input.planId, label: input.label };
}

function parseCorrelation(input: unknown, diagnostics: ControlledAgentRuntimeSessionDiagnostic[]): PreconditionMetadata["correlation"] | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push(diagnostic("malformed_input", "Controlled runtime correlation metadata must be an object."));
    return undefined;
  }
  rejectUnknownKeys(input, correlationKeys, diagnostics, "correlation");
  if (typeof input.correlationId !== "string" || !safeIdPattern.test(input.correlationId) || typeof input.readinessId !== "string" || !safeIdPattern.test(input.readinessId) || typeof input.checkpointId !== "string" || !safeIdPattern.test(input.checkpointId) || typeof input.rollbackPlanId !== "string" || !safeIdPattern.test(input.rollbackPlanId) || (input.label !== undefined && typeof input.label !== "string")) {
    diagnostics.push(diagnostic("malformed_input", "Controlled runtime correlation metadata is invalid."));
    return undefined;
  }
  return { correlationId: input.correlationId, readinessId: input.readinessId, checkpointId: input.checkpointId, rollbackPlanId: input.rollbackPlanId, label: input.label };
}

function parseSession(input: unknown, diagnostics: ControlledAgentRuntimeSessionDiagnostic[]): SessionMetadata | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push(diagnostic("malformed_input", "Controlled runtime session metadata must be an object."));
    return undefined;
  }
  rejectUnknownKeys(input, sessionKeys, diagnostics, "session");
  const startRequest = input.startRequest === undefined ? undefined : parseSessionRequest(input.startRequest, diagnostics, "start request");
  const stopRequest = input.stopRequest === undefined ? undefined : parseSessionRequest(input.stopRequest, diagnostics, "stop request");
  if (!statusValues.has(input.state) || input.state === "opt_in_required" || input.state === "preconditions_blocked" || typeof input.sessionId !== "string" || !safeIdPattern.test(input.sessionId) || typeof input.metadataOnly !== "boolean" || !boundedInteger(input.sequence, 0, 1000) || typeof input.enteredAt !== "string" || (input.label !== undefined && typeof input.label !== "string") || (input.startRequest !== undefined && !startRequest) || (input.stopRequest !== undefined && !stopRequest)) {
    diagnostics.push(diagnostic("malformed_input", "Controlled runtime session metadata is invalid."));
    return undefined;
  }
  return { state: input.state as ControlledAgentRuntimeSessionStatus, sessionId: input.sessionId, metadataOnly: input.metadataOnly, sequence: input.sequence, enteredAt: input.enteredAt, startRequest, stopRequest, label: input.label };
}

function parseSessionRequest(input: unknown, diagnostics: ControlledAgentRuntimeSessionDiagnostic[], label: string): SessionRequest | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push(diagnostic("malformed_input", `Controlled runtime ${label} metadata must be an object.`));
    return undefined;
  }
  rejectUnknownKeys(input, requestKeys, diagnostics, label);
  if (typeof input.requestId !== "string" || !safeIdPattern.test(input.requestId) || !requestActors.has(input.requestedBy) || !requestActors.has(input.requestIdMintedBy) || typeof input.assistantMinted !== "boolean" || typeof input.correlationId !== "string" || !safeIdPattern.test(input.correlationId) || typeof input.requestedAt !== "string" || (input.reason !== undefined && typeof input.reason !== "string")) {
    diagnostics.push(diagnostic("malformed_input", `Controlled runtime ${label} metadata is invalid.`));
    return undefined;
  }
  return { requestId: input.requestId, requestedBy: input.requestedBy as SessionRequest["requestedBy"], requestIdMintedBy: input.requestIdMintedBy as SessionRequest["requestIdMintedBy"], assistantMinted: input.assistantMinted, correlationId: input.correlationId, requestedAt: input.requestedAt, reason: input.reason };
}

function parseLimits(input: unknown, diagnostics: ControlledAgentRuntimeSessionDiagnostic[]): LimitsMetadata | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push(diagnostic("malformed_input", "Controlled runtime limits metadata must be an object."));
    return undefined;
  }
  rejectUnknownKeys(input, limitsKeys, diagnostics, "limits");
  if (!boundedInteger(input.maxSteps, 1, 20) || !boundedInteger(input.maxFileReads, 0, 48) || !boundedInteger(input.maxTouchedFiles, 0, 12) || !boundedInteger(input.maxPatchBytes, 0, 50000) || !boundedInteger(input.maxVerificationRuns, 0, 4) || !boundedInteger(input.maxRuntimeSeconds, 1, 1800) || (input.limitLabel !== undefined && typeof input.limitLabel !== "string")) {
    diagnostics.push(diagnostic("malformed_input", "Controlled runtime limits metadata is outside allowed bounds."));
    return undefined;
  }
  return { maxSteps: input.maxSteps, maxFileReads: input.maxFileReads, maxTouchedFiles: input.maxTouchedFiles, maxPatchBytes: input.maxPatchBytes, maxVerificationRuns: input.maxVerificationRuns, maxRuntimeSeconds: input.maxRuntimeSeconds, limitLabel: input.limitLabel };
}

function parsePolicyFlags(input: unknown, diagnostics: ControlledAgentRuntimeSessionDiagnostic[]): PolicyFlags | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push(diagnostic("malformed_input", "Controlled runtime policy flags must be an object."));
    return undefined;
  }
  rejectUnknownKeys(input, policyFlagKeySet, diagnostics, "policy flags");
  for (const key of policyFlagKeys) {
    if (typeof input[key] !== "boolean") {
      diagnostics.push(diagnostic("malformed_input", "Controlled runtime policy flags are invalid."));
      return undefined;
    }
  }
  return input as PolicyFlags;
}

function parseDetails(input: unknown, diagnostics: ControlledAgentRuntimeSessionDiagnostic[]): DetailsMetadata | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push(diagnostic("malformed_input", "Controlled runtime details metadata must be an object."));
    return undefined;
  }
  rejectUnknownKeys(input, detailsKeys, diagnostics, "details");
  if (typeof input.summary !== "string" || typeof input.sanitized !== "boolean" || (input.nextUserAction !== undefined && !nextUserActions.has(input.nextUserAction)) || (input.evidenceLabel !== undefined && typeof input.evidenceLabel !== "string")) {
    diagnostics.push(diagnostic("malformed_input", "Controlled runtime details metadata is invalid."));
    return undefined;
  }
  return { summary: input.summary, sanitized: input.sanitized, nextUserAction: input.nextUserAction as ControlledAgentRuntimeSessionNextUserAction | undefined, evidenceLabel: input.evidenceLabel };
}

function validateAuthority(metadata: RuntimeSessionRecord, diagnostics: ControlledAgentRuntimeSessionDiagnostic[]): void {
  if (metadata.authority !== "runtime_session_metadata_only" || metadata.cloudRequired !== false || metadata.details.sanitized !== true) {
    diagnostics.push(diagnostic("invalid_authority", "Controlled runtime session metadata must remain sanitized metadata only."));
  }
  if (metadata.executionAllowed !== false || metadata.agentStartAllowed !== false || metadata.autoStartAllowed !== false) {
    diagnostics.push(diagnostic("invalid_authority", "Controlled runtime session metadata cannot grant execution or start authority."));
  }
  const preconditions = metadata.preconditions;
  if (preconditions.optIn.assistantMinted !== false || preconditions.optIn.grantsStartAuthority !== false || preconditions.workspaceReadiness.metadataOnly !== true || preconditions.checkpoint.metadataOnly !== true || preconditions.checkpoint.autoCreateAllowed !== false || preconditions.rollback.metadataOnly !== true || preconditions.rollback.autoRollbackAllowed !== false || preconditions.rollback.requiresUserConfirmation !== true) {
    diagnostics.push(diagnostic("invalid_authority", "Controlled runtime preconditions cannot grant automatic authority."));
  }
  if (metadata.session.metadataOnly !== true) {
    diagnostics.push(diagnostic("invalid_authority", "Controlled runtime session state must be metadata only."));
  }
}

function validatePolicyFlags(policyFlags: PolicyFlags, diagnostics: ControlledAgentRuntimeSessionDiagnostic[]): void {
  if (policyFlags.runtimeSessionMetadataOnly !== true || policyFlagKeys.filter((key) => key !== "runtimeSessionMetadataOnly").some((key) => policyFlags[key] !== false)) {
    diagnostics.push(diagnostic("invalid_authority", "Controlled runtime policy flags must deny runtime authority."));
  }
}

function validateRequests(metadata: RuntimeSessionRecord, diagnostics: ControlledAgentRuntimeSessionDiagnostic[]): void {
  for (const request of [metadata.session.startRequest, metadata.session.stopRequest]) {
    if (!request) continue;
    if (request.assistantMinted !== false) {
      diagnostics.push(diagnostic("assistant_minted_request", "Assistant-minted runtime session request metadata is blocked."));
    }
  }
}

function determineStatus(metadata: RuntimeSessionRecord, diagnostics: ControlledAgentRuntimeSessionDiagnostic[]): ControlledAgentRuntimeSessionStatus {
  if (metadata.workspace.workspaceMode === "none" || metadata.session.state === "disabled") {
    return "disabled";
  }
  if (metadata.host.kind === "browser" || metadata.host.supported !== true || metadata.host.surface !== "ide_extension") {
    diagnostics.push(diagnostic("unsupported_host", "Browser preview cannot support controlled runtime sessions."));
    return "unsupported_host";
  }
  if (!hasExplicitUserOptIn(metadata)) {
    diagnostics.push(diagnostic("missing_user_opt_in", "Controlled runtime session requires explicit user opt-in metadata."));
    return "opt_in_required";
  }
  const readiness = evaluateControlledAgentWorkspaceReadiness(toWorkspaceReadiness(metadata));
  if (!hasReadyPreconditions(metadata) || readiness.state !== "ready_for_future_controlled_mode") {
    diagnostics.push(diagnostic("preconditions_blocked", "Controlled runtime session requires ready workspace, checkpoint, and rollback metadata."));
    return "preconditions_blocked";
  }
  if (metadata.session.state === "stopped") return "stopped";
  if (metadata.session.state === "stop_requested_metadata") return "stop_requested_metadata";
  if (metadata.session.state === "session_open_metadata") return "session_open_metadata";
  if (metadata.session.state === "start_requested_metadata") return "start_requested_metadata";
  return "ready_to_start";
}

function hasExplicitUserOptIn(metadata: RuntimeSessionRecord): boolean {
  const optIn = metadata.preconditions.optIn;
  return optIn.status === "confirmed" && optIn.origin === "user" && optIn.confirmedBy === "user" && (optIn.requestIdMintedBy === "gui" || optIn.requestIdMintedBy === "host") && optIn.assistantMinted === false && optIn.grantsStartAuthority === false;
}

function hasReadyPreconditions(metadata: RuntimeSessionRecord): boolean {
  const preconditions = metadata.preconditions;
  return metadata.workspace.workspaceReady === true && metadata.workspace.privatePathExposed === false && metadata.workspace.hostOwned === true && metadata.workspace.workspaceMode !== "existing" && metadata.workspace.workspaceMode !== "none" && preconditions.workspaceReadiness.status === "ready" && preconditions.checkpoint.status === "verified" && preconditions.checkpoint.verified === true && (preconditions.rollback.status === "planned" || preconditions.rollback.status === "ready") && preconditions.rollback.requiresUserConfirmation === true && correlationMatches(preconditions);
}

function correlationMatches(preconditions: PreconditionMetadata): boolean {
  if (!preconditions.correlation || !preconditions.checkpoint.checkpointId || !preconditions.rollback.planId) return false;
  return preconditions.correlation.readinessId === preconditions.workspaceReadiness.readinessId && preconditions.correlation.checkpointId === preconditions.checkpoint.checkpointId && preconditions.correlation.rollbackPlanId === preconditions.rollback.planId;
}

function toWorkspaceReadiness(metadata: RuntimeSessionRecord): Record<string, unknown> {
  return {
    kind: "controlled_agent_workspace_readiness",
    version: "2026-06-29",
    authority: "metadata_only",
    cloudRequired: false,
    executionAllowed: false,
    agentStartAllowed: false,
    workspaceMode: metadata.workspace.workspaceMode,
    host: metadata.host.kind,
    optIn: hasExplicitUserOptIn(metadata) ? {
      origin: "user",
      confirmedBy: "user",
      confirmedAt: metadata.preconditions.optIn.confirmedAt ?? metadata.session.enteredAt,
      requestIdMintedBy: metadata.preconditions.optIn.requestIdMintedBy,
      grantsStartAuthority: false,
      label: metadata.preconditions.optIn.label,
    } : undefined,
    isolation: {
      status: metadata.workspace.workspaceReady ? "ready" : metadata.workspace.workspaceMode === "none" ? "disabled" : "not_ready",
      workspaceMode: metadata.workspace.workspaceMode,
      hostOwned: metadata.workspace.hostOwned,
      workspaceLabel: metadata.workspace.label,
      privatePathExposed: metadata.workspace.privatePathExposed,
      readinessId: metadata.workspace.readinessId,
    },
    checkpoint: metadata.preconditions.checkpoint,
    rollback: metadata.preconditions.rollback,
    limits: {
      maxSteps: metadata.limits.maxSteps,
      maxTouchedFiles: metadata.limits.maxTouchedFiles,
      maxPatchBytes: metadata.limits.maxPatchBytes,
      maxRuntimeSeconds: metadata.limits.maxRuntimeSeconds,
      limitLabel: metadata.limits.limitLabel,
    },
    policyFlags: {
      fileReadAllowed: false,
      fileWriteAllowed: false,
      shellAllowed: false,
      gitAllowed: false,
      providerAllowed: false,
      toolAllowed: false,
      autoStartAllowed: false,
      autoApplyAllowed: false,
      autoRunAllowed: false,
      autoRollbackAllowed: false,
    },
    summary: metadata.details.summary,
  };
}

function buildEvaluation(status: ControlledAgentRuntimeSessionStatus, label: string, metadata: RuntimeSessionRecord | undefined, diagnostics: ControlledAgentRuntimeSessionDiagnostic[]): ControlledAgentRuntimeSessionEvaluation {
  const safeLabel = safeText(label, defaultLabel(status), 160);
  return {
    status,
    label: safeLabel,
    hostSupport: buildHostSupport(metadata),
    preconditions: buildPreconditions(status, metadata),
    session: buildSession(status, metadata),
    nextUserAction: nextAction(status, metadata),
    diagnostics: diagnostics.map((item) => diagnostic(item.code, item.message)).slice(0, 24),
    details: buildDetails(status, metadata),
    safetyFlags,
  };
}

function buildHostSupport(metadata: RuntimeSessionRecord | undefined): ControlledAgentRuntimeSessionEvaluation["hostSupport"] {
  if (!metadata) return { host: "unknown", supported: false, surface: "unknown", futureCapable: false, label: "Host metadata unavailable" };
  const futureCapable = metadata.host.kind === "vscode" || metadata.host.kind === "jetbrains";
  return { host: metadata.host.kind, supported: metadata.host.supported === true && futureCapable, surface: metadata.host.surface, futureCapable, label: safeText(metadata.host.label, "Host metadata visible", 100) };
}

function buildPreconditions(status: ControlledAgentRuntimeSessionStatus, metadata: RuntimeSessionRecord | undefined): ControlledAgentRuntimeSessionEvaluation["preconditions"] {
  if (!metadata) return { optIn: status === "disabled" ? "not_required" : "blocked", workspaceReadiness: "missing", checkpoint: "missing", rollback: "missing", workspaceReady: false, readinessState: "unavailable" };
  return {
    optIn: metadata.preconditions.optIn.status,
    workspaceReadiness: metadata.preconditions.workspaceReadiness.status,
    checkpoint: metadata.preconditions.checkpoint.status,
    rollback: metadata.preconditions.rollback.status,
    workspaceReady: metadata.workspace.workspaceReady === true,
    readinessState: hasReadyPreconditions(metadata) ? "ready_for_future_controlled_mode" : "blocked",
  };
}

function buildSession(status: ControlledAgentRuntimeSessionStatus, metadata: RuntimeSessionRecord | undefined): ControlledAgentRuntimeSessionEvaluation["session"] {
  return {
    state: status,
    sessionId: metadata?.session.sessionId,
    sequence: metadata?.session.sequence ?? 0,
    metadataOnly: metadata?.session.metadataOnly === true,
    terminal: status === "stopped" || status === "blocked" || status === "disabled",
    startRequested: metadata?.session.startRequest !== undefined,
    stopRequested: metadata?.session.stopRequest !== undefined,
  };
}

function nextAction(status: ControlledAgentRuntimeSessionStatus, metadata: RuntimeSessionRecord | undefined): ControlledAgentRuntimeSessionNextUserAction {
  if (status === "disabled") return "none";
  if (status === "opt_in_required") return "review_opt_in";
  if (status === "unsupported_host" || status === "blocked") return "review_blocker";
  if (status === "preconditions_blocked") return "review_preconditions";
  if (status === "ready_to_start") return "request_start";
  if (status === "stop_requested_metadata" || status === "stopped") return "review_stop";
  if (status === "start_requested_metadata") return metadata?.details.nextUserAction ?? "review_session";
  return "review_session";
}

function buildDetails(status: ControlledAgentRuntimeSessionStatus, metadata: RuntimeSessionRecord | undefined): Record<string, string | number | boolean | string[]> {
  const sanitized = sanitizeDisplayValue({
    displayOnly: true,
    sanitized: true,
    status,
    host: metadata?.host.kind,
    workspaceMode: metadata?.workspace.workspaceMode,
    workspaceReady: metadata?.workspace.workspaceReady,
    sessionState: metadata?.session.state,
    sequence: metadata?.session.sequence,
    maxSteps: metadata?.limits.maxSteps,
    maxFileReads: metadata?.limits.maxFileReads,
    maxTouchedFiles: metadata?.limits.maxTouchedFiles,
    maxVerificationRuns: metadata?.limits.maxVerificationRuns,
    maxRuntimeSeconds: metadata?.limits.maxRuntimeSeconds,
    summary: metadata?.details.summary,
    evidenceLabel: metadata?.details.evidenceLabel,
  });
  if (!isPlainObject(sanitized)) return { displayOnly: true, sanitized: true };
  const details: Record<string, string | number | boolean | string[]> = {};
  for (const [key, value] of Object.entries(sanitized).slice(0, 24)) {
    const safeKey = sanitizeDisplayText(key);
    if (typeof value === "string") details[safeKey] = safeText(value, "[redacted]", 120);
    if (typeof value === "number" && Number.isFinite(value)) details[safeKey] = value;
    if (typeof value === "boolean") details[safeKey] = value;
    if (Array.isArray(value)) details[safeKey] = value.filter((item): item is string => typeof item === "string").map((item) => safeText(item, "[redacted]", 80)).slice(0, 8);
  }
  return details;
}

function rejectUnknownKeys(input: Record<string, unknown>, allowed: Set<string>, diagnostics: ControlledAgentRuntimeSessionDiagnostic[], label: string): void {
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      diagnostics.push(diagnostic("unknown_or_invalid_field", `Unsupported controlled runtime ${label} field ${sanitizeDisplayText(key)}.`));
    }
  }
}

function scanUnsafeMetadata(value: unknown, diagnostics: ControlledAgentRuntimeSessionDiagnostic[], keyPath = "", depth = 0, seen = new WeakSet<object>()): void {
  if (depth > 8) return;
  if (typeof value === "string") {
    if (unsafeTextPattern.test(value)) {
      diagnostics.push(diagnostic("unsafe_metadata", `Unsafe controlled runtime metadata omitted near ${sanitizeDisplayText(keyPath || "value")}.`));
    }
    return;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    value.slice(0, 50).forEach((item, index) => scanUnsafeMetadata(item, diagnostics, `${keyPath}[${index}]`, depth + 1, seen));
    return;
  }
  if (isPlainObject(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    for (const [key, item] of Object.entries(value).slice(0, 50)) {
      if (blockedKeyPattern.test(key)) {
        diagnostics.push(diagnostic("unsafe_metadata", `Unsupported controlled runtime metadata field ${sanitizeDisplayText(key)}.`));
      }
      scanUnsafeMetadata(item, diagnostics, keyPath ? `${keyPath}.${key}` : key, depth + 1, seen);
    }
  }
}

function hasBlockingDiagnostics(diagnostics: ControlledAgentRuntimeSessionDiagnostic[]): boolean {
  return diagnostics.some((item) => item.code === "malformed_input" || item.code === "unknown_or_invalid_field" || item.code === "unsafe_metadata" || item.code === "invalid_authority" || item.code === "assistant_minted_request");
}

function diagnostic(code: ControlledAgentRuntimeSessionDiagnosticCode, message: string): ControlledAgentRuntimeSessionDiagnostic {
  return { code, message: safeText(message, "Controlled runtime session metadata is blocked.", 200) };
}

function safeText(input: unknown, fallback: string, limit: number): string {
  if (typeof input !== "string") return fallback;
  const sanitized = sanitizeTimelineText(input).replace(/[<>\r\n\t]+/g, " ").trim();
  const safe = sanitized.length > 0 ? sanitized : fallback;
  return sanitizeDisplayText(safe.length > limit ? `${safe.slice(0, limit)}…` : safe);
}

function defaultLabel(status: ControlledAgentRuntimeSessionStatus): string {
  if (status === "disabled") return "Controlled runtime session is disabled.";
  if (status === "opt_in_required") return "Controlled runtime session requires user opt-in.";
  if (status === "unsupported_host") return "Controlled runtime session is not supported in this host.";
  if (status === "preconditions_blocked") return "Controlled runtime session preconditions are blocked.";
  if (status === "ready_to_start") return "Controlled runtime session metadata is ready for user start review.";
  if (status === "start_requested_metadata") return "Controlled runtime session start request metadata is visible.";
  if (status === "session_open_metadata") return "Controlled runtime session open metadata is visible.";
  if (status === "stop_requested_metadata") return "Controlled runtime session stop request metadata is visible.";
  if (status === "stopped") return "Controlled runtime session stopped metadata is visible.";
  return "Controlled runtime session metadata is blocked.";
}

function optionalSafeId(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === "string" && safeIdPattern.test(value));
}

function boundedInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
