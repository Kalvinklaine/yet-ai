export type BridgeHost = "browser" | "vscode" | "jetbrains";

export type WorkspaceEditPosition = {
  line: number;
  character: number;
};

export type WorkspaceEditRange = {
  start: WorkspaceEditPosition;
  end: WorkspaceEditPosition;
};

export type WorkspaceTextReplacement = {
  range: WorkspaceEditRange;
  replacementText: string;
};

export type WorkspaceFileTextEdits = {
  workspaceRelativePath: string;
  textReplacements: WorkspaceTextReplacement[];
};

export type ApplyWorkspaceEditPayload = {
  requiresUserConfirmation: true;
  summary: string;
  cloudRequired?: false;
  edits: WorkspaceFileTextEdits[];
};

export type ApplyWorkspaceEditResultPayload = {
  status: "applied" | "denied" | "rejected" | "failed";
  message: string;
  cloudRequired: false;
  appliedEditCount?: number;
  affectedFiles?: string[];
};

export type IdeActionType = "getContextSnapshot" | "getActiveFileExcerpt" | "openWorkspaceFile" | "revealWorkspaceRange" | "runVerificationCommand" | "searchWorkspaceSnippets";

export type VerificationCommandId = "repository-check" | "gui-app-tests" | "engine-chat-tests";

export type IdeActionRequestPayload =
  | { action: "getContextSnapshot" }
  | { action: "getActiveFileExcerpt" }
  | { action: "openWorkspaceFile"; workspaceRelativePath: string }
  | { action: "revealWorkspaceRange"; workspaceRelativePath: string; range: WorkspaceEditRange }
  | { action: "runVerificationCommand"; commandId: VerificationCommandId }
  | { action: "searchWorkspaceSnippets"; query: string };

export type WorkspaceSnippetSearchResult = {
  workspaceRelativePath: string;
  languageId: string;
  range: WorkspaceEditRange;
  text: string;
};

export type IdeActionProgressPayload = {
  phase: "queued" | "checkingPolicy" | "running" | "completed";
  status: "pending" | "inProgress" | "succeeded" | "rejected" | "unavailable" | "failed";
  summary: string;
  cloudRequired: false;
  action?: IdeActionType;
  workspaceRelativePath?: string;
  range?: WorkspaceEditRange;
  commandId?: VerificationCommandId;
  queryLabel?: string;
  resultCount?: number;
};

export type ActiveFileExcerptAttachment = {
  kind: "active_file_excerpt";
  source: "vscode" | "jetbrains";
  file: {
    displayPath?: string;
    workspaceRelativePath?: string;
    languageId?: string;
  };
  range: WorkspaceEditRange;
  text: string;
  truncated: boolean;
};

export type IdeActionResultPayload = {
  status: "succeeded" | "rejected" | "unavailable" | "failed";
  message: string;
  cloudRequired: false;
  action?: IdeActionType;
  workspaceRelativePath?: string;
  range?: WorkspaceEditRange;
  context?: {
    source: "vscode" | "jetbrains";
    hasActiveEditor: boolean;
    workspaceFolderCount: number;
  };
  contextAttachment?: ActiveFileExcerptAttachment;
  commandId?: VerificationCommandId;
  exitCode?: number;
  durationMs?: number;
  outputTail?: string;
  truncated?: boolean;
  queryLabel?: string;
  resultCount?: number;
  snippets?: WorkspaceSnippetSearchResult[];
};

export type GuiMessage = {
  version: string;
  type: "gui.ready" | "gui.unloaded" | "gui.runtimeRefresh" | "gui.ideActionRequest" | "gui.applyWorkspaceEditRequest" | "gui.controlledAgentFileReadRequest" | "gui.controlledAgentEditRequest" | "gui.controlledAgentMultifileApplyRequest" | "gui.controlledAgentCommandRunRequest" | "gui.controlledAgentLexicalSearchRequest" | "gui.controlledAgentVerificationBundleRequest";
  requestId?: string;
  payload?: Record<string, unknown> | IdeActionRequestPayload | ApplyWorkspaceEditPayload;
};

export type RuntimeLifecycleState = "unknown" | "checking" | "starting" | "connected" | "degraded" | "disconnected" | "restarting" | "stopped" | "auth_mismatch" | "invalid_settings" | "failed";

export type HostRuntimeStatusPayload = {
  protocolVersion: "2026-06-21";
  surface: BridgeHost;
  lifecycle: RuntimeLifecycleState;
  runtimeOwner: "browser_preview" | "ide_host" | "external" | "user" | "test_harness";
  launchMode: "auto" | "connect" | "launch" | "preview" | "manual" | "unknown";
  tokenState: "unknown" | "not_required" | "absent" | "present" | "mismatch" | "invalid";
  processState: "unknown" | "not_owned" | "checking" | "starting" | "running" | "exited" | "stopped" | "failed";
  diagnosis: string;
  nextAction: string;
  cloudRequired: false;
  authority: "metadata_only";
};

export type HostMessage = {
  version: string;
  type: "host.ready" | "host.openedFromCommand" | "host.contextSnapshot" | "host.ideActionProgress" | "host.ideActionResult" | "host.applyWorkspaceEditResult" | "host.runtimeStatus" | "host.controlledAgentFileReadResult" | "host.controlledAgentEditResult" | "host.controlledAgentMultifileApplyResult" | "host.controlledAgentCommandRunResult" | "host.controlledAgentLexicalSearchResult" | "host.controlledAgentVerificationBundleResult";
  requestId?: string;
  payload?: Record<string, unknown> | IdeActionProgressPayload | IdeActionResultPayload | ApplyWorkspaceEditResultPayload | HostRuntimeStatusPayload;
};

type FrameNonceMessage = {
  version: string;
  type: "host.frameNonce";
  payload: {
    frameNonce: string;
  };
};

export type HostReadyPayload = {
  runtimeUrl?: string;
  sessionToken?: string;
  productId?: string;
  displayName?: string;
  cloudRequired?: boolean;
  controlledCapabilities?: ControlledHostCapabilitiesPayload;
};

export type ControlledHostCapabilitiesPayload = {
  protocolVersion: "controlled_host_capabilities_v2";
  hostSurface: BridgeHost;
  authority: "metadata_only";
  capabilities: {
    controlledStart: ControlledHostCapabilityStatus;
    controlledRead: ControlledHostCapabilityStatus;
    controlledEdit: ControlledHostCapabilityStatus;
    controlledVerification: ControlledHostCapabilityStatus;
    controlledRepair: ControlledHostCapabilityStatus;
  };
  correlationRequirements: string[];
  authorityFlags: Record<string, boolean>;
  limits: {
    maxReadBytes: number;
    maxReadLines: number;
    maxEditFiles: number;
    maxEditOperations: number;
    maxPatchBytes: number;
    maxVerificationOutputBytes: number;
    maxVerificationOutputLines: number;
    maxRepairAttempts: number;
  };
  reasonCodes: string[];
  safeLabels: {
    host: string;
    support: string;
  };
};

type ControlledHostCapabilityStatus = "supported" | "preview_only" | "unsupported" | "disabled" | "degraded" | "unknown";

export type HostContextSnapshotPayload = {
  kind: "active_editor";
  source: BridgeHost;
  file?: {
    displayPath?: string;
    workspaceRelativePath?: string;
    languageId?: string;
  };
  selection?: {
    startLine?: number;
    startCharacter?: number;
    endLine?: number;
    endCharacter?: number;
    text?: string;
  };
};

export type HostMessageHandler = (message: HostMessage) => void;

export type BridgeAdapter = {
  host: BridgeHost;
  log: string[];
  post: (message: GuiMessage) => void;
  subscribe: (handler: HostMessageHandler) => () => void;
  dispose: () => void;
};

type VsCodeApi = {
  postMessage: (message: GuiMessage) => void;
};

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApi;
    postIntellijMessage?: (message: GuiMessage) => void;
  }
}

const bridgeVersion = "2026-05-15";
const hostMessageTypes = new Set<HostMessage["type"]>([
  "host.ready",
  "host.openedFromCommand",
  "host.contextSnapshot",
  "host.ideActionProgress",
  "host.ideActionResult",
  "host.applyWorkspaceEditResult",
  "host.runtimeStatus",
  "host.controlledAgentFileReadResult",
  "host.controlledAgentEditResult",
  "host.controlledAgentMultifileApplyResult",
  "host.controlledAgentCommandRunResult",
  "host.controlledAgentLexicalSearchResult",
  "host.controlledAgentVerificationBundleResult",
]);
const guiMessageTypes = new Set<GuiMessage["type"]>([
  "gui.ready",
  "gui.unloaded",
  "gui.runtimeRefresh",
  "gui.ideActionRequest",
  "gui.applyWorkspaceEditRequest",
  "gui.controlledAgentFileReadRequest",
  "gui.controlledAgentEditRequest",
  "gui.controlledAgentMultifileApplyRequest",
  "gui.controlledAgentCommandRunRequest",
  "gui.controlledAgentLexicalSearchRequest",
  "gui.controlledAgentVerificationBundleRequest",
]);

function expectedParentOrigin(): string | undefined {
  if (!document.referrer) {
    return undefined;
  }
  try {
    const origin = new URL(document.referrer).origin;
    return origin === "null" ? undefined : origin;
  } catch {
    return undefined;
  }
}

export function createBridgeAdapter(onLog: (entry: string) => void): BridgeAdapter {
  const log: string[] = [];
  const handlers = new Set<HostMessageHandler>();
  const pendingMessages: HostMessage[] = [];
  const maxPendingMessages = 8;
  let jetbrainsFrameNonce: string | undefined;
  let postedJetbrainsFrameNonce: string | undefined;
  const append = (entry: string) => {
    log.push(entry);
    onLog(entry);
  };

  const vscode = window.acquireVsCodeApi?.();
  const postIntellijMessage = window.postIntellijMessage;
  const parentBridge = !vscode && !postIntellijMessage && window.parent !== window ? window.parent : undefined;
  const parentOrigin = parentBridge ? expectedParentOrigin() : undefined;
  const host: BridgeHost = vscode ? "vscode" : (postIntellijMessage || parentBridge) ? "jetbrains" : "browser";

  const withFrameNonce = (message: GuiMessage): GuiMessage => {
    if (message.type !== "gui.ready" || !parentBridge || jetbrainsFrameNonce === undefined) {
      return message;
    }
    return {
      ...message,
      payload: {
        ...(message.payload ?? {}),
        frameNonce: jetbrainsFrameNonce,
      },
    };
  };

  const post = (message: GuiMessage) => {
    const outbound = withFrameNonce(message);
    if (!isGuiMessage(outbound)) {
      append("Rejected invalid GUI bridge message");
      return;
    }
    if (vscode) {
      vscode.postMessage(outbound);
    } else if (postIntellijMessage) {
      postIntellijMessage(outbound);
    } else if (parentBridge) {
      parentBridge.postMessage(outbound, parentOrigin ?? "*");
    } else {
      append(`Browser mock sent ${outbound.type}`);
    }
  };

  const subscribe = (handler: HostMessageHandler) => {
    handlers.add(handler);
    const pending = pendingMessages.splice(0);
    pending.forEach((message) => handler(message));
    return () => handlers.delete(handler);
  };

  const onMessage = (event: MessageEvent<unknown>) => {
    const message = event.data;
    if (parentBridge && event.source !== parentBridge) {
      append("Rejected host bridge message from unexpected source");
      return;
    }
    if (parentBridge && parentOrigin && event.origin !== parentOrigin) {
      append("Rejected host bridge message from unexpected origin");
      return;
    }
    if (parentBridge && isFrameNonceMessage(message)) {
      jetbrainsFrameNonce = message.payload.frameNonce;
      if (postedJetbrainsFrameNonce !== jetbrainsFrameNonce) {
        postedJetbrainsFrameNonce = jetbrainsFrameNonce;
        post({
          version: bridgeVersion,
          type: "gui.ready",
          payload: { supportedBridgeVersion: bridgeVersion },
        });
      }
      return;
    }
    if (!isHostMessage(message)) {
      append("Rejected invalid host bridge message");
      return;
    }
    append(message.type === "host.ready" ? "Host runtime settings received" : `Host message ${message.type}`);
    if (handlers.size === 0) {
      pendingMessages.push(message);
      if (pendingMessages.length > maxPendingMessages) {
        pendingMessages.shift();
      }
      return;
    }
    handlers.forEach((handler) => handler(message));
  };

  const postUnload = () => {
    if (parentBridge) {
      post({
        version: bridgeVersion,
        type: "gui.unloaded",
        payload: {},
      });
    }
  };

  window.addEventListener("message", onMessage);
  window.addEventListener("pagehide", postUnload);
  window.addEventListener("beforeunload", postUnload);
  append(`Bridge host ${host}`);
  if (!parentBridge) {
    post({
      version: bridgeVersion,
      type: "gui.ready",
      payload: { supportedBridgeVersion: bridgeVersion },
    });
  }

  return {
    host,
    log,
    post,
    subscribe,
    dispose: () => {
      handlers.clear();
      pendingMessages.splice(0);
      window.removeEventListener("message", onMessage);
      window.removeEventListener("pagehide", postUnload);
      window.removeEventListener("beforeunload", postUnload);
    },
  };
}

export function isGuiMessage(value: unknown): value is GuiMessage {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["version", "type", "requestId", "payload"])) {
    return false;
  }
  if (value.version !== bridgeVersion || typeof value.type !== "string" || !guiMessageTypes.has(value.type as GuiMessage["type"]) || !isBoundedRequestId(value.requestId)) {
    return false;
  }
  if (value.type === "gui.ready") {
    return isGuiReadyPayload(value.payload);
  }
  if (value.type === "gui.unloaded") {
    return value.requestId === undefined && isEmptyPayload(value.payload);
  }
  if (value.type === "gui.runtimeRefresh") {
    return isEmptyPayload(value.payload);
  }
  if (value.type === "gui.ideActionRequest") {
    return typeof value.requestId === "string" && isIdeActionRequestPayload(value.payload);
  }
  if (value.type === "gui.controlledAgentFileReadRequest") {
    return typeof value.requestId === "string" && isPlainObject(value.payload);
  }
  if (value.type === "gui.controlledAgentEditRequest") {
    return typeof value.requestId === "string" && isPlainObject(value.payload);
  }
  if (value.type === "gui.controlledAgentMultifileApplyRequest") {
    return typeof value.requestId === "string" && isControlledAgentMultifileApplyRequestPayload(value.payload) && value.payload.requestId === value.requestId;
  }
  if (value.type === "gui.controlledAgentCommandRunRequest") {
    return typeof value.requestId === "string" && isControlledAgentCommandRunRequestPayload(value.payload) && value.payload.requestId === value.requestId;
  }
  if (value.type === "gui.controlledAgentLexicalSearchRequest") {
    return typeof value.requestId === "string" && isControlledAgentLexicalSearchRequestPayload(value.payload) && value.payload.requestId === value.requestId;
  }
  if (value.type === "gui.controlledAgentVerificationBundleRequest") {
    return typeof value.requestId === "string" && isControlledAgentVerificationBundleRequestPayload(value.payload) && value.payload.requestId === value.requestId;
  }
  return value.type === "gui.applyWorkspaceEditRequest" && typeof value.requestId === "string" && isApplyWorkspaceEditPayload(value.payload);
}


export function isControlledAgentMultifileApplyRequestPayload(value: unknown): value is Record<string, unknown> & { requestId: string } {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["requestId", "requestIdMintedBy", "source", "assistantMinted", "controlledWorkspaceId", "runId", "runtimeSessionId", "workspaceReadinessId", "patchPlanId", "userConfirmed", "confirmationKind", "limits", "policy", "edits"])) {
    return false;
  }
  return safeControlledAgentId(value.requestId) &&
    value.requestIdMintedBy === "gui" &&
    value.source === "gui" &&
    value.assistantMinted === false &&
    safeControlledAgentId(value.controlledWorkspaceId) &&
    safeControlledAgentId(value.runId) &&
    (value.runtimeSessionId === undefined || safeControlledAgentId(value.runtimeSessionId)) &&
    safeControlledAgentId(value.workspaceReadinessId) &&
    safeControlledAgentId(value.patchPlanId) &&
    value.userConfirmed === true &&
    value.confirmationKind === "explicit_user_multifile_apply" &&
    isControlledAgentMultifileApplyLimits(value.limits) &&
    isControlledAgentMultifileApplyPolicy(value.policy) &&
    isControlledAgentMultifileApplyEdits(value.edits);
}

export function isControlledAgentMultifileApplyResultPayload(value: unknown): value is Record<string, unknown> & { requestId: string } {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["type", "schemaVersion", "state", "authority", "cloudRequired", "controlledWorkspaceId", "runId", "runtimeSessionId", "workspaceReadinessId", "requestId", "requestIdMintedBy", "userConfirmed", "patchPlanId", "limits", "edits", "policyFlags", "result"])) {
    return false;
  }
  return value.type === "controlled_agent_multifile_apply" &&
    value.schemaVersion === "2026-07-07" &&
    (value.state === "applied" || value.state === "blocked" || value.state === "failed") &&
    value.authority === "vscode_bounded_multifile_replacement_apply" &&
    value.cloudRequired === false &&
    safeControlledAgentId(value.controlledWorkspaceId) &&
    safeControlledAgentId(value.runId) &&
    (value.runtimeSessionId === undefined || safeControlledAgentId(value.runtimeSessionId)) &&
    safeControlledAgentId(value.workspaceReadinessId) &&
    safeControlledAgentId(value.requestId) &&
    value.requestIdMintedBy === "gui" &&
    value.userConfirmed === true &&
    safeControlledAgentId(value.patchPlanId) &&
    isControlledAgentMultifileApplyLimits(value.limits) &&
    isControlledAgentMultifileApplyResultEdits(value.edits) &&
    isControlledAgentMultifileApplyPolicyFlags(value.policyFlags) &&
    isControlledAgentMultifileApplyResultDetails(value.result, value.state);
}

export function isControlledAgentCommandRunRequestPayload(value: unknown): value is Record<string, unknown> & { requestId: string } {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["requestId", "requestIdMintedBy", "source", "assistantMinted", "controlledWorkspaceId", "runId", "runtimeSessionId", "sessionId", "workspaceReadinessId", "userConfirmed", "commandId", "limits", "policyFlags"])) {
    return false;
  }
  return safeControlledAgentId(value.requestId) &&
    value.requestIdMintedBy === "gui" &&
    value.source === "gui" &&
    value.assistantMinted === false &&
    safeControlledAgentId(value.controlledWorkspaceId) &&
    safeControlledAgentId(value.runId) &&
    safeControlledAgentId(value.runtimeSessionId) &&
    (value.sessionId === undefined || safeControlledAgentId(value.sessionId)) &&
    safeControlledAgentId(value.workspaceReadinessId) &&
    value.userConfirmed === true &&
    isVerificationCommandId(value.commandId) &&
    isControlledAgentCommandRunLimits(value.limits) &&
    isControlledAgentCommandRunPolicyFlags(value.policyFlags);
}

export function isControlledAgentCommandRunResultPayload(value: unknown): value is Record<string, unknown> & { requestId: string } {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["requestId", "requestIdMintedBy", "userConfirmed", "controlledWorkspaceId", "runId", "runtimeSessionId", "sessionId", "workspaceReadinessId", "commandId", "status", "authority", "cloudRequired", "executionAllowed", "freeformCommandAllowed", "policyFlags", "durationMs", "exitCode", "outputTail", "outputByteCount", "outputLineCount", "resultHash", "truncated", "message"])) {
    return false;
  }
  if (!safeControlledAgentId(value.requestId) || value.requestIdMintedBy !== "gui" || value.userConfirmed !== true || !safeControlledAgentId(value.controlledWorkspaceId) || !safeControlledAgentId(value.runId) || !safeControlledAgentId(value.runtimeSessionId) || (value.sessionId !== undefined && !safeControlledAgentId(value.sessionId)) || !safeControlledAgentId(value.workspaceReadinessId) || !isVerificationCommandId(value.commandId) || value.authority !== "allowlisted_command_id" || value.cloudRequired !== false || value.executionAllowed !== false || value.freeformCommandAllowed !== false || !isControlledAgentCommandRunPolicyFlags(value.policyFlags) || !safeMessage(value.message)) {
    return false;
  }
  if (value.status === "running") {
    return optionalBoundedInteger(value.durationMs, 0, 1800000) && value.durationMs !== undefined && value.exitCode === undefined && value.outputTail === undefined && value.outputByteCount === undefined && value.outputLineCount === undefined && value.resultHash === undefined && value.truncated === false;
  }
  if (value.status === "blocked") {
    return value.durationMs === undefined && value.exitCode === undefined && value.outputTail === undefined && value.outputByteCount === undefined && value.outputLineCount === undefined && value.resultHash === undefined && value.truncated === false;
  }
  if (value.status === "succeeded" || value.status === "failed" || value.status === "timed_out" || value.status === "killed") {
    const validExitCode = value.status === "succeeded" ? value.exitCode === 0 : value.status === "failed" ? typeof value.exitCode === "number" && value.exitCode > 0 && value.exitCode <= 255 && Number.isInteger(value.exitCode) : value.exitCode === null;
    return validExitCode && optionalBoundedInteger(value.durationMs, 0, 1800000) && value.durationMs !== undefined && safeVerificationOutputTail(value.outputTail) && optionalBoundedInteger(value.outputByteCount, 0, 20000) && value.outputByteCount !== undefined && optionalBoundedInteger(value.outputLineCount, 0, 400) && value.outputLineCount !== undefined && typeof value.resultHash === "string" && /^sha256:[a-f0-9]{64}$/.test(value.resultHash) && typeof value.truncated === "boolean";
  }
  return false;
}

export function isControlledAgentLexicalSearchRequestPayload(value: unknown): value is Record<string, unknown> & { requestId: string } {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["requestId", "requestIdMintedBy", "source", "assistantMinted", "controlledWorkspaceId", "runId", "runtimeSessionId", "workspaceReadinessId", "explicitUserGesture", "userGestureId", "host", "query", "queryMode", "scope", "limits", "policyFlags"])) {
    return false;
  }
  return safeControlledAgentId(value.requestId) &&
    value.requestIdMintedBy === "gui" &&
    value.source === "gui" &&
    value.assistantMinted === false &&
    safeControlledAgentId(value.controlledWorkspaceId) &&
    safeControlledAgentId(value.runId) &&
    safeControlledAgentId(value.runtimeSessionId) &&
    safeControlledAgentId(value.workspaceReadinessId) &&
    value.explicitUserGesture === true &&
    safeControlledAgentId(value.userGestureId) &&
    value.host === "vscode" &&
    safeControlledAgentLexicalSearchQuery(value.query) &&
    value.queryMode === "literal_text" &&
    isControlledAgentLexicalSearchScope(value.scope) &&
    isControlledAgentLexicalSearchLimits(value.limits) &&
    isControlledAgentLexicalSearchPolicyFlags(value.policyFlags);
}

export function isControlledAgentLexicalSearchResultPayload(value: unknown): value is Record<string, unknown> & { requestId: string } {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["requestId", "requestIdMintedBy", "userConfirmed", "explicitUserGesture", "controlledWorkspaceId", "runId", "runtimeSessionId", "workspaceReadinessId", "host", "status", "authority", "cloudRequired", "executionAllowed", "searchAllowed", "privatePathExposed", "rawContentIncluded", "policyFlags", "resultCount", "totalMatchCount", "totalSnippetBytes", "truncated", "resultHash", "snippets", "blockedReason", "message"])) {
    return false;
  }
  if (!safeControlledAgentId(value.requestId) || value.requestIdMintedBy !== "gui" || value.userConfirmed !== true || value.explicitUserGesture !== true || !safeControlledAgentId(value.controlledWorkspaceId) || !safeControlledAgentId(value.runId) || !safeControlledAgentId(value.runtimeSessionId) || !safeControlledAgentId(value.workspaceReadinessId) || value.host !== "vscode" || value.authority !== "explicit_literal_lexical_search_metadata" || value.cloudRequired !== false || value.executionAllowed !== false || value.privatePathExposed !== false || value.rawContentIncluded !== false || !isControlledAgentLexicalSearchPolicyFlags(value.policyFlags) || !safeMessage(value.message)) {
    return false;
  }
  if (value.status === "succeeded") {
    return value.searchAllowed === true && optionalBoundedInteger(value.resultCount, 0, 20) && value.resultCount !== undefined && optionalBoundedInteger(value.totalMatchCount, 0, 200) && value.totalMatchCount !== undefined && optionalBoundedInteger(value.totalSnippetBytes, 0, 8000) && value.totalSnippetBytes !== undefined && typeof value.truncated === "boolean" && typeof value.resultHash === "string" && /^sha256:[a-f0-9]{64}$/.test(value.resultHash) && isControlledAgentLexicalSearchSnippets(value.snippets) && Array.isArray(value.snippets) && value.snippets.length === value.resultCount && value.blockedReason === undefined;
  }
  if (value.status === "blocked" || value.status === "failed") {
    return value.searchAllowed === false && value.resultCount === 0 && value.totalMatchCount === 0 && value.totalSnippetBytes === 0 && value.truncated === false && value.resultHash === undefined && Array.isArray(value.snippets) && value.snippets.length === 0 && (value.blockedReason === undefined || isControlledAgentLexicalSearchBlockedReason(value.blockedReason));
  }
  return false;
}

export function isControlledAgentVerificationBundleRequestPayload(value: unknown): value is Record<string, unknown> & { requestId: string } {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["requestId", "requestIdMintedBy", "source", "assistantMinted", "controlledWorkspaceId", "runId", "workspaceReadinessId", "bundleId", "userConfirmed", "confirmationKind", "commandIds", "limits", "policyFlags"])) {
    return false;
  }
  return safeControlledAgentId(value.requestId) &&
    value.requestIdMintedBy === "gui" &&
    value.source === "gui" &&
    value.assistantMinted === false &&
    safeControlledAgentId(value.controlledWorkspaceId) &&
    safeControlledAgentId(value.runId) &&
    (value.workspaceReadinessId === undefined || safeControlledAgentId(value.workspaceReadinessId)) &&
    safeControlledAgentId(value.bundleId) &&
    value.userConfirmed === true &&
    value.confirmationKind === "explicit_user_verification_bundle" &&
    isControlledAgentVerificationBundleCommandIds(value.commandIds) &&
    isControlledAgentVerificationBundleLimits(value.limits) &&
    isControlledAgentVerificationBundlePolicyFlags(value.policyFlags);
}

function isControlledAgentMultifileApplyLimits(value: unknown): boolean {
  return isPlainObject(value) && hasOnlyKeys(value, ["maxFiles", "maxEdits", "maxReplacementBytesPerEdit", "maxTotalReplacementBytes"]) &&
    optionalBoundedInteger(value.maxFiles, 1, 4) && value.maxFiles !== undefined &&
    optionalBoundedInteger(value.maxEdits, 1, 12) && value.maxEdits !== undefined &&
    optionalBoundedInteger(value.maxReplacementBytesPerEdit, 1, 12000) && value.maxReplacementBytesPerEdit !== undefined &&
    optionalBoundedInteger(value.maxTotalReplacementBytes, 1, 48000) && value.maxTotalReplacementBytes !== undefined;
}

function isControlledAgentMultifileApplyPolicy(value: unknown): boolean {
  const keys = ["host", "browserSupported", "jetbrainsSupported", "vscodeExecutionOnly", "existingTextFilesOnly", "boundedReplacementOnly", "rawReplacementIncluded", "rawDiffIncluded", "fileBodyIncluded", "createAllowed", "deleteAllowed", "renameAllowed", "moveAllowed", "dependencyEditAllowed", "generatedEditAllowed", "hiddenPathAllowed", "commandAllowed", "providerAllowed", "toolAllowed", "automaticApplyAllowed"];
  return isPlainObject(value) && hasOnlyKeys(value, keys) && value.host === "vscode" && keys.every((key) => key === "host" ? true : key === "vscodeExecutionOnly" || key === "existingTextFilesOnly" || key === "boundedReplacementOnly" ? value[key] === true : value[key] === false);
}

function isControlledAgentMultifileApplyPolicyFlags(value: unknown): boolean {
  const keys = ["vscodeExecutionOnly", "browserSupported", "jetbrainsSupported", "existingTextFilesOnly", "boundedReplacementOnly", "rawReplacementIncluded", "rawDiffIncluded", "fileBodyIncluded", "createAllowed", "deleteAllowed", "renameAllowed", "moveAllowed", "dependencyEditAllowed", "generatedEditAllowed", "hiddenPathAllowed", "commandAllowed", "providerAllowed", "toolAllowed", "automaticApplyAllowed"];
  return isPlainObject(value) && hasOnlyKeys(value, keys) && keys.every((key) => key === "vscodeExecutionOnly" || key === "existingTextFilesOnly" || key === "boundedReplacementOnly" ? value[key] === true : value[key] === false);
}

function isControlledAgentMultifileApplyEdits(value: unknown): boolean {
  return Array.isArray(value) && value.length >= 1 && value.length <= 12 && value.every(isControlledAgentMultifileApplyEdit);
}

function isControlledAgentMultifileApplyResultEdits(value: unknown): boolean {
  return Array.isArray(value) && value.length >= 1 && value.length <= 12 && value.every(isControlledAgentMultifileApplyResultEdit);
}

function isControlledAgentMultifileApplyEdit(value: unknown): boolean {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["editId", "operation", "workspaceRelativePath", "fileLabel", "existingTextFile", "expectedPreEditHash", "expectedRangeHash", "replacementContentHash", "replacementText", "startLine", "endLine", "replacementByteCount", "sanitizedSummary"])) {
    return false;
  }
  return safeControlledAgentId(value.editId) && value.operation === "replace" && requiredSafeRelativePath(value.workspaceRelativePath) && value.fileLabel === value.workspaceRelativePath && value.existingTextFile === true && isSha256Hash(value.expectedPreEditHash) && isSha256Hash(value.expectedRangeHash) && isSha256Hash(value.replacementContentHash) && safeTransientReplacementText(value.replacementText, value.replacementByteCount) && optionalBoundedInteger(value.startLine, 1, 1000000) && value.startLine !== undefined && optionalBoundedInteger(value.endLine, 1, 1000000) && value.endLine !== undefined && (value.endLine as number) >= (value.startLine as number) && optionalBoundedInteger(value.replacementByteCount, 0, 12000) && value.replacementByteCount !== undefined && safeMessage(value.sanitizedSummary);
}

function isControlledAgentMultifileApplyResultEdit(value: unknown): boolean {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["editId", "operation", "workspaceRelativePath", "fileLabel", "status", "expectedPreEditHash", "expectedRangeHash", "replacementContentHash", "actualPostEditHash", "startLine", "endLine", "replacementByteCount", "sanitizedSummary"])) {
    return false;
  }
  return safeControlledAgentId(value.editId) && value.operation === "replace" && requiredSafeRelativePath(value.workspaceRelativePath) && value.fileLabel === value.workspaceRelativePath && (value.status === "applied" || value.status === "blocked" || value.status === "failed") && isSha256Hash(value.expectedPreEditHash) && isSha256Hash(value.expectedRangeHash) && isSha256Hash(value.replacementContentHash) && (value.actualPostEditHash === undefined || isSha256Hash(value.actualPostEditHash)) && optionalBoundedInteger(value.startLine, 1, 1000000) && value.startLine !== undefined && optionalBoundedInteger(value.endLine, 1, 1000000) && value.endLine !== undefined && (value.endLine as number) >= (value.startLine as number) && optionalBoundedInteger(value.replacementByteCount, 0, 12000) && value.replacementByteCount !== undefined && safeMessage(value.sanitizedSummary);
}

function isControlledAgentMultifileApplyResultDetails(value: unknown, state: unknown): boolean {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["status", "cloudRequired", "privatePathExposed", "rawReplacementIncluded", "rawDiffIncluded", "fileBodyIncluded", "message", "appliedFileCount", "appliedEditCount", "blockedFileCount", "failedEditCount", "affectedFiles"])) {
    return false;
  }
  return value.status === state && value.cloudRequired === false && value.privatePathExposed === false && value.rawReplacementIncluded === false && value.rawDiffIncluded === false && value.fileBodyIncluded === false && safeMessage(value.message) && optionalBoundedInteger(value.appliedFileCount, 0, 4) && value.appliedFileCount !== undefined && optionalBoundedInteger(value.appliedEditCount, 0, 12) && value.appliedEditCount !== undefined && optionalBoundedInteger(value.blockedFileCount, 0, 4) && value.blockedFileCount !== undefined && optionalBoundedInteger(value.failedEditCount, 0, 12) && value.failedEditCount !== undefined && (value.affectedFiles === undefined || (Array.isArray(value.affectedFiles) && value.affectedFiles.length <= 4 && value.affectedFiles.every(requiredSafeRelativePath)));
}

function isSha256Hash(value: unknown): boolean {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

function safeTransientReplacementText(value: unknown, byteCount: unknown): boolean {
  return typeof value === "string" && optionalBoundedInteger(byteCount, 1, 12000) && byteCount !== undefined && new TextEncoder().encode(value).length === byteCount && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]|(?:^|\n)diff --git |(?:^|\n)@@ |(?:^|\n)--- |(?:^|\n)\+\+\+ |authorization|bearer|api[_ -]?key|access[_ -]?token|token|secret|password|cookie|raw[_ -]?(?:file|body|diff|patch|replacement|prompt|command|output)|file[_ -]?(?:body|content)|provider|shell|command|cwd|\benv\b|\bgit\b|\btool\b|network|hidden[_ -]?(?:scan|read|search)|index(?:ing)?|auto[_ -]?(?:start|apply|run|repair)|create|delete|rename|move|chmod|symlink|binary|sk-(?:proj-)?[A-Za-z0-9_-]{8,}|BEGIN [A-Z ]*PRIVATE KEY|\/(?:Users|home|tmp|var|etc|opt|mnt|Volumes|private)(?=\/|$)|[A-Za-z]:(?:\\|\/)|~(?:\\|\/)/i.test(value);
}

function isControlledAgentCommandRunLimits(value: unknown): boolean {
  return isPlainObject(value) && hasOnlyKeys(value, ["timeoutMs", "maxOutputBytes", "maxOutputLines", "tailOnly", "commandStringAllowed", "argsAllowed", "cwdAllowed", "envAllowed", "shellAllowed"]) &&
    optionalBoundedInteger(value.timeoutMs, 1000, 1800000) && value.timeoutMs !== undefined &&
    optionalBoundedInteger(value.maxOutputBytes, 1, 20000) && value.maxOutputBytes !== undefined &&
    optionalBoundedInteger(value.maxOutputLines, 1, 400) && value.maxOutputLines !== undefined &&
    value.tailOnly === true &&
    value.commandStringAllowed === false &&
    value.argsAllowed === false &&
    value.cwdAllowed === false &&
    value.envAllowed === false &&
    value.shellAllowed === false;
}

function isControlledAgentCommandRunPolicyFlags(value: unknown): boolean {
  const keys = ["allowlistedCommandIdOnly", "freeformCommandAllowed", "argsAllowed", "cwdAllowed", "envAllowed", "shellAllowed", "gitAllowed", "networkAllowed", "providerAllowed", "toolAllowed", "packageInstallAllowed", "fileReadAllowed", "fileWriteAllowed", "hiddenSearchAllowed", "indexingAllowed", "autoStartAllowed", "autoApplyAllowed", "autoRunAllowed", "autoVerifyAllowed", "autoFixAllowed"];
  if (!isPlainObject(value) || !hasOnlyKeys(value, keys)) {
    return false;
  }
  return keys.every((key) => key === "allowlistedCommandIdOnly" ? value[key] === true : value[key] === false);
}

function isControlledAgentVerificationBundleCommandIds(value: unknown): boolean {
  return Array.isArray(value) && value.length >= 1 && value.length <= 3 && value.every(isVerificationCommandId);
}

function isControlledAgentVerificationBundleLimits(value: unknown): boolean {
  return isPlainObject(value) && hasOnlyKeys(value, ["maxCommands", "maxTimeoutMs", "maxOutputBytes", "maxOutputLines", "tailOnly", "commandStringAllowed", "argsAllowed", "cwdAllowed", "envAllowed", "shellAllowed"]) &&
    value.maxCommands === 3 &&
    value.maxTimeoutMs === 1800000 &&
    value.maxOutputBytes === 20000 &&
    value.maxOutputLines === 400 &&
    value.tailOnly === true &&
    value.commandStringAllowed === false &&
    value.argsAllowed === false &&
    value.cwdAllowed === false &&
    value.envAllowed === false &&
    value.shellAllowed === false;
}

function isControlledAgentVerificationBundlePolicyFlags(value: unknown): boolean {
  const keys = ["allowlistedCommandIdsOnly", "boundedSequenceOnly", "explicitUserConfirmationRequired", "freeformCommandAllowed", "argsAllowed", "cwdAllowed", "envAllowed", "shellAllowed", "gitAllowed", "networkAllowed", "providerAllowed", "toolAllowed", "packageInstallAllowed", "fileReadAllowed", "fileWriteAllowed", "hiddenSearchAllowed", "indexingAllowed", "autoStartAllowed", "autoApplyAllowed", "autoRunAllowed", "autoVerifyAllowed", "autoFixAllowed", "productionClaimAllowed", "releaseClaimAllowed"];
  return isPlainObject(value) && hasOnlyKeys(value, keys) && keys.every((key) => key === "allowlistedCommandIdsOnly" || key === "boundedSequenceOnly" || key === "explicitUserConfirmationRequired" ? value[key] === true : value[key] === false);
}

function isControlledAgentLexicalSearchScope(value: unknown): boolean {
  return isPlainObject(value) && hasOnlyKeys(value, ["kind", "controlledWorkspaceOnly", "includePathLabels", "excludeHidden", "excludeDependencies", "excludeGenerated", "excludeBinary", "excludeSecretLikePaths", "recursiveAllowed", "broadWorkspaceScanAllowed"]) &&
    value.kind === "controlled_workspace_bounded" &&
    value.controlledWorkspaceOnly === true &&
    Array.isArray(value.includePathLabels) && value.includePathLabels.length <= 8 && value.includePathLabels.every((item) => requiredSafeRelativePath(item)) &&
    value.excludeHidden === true &&
    value.excludeDependencies === true &&
    value.excludeGenerated === true &&
    value.excludeBinary === true &&
    value.excludeSecretLikePaths === true &&
    value.recursiveAllowed === false &&
    value.broadWorkspaceScanAllowed === false;
}

function isControlledAgentLexicalSearchLimits(value: unknown): boolean {
  return isPlainObject(value) && hasOnlyKeys(value, ["maxFilesScanned", "maxMatches", "maxSnippetBytes", "literalOnly", "regexAllowed", "globAllowed", "pathQueryAllowed", "indexingAllowed", "backgroundAllowed"]) &&
    optionalBoundedInteger(value.maxFilesScanned, 1, 40) && value.maxFilesScanned !== undefined &&
    optionalBoundedInteger(value.maxMatches, 1, 20) && value.maxMatches !== undefined &&
    optionalBoundedInteger(value.maxSnippetBytes, 1, 400) && value.maxSnippetBytes !== undefined &&
    value.literalOnly === true &&
    value.regexAllowed === false &&
    value.globAllowed === false &&
    value.pathQueryAllowed === false &&
    value.indexingAllowed === false &&
    value.backgroundAllowed === false;
}

function isControlledAgentLexicalSearchPolicyFlags(value: unknown): boolean {
  const keys = ["explicitLiteralSearchAllowed", "hiddenSearchAllowed", "backgroundSearchAllowed", "indexingAllowed", "regexAllowed", "globAllowed", "pathQueryAllowed", "broadWorkspaceScanAllowed", "fileReadBodyAllowed", "fileWriteAllowed", "shellAllowed", "gitAllowed", "providerAllowed", "toolAllowed", "autoSearchAllowed", "autoApplyAllowed", "autoRunAllowed"];
  return isPlainObject(value) && hasOnlyKeys(value, keys) && keys.every((key) => key === "explicitLiteralSearchAllowed" ? value[key] === true : value[key] === false);
}

function isControlledAgentLexicalSearchSnippets(value: unknown): boolean {
  return Array.isArray(value) && value.length <= 20 && value.every(isControlledAgentLexicalSearchSnippet);
}

function isControlledAgentLexicalSearchSnippet(value: unknown): boolean {
  return isPlainObject(value) && hasOnlyKeys(value, ["pathLabel", "range", "languageId", "snippet", "snippetByteCount", "snippetHash", "matchCount", "truncated"]) &&
    requiredSafeRelativePath(value.pathLabel) &&
    isEditRange(value.range) &&
    optionalLanguageId(value.languageId) && value.languageId !== undefined &&
    safeControlledAgentLexicalSearchSnippet(value.snippet) &&
    optionalBoundedInteger(value.snippetByteCount, 0, 400) && value.snippetByteCount !== undefined &&
    typeof value.snippetHash === "string" && /^sha256:[a-f0-9]{64}$/.test(value.snippetHash) &&
    optionalBoundedInteger(value.matchCount, 0, 20) && value.matchCount !== undefined &&
    typeof value.truncated === "boolean";
}

function isControlledAgentLexicalSearchBlockedReason(value: unknown): boolean {
  return value === "search_disabled" || value === "unsupported_host" || value === "unsafe_query" || value === "policy_denied" || value === "host_unavailable";
}

function safeControlledAgentId(value: unknown): boolean {
  return typeof value === "string" && /^(?!assistant(?:[._:-]|$))(?!.*(?:assistant|sk-(?:proj-)?))[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/i.test(value) && !hasSecretRequestIdMarker(value);
}

function isFrameNonceMessage(value: unknown): value is FrameNonceMessage {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["version", "type", "payload"])) {
    return false;
  }
  if (value.version !== bridgeVersion || value.type !== "host.frameNonce" || !isPlainObject(value.payload) || !hasOnlyKeys(value.payload, ["frameNonce"])) {
    return false;
  }
  return typeof value.payload.frameNonce === "string" && /^[0-9a-f]{32}$/.test(value.payload.frameNonce);
}

export function isHostMessage(value: unknown): value is HostMessage {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["version", "type", "requestId", "payload"])) {
    return false;
  }
  if (
    value.version !== bridgeVersion ||
    typeof value.type !== "string" ||
    !hostMessageTypes.has(value.type as HostMessage["type"]) ||
    !isBoundedRequestId(value.requestId)
  ) {
    return false;
  }
  if (value.type === "host.ready") {
    return isHostReadyPayload(value.payload);
  }
  if (value.type === "host.contextSnapshot") {
    return isHostContextSnapshotPayload(value.payload);
  }
  if (value.type === "host.applyWorkspaceEditResult") {
    return typeof value.requestId === "string" && isApplyWorkspaceEditResultPayload(value.payload);
  }
  if (value.type === "host.ideActionProgress") {
    return typeof value.requestId === "string" && isIdeActionProgressPayload(value.payload);
  }
  if (value.type === "host.ideActionResult") {
    return typeof value.requestId === "string" && isIdeActionResultPayload(value.payload);
  }
  if (value.type === "host.runtimeStatus") {
    return value.requestId === undefined && isHostRuntimeStatusPayload(value.payload);
  }
  if (value.type === "host.controlledAgentFileReadResult") {
    return typeof value.requestId === "string" && isPlainObject(value.payload);
  }
  if (value.type === "host.controlledAgentEditResult") {
    return typeof value.requestId === "string" && isPlainObject(value.payload);
  }
  if (value.type === "host.controlledAgentMultifileApplyResult") {
    return typeof value.requestId === "string" && isControlledAgentMultifileApplyResultPayload(value.payload) && value.payload.requestId === value.requestId;
  }
  if (value.type === "host.controlledAgentCommandRunResult") {
    return typeof value.requestId === "string" && isControlledAgentCommandRunResultPayload(value.payload) && value.payload.requestId === value.requestId;
  }
  if (value.type === "host.controlledAgentLexicalSearchResult") {
    return typeof value.requestId === "string" && isControlledAgentLexicalSearchResultPayload(value.payload) && value.payload.requestId === value.requestId;
  }
  if (value.type === "host.controlledAgentVerificationBundleResult") {
    return typeof value.requestId === "string" && isPlainObject(value.payload);
  }
  return value.type === "host.openedFromCommand" && value.requestId === undefined && isEmptyPayload(value.payload);
}

export function isHostReadyPayload(value: unknown): value is HostReadyPayload {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["runtimeUrl", "sessionToken", "productId", "displayName", "cloudRequired", "controlledCapabilities"])) {
    return false;
  }
  return (
    optionalLoopbackRuntimeUrl(value.runtimeUrl) &&
    optionalSessionToken(value.sessionToken) &&
    optionalProductId(value.productId) &&
    optionalDisplayName(value.displayName) &&
    (value.cloudRequired === undefined || value.cloudRequired === false) &&
    isOptionalControlledHostCapabilities(value.controlledCapabilities)
  );
}

function isOptionalControlledHostCapabilities(value: unknown): value is ControlledHostCapabilitiesPayload | undefined {
  return value === undefined || isControlledHostCapabilitiesPayload(value);
}

export function isControlledHostCapabilitiesPayload(value: unknown): value is ControlledHostCapabilitiesPayload {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["protocolVersion", "hostSurface", "authority", "capabilities", "correlationRequirements", "authorityFlags", "limits", "reasonCodes", "safeLabels"])) {
    return false;
  }
  return value.protocolVersion === "controlled_host_capabilities_v2" &&
    optionalRuntimeSurface(value.hostSurface) &&
    value.authority === "metadata_only" &&
    isControlledHostCapabilityStatuses(value.capabilities) &&
    isControlledHostCorrelationRequirements(value.correlationRequirements) &&
    isControlledHostAuthorityFlags(value.authorityFlags) &&
    isControlledHostCapabilityLimits(value.limits) &&
    isSafeReasonCodes(value.reasonCodes) &&
    isControlledHostSafeLabels(value.safeLabels);
}

function isControlledHostCapabilityStatuses(value: unknown): boolean {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["controlledStart", "controlledRead", "controlledEdit", "controlledVerification", "controlledRepair"])) {
    return false;
  }
  return isControlledHostCapabilityStatus(value.controlledStart) &&
    isControlledHostCapabilityStatus(value.controlledRead) &&
    isControlledHostCapabilityStatus(value.controlledEdit) &&
    isControlledHostCapabilityStatus(value.controlledVerification) &&
    isControlledHostCapabilityStatus(value.controlledRepair);
}

function isControlledHostCapabilityStatus(value: unknown): value is ControlledHostCapabilityStatus {
  return value === "supported" || value === "preview_only" || value === "unsupported" || value === "disabled" || value === "degraded" || value === "unknown";
}

function isControlledHostCorrelationRequirements(value: unknown): boolean {
  const allowed = ["request_id", "run_id", "runtime_session_id", "controlled_workspace_id", "workspace_readiness_id", "host_ready_request_id", "explicit_user_gesture", "operation_kind", "capability_snapshot_id"];
  return Array.isArray(value) && value.length >= 1 && value.length <= allowed.length && value.every((item) => typeof item === "string" && allowed.includes(item)) && new Set(value).size === value.length;
}

function isControlledHostAuthorityFlags(value: unknown): boolean {
  const allowedTrue = new Set(["metadataOnly"]);
  const allowedKeys = ["metadataOnly", "controlledRead", "controlledEdit", "controlledVerification", "controlledStart", "repair", "shell", "git", "packageInstall", "network", "provider", "tool", "hiddenSearch", "indexing", "autoApply", "autoRun", "autoFix"];
  return isPlainObject(value) && hasOnlyKeys(value, allowedKeys) && allowedKeys.every((key) => typeof value[key] === "boolean") && Object.entries(value).every(([key, flag]) => allowedTrue.has(key) ? flag === true : flag === false);
}

function isControlledHostCapabilityLimits(value: unknown): boolean {
  return isPlainObject(value) && hasOnlyKeys(value, ["maxReadBytes", "maxReadLines", "maxEditFiles", "maxEditOperations", "maxPatchBytes", "maxVerificationOutputBytes", "maxVerificationOutputLines", "maxRepairAttempts"]) &&
    optionalBoundedInteger(value.maxReadBytes, 1, 8192) && value.maxReadBytes !== undefined &&
    optionalBoundedInteger(value.maxReadLines, 1, 240) && value.maxReadLines !== undefined &&
    optionalBoundedInteger(value.maxEditFiles, 1, 4) && value.maxEditFiles !== undefined &&
    optionalBoundedInteger(value.maxEditOperations, 1, 16) && value.maxEditOperations !== undefined &&
    optionalBoundedInteger(value.maxPatchBytes, 1, 12000) && value.maxPatchBytes !== undefined &&
    optionalBoundedInteger(value.maxVerificationOutputBytes, 1, 20000) && value.maxVerificationOutputBytes !== undefined &&
    optionalBoundedInteger(value.maxVerificationOutputLines, 1, 400) && value.maxVerificationOutputLines !== undefined &&
    optionalBoundedInteger(value.maxRepairAttempts, 0, 1) && value.maxRepairAttempts !== undefined;
}

function isSafeReasonCodes(value: unknown): boolean {
  return Array.isArray(value) && value.length >= 1 && value.length <= 8 && value.every((item) => typeof item === "string" && /^[a-z][a-z0-9_]{0,79}$/.test(item) && !unsafeDisplayText(item) && !hasKeyLikeSecretText(item));
}

function isControlledHostSafeLabels(value: unknown): boolean {
  return isPlainObject(value) && hasOnlyKeys(value, ["host", "support"]) && safeMessage(value.host) && safeMessage(value.support);
}

export function isHostRuntimeStatusPayload(value: unknown): value is HostRuntimeStatusPayload {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["protocolVersion", "surface", "lifecycle", "runtimeOwner", "launchMode", "tokenState", "processState", "diagnosis", "nextAction", "cloudRequired", "authority"])) {
    return false;
  }
  return value.protocolVersion === "2026-06-21" &&
    optionalRuntimeSurface(value.surface) &&
    optionalRuntimeLifecycle(value.lifecycle) &&
    optionalRuntimeOwner(value.runtimeOwner) &&
    optionalRuntimeLaunchMode(value.launchMode) &&
    optionalRuntimeTokenState(value.tokenState) &&
    optionalRuntimeProcessState(value.processState) &&
    safeMessage(value.diagnosis) &&
    safeMessage(value.nextAction) &&
    value.cloudRequired === false &&
    value.authority === "metadata_only";
}

export function isHostContextSnapshotPayload(value: unknown): value is HostContextSnapshotPayload {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["kind", "source", "file", "selection"])) {
    return false;
  }
  return (
    value.kind === "active_editor" &&
    (value.source === "vscode" || value.source === "jetbrains" || value.source === "browser") &&
    isContextFile(value.file) &&
    isContextSelection(value.selection)
  );
}

function isGuiReadyPayload(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  return isPlainObject(value) && hasOnlyKeys(value, ["supportedBridgeVersion", "frameNonce"]) && (value.supportedBridgeVersion === undefined || value.supportedBridgeVersion === bridgeVersion) && (value.frameNonce === undefined || (typeof value.frameNonce === "string" && /^[0-9a-f]{32}$/.test(value.frameNonce)));
}

export function isApplyWorkspaceEditPayload(value: unknown): value is ApplyWorkspaceEditPayload {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["requiresUserConfirmation", "summary", "cloudRequired", "edits"])) {
    return false;
  }
  if (value.requiresUserConfirmation !== true || !safeSummary(value.summary) || (value.cloudRequired !== undefined && value.cloudRequired !== false)) {
    return false;
  }
  if (!Array.isArray(value.edits) || value.edits.length < 1 || value.edits.length > 4) {
    return false;
  }
  const seenWorkspaceRelativePaths = new Set<string>();
  let totalReplacementText = 0;
  for (const fileEdit of value.edits) {
    if (!isFileTextEdits(fileEdit)) {
      return false;
    }
    if (seenWorkspaceRelativePaths.has(fileEdit.workspaceRelativePath)) {
      return false;
    }
    seenWorkspaceRelativePaths.add(fileEdit.workspaceRelativePath);
    for (const replacement of fileEdit.textReplacements) {
      totalReplacementText += replacement.replacementText.length;
      if (totalReplacementText > 32768) {
        return false;
      }
    }
  }
  return true;
}

export function isApplyWorkspaceEditResultPayload(value: unknown): value is ApplyWorkspaceEditResultPayload {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["status", "message", "cloudRequired", "appliedEditCount", "affectedFiles"])) {
    return false;
  }
  return (
    (value.status === "applied" || value.status === "denied" || value.status === "rejected" || value.status === "failed") &&
    safeApplyResultMessage(value.message) &&
    value.cloudRequired === false &&
    optionalBoundedInteger(value.appliedEditCount, 0, 64) &&
    isOptionalApplyAffectedFiles(value.affectedFiles)
  );
}

export function isIdeActionRequestPayload(value: unknown): value is IdeActionRequestPayload {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["action", "workspaceRelativePath", "range", "commandId", "query"])) {
    return false;
  }
  if (value.action === "getContextSnapshot" || value.action === "getActiveFileExcerpt") {
    return hasOnlyKeys(value, ["action"]);
  }
  if (value.action === "openWorkspaceFile") {
    return hasOnlyKeys(value, ["action", "workspaceRelativePath"]) && requiredSafeRelativePath(value.workspaceRelativePath);
  }
  if (value.action === "revealWorkspaceRange") {
    return hasOnlyKeys(value, ["action", "workspaceRelativePath", "range"]) && requiredSafeRelativePath(value.workspaceRelativePath) && isEditRange(value.range);
  }
  if (value.action === "runVerificationCommand") {
    return hasOnlyKeys(value, ["action", "commandId"]) && isVerificationCommandId(value.commandId);
  }
  if (value.action === "searchWorkspaceSnippets") {
    return hasOnlyKeys(value, ["action", "query"]) && safeWorkspaceSnippetQuery(value.query);
  }
  return false;
}


export function isIdeActionProgressPayload(value: unknown): value is IdeActionProgressPayload {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["phase", "status", "summary", "cloudRequired", "action", "workspaceRelativePath", "range", "commandId", "queryLabel", "resultCount"])) {
    return false;
  }
  return (
    (value.phase === "queued" || value.phase === "checkingPolicy" || value.phase === "running" || value.phase === "completed") &&
    (value.status === "pending" || value.status === "inProgress" || value.status === "succeeded" || value.status === "rejected" || value.status === "unavailable" || value.status === "failed") &&
    safeMessage(value.summary) &&
    isIdeActionProgressPhaseStatus(value.phase, value.status) &&
    value.cloudRequired === false &&
    optionalIdeActionType(value.action) &&
    safeRelativePath(value.workspaceRelativePath) &&
    (value.range === undefined || isEditRange(value.range)) &&
    (value.commandId === undefined || isVerificationCommandId(value.commandId)) &&
    (value.queryLabel === undefined || safeWorkspaceSnippetQuery(value.queryLabel)) &&
    optionalBoundedInteger(value.resultCount, 0, 20) &&
    hasAllowedProgressMetadata(value) &&
    hasRequiredSuccessfulActionMetadata(value)
  );
}

function isIdeActionProgressPhaseStatus(phase: unknown, status: unknown): boolean {
  if (phase === "queued") {
    return status === "pending";
  }
  if (phase === "checkingPolicy" || phase === "running") {
    return status === "inProgress";
  }
  return phase === "completed" && (status === "succeeded" || status === "rejected" || status === "unavailable" || status === "failed");
}


export function isIdeActionResultPayload(value: unknown): value is IdeActionResultPayload {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["status", "message", "cloudRequired", "action", "workspaceRelativePath", "range", "context", "contextAttachment", "commandId", "exitCode", "durationMs", "outputTail", "truncated", "queryLabel", "resultCount", "snippets"])) {
    return false;
  }
  return (
    (value.status === "succeeded" || value.status === "rejected" || value.status === "unavailable" || value.status === "failed") &&
    safeMessage(value.message) &&
    value.cloudRequired === false &&
    optionalIdeActionType(value.action) &&
    safeRelativePath(value.workspaceRelativePath) &&
    (value.range === undefined || isEditRange(value.range)) &&
    isOptionalIdeActionContext(value.context) &&
    isOptionalActiveFileExcerptAttachment(value.contextAttachment) &&
    (value.commandId === undefined || isVerificationCommandId(value.commandId)) &&
    optionalBoundedInteger(value.exitCode, 0, 255) &&
    optionalBoundedInteger(value.durationMs, 0, 3600000) &&
    (value.outputTail === undefined || safeVerificationOutputTail(value.outputTail)) &&
    (value.truncated === undefined || typeof value.truncated === "boolean") &&
    (value.queryLabel === undefined || safeWorkspaceSnippetQuery(value.queryLabel)) &&
    optionalBoundedInteger(value.resultCount, 0, 20) &&
    isOptionalWorkspaceSnippets(value.snippets) &&
    hasAllowedResultMetadata(value) &&
    hasRequiredSuccessfulActionMetadata(value) &&
    hasRequiredSuccessfulResultMetadata(value)
  );
}

function hasAllowedProgressMetadata(value: Record<string, unknown>): boolean {
  if (value.action !== "runVerificationCommand" && value.commandId !== undefined) {
    return false;
  }
  if (value.action !== "searchWorkspaceSnippets" && (value.queryLabel !== undefined || value.resultCount !== undefined)) {
    return false;
  }
  if (value.action === "runVerificationCommand") {
    return value.workspaceRelativePath === undefined && value.range === undefined && isVerificationCommandId(value.commandId);
  }
  if (value.action === "searchWorkspaceSnippets") {
    return value.workspaceRelativePath === undefined && value.range === undefined && value.commandId === undefined;
  }
  return true;
}

function hasAllowedResultMetadata(value: Record<string, unknown>): boolean {
  if (value.status !== "succeeded" && value.contextAttachment !== undefined) {
    return false;
  }
  if (value.action !== "getActiveFileExcerpt" && value.contextAttachment !== undefined) {
    return false;
  }
  if (value.action !== "runVerificationCommand" && (value.commandId !== undefined || value.exitCode !== undefined || value.durationMs !== undefined || value.outputTail !== undefined)) {
    return false;
  }
  if (value.action !== "runVerificationCommand" && value.action !== "searchWorkspaceSnippets" && value.truncated !== undefined) {
    return false;
  }
  if (value.action !== "searchWorkspaceSnippets" && (value.queryLabel !== undefined || value.resultCount !== undefined || value.snippets !== undefined)) {
    return false;
  }
  if (value.action === "getContextSnapshot") {
    return value.workspaceRelativePath === undefined && value.range === undefined;
  }
  if (value.action === "getActiveFileExcerpt") {
    return value.workspaceRelativePath === undefined && value.range === undefined && value.context === undefined;
  }
  if (value.action === "runVerificationCommand") {
    return value.workspaceRelativePath === undefined && value.range === undefined && value.context === undefined && value.contextAttachment === undefined && isVerificationCommandId(value.commandId);
  }
  if (value.action === "searchWorkspaceSnippets") {
    return value.workspaceRelativePath === undefined && value.range === undefined && value.context === undefined && value.contextAttachment === undefined && value.commandId === undefined && value.exitCode === undefined && value.durationMs === undefined && value.outputTail === undefined && safeWorkspaceSnippetQuery(value.queryLabel) && optionalBoundedInteger(value.resultCount, 0, 20) && Array.isArray(value.snippets) && typeof value.truncated === "boolean";
  }
  if (value.action === "openWorkspaceFile" || value.action === "revealWorkspaceRange") {
    return value.context === undefined;
  }
  return true;
}

function hasRequiredSuccessfulResultMetadata(value: Record<string, unknown>): boolean {
  if (value.status !== "succeeded") {
    return true;
  }
  if (value.action === "getContextSnapshot") {
    return isIdeActionContext(value.context);
  }
  if (value.action === "getActiveFileExcerpt") {
    return isActiveFileExcerptAttachment(value.contextAttachment);
  }
  if (value.action === "runVerificationCommand") {
    return isVerificationCommandId(value.commandId) && optionalBoundedInteger(value.exitCode, 0, 255) && optionalBoundedInteger(value.durationMs, 0, 3600000) && safeVerificationOutputTail(value.outputTail) && typeof value.truncated === "boolean";
  }
  if (value.action === "searchWorkspaceSnippets") {
    return safeWorkspaceSnippetQuery(value.queryLabel) && optionalBoundedInteger(value.resultCount, 0, 20) && isWorkspaceSnippets(value.snippets) && typeof value.truncated === "boolean";
  }
  if (value.action === "openWorkspaceFile" || value.action === "revealWorkspaceRange") {
    return value.context === undefined;
  }
  return true;
}

function hasRequiredSuccessfulActionMetadata(value: Record<string, unknown>): boolean {
  if (value.status !== "succeeded") {
    return true;
  }
  if (value.action === "openWorkspaceFile") {
    return requiredSafeRelativePath(value.workspaceRelativePath) && value.range === undefined;
  }
  if (value.action === "revealWorkspaceRange") {
    return requiredSafeRelativePath(value.workspaceRelativePath) && isEditRange(value.range);
  }
  if (value.action === "getActiveFileExcerpt") {
    return value.workspaceRelativePath === undefined && value.range === undefined && value.context === undefined;
  }
  if (value.action === "runVerificationCommand") {
    return value.workspaceRelativePath === undefined && value.range === undefined && value.context === undefined && isVerificationCommandId(value.commandId);
  }
  if (value.action === "searchWorkspaceSnippets") {
    return value.workspaceRelativePath === undefined && value.range === undefined && value.context === undefined && value.contextAttachment === undefined;
  }
  return value.action === "getContextSnapshot" && value.workspaceRelativePath === undefined && value.range === undefined;
}

function optionalIdeActionType(value: unknown): boolean {
  return value === undefined || value === "getContextSnapshot" || value === "getActiveFileExcerpt" || value === "openWorkspaceFile" || value === "revealWorkspaceRange" || value === "runVerificationCommand" || value === "searchWorkspaceSnippets";
}

function optionalRuntimeLifecycle(value: unknown): value is RuntimeLifecycleState {
  return value === "unknown" || value === "checking" || value === "starting" || value === "connected" || value === "degraded" || value === "disconnected" || value === "restarting" || value === "stopped" || value === "auth_mismatch" || value === "invalid_settings" || value === "failed";
}

function optionalRuntimeSurface(value: unknown): value is BridgeHost {
  return value === "browser" || value === "vscode" || value === "jetbrains";
}

function optionalRuntimeOwner(value: unknown): boolean {
  return value === "browser_preview" || value === "ide_host" || value === "external" || value === "user" || value === "test_harness";
}

function optionalRuntimeLaunchMode(value: unknown): boolean {
  return value === "auto" || value === "connect" || value === "launch" || value === "preview" || value === "manual" || value === "unknown";
}

function optionalRuntimeTokenState(value: unknown): boolean {
  return value === "unknown" || value === "not_required" || value === "absent" || value === "present" || value === "mismatch" || value === "invalid";
}

function optionalRuntimeProcessState(value: unknown): boolean {
  return value === "unknown" || value === "not_owned" || value === "checking" || value === "starting" || value === "running" || value === "exited" || value === "stopped" || value === "failed";
}

function isVerificationCommandId(value: unknown): value is VerificationCommandId {
  return value === "repository-check" || value === "gui-app-tests" || value === "engine-chat-tests";
}

function isOptionalIdeActionContext(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  return isIdeActionContext(value);
}

function isIdeActionContext(value: unknown): boolean {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["source", "hasActiveEditor", "workspaceFolderCount"])) {
    return false;
  }
  const workspaceFolderCount = value.workspaceFolderCount;
  return (value.source === "vscode" || value.source === "jetbrains") &&
    typeof value.hasActiveEditor === "boolean" &&
    typeof workspaceFolderCount === "number" && Number.isInteger(workspaceFolderCount) && workspaceFolderCount >= 0 && workspaceFolderCount <= 100;
}

function isOptionalActiveFileExcerptAttachment(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  return isActiveFileExcerptAttachment(value);
}

function isActiveFileExcerptAttachment(value: unknown): value is ActiveFileExcerptAttachment {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["kind", "source", "file", "range", "text", "truncated"])) {
    return false;
  }
  return value.kind === "active_file_excerpt" &&
    (value.source === "vscode" || value.source === "jetbrains") &&
    isActiveFileExcerptFile(value.file) &&
    isEditRange(value.range) &&
    safeActiveFileExcerptText(value.text) &&
    typeof value.truncated === "boolean";
}

function isActiveFileExcerptFile(value: unknown): boolean {
  return isPlainObject(value) && hasOnlyKeys(value, ["displayPath", "workspaceRelativePath", "languageId"]) && Object.keys(value).length > 0 && safeDisplayPath(value.displayPath) && safeRelativePath(value.workspaceRelativePath) && optionalLanguageId(value.languageId);
}

function safeActiveFileExcerptText(value: unknown): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 8000 && !hasControlCharactersExceptCodeWhitespace(value) && !unsafeDisplayText(value) && !hasPrivatePathLikeText(value) && !hasKeyLikeSecretText(value);
}

function safeVerificationOutputTail(value: unknown): boolean {
  return typeof value === "string" && value.length <= 4000 && !hasControlCharactersExceptCodeWhitespace(value) && !unsafeDisplayText(value) && !hasPrivatePathLikeText(value) && !hasKeyLikeSecretText(value);
}

function safeWorkspaceSnippetQuery(value: unknown): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 120 && value.trim().length > 0 && !hasControlCharacters(value) && !/[*/\\~]|\.\.|[{}[\]()^$+?|]|[;&`$<>]/.test(value) && !/\b(?:cwd|env|shell|git|tool|provider|model|apiKey|requestId|assistant|regex|glob|path)\b/i.test(value) && !unsafeDisplayText(value) && !hasKeyLikeSecretText(value);
}

function safeControlledAgentLexicalSearchQuery(value: unknown): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 120 && value.trim().length > 0 && !hasControlCharacters(value) && !/[*/\\~]|\.\.|[{}[\]()^$+?|]|[;&`$<>]/.test(value) && !/\b(?:cwd|env|shell|git|tool|provider|model|apiKey|requestId|assistant|regex|glob|path|token|secret)\b/i.test(value) && !unsafeDisplayText(value) && !hasKeyLikeSecretText(value);
}

function safeControlledAgentLexicalSearchSnippet(value: unknown): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 400 && !hasControlCharactersExceptCodeWhitespace(value) && !unsafeDisplayText(value) && !hasPrivatePathLikeText(value) && !hasKeyLikeSecretText(value);
}

function safeWorkspaceSnippetText(value: unknown): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 2000 && !hasControlCharactersExceptCodeWhitespace(value) && !unsafeDisplayText(value) && !hasPrivatePathLikeText(value) && !hasKeyLikeSecretText(value);
}

function isOptionalWorkspaceSnippets(value: unknown): boolean {
  return value === undefined || isWorkspaceSnippets(value);
}

function isWorkspaceSnippets(value: unknown): value is WorkspaceSnippetSearchResult[] {
  return Array.isArray(value) && value.length <= 20 && value.every(isWorkspaceSnippet);
}

function isWorkspaceSnippet(value: unknown): value is WorkspaceSnippetSearchResult {
  return isPlainObject(value) && hasOnlyKeys(value, ["workspaceRelativePath", "languageId", "range", "text"]) && requiredSafeRelativePath(value.workspaceRelativePath) && optionalLanguageId(value.languageId) && isEditRange(value.range) && safeWorkspaceSnippetText(value.text);
}

function hasControlCharactersExceptCodeWhitespace(value: string): boolean {
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(value);
}

function isFileTextEdits(value: unknown): value is WorkspaceFileTextEdits {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["workspaceRelativePath", "textReplacements"]) || !requiredSafeRelativePath(value.workspaceRelativePath)) {
    return false;
  }
  return Array.isArray(value.textReplacements) && value.textReplacements.length >= 1 && value.textReplacements.length <= 16 && value.textReplacements.every(isTextReplacement);
}

function isTextReplacement(value: unknown): value is WorkspaceTextReplacement {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["range", "replacementText"])) {
    return false;
  }
  return isEditRange(value.range) && typeof value.replacementText === "string" && value.replacementText.length <= 8192;
}

function isEditRange(value: unknown): value is WorkspaceEditRange {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["start", "end"]) || !isEditPosition(value.start) || !isEditPosition(value.end)) {
    return false;
  }
  return value.end.line > value.start.line || (value.end.line === value.start.line && value.end.character >= value.start.character);
}

function isEditPosition(value: unknown): value is WorkspaceEditPosition {
  return isPlainObject(value) && hasOnlyKeys(value, ["line", "character"]) && Number.isInteger(value.line) && Number.isInteger(value.character) && optionalBoundedInteger(value.line, 0, 1000000) && optionalBoundedInteger(value.character, 0, 1000000);
}

function isOptionalAffectedFiles(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.length <= 4 && value.every((item) => requiredSafeRelativePath(item)));
}

function isOptionalApplyAffectedFiles(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.length <= 4 && value.every((item) => requiredSafeRelativePath(item)));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isBoundedRequestId(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value) && !hasSecretRequestIdMarker(value));
}

function hasSecretRequestIdMarker(value: string): boolean {
  return /authorization|bearer|api[_-]?key|token|secret|access[_-]?token|sk-(?:proj-)?[A-Za-z0-9_-]{8,}/i.test(value);
}

function isEmptyPayload(value: unknown): boolean {
  return value === undefined || (isPlainObject(value) && Object.keys(value).length === 0);
}

function optionalString(value: unknown, maxLength: number, minLength = 0): boolean {
  return value === undefined || (typeof value === "string" && value.length >= minLength && value.length <= maxLength);
}

function optionalSessionToken(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && value.length >= 1 && value.length <= 512 && /^[A-Za-z0-9._~+/=-]+$/.test(value) && !/bearer|api[_-]?key|secret|password|sk-(?:proj-)?[A-Za-z0-9_-]{8,}/i.test(value));
}

function optionalProductId(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(value) && !/auth|bearer|api[_-]?key|token|secret|sk-(?:proj-)?[A-Za-z0-9_-]{8,}/i.test(value));
}

function optionalDisplayName(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9 ._+-]{0,79}$/.test(value) && !/auth|bearer|api[_-]?key|token|secret|sk-(?:proj-)?[A-Za-z0-9_-]{8,}/i.test(value));
}

function optionalNonEmptyString(value: unknown, maxLength: number): boolean {
  return value === undefined || (typeof value === "string" && value.length > 0 && value.length <= maxLength);
}

function optionalLoopbackRuntimeUrl(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) {
    return false;
  }
  try {
    const parsed = new URL(value);
    const hasRootPath = parsed.pathname === "/" && /^[a-zA-Z][a-zA-Z\d+.-]*:\/\/[^/?#]*(?:\/)?$/.test(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "[::1]") &&
      parsed.port.length > 0 && Number.parseInt(parsed.port, 10) > 0 && Number.parseInt(parsed.port, 10) <= 65535 &&
      parsed.username.length === 0 && parsed.password.length === 0 &&
      parsed.search.length === 0 && parsed.hash.length === 0 &&
      hasRootPath;
  } catch {
    return false;
  }
}

function isContextFile(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["displayPath", "workspaceRelativePath", "languageId"]) || Object.keys(value).length === 0) {
    return false;
  }
  return safeDisplayPath(value.displayPath) && safeRelativePath(value.workspaceRelativePath) && optionalLanguageId(value.languageId);
}

function isContextSelection(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["startLine", "startCharacter", "endLine", "endCharacter", "text"]) || Object.keys(value).length === 0) {
    return false;
  }
  return (
    optionalBoundedInteger(value.startLine, 0, 1000000) &&
    optionalBoundedInteger(value.startCharacter, 0, 1000000) &&
    optionalBoundedInteger(value.endLine, 0, 1000000) &&
    optionalBoundedInteger(value.endCharacter, 0, 1000000) &&
    optionalString(value.text, 8000) &&
    isOptionalSelectionRangeOrdered(value)
  );
}

function isOptionalSelectionRangeOrdered(value: Record<string, unknown>): boolean {
  const rangeKeys = [value.startLine, value.startCharacter, value.endLine, value.endCharacter];
  if (rangeKeys.every((item) => item === undefined)) {
    return true;
  }
  if (!rangeKeys.every((item) => Number.isInteger(item))) {
    return false;
  }
  return (value.endLine as number) > (value.startLine as number) || ((value.endLine as number) === (value.startLine as number) && (value.endCharacter as number) >= (value.startCharacter as number));
}

function safeDisplayPath(value: unknown): boolean {
  return value === undefined || safePath(value, 256);
}

function safeRelativePath(value: unknown): boolean {
  return value === undefined || requiredSafeRelativePath(value);
}

function requiredSafeRelativePath(value: unknown): boolean {
  return safePath(value, 512);
}

function safePath(value: unknown, maxLength: number): boolean {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || value.startsWith("/") || value.startsWith("~") || value.includes("%") || value.includes("\\") || value.includes(":") || value.includes("?") || value.includes("#")) {
    return false;
  }
  if (/^[^\u0000-\u001f\u007f-\u009f]+$/.test(value) === false) {
    return false;
  }
  return value.split("/").every((part) => part.length > 0 && part !== "." && part !== ".." && !isSecretLikePathSegment(part));
}

function isSecretLikePathSegment(value: string): boolean {
  return /^(?:auth|authorization|bearer|cookie|credential|credentials|password|secret|token|access[_-]?token|api[_-]?key)(?:\.|-|_|$)/i.test(value) ||
    /(?:^|[._-])(?:auth|credential|credentials|password|secret|token|access[_-]?token|api[_-]?key)(?:[._-]|$)/i.test(value) ||
    /^sk-(?:proj-)?[A-Za-z0-9_-]{8,}/i.test(value);
}

function optionalLanguageId(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && value.length > 0 && value.length <= 64 && /^[A-Za-z0-9_.+-]+$/.test(value));
}

function optionalBoundedInteger(value: unknown, min: number, max: number): boolean {
  return value === undefined || (Number.isInteger(value) && (value as number) >= min && (value as number) <= max);
}

function safeSummary(value: unknown): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 1000 && !hasControlCharacters(value) && !unsafeDisplayText(value) && !hasPrivatePathLikeText(value) && !hasKeyLikeSecretText(value);
}

function safeMessage(value: unknown): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 1000 && !hasControlCharacters(value) && !unsafeDisplayText(value) && !hasPrivatePathLikeText(value) && !hasKeyLikeSecretText(value);
}

function safeApplyResultMessage(value: unknown): boolean {
  return safeMessage(value);
}

function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u001F\u007F-\u009F]/u.test(value);
}

function hasPrivatePathLikeText(value: string): boolean {
  return /(?:\/(?:Users|home|tmp|var|Volumes|Private|etc|opt|mnt)(?=\/|$|[^A-Za-z0-9_])|~[\/\\]|[A-Za-z]:[\/\\])/i.test(value);
}

function hasKeyLikeSecretText(value: string): boolean {
  return /(?:^|[^A-Za-z0-9_-])sk-(?:proj-)?[A-Za-z0-9_-]{8,}/i.test(value);
}

function unsafeDisplayText(value: string): boolean {
  return /authorization|bearer|cookie|api[_-]?key|token|secret|password|private[_-]?path|provider[_-]?response|raw[_-]?prompt|file[_-]?content/i.test(value);
}
