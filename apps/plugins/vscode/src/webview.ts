import * as vscode from "vscode";
import * as crypto from "node:crypto";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { EngineConnection, getLoopbackOrigin, isBridgeSafeSessionToken, redactRuntimeDiagnosticText, validateRuntimeUrl } from "./engineConnection";
import { isControlledFileReadGuiMessage, isInvalidControlledFileReadRequestMessage, runControlledFileReadRequest } from "./controlledFileRead";
import { isControlledAgentEditGuiMessage, isInvalidControlledAgentEditRequestMessage, runControlledAgentEditRequest } from "./controlledEdit";
import { ProductIdentity, bridgeVersion, configurationPrefix } from "./identity";

export type HostMessage =
  | { version: string; type: "host.ready"; requestId?: string; payload?: Record<string, unknown> }
  | { version: string; type: "host.openedFromCommand" | "host.runtimeStatus"; requestId?: never; payload?: Record<string, unknown> }
  | { version: string; type: "host.contextSnapshot" | "host.ideActionProgress" | "host.ideActionResult" | "host.applyWorkspaceEditResult" | "host.controlledAgentFileReadResult" | "host.controlledAgentEditResult"; requestId?: string; payload?: Record<string, unknown> };

type RuntimeStatusLifecycle = "unknown" | "checking" | "starting" | "connected" | "degraded" | "disconnected" | "restarting" | "stopped" | "auth_mismatch" | "invalid_settings" | "failed";
type RuntimeStatusLaunchMode = "auto" | "connect" | "launch" | "preview" | "manual" | "unknown";
type RuntimeStatusTokenState = "unknown" | "not_required" | "absent" | "present" | "mismatch" | "invalid";
type RuntimeStatusProcessState = "unknown" | "not_owned" | "checking" | "starting" | "running" | "exited" | "stopped" | "failed";

type RuntimeStatusInput = {
  lifecycle: RuntimeStatusLifecycle;
  launchMode?: RuntimeStatusLaunchMode;
  runtimeOwner?: "ide_host" | "external" | "user" | "test_harness";
  tokenState?: RuntimeStatusTokenState;
  processState?: RuntimeStatusProcessState;
  diagnosis: string;
  nextAction: string;
};

type HostContextPayload = {
  kind: "active_editor";
  source: "vscode";
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

type GuiMessage = {
  version: string;
  type: "gui.ready" | "gui.ideActionRequest" | "gui.applyWorkspaceEditRequest" | "gui.controlledAgentFileReadRequest" | "gui.controlledAgentEditRequest";
  requestId?: string;
  payload?: Record<string, unknown>;
};

type VerificationCommandId = "repository-check" | "gui-app-tests" | "engine-chat-tests";

type IdeActionType = "getContextSnapshot" | "getActiveFileExcerpt" | "openWorkspaceFile" | "revealWorkspaceRange" | "runVerificationCommand" | "searchWorkspaceSnippets";

type IdeActionStatus = "succeeded" | "rejected" | "unavailable" | "failed";

type IdeActionRequest =
  | { requestId: string; action: "getContextSnapshot" }
  | { requestId: string; action: "getActiveFileExcerpt" }
  | { requestId: string; action: "openWorkspaceFile"; workspaceRelativePath: string }
  | { requestId: string; action: "revealWorkspaceRange"; workspaceRelativePath: string; range: ApplyWorkspaceTextReplacement["range"] }
  | { requestId: string; action: "runVerificationCommand"; commandId: VerificationCommandId }
  | { requestId: string; action: "searchWorkspaceSnippets"; query: string };

type ActiveFileExcerptAttachment = {
  kind: "active_file_excerpt";
  source: "vscode";
  file: {
    displayPath: string;
    workspaceRelativePath: string;
    languageId?: string;
  };
  range: ApplyWorkspaceTextReplacement["range"];
  text: string;
  truncated: boolean;
};

type WorkspaceSnippet = {
  workspaceRelativePath: string;
  languageId: string;
  range: ApplyWorkspaceTextReplacement["range"];
  text: string;
};

type WorkspaceSnippetSearchMetadata = {
  action: "searchWorkspaceSnippets";
  queryLabel: string;
  resultCount: number;
  snippets: WorkspaceSnippet[];
  truncated: boolean;
};

type ApplyWorkspaceEditRequest = {
  requestId: string;
  summary: string;
  edits: ApplyWorkspaceFileEdit[];
};

type ApplyWorkspaceFileEdit = {
  workspaceRelativePath: string;
  textReplacements: ApplyWorkspaceTextReplacement[];
};

type ApplyWorkspaceTextReplacement = {
  range: {
    start: ApplyWorkspacePosition;
    end: ApplyWorkspacePosition;
  };
  replacementText: string;
};

type ApplyWorkspacePosition = {
  line: number;
  character: number;
};

type ValidatedWorkspaceEdit = {
  requestId: string;
  summary: string;
  files: ValidatedWorkspaceFileEdit[];
  editCount: number;
};

type ValidatedWorkspaceFileEdit = {
  workspaceRelativePath: string;
  uri: vscode.Uri;
  textReplacements: ApplyWorkspaceTextReplacement[];
};

type ApplyWorkspaceEditStatus = "applied" | "denied" | "rejected" | "failed";

const applyWorkspaceEditConfirmationLabel = "Apply edits";
const maxForwardedApplyWorkspaceEditMessageBytes = 65536;
const maxForwardedIdeActionMessageBytes = 8192;
const maxForwardedControlledFileReadMessageBytes = 8192;
const maxForwardedControlledAgentEditMessageBytes = 65536;
const maxControlledIdeActionFileBytes = 2 * 1024 * 1024;
const maxActiveFileExcerptTextLength = 8000;
const maxWorkspaceSnippetSearchFileBytes = 1024 * 1024;
const maxWorkspaceSnippetSearchFiles = 500;
const maxWorkspaceSnippetSearchResults = 20;
const maxWorkspaceSnippetSearchSnippetsPerFile = 8;
const maxWorkspaceSnippetSearchSnippetLength = 400;
const inFlightIdeActionRequestIds = new Set<string>();
const verificationCommandTimeoutMs = 120000;
const maxVerificationOutputTailLength = 4000;
const verificationCommandConfirmationLabel = "Run verification";
const pendingVerificationCommandIds = new Set<VerificationCommandId>();
const pendingWorkspaceSnippetSearchQueries = new Set<string>();
const verificationCommands: Record<VerificationCommandId, { command: string; args: string[]; label: string }> = {
  "repository-check": { command: "npm", args: ["run", "check"], label: "repository check" },
  "gui-app-tests": { command: "npm", args: ["--prefix", "apps/gui", "test", "--", "App"], label: "GUI app tests" },
  "engine-chat-tests": { command: "cargo", args: ["test", "-p", "yet-lsp", "chat"], label: "engine chat tests" },
};

export function openYetAiWebview(
  context: vscode.ExtensionContext,
  identity: ProductIdentity,
  connection: EngineConnection,
): void {
  const panel = vscode.window.createWebviewPanel(
    "yetAiChat",
    identity.vscode.displayName,
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")],
    },
  );

  panel.webview.html = renderWebviewHtml(panel.webview, context.extensionUri, identity, connection);
  let guiReady = false;
  let guiReadyRequestId: string | undefined;
  let contextRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  const sendContextSnapshot = () => {
    if (!guiReady) {
      return;
    }
    void panel.webview.postMessage(createHostContextSnapshot(guiReadyRequestId));
  };
  const scheduleContextRefresh = () => {
    if (!guiReady) {
      return;
    }
    if (contextRefreshTimer !== undefined) {
      clearTimeout(contextRefreshTimer);
    }
    contextRefreshTimer = setTimeout(() => {
      contextRefreshTimer = undefined;
      sendContextSnapshot();
    }, 200);
  };
  const activeEditorListener = vscode.window.onDidChangeActiveTextEditor(() => scheduleContextRefresh());
  const selectionListener = vscode.window.onDidChangeTextEditorSelection(() => scheduleContextRefresh());
  panel.onDidDispose(() => {
    activeEditorListener.dispose();
    selectionListener.dispose();
    if (contextRefreshTimer !== undefined) {
      clearTimeout(contextRefreshTimer);
      contextRefreshTimer = undefined;
    }
  });
  panel.webview.onDidReceiveMessage((message: unknown) => {
    if (!isGuiMessage(message)) {
      if (isInvalidIdeActionRequestMessage(message)) {
        const requestId = (message as { requestId: string }).requestId;
        void panel.webview.postMessage(createIdeActionResult(requestId, "rejected", "IDE action rejected by host policy."));
        return;
      }
      if (isInvalidApplyWorkspaceEditRequestMessage(message)) {
        const requestId = (message as { requestId: string }).requestId;
        void panel.webview.postMessage(createApplyWorkspaceEditResult(requestId, "rejected", "Edit request rejected by host policy."));
        return;
      }
      if (isInvalidControlledFileReadRequestMessage(message)) {
        const requestId = (message as { requestId: string }).requestId;
        void runControlledFileReadRequest({ version: bridgeVersion, type: "gui.controlledAgentFileReadRequest", requestId, payload: {} }, []).then((result) => panel.webview.postMessage(result));
        return;
      }
      if (isInvalidControlledAgentEditRequestMessage(message)) {
        const requestId = (message as { requestId: string }).requestId;
        void runControlledAgentEditRequest({ version: bridgeVersion, type: "gui.controlledAgentEditRequest", requestId, payload: {} }, []).then((result) => panel.webview.postMessage(result));
        return;
      }
      console.log("Yet AI rejected invalid GUI bridge message");
      return;
    }
    console.log(`Yet AI received ${message.type}`);
    if (message.type === "gui.ideActionRequest") {
      void handleIdeActionRequest(panel.webview, message);
      return;
    }
    if (message.type === "gui.applyWorkspaceEditRequest") {
      void handleApplyWorkspaceEditRequest(panel.webview, message);
      return;
    }
    if (message.type === "gui.controlledAgentFileReadRequest") {
      void handleControlledFileReadRequest(panel.webview, message);
      return;
    }
    if (message.type === "gui.controlledAgentEditRequest") {
      void handleControlledAgentEditRequest(panel.webview, message);
      return;
    }
    guiReady = true;
    guiReadyRequestId = message.requestId;
    void panel.webview.postMessage(createConnectedHostRuntimeStatus(connection));
    void panel.webview.postMessage(createHostReady(identity, connection, message.requestId));
    void panel.webview.postMessage({
      version: bridgeVersion,
      type: "host.openedFromCommand",
      payload: {},
    } satisfies HostMessage);
    sendContextSnapshot();
  });
}

export async function handleControlledFileReadRequest(webview: vscode.Webview, message: GuiMessage): Promise<void> {
  const workspaceRoots = (vscode.workspace.workspaceFolders ?? [])
    .filter((folder) => folder.uri.scheme === "file")
    .map((folder) => folder.uri.fsPath);
  const result = await runControlledFileReadRequest({
    version: message.version,
    type: "gui.controlledAgentFileReadRequest",
    requestId: message.requestId,
    payload: message.payload,
  }, workspaceRoots);
  await webview.postMessage(result);
}

export async function handleControlledAgentEditRequest(webview: vscode.Webview, message: GuiMessage): Promise<void> {
  const workspaceRoots = (vscode.workspace.workspaceFolders ?? [])
    .filter((folder) => folder.uri.scheme === "file")
    .map((folder) => folder.uri.fsPath);
  const result = await runControlledAgentEditRequest({
    version: message.version,
    type: "gui.controlledAgentEditRequest",
    requestId: message.requestId,
    payload: message.payload,
  }, workspaceRoots);
  await webview.postMessage(result);
}

export function createHostReady(
  identity: ProductIdentity,
  connection: EngineConnection,
  requestId: string | undefined,
): HostMessage {
  validateRuntimeUrl(connection.runtimeUrl, `${configurationPrefix}.runtimeUrl`);
  if (connection.sessionToken !== undefined && !isBridgeSafeSessionToken(connection.sessionToken)) {
    console.log("Yet AI refused unsafe host.ready session token");
    return {
      version: bridgeVersion,
      type: "host.ready",
      requestId,
      payload: {
        productId: identity.product.id,
        displayName: identity.product.displayName,
        runtimeUrl: connection.runtimeUrl,
        cloudRequired: false,
      },
    };
  }
  return {
    version: bridgeVersion,
    type: "host.ready",
    requestId,
    payload: {
      productId: identity.product.id,
      displayName: identity.product.displayName,
      runtimeUrl: connection.runtimeUrl,
      sessionToken: connection.sessionToken,
      cloudRequired: false,
    },
  };
}

export function createHostRuntimeStatus(status: RuntimeStatusInput): HostMessage {
  return {
    version: bridgeVersion,
    type: "host.runtimeStatus",
    payload: {
      protocolVersion: "2026-06-21",
      surface: "vscode",
      lifecycle: status.lifecycle,
      runtimeOwner: status.runtimeOwner ?? "ide_host",
      launchMode: status.launchMode ?? "unknown",
      tokenState: status.tokenState ?? "unknown",
      processState: status.processState ?? "unknown",
      diagnosis: sanitizeRuntimeStatusMessage(status.diagnosis, "runtime status changed"),
      nextAction: sanitizeRuntimeStatusMessage(status.nextAction, "Use Yet AI runtime diagnostics or reopen the chat."),
      cloudRequired: false,
      authority: "metadata_only",
    },
  };
}

export function createConnectedHostRuntimeStatus(connection: EngineConnection, launchMode: RuntimeStatusLaunchMode = "unknown"): HostMessage {
  return createHostRuntimeStatus({
    lifecycle: "connected",
    launchMode,
    tokenState: connection.sessionToken === undefined ? "absent" : "present",
    processState: "running",
    diagnosis: "runtime connected",
    nextAction: "Type a prompt or refresh provider readiness.",
  });
}

export function createRuntimeFailureHostRuntimeStatus(error: unknown, launchMode: RuntimeStatusLaunchMode = "unknown"): HostMessage {
  const rawMessage = error instanceof Error ? error.message : typeof error === "string" ? error : "runtime unavailable";
  const redactedMessage = redactRuntimeDiagnosticText(rawMessage);
  const lifecycle = /401|unauthorized|session token mismatch/i.test(redactedMessage) ? "auth_mismatch" : /settings|launchMode|runtimeUrl|engineBinaryPath|must be/i.test(redactedMessage) ? "invalid_settings" : "failed";
  return createHostRuntimeStatus({
    lifecycle,
    launchMode,
    tokenState: lifecycle === "auth_mismatch" ? "mismatch" : lifecycle === "invalid_settings" ? "invalid" : "unknown",
    processState: lifecycle === "invalid_settings" ? "failed" : "exited",
    diagnosis: lifecycle === "auth_mismatch" ? "runtime session mismatch" : lifecycle === "invalid_settings" ? "runtime settings need review" : "runtime unavailable",
    nextAction: runtimeStatusRecoveryAction(lifecycle, redactedMessage),
  });
}

function runtimeStatusRecoveryAction(lifecycle: RuntimeStatusLifecycle, redactedMessage: string): string {
  if (lifecycle === "auth_mismatch") {
    return "Reopen the chat to refresh the IDE runtime session, or update the SecretStorage token for connect mode.";
  }
  if (lifecycle === "invalid_settings") {
    return "Open Yet AI settings and choose a valid local launch mode.";
  }
  if (/reopen|restart/i.test(redactedMessage)) {
    return "Reopen the chat or restart the IDE host to recover the local runtime.";
  }
  return "Use Yet AI runtime diagnostics, then reopen the chat if the local runtime was restarted.";
}

function sanitizeRuntimeStatusMessage(value: string, fallback: string): string {
  const redacted = redactRuntimeDiagnosticText(value).trim();
  if (redacted.length === 0 || redacted.length > 1000 || hasSecretLikeText(redacted) || hasPrivatePathLikeText(redacted) || hasBinaryLikeText(redacted)) {
    return fallback;
  }
  return redacted;
}

export function createHostContextSnapshot(requestId: string | undefined): HostMessage {
  return {
    version: bridgeVersion,
    type: "host.contextSnapshot",
    requestId,
    payload: createActiveEditorContextPayload(),
  };
}

export function createApplyWorkspaceEditResult(
  requestId: string,
  status: ApplyWorkspaceEditStatus,
  message: string,
  appliedEditCount = 0,
  affectedFiles: string[] = [],
): HostMessage {
  return {
    version: bridgeVersion,
    type: "host.applyWorkspaceEditResult",
    requestId,
    payload: {
      status,
      message: sanitizeApplyWorkspaceEditResultMessage(message),
      cloudRequired: false,
      appliedEditCount: clampAppliedEditCount(appliedEditCount),
      affectedFiles: affectedFiles.map((file) => sanitizeRelativePath(file, 512)).filter((file): file is string => file !== undefined).slice(0, 4),
    },
  };
}

export function createIdeActionProgress(
  requestId: string,
  phase: "queued" | "checkingPolicy" | "running" | "completed",
  status: "pending" | "inProgress" | IdeActionStatus,
  summary: string,
  action?: IdeActionType,
  workspaceRelativePath?: string,
  commandId?: VerificationCommandId,
): HostMessage {
  const payload: Record<string, unknown> = {
    phase,
    status,
    summary: sanitizeIdeActionStatusMessage(summary),
    cloudRequired: false,
  };
  if (action) {
    payload.action = action;
  }
  const pathValue = sanitizeRelativePath(workspaceRelativePath, 512);
  if (pathValue) {
    payload.workspaceRelativePath = pathValue;
  }
  if (commandId && isVerificationCommandId(commandId)) {
    payload.commandId = commandId;
  }
  return { version: bridgeVersion, type: "host.ideActionProgress", requestId, payload };
}

export function createIdeActionResult(
  requestId: string,
  status: IdeActionStatus,
  message: string,
  metadata: { action?: IdeActionType; workspaceRelativePath?: string; range?: ApplyWorkspaceTextReplacement["range"]; context?: Record<string, unknown>; contextAttachment?: ActiveFileExcerptAttachment; commandId?: VerificationCommandId; exitCode?: number; durationMs?: number; outputTail?: string; truncated?: boolean; queryLabel?: string; resultCount?: number; snippets?: WorkspaceSnippet[] } = {},
): HostMessage {
  const payload: Record<string, unknown> = {
    status,
    message: sanitizeIdeActionStatusMessage(message),
    cloudRequired: false,
  };
  if (metadata.action) {
    payload.action = metadata.action;
  }
  const pathValue = sanitizeRelativePath(metadata.workspaceRelativePath, 512);
  if (pathValue) {
    payload.workspaceRelativePath = pathValue;
  }
  if (metadata.range && isStrictRange(metadata.range)) {
    payload.range = metadata.range;
  }
  if (metadata.context && (status !== "succeeded" || metadata.action === "getContextSnapshot")) {
    payload.context = { ...metadata.context, source: "vscode" };
  }
  if (metadata.contextAttachment && status === "succeeded" && metadata.action === "getActiveFileExcerpt") {
    payload.contextAttachment = metadata.contextAttachment;
  }
  if (metadata.commandId && isVerificationCommandId(metadata.commandId)) {
    payload.commandId = metadata.commandId;
  }
  if (metadata.action === "runVerificationCommand" && metadata.commandId && metadata.exitCode !== undefined && metadata.durationMs !== undefined && metadata.outputTail !== undefined && metadata.truncated !== undefined) {
    payload.exitCode = clampExitCode(metadata.exitCode);
    payload.durationMs = clampDurationMs(metadata.durationMs);
    payload.outputTail = sanitizeVerificationOutputTail(metadata.outputTail).outputTail;
    payload.truncated = metadata.truncated;
  }
  if (metadata.action === "searchWorkspaceSnippets" && metadata.queryLabel !== undefined && metadata.resultCount !== undefined && metadata.snippets !== undefined && metadata.truncated !== undefined) {
    payload.queryLabel = sanitizeWorkspaceSnippetSearchQuery(metadata.queryLabel);
    payload.resultCount = clampWorkspaceSnippetResultCount(metadata.resultCount);
    payload.snippets = sanitizeWorkspaceSnippets(metadata.snippets);
    payload.truncated = metadata.truncated;
  }
  hardenIdeActionResultPayload(payload);
  return { version: bridgeVersion, type: "host.ideActionResult", requestId, payload };
}

function hardenIdeActionResultPayload(payload: Record<string, unknown>): void {
  if (payload.status !== "succeeded") {
    return;
  }
  if (payload.action === "getContextSnapshot") {
    delete payload.workspaceRelativePath;
    delete payload.range;
    if (!isIdeActionContextMetadata(payload.context)) {
      payload.context = createIdeActionContextMetadata();
    }
  }
  if (payload.action === "getActiveFileExcerpt") {
    delete payload.workspaceRelativePath;
    delete payload.range;
    delete payload.context;
    if (!isActiveFileExcerptAttachment(payload.contextAttachment)) {
      delete payload.contextAttachment;
      payload.status = "rejected";
      payload.message = "IDE action rejected by host policy.";
    }
  }
  if (payload.action === "openWorkspaceFile") {
    delete payload.range;
    delete payload.context;
  }
  if (payload.action === "revealWorkspaceRange") {
    delete payload.context;
  }
  if (payload.action === "runVerificationCommand") {
    delete payload.workspaceRelativePath;
    delete payload.range;
    delete payload.context;
    delete payload.contextAttachment;
    if (!isVerificationCommandId(payload.commandId) || !isBoundedInteger(payload.exitCode) || !isBoundedInteger(payload.durationMs) || typeof payload.outputTail !== "string" || sanitizeVerificationOutputTail(payload.outputTail).outputTail !== payload.outputTail || typeof payload.truncated !== "boolean") {
      payload.status = "failed";
      payload.message = "Verification command status changed.";
      payload.commandId = isVerificationCommandId(payload.commandId) ? payload.commandId : "repository-check";
      payload.exitCode = 1;
      payload.durationMs = 0;
      payload.outputTail = "Verification output hidden by host policy.";
      payload.truncated = true;
    }
  }
  if (payload.action === "searchWorkspaceSnippets") {
    delete payload.workspaceRelativePath;
    delete payload.range;
    delete payload.context;
    delete payload.contextAttachment;
    delete payload.commandId;
    delete payload.exitCode;
    delete payload.durationMs;
    delete payload.outputTail;
    if (typeof payload.queryLabel !== "string" || sanitizeWorkspaceSnippetSearchQuery(payload.queryLabel) !== payload.queryLabel || !isBoundedSnippetResultCount(payload.resultCount) || !Array.isArray(payload.snippets) || payload.snippets.length !== payload.resultCount || payload.snippets.length > maxWorkspaceSnippetSearchResults || !payload.snippets.every(isWorkspaceSnippet) || typeof payload.truncated !== "boolean") {
      payload.status = "rejected";
      payload.message = "IDE action rejected by host policy.";
      delete payload.queryLabel;
      delete payload.resultCount;
      delete payload.snippets;
      delete payload.truncated;
    }
  }
}

function isIdeActionContextMetadata(value: unknown): value is Record<string, unknown> {
  return isPlainRecord(value) &&
    hasOnlyKeys(value, ["source", "hasActiveEditor", "workspaceFolderCount"]) &&
    (value.source === undefined || value.source === "vscode") &&
    (value.hasActiveEditor === undefined || typeof value.hasActiveEditor === "boolean") &&
    (value.workspaceFolderCount === undefined || (Number.isInteger(value.workspaceFolderCount) && typeof value.workspaceFolderCount === "number" && value.workspaceFolderCount >= 0 && value.workspaceFolderCount <= 100));
}

function isActiveFileExcerptAttachment(value: unknown): value is ActiveFileExcerptAttachment {
  return isPlainRecord(value) &&
    hasOnlyKeys(value, ["kind", "source", "file", "range", "text", "truncated"]) &&
    value.kind === "active_file_excerpt" &&
    value.source === "vscode" &&
    isPlainRecord(value.file) &&
    hasOnlyKeys(value.file, ["displayPath", "workspaceRelativePath", "languageId"]) &&
    typeof value.file.displayPath === "string" &&
    sanitizeRelativePath(value.file.displayPath, 512) === value.file.displayPath &&
    typeof value.file.workspaceRelativePath === "string" &&
    sanitizeRelativePath(value.file.workspaceRelativePath, 512) === value.file.workspaceRelativePath &&
    (value.file.languageId === undefined || (typeof value.file.languageId === "string" && sanitizeLanguageId(value.file.languageId) === value.file.languageId)) &&
    isStrictRange(value.range) &&
    typeof value.text === "string" &&
    sanitizeActiveFileExcerptText(value.text) === value.text &&
    typeof value.truncated === "boolean";
}

function isWorkspaceSnippet(value: unknown): value is WorkspaceSnippet {
  return isPlainRecord(value) &&
    hasOnlyKeys(value, ["workspaceRelativePath", "languageId", "range", "text"]) &&
    typeof value.workspaceRelativePath === "string" &&
    sanitizeRelativePath(value.workspaceRelativePath, 512) === value.workspaceRelativePath &&
    typeof value.languageId === "string" &&
    sanitizeLanguageId(value.languageId) === value.languageId &&
    isStrictRange(value.range) &&
    typeof value.text === "string" &&
    sanitizeWorkspaceSnippetText(value.text) === value.text;
}

export async function handleIdeActionRequest(webview: vscode.Webview, message: GuiMessage): Promise<void> {
  const requestId = typeof message.requestId === "string" ? message.requestId : "invalid-request";
  const request = parseIdeActionRequest(message);
  if (!request) {
    await webview.postMessage(createIdeActionResult(requestId, "rejected", "IDE action rejected by host policy."));
    return;
  }
  if (inFlightIdeActionRequestIds.has(request.requestId)) {
    const metadata = request.action === "runVerificationCommand"
      ? createVerificationResultMetadata(request.commandId, 1, 0, "Verification command is already running.", false)
      : { action: request.action };
    await webview.postMessage(createIdeActionResult(request.requestId, "rejected", "IDE action rejected by host policy.", metadata));
    return;
  }

  inFlightIdeActionRequestIds.add(request.requestId);
  try {
    await webview.postMessage(createIdeActionProgress(request.requestId, "checkingPolicy", "inProgress", "IDE action policy check started.", request.action, "workspaceRelativePath" in request ? request.workspaceRelativePath : undefined, "commandId" in request ? request.commandId : undefined));
    const result = await runIdeActionRequest(request);
    await webview.postMessage(result);
  } catch {
    await webview.postMessage(createIdeActionResult(request.requestId, "failed", "IDE action failed.", { action: request.action }));
  } finally {
    inFlightIdeActionRequestIds.delete(request.requestId);
  }
}

async function runIdeActionRequest(request: IdeActionRequest): Promise<HostMessage> {
  if (request.action === "getContextSnapshot") {
    return createIdeActionResult(request.requestId, "succeeded", "IDE context snapshot captured.", {
      action: request.action,
      context: createIdeActionContextMetadata(),
    });
  }
  if (request.action === "getActiveFileExcerpt") {
    return createActiveFileExcerptResult(request.requestId);
  }
  if (request.action === "runVerificationCommand") {
    return runVerificationCommandRequest(request);
  }
  if (request.action === "searchWorkspaceSnippets") {
    return runWorkspaceSnippetSearchRequest(request);
  }

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return createIdeActionResult(request.requestId, "unavailable", "Workspace is unavailable.", { action: request.action, workspaceRelativePath: request.workspaceRelativePath });
  }
  const uri = await resolveExistingWorkspaceFile(request.workspaceRelativePath, workspaceFolders, maxControlledIdeActionFileBytes);
  if (!uri) {
    return createIdeActionResult(request.requestId, "rejected", "Workspace file rejected by host policy.", { action: request.action, workspaceRelativePath: request.workspaceRelativePath });
  }
  const document = await vscode.workspace.openTextDocument(uri);
  if (!document || document.isUntitled) {
    return createIdeActionResult(request.requestId, "unavailable", "Workspace file is unavailable.", { action: request.action, workspaceRelativePath: request.workspaceRelativePath });
  }
  if (request.action === "openWorkspaceFile") {
    await vscode.window.showTextDocument(document, { preview: true });
    return createIdeActionResult(request.requestId, "succeeded", "Workspace file opened.", { action: request.action, workspaceRelativePath: request.workspaceRelativePath });
  }
  if (!isRangeWithinDocument(request.range, document)) {
    return createIdeActionResult(request.requestId, "rejected", "Workspace range rejected by host policy.", { action: request.action, workspaceRelativePath: request.workspaceRelativePath });
  }
  const editor = await vscode.window.showTextDocument(document, { preview: true, selection: toVscodeRange(request.range) });
  editor.revealRange(toVscodeRange(request.range), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  return createIdeActionResult(request.requestId, "succeeded", "Workspace range revealed.", { action: request.action, workspaceRelativePath: request.workspaceRelativePath, range: request.range });
}

async function runVerificationCommandRequest(request: Extract<IdeActionRequest, { action: "runVerificationCommand" }>): Promise<HostMessage> {
  const commandSpec = verificationCommands[request.commandId];
  if (!commandSpec) {
    return createIdeActionResult(request.requestId, "rejected", "Verification command rejected by host policy.", { action: request.action, commandId: request.commandId });
  }
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length !== 1 || workspaceFolders[0].uri.scheme !== "file") {
    return createIdeActionResult(request.requestId, "unavailable", "Verification command requires exactly one local workspace folder.", createVerificationResultMetadata(request.commandId, 1, 0, "Verification command requires exactly one local workspace folder.", false));
  }
  if (pendingVerificationCommandIds.has(request.commandId)) {
    return createIdeActionResult(request.requestId, "rejected", "Verification command is already running.", createVerificationResultMetadata(request.commandId, 1, 0, "Verification command is already running.", false));
  }
  pendingVerificationCommandIds.add(request.commandId);
  try {
    const confirmed = await vscode.window.showWarningMessage(
      `Yet AI wants to run the allowlisted ${commandSpec.label} verification command in this workspace.`,
      { modal: true },
      verificationCommandConfirmationLabel,
    );
    if (confirmed !== verificationCommandConfirmationLabel) {
      return createIdeActionResult(request.requestId, "rejected", "Verification command denied by user.", createVerificationResultMetadata(request.commandId, 1, 0, "Verification command denied by user.", false));
    }
    const startedAt = Date.now();
    const result = await spawnVerificationCommand(commandSpec.command, commandSpec.args, workspaceFolders[0].uri.fsPath);
    const durationMs = Date.now() - startedAt;
    const status = result.exitCode === 0 ? "succeeded" : "failed";
    const message = result.exitCode === 0 ? "Verification command completed." : "Verification command failed.";
    return createIdeActionResult(request.requestId, status, message, createVerificationResultMetadata(request.commandId, result.exitCode, durationMs, result.outputTail, result.truncated));
  } finally {
    pendingVerificationCommandIds.delete(request.commandId);
  }
}

function createVerificationResultMetadata(commandId: VerificationCommandId, exitCode: number, durationMs: number, outputTail: string, truncated: boolean): { action: "runVerificationCommand"; commandId: VerificationCommandId; exitCode: number; durationMs: number; outputTail: string; truncated: boolean } {
  const sanitized = sanitizeVerificationOutputTail(outputTail);
  return {
    action: "runVerificationCommand",
    commandId,
    exitCode: clampExitCode(exitCode),
    durationMs: clampDurationMs(durationMs),
    outputTail: sanitized.outputTail,
    truncated: truncated || sanitized.truncated,
  };
}

function spawnVerificationCommand(command: string, args: string[], cwd: string): Promise<{ exitCode: number; outputTail: string; truncated: boolean }> {
  return new Promise((resolve) => {
    let completed = false;
    let output = "";
    let truncated = false;
    const child = spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true,
      env: { PATH: process.env.PATH ?? "" },
    });
    const finish = (exitCode: number, extraOutput = "") => {
      if (completed) {
        return;
      }
      completed = true;
      if (extraOutput.length > 0) {
        output = appendVerificationOutput(output, extraOutput).output;
        truncated = true;
      }
      clearTimeout(timeout);
      const sanitized = sanitizeVerificationOutputTail(output.length > 0 ? output : "Verification command produced no output.");
      resolve({ exitCode: clampExitCode(exitCode), outputTail: sanitized.outputTail, truncated: truncated || sanitized.truncated });
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(1, "\nVerification command timed out.");
    }, verificationCommandTimeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      const appended = appendVerificationOutput(output, chunk.toString("utf8"));
      output = appended.output;
      truncated = truncated || appended.truncated;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const appended = appendVerificationOutput(output, chunk.toString("utf8"));
      output = appended.output;
      truncated = truncated || appended.truncated;
    });
    child.on("error", () => finish(1, "Verification binary unavailable."));
    child.on("close", (code) => finish(code ?? 1));
  });
}

function appendVerificationOutput(current: string, next: string): { output: string; truncated: boolean } {
  const combined = current + next;
  if (combined.length <= maxVerificationOutputTailLength) {
    return { output: combined, truncated: false };
  }
  return { output: combined.slice(combined.length - maxVerificationOutputTailLength), truncated: true };
}

async function runWorkspaceSnippetSearchRequest(request: Extract<IdeActionRequest, { action: "searchWorkspaceSnippets" }>): Promise<HostMessage> {
  if (pendingWorkspaceSnippetSearchQueries.has(request.query)) {
    return createIdeActionResult(request.requestId, "rejected", "Workspace snippet search is already running.", { action: request.action });
  }
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length !== 1 || workspaceFolders[0].uri.scheme !== "file") {
    return createIdeActionResult(request.requestId, "unavailable", "Workspace snippet search requires exactly one local workspace folder.", { action: request.action });
  }
  pendingWorkspaceSnippetSearchQueries.add(request.query);
  try {
    const metadata = await searchWorkspaceSnippets(workspaceFolders[0], request.query);
    return createIdeActionResult(request.requestId, "succeeded", "Workspace snippet search completed.", metadata);
  } finally {
    pendingWorkspaceSnippetSearchQueries.delete(request.query);
  }
}

async function searchWorkspaceSnippets(workspaceFolder: vscode.WorkspaceFolder, query: string): Promise<WorkspaceSnippetSearchMetadata> {
  const files = await vscode.workspace.findFiles(
    new vscode.RelativePattern(workspaceFolder, "**/*"),
    "{**/.git/**,**/node_modules/**,**/dist/**,**/target/**,**/build/**,**/cache/**}",
    maxWorkspaceSnippetSearchFiles,
  );
  const snippets: WorkspaceSnippet[] = [];
  let truncated = files.length >= maxWorkspaceSnippetSearchFiles;
  const sortedFiles = files
    .map((uri) => ({ uri, workspaceRelativePath: workspaceSnippetRelativePath(workspaceFolder, uri) }))
    .filter((entry): entry is { uri: vscode.Uri; workspaceRelativePath: string } => entry.workspaceRelativePath !== undefined && !isExcludedWorkspaceSnippetPath(entry.workspaceRelativePath))
    .sort((left, right) => left.workspaceRelativePath.localeCompare(right.workspaceRelativePath, "en-US"));
  for (const { uri, workspaceRelativePath } of sortedFiles) {
    if (snippets.length >= maxWorkspaceSnippetSearchResults) {
      truncated = true;
      break;
    }
    const fileSnippets = await createWorkspaceFileSnippets(workspaceFolder, uri, workspaceRelativePath, query);
    if (fileSnippets.length === 0) {
      continue;
    }
    const remaining = maxWorkspaceSnippetSearchResults - snippets.length;
    snippets.push(...fileSnippets.slice(0, remaining));
    truncated = truncated || fileSnippets.length > remaining;
  }
  snippets.sort(compareWorkspaceSnippets);
  return {
    action: "searchWorkspaceSnippets",
    queryLabel: query,
    resultCount: snippets.length,
    snippets,
    truncated,
  };
}

async function createWorkspaceFileSnippets(workspaceFolder: vscode.WorkspaceFolder, uri: vscode.Uri, workspaceRelativePath: string, query: string): Promise<WorkspaceSnippet[]> {
  if (uri.scheme !== "file" || workspaceSnippetRelativePath(workspaceFolder, uri) !== workspaceRelativePath || isExcludedWorkspaceSnippetPath(workspaceRelativePath)) {
    return [];
  }
  let stat: vscode.FileStat;
  try {
    stat = await vscode.workspace.fs.stat(uri);
  } catch {
    return [];
  }
  if (stat.type !== vscode.FileType.File || stat.size > maxWorkspaceSnippetSearchFileBytes) {
    return [];
  }
  let bytes: Uint8Array;
  try {
    bytes = await vscode.workspace.fs.readFile(uri);
  } catch {
    return [];
  }
  if (isBinaryWorkspaceSnippetBytes(bytes)) {
    return [];
  }
  const text = Buffer.from(bytes).toString("utf8");
  if (hasBinaryLikeText(text)) {
    return [];
  }
  return createWorkspaceSnippetsFromText(workspaceRelativePath, text, query);
}

function createWorkspaceSnippetsFromText(workspaceRelativePath: string, text: string, query: string): WorkspaceSnippet[] {
  const snippets: WorkspaceSnippet[] = [];
  let searchFrom = 0;
  while (snippets.length < maxWorkspaceSnippetSearchSnippetsPerFile) {
    const matchIndex = text.indexOf(query, searchFrom);
    if (matchIndex === -1) {
      break;
    }
    const snippetStart = Math.max(0, matchIndex - Math.floor((maxWorkspaceSnippetSearchSnippetLength - query.length) / 2));
    const snippetEnd = Math.min(text.length, snippetStart + maxWorkspaceSnippetSearchSnippetLength);
    const snippetText = sanitizeWorkspaceSnippetText(text.slice(snippetStart, snippetEnd));
    if (snippetText !== undefined) {
      const start = positionAtTextOffset(text, matchIndex);
      const end = positionAtTextOffset(text, matchIndex + query.length);
      snippets.push({
        workspaceRelativePath,
        languageId: languageIdForWorkspaceSnippetPath(workspaceRelativePath),
        range: { start, end },
        text: snippetText,
      });
    }
    searchFrom = matchIndex + Math.max(query.length, 1);
  }
  return snippets.sort(compareWorkspaceSnippets);
}

function compareWorkspaceSnippets(left: WorkspaceSnippet, right: WorkspaceSnippet): number {
  const pathOrder = left.workspaceRelativePath.localeCompare(right.workspaceRelativePath, "en-US");
  if (pathOrder !== 0) {
    return pathOrder;
  }
  return comparePositions(left.range.start, right.range.start);
}

function languageIdForWorkspaceSnippetPath(workspaceRelativePath: string): string {
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

function workspaceSnippetRelativePath(workspaceFolder: vscode.WorkspaceFolder, uri: vscode.Uri): string | undefined {
  if (uri.scheme !== "file") {
    return undefined;
  }
  const relativePath = path.relative(workspaceFolder.uri.fsPath, uri.fsPath).replaceAll(path.sep, "/");
  if (relativePath.length === 0 || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return undefined;
  }
  return sanitizeRelativePath(relativePath, 512);
}

function isExcludedWorkspaceSnippetPath(workspaceRelativePath: string): boolean {
  return workspaceRelativePath.split("/").some((segment) => segment === ".git" || segment === "node_modules" || segment === "dist" || segment === "target" || segment === "build" || segment === "cache");
}

function isBinaryWorkspaceSnippetBytes(bytes: Uint8Array): boolean {
  const sampleLength = Math.min(bytes.length, 8000);
  for (let index = 0; index < sampleLength; index += 1) {
    const byte = bytes[index];
    if (byte === 0 || (byte < 9 || (byte > 13 && byte < 32))) {
      return true;
    }
  }
  return false;
}

function positionAtTextOffset(text: string, targetOffset: number): ApplyWorkspacePosition {
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

function createActiveFileExcerptResult(requestId: string): HostMessage {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return createIdeActionResult(requestId, "unavailable", "Active file excerpt is unavailable in this surface.", { action: "getActiveFileExcerpt" });
  }
  const attachment = createActiveFileExcerptAttachment(editor);
  if (!attachment) {
    return createIdeActionResult(requestId, "rejected", "Active file excerpt rejected by host policy.", { action: "getActiveFileExcerpt" });
  }
  return createIdeActionResult(requestId, "succeeded", "Active file excerpt ready.", { action: "getActiveFileExcerpt", contextAttachment: attachment });
}

function createActiveFileExcerptAttachment(editor: vscode.TextEditor): ActiveFileExcerptAttachment | undefined {
  const document = editor.document;
  if (document.isUntitled || document.uri.scheme !== "file") {
    return undefined;
  }
  const workspaceRelativePath = activeDocumentWorkspaceRelativePath(document);
  if (!workspaceRelativePath) {
    return undefined;
  }
  const sourceRange = activeFileExcerptSourceRange(editor);
  if (!sourceRange) {
    return undefined;
  }
  const excerpt = createBoundedActiveFileExcerpt(document, sourceRange);
  if (!excerpt) {
    return undefined;
  }
  const languageId = sanitizeLanguageId(document.languageId);
  return {
    kind: "active_file_excerpt",
    source: "vscode",
    file: {
      displayPath: workspaceRelativePath,
      workspaceRelativePath,
      ...(languageId ? { languageId } : {}),
    },
    range: excerpt.range,
    text: excerpt.text,
    truncated: excerpt.truncated,
  };
}

function activeDocumentWorkspaceRelativePath(document: vscode.TextDocument): string | undefined {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return undefined;
  }
  const matches = workspaceFolders
    .filter((folder) => folder.uri.scheme === "file")
    .map((folder) => path.relative(folder.uri.fsPath, document.uri.fsPath).replaceAll(path.sep, "/"))
    .filter((relativePath) => relativePath.length > 0 && !relativePath.startsWith("..") && !path.isAbsolute(relativePath))
    .map((relativePath) => sanitizeRelativePath(relativePath, 512))
    .filter((relativePath): relativePath is string => relativePath !== undefined);
  return matches.length === 1 ? matches[0] : undefined;
}

function activeFileExcerptSourceRange(editor: vscode.TextEditor): vscode.Range | undefined {
  if (!editor.selection.isEmpty) {
    return editor.selection;
  }
  const visibleRange = editor.visibleRanges[0];
  if (visibleRange && !visibleRange.isEmpty) {
    return visibleRange;
  }
  const line = editor.document.lineAt(editor.selection.active.line);
  if (line.text.length === 0) {
    return undefined;
  }
  return new vscode.Range(line.range.start, line.range.end);
}

function createBoundedActiveFileExcerpt(document: vscode.TextDocument, sourceRange: vscode.Range): { range: ApplyWorkspaceTextReplacement["range"]; text: string; truncated: boolean } | undefined {
  const range = toStrictRange(sourceRange);
  if (!range || !isRangeWithinDocument(range, document) || isZeroLengthRange(range)) {
    return undefined;
  }
  const startOffset = document.offsetAt(toVscodePosition(range.start));
  const endOffset = document.offsetAt(toVscodePosition(range.end));
  if (endOffset <= startOffset) {
    return undefined;
  }
  const boundedEndOffset = Math.min(endOffset, startOffset + maxActiveFileExcerptTextLength);
  const boundedRange = {
    start: range.start,
    end: toStrictPosition(document.positionAt(boundedEndOffset)),
  };
  if (!isStrictRange(boundedRange) || isZeroLengthRange(boundedRange)) {
    return undefined;
  }
  const text = document.getText(toVscodeRange(boundedRange));
  const sanitizedText = sanitizeActiveFileExcerptText(text);
  if (sanitizedText === undefined) {
    return undefined;
  }
  return {
    range: boundedRange,
    text: sanitizedText,
    truncated: boundedEndOffset < endOffset,
  };
}

function toStrictRange(range: vscode.Range): ApplyWorkspaceTextReplacement["range"] | undefined {
  const strictRange = {
    start: {
      line: range.start.line,
      character: range.start.character,
    },
    end: {
      line: range.end.line,
      character: range.end.character,
    },
  };
  return isStrictRange(strictRange) ? strictRange : undefined;
}

function toVscodeRange(range: ApplyWorkspaceTextReplacement["range"]): vscode.Range {
  return new vscode.Range(new vscode.Position(range.start.line, range.start.character), new vscode.Position(range.end.line, range.end.character));
}

function toVscodePosition(position: ApplyWorkspacePosition): vscode.Position {
  return new vscode.Position(position.line, position.character);
}

function toStrictPosition(position: vscode.Position): ApplyWorkspacePosition {
  return {
    line: position.line,
    character: position.character,
  };
}

function createIdeActionContextMetadata(): Record<string, unknown> {
  return {
    source: "vscode",
    hasActiveEditor: vscode.window.activeTextEditor !== undefined,
    workspaceFolderCount: Math.min(vscode.workspace.workspaceFolders?.length ?? 0, 100),
  };
}

export async function handleApplyWorkspaceEditRequest(webview: vscode.Webview, message: GuiMessage): Promise<void> {
  const requestId = typeof message.requestId === "string" ? message.requestId : "invalid-request";
  const validatedRequest = parseApplyWorkspaceEditRequest(message);
  if (!validatedRequest) {
    await webview.postMessage(createApplyWorkspaceEditResult(requestId, "rejected", "Edit request rejected by host policy."));
    return;
  }

  const validatedEdit = await validateWorkspaceEditBeforeApply(validatedRequest);
  if (!validatedEdit) {
    await webview.postMessage(createApplyWorkspaceEditResult(validatedRequest.requestId, "rejected", "Edit request rejected by host policy."));
    return;
  }

  const confirmed = await vscode.window.showWarningMessage(
    `Yet AI wants to apply ${validatedEdit.editCount} confirmed text edit${validatedEdit.editCount === 1 ? "" : "s"} to ${validatedEdit.files.length} workspace file${validatedEdit.files.length === 1 ? "" : "s"}: ${validatedEdit.summary}`,
    { modal: true },
    applyWorkspaceEditConfirmationLabel,
  );
  if (confirmed !== applyWorkspaceEditConfirmationLabel) {
    await webview.postMessage(createApplyWorkspaceEditResult(validatedEdit.requestId, "denied", "Edit request denied by user."));
    return;
  }

  const workspaceEdit = new vscode.WorkspaceEdit();
  for (const fileEdit of validatedEdit.files) {
    for (const textReplacement of fileEdit.textReplacements) {
      workspaceEdit.replace(
        fileEdit.uri,
        new vscode.Range(
          new vscode.Position(textReplacement.range.start.line, textReplacement.range.start.character),
          new vscode.Position(textReplacement.range.end.line, textReplacement.range.end.character),
        ),
        textReplacement.replacementText,
      );
    }
  }

  try {
    const applied = await vscode.workspace.applyEdit(workspaceEdit);
    if (!applied) {
      await webview.postMessage(createApplyWorkspaceEditResult(validatedEdit.requestId, "failed", "Edit request failed during apply."));
      return;
    }
    await webview.postMessage(createApplyWorkspaceEditResult(validatedEdit.requestId, "applied", "Edit request applied.", validatedEdit.editCount, validatedEdit.files.map((file) => file.workspaceRelativePath)));
  } catch {
    await webview.postMessage(createApplyWorkspaceEditResult(validatedEdit.requestId, "failed", "Edit request failed during apply."));
  }
}

export async function validateWorkspaceEditBeforeApply(request: ApplyWorkspaceEditRequest): Promise<ValidatedWorkspaceEdit | undefined> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return undefined;
  }

  const files: ValidatedWorkspaceFileEdit[] = [];
  const seenWorkspaceRelativePaths = new Set<string>();
  let editCount = 0;
  for (const fileEdit of request.edits) {
    if (seenWorkspaceRelativePaths.has(fileEdit.workspaceRelativePath)) {
      return undefined;
    }
    seenWorkspaceRelativePaths.add(fileEdit.workspaceRelativePath);
    const uri = await resolveExistingWorkspaceFile(fileEdit.workspaceRelativePath, workspaceFolders);
    if (!uri) {
      return undefined;
    }
    const document = await vscode.workspace.openTextDocument(uri);
    if (!document || document.isUntitled) {
      return undefined;
    }
    if (hasOverlappingTextReplacements(fileEdit.textReplacements)) {
      return undefined;
    }
    for (const textReplacement of fileEdit.textReplacements) {
      if (!isRangeWithinDocument(textReplacement.range, document)) {
        return undefined;
      }
      editCount += 1;
    }
    files.push({
      workspaceRelativePath: fileEdit.workspaceRelativePath,
      uri,
      textReplacements: fileEdit.textReplacements,
    });
  }

  return {
    requestId: request.requestId,
    summary: request.summary,
    files,
    editCount,
  };
}

function parseApplyWorkspaceEditRequest(message: GuiMessage): ApplyWorkspaceEditRequest | undefined {
  if (
    message.type !== "gui.applyWorkspaceEditRequest" ||
    !isRequiredRequestId(message.requestId) ||
    !isPlainRecord(message.payload) ||
    !hasOnlyKeys(message.payload, ["requiresUserConfirmation", "summary", "cloudRequired", "edits"]) ||
    message.payload.requiresUserConfirmation !== true ||
    (message.payload.cloudRequired !== undefined && message.payload.cloudRequired !== false) ||
    !isSafeSummary(message.payload.summary) ||
    !Array.isArray(message.payload.edits) ||
    message.payload.edits.length < 1 ||
    message.payload.edits.length > 4
  ) {
    return undefined;
  }

  let totalReplacementText = 0;
  const edits: ApplyWorkspaceFileEdit[] = [];
  for (const fileEdit of message.payload.edits) {
    if (
      !isPlainRecord(fileEdit) ||
      !hasOnlyKeys(fileEdit, ["workspaceRelativePath", "textReplacements"]) ||
      !isStrictSafeRelativePath(fileEdit.workspaceRelativePath) ||
      !Array.isArray(fileEdit.textReplacements) ||
      fileEdit.textReplacements.length < 1 ||
      fileEdit.textReplacements.length > 16
    ) {
      return undefined;
    }

    const textReplacements: ApplyWorkspaceTextReplacement[] = [];
    for (const textReplacement of fileEdit.textReplacements) {
      if (
        !isPlainRecord(textReplacement) ||
        !hasOnlyKeys(textReplacement, ["range", "replacementText"]) ||
        !isStrictRange(textReplacement.range) ||
        typeof textReplacement.replacementText !== "string" ||
        textReplacement.replacementText.length > 8192
      ) {
        return undefined;
      }
      totalReplacementText += textReplacement.replacementText.length;
      if (totalReplacementText > 32768) {
        return undefined;
      }
      textReplacements.push({
        range: textReplacement.range,
        replacementText: textReplacement.replacementText,
      });
    }

    edits.push({
      workspaceRelativePath: fileEdit.workspaceRelativePath,
      textReplacements,
    });
  }

  return {
    requestId: message.requestId,
    summary: message.payload.summary,
    edits,
  };
}

export function parseIdeActionRequest(message: GuiMessage): IdeActionRequest | undefined {
  if (message.type !== "gui.ideActionRequest" || !isRequiredRequestId(message.requestId) || !isPlainRecord(message.payload)) {
    return undefined;
  }
  if (hasOnlyKeys(message.payload, ["action"]) && message.payload.action === "getContextSnapshot") {
    return { requestId: message.requestId, action: "getContextSnapshot" };
  }
  if (hasOnlyKeys(message.payload, ["action"]) && message.payload.action === "getActiveFileExcerpt") {
    return { requestId: message.requestId, action: "getActiveFileExcerpt" };
  }
  if (
    hasOnlyKeys(message.payload, ["action", "workspaceRelativePath"]) &&
    message.payload.action === "openWorkspaceFile" &&
    isStrictSafeRelativePath(message.payload.workspaceRelativePath)
  ) {
    return { requestId: message.requestId, action: "openWorkspaceFile", workspaceRelativePath: message.payload.workspaceRelativePath };
  }
  if (
    hasOnlyKeys(message.payload, ["action", "workspaceRelativePath", "range"]) &&
    message.payload.action === "revealWorkspaceRange" &&
    isStrictSafeRelativePath(message.payload.workspaceRelativePath) &&
    isStrictRange(message.payload.range)
  ) {
    return { requestId: message.requestId, action: "revealWorkspaceRange", workspaceRelativePath: message.payload.workspaceRelativePath, range: message.payload.range };
  }
  if (
    hasOnlyKeys(message.payload, ["action", "commandId"]) &&
    message.payload.action === "runVerificationCommand" &&
    isVerificationCommandId(message.payload.commandId)
  ) {
    return { requestId: message.requestId, action: "runVerificationCommand", commandId: message.payload.commandId };
  }
  if (
    hasOnlyKeys(message.payload, ["action", "query"]) &&
    message.payload.action === "searchWorkspaceSnippets" &&
    isWorkspaceSnippetSearchQuery(message.payload.query)
  ) {
    return { requestId: message.requestId, action: "searchWorkspaceSnippets", query: message.payload.query };
  }
  return undefined;
}

async function resolveExistingWorkspaceFile(workspaceRelativePath: string, workspaceFolders: readonly vscode.WorkspaceFolder[], maxFileBytes?: number): Promise<vscode.Uri | undefined> {
  const segments = workspaceRelativePath.split("/");
  const matches: vscode.Uri[] = [];
  for (const workspaceFolder of workspaceFolders) {
    const uri = vscode.Uri.joinPath(workspaceFolder.uri, ...segments);
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type === vscode.FileType.File && (maxFileBytes === undefined || stat.size <= maxFileBytes)) {
        matches.push(uri);
      }
    } catch {
      continue;
    }
  }
  return matches.length === 1 ? matches[0] : undefined;
}

function isRangeWithinDocument(range: ApplyWorkspaceTextReplacement["range"], document: vscode.TextDocument): boolean {
  if (!isStrictRange(range) || range.start.line >= document.lineCount || range.end.line >= document.lineCount) {
    return false;
  }
  return range.start.character <= document.lineAt(range.start.line).text.length && range.end.character <= document.lineAt(range.end.line).text.length;
}

function hasOverlappingTextReplacements(textReplacements: ApplyWorkspaceTextReplacement[]): boolean {
  const sorted = [...textReplacements].sort((left, right) => comparePositions(left.range.start, right.range.start));
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (comparePositions(previous.range.start, current.range.start) === 0 && (isZeroLengthRange(previous.range) || isZeroLengthRange(current.range))) {
      return true;
    }
    if (comparePositions(previous.range.end, current.range.start) > 0) {
      return true;
    }
  }
  return false;
}

function isZeroLengthRange(range: ApplyWorkspaceTextReplacement["range"]): boolean {
  return comparePositions(range.start, range.end) === 0;
}

function comparePositions(left: ApplyWorkspacePosition, right: ApplyWorkspacePosition): number {
  if (left.line !== right.line) {
    return left.line - right.line;
  }
  return left.character - right.character;
}

function isStrictRange(value: unknown): value is ApplyWorkspaceTextReplacement["range"] {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["start", "end"]) || !isStrictPosition(value.start) || !isStrictPosition(value.end)) {
    return false;
  }
  return value.end.line > value.start.line || (value.end.line === value.start.line && value.end.character >= value.start.character);
}

function isStrictPosition(value: unknown): value is ApplyWorkspacePosition {
  return isPlainRecord(value) && hasOnlyKeys(value, ["line", "character"]) && isBoundedInteger(value.line) && isBoundedInteger(value.character);
}

function isBoundedInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value >= 0 && value <= 1000000;
}

function isStrictSafeRelativePath(value: unknown): value is string {
  return typeof value === "string" && sanitizeRelativePath(value, 512) === value;
}

function isSafeSummary(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1000 && !hasSecretLikeText(value) && !hasBinaryLikeText(value) && !hasPrivatePathLikeText(value);
}

function isRequiredRequestId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value) && !hasSecretRequestIdMarker(value);
}

function isVerificationCommandId(value: unknown): value is VerificationCommandId {
  return value === "repository-check" || value === "gui-app-tests" || value === "engine-chat-tests";
}

function isWorkspaceSnippetSearchQuery(value: unknown): value is string {
  return typeof value === "string" && sanitizeWorkspaceSnippetSearchQuery(value) === value;
}

function sanitizeWorkspaceSnippetSearchQuery(value: string): string | undefined {
  if (value.length === 0 || value.length > 120 || !/\S/.test(value) || /[\u0000-\u001f\u007f-\u009f]/.test(value) || /[*/\\~]/.test(value) || value.includes("..") || /[{}[\]()^$+?|]/.test(value) || /[;&`$<>]/.test(value) || /\b(?:cwd|env|shell|git|tool|provider|model|apiKey|requestId|assistant|regex|glob|path)\b/.test(value) || hasSecretLikeText(value) || hasPrivatePathLikeText(value) || /[A-Za-z]:/.test(value)) {
    return undefined;
  }
  return value;
}

function sanitizeWorkspaceSnippetText(value: string): string | undefined {
  const text = value.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "");
  if (text.length === 0 || text.length > maxWorkspaceSnippetSearchSnippetLength || hasSecretLikeText(text) || hasPrivatePathLikeText(text) || hasBinaryLikeText(text)) {
    return undefined;
  }
  return text;
}

function sanitizeWorkspaceSnippets(values: WorkspaceSnippet[]): WorkspaceSnippet[] {
  return values
    .map((snippet) => {
      const workspaceRelativePath = sanitizeRelativePath(snippet.workspaceRelativePath, 512);
      const languageId = sanitizeLanguageId(snippet.languageId);
      const text = sanitizeWorkspaceSnippetText(snippet.text);
      if (!workspaceRelativePath || !languageId || !isStrictRange(snippet.range) || text === undefined) {
        return undefined;
      }
      return { workspaceRelativePath, languageId, range: snippet.range, text };
    })
    .filter((snippet): snippet is WorkspaceSnippet => snippet !== undefined)
    .slice(0, maxWorkspaceSnippetSearchResults);
}

function isBoundedSnippetResultCount(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value >= 0 && value <= maxWorkspaceSnippetSearchResults;
}

function clampWorkspaceSnippetResultCount(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    return 0;
  }
  return Math.min(value, maxWorkspaceSnippetSearchResults);
}

function sanitizeApplyWorkspaceEditResultMessage(value: string): string {
  if (value.length === 0 || value.length > 1000 || hasSecretLikeText(value) || hasPrivatePathLikeText(value) || hasBinaryLikeText(value)) {
    return "Edit request status changed.";
  }
  return value;
}

function sanitizeIdeActionStatusMessage(value: string): string {
  if (value.length === 0 || value.length > 1000 || hasSecretLikeText(value) || hasPrivatePathLikeText(value) || hasBinaryLikeText(value)) {
    return "IDE action status changed.";
  }
  return value;
}

function sanitizeVerificationOutputTail(value: string): { outputTail: string; truncated: boolean } {
  let outputTail = value.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "");
  let truncated = false;
  if (outputTail.length > maxVerificationOutputTailLength) {
    outputTail = outputTail.slice(outputTail.length - maxVerificationOutputTailLength);
    truncated = true;
  }
  if (outputTail.length === 0 || hasSecretLikeText(outputTail) || hasPrivatePathLikeText(outputTail)) {
    return { outputTail: "Verification output hidden by host policy.", truncated: true };
  }
  return { outputTail, truncated };
}

function clampExitCode(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    return 1;
  }
  return Math.min(value, 255);
}

function clampDurationMs(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    return 0;
  }
  return Math.min(value, 3600000);
}

function clampAppliedEditCount(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    return 0;
  }
  return Math.min(value, 64);
}

function createActiveEditorContextPayload(): HostContextPayload {
  const payload: HostContextPayload = {
    kind: "active_editor",
    source: "vscode",
  };
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return payload;
  }

  const file = createActiveEditorFileContext(editor.document);
  if (file) {
    payload.file = file;
  }

  const selection = createActiveEditorSelectionContext(editor.document, editor.selection);
  if (selection) {
    payload.selection = selection;
  }

  return payload;
}

function createActiveEditorFileContext(document: vscode.TextDocument): HostContextPayload["file"] | undefined {
  const file: NonNullable<HostContextPayload["file"]> = {};
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  const workspaceRelativePath = workspaceFolder ? sanitizeRelativePath(vscode.workspace.asRelativePath(document.uri, false), 512) : undefined;
  const displayPath = workspaceRelativePath ?? sanitizeDisplayPath(getDocumentDisplayLabel(document));
  const languageId = sanitizeLanguageId(document.languageId);

  if (displayPath) {
    file.displayPath = displayPath;
  }
  if (workspaceRelativePath) {
    file.workspaceRelativePath = workspaceRelativePath;
  }
  if (languageId) {
    file.languageId = languageId;
  }

  return Object.keys(file).length > 0 ? file : undefined;
}

function createActiveEditorSelectionContext(document: vscode.TextDocument, selection: vscode.Selection): HostContextPayload["selection"] | undefined {
  if (selection.isEmpty) {
    return undefined;
  }
  const startLine = sanitizePositionNumber(selection.start.line);
  const startCharacter = sanitizePositionNumber(selection.start.character);
  const endLine = sanitizePositionNumber(selection.end.line);
  const endCharacter = sanitizePositionNumber(selection.end.character);
  if (startLine === undefined || startCharacter === undefined || endLine === undefined || endCharacter === undefined) {
    return undefined;
  }

  const text = sanitizeSelectionText(document.getText(selection));
  const result: NonNullable<HostContextPayload["selection"]> = {
    startLine,
    startCharacter,
    endLine,
    endCharacter,
  };
  if (text !== undefined) {
    result.text = text;
  }
  return result;
}

export function renderWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  identity: ProductIdentity,
  connection: EngineConnection,
): string {
  const nonce = createNonce();
  const guiDevOrigin = connection.guiDevUrl
    ? getLoopbackOrigin(connection.guiDevUrl, `${configurationPrefix}.guiDevUrl`)
    : undefined;
  const packagedGui = connection.guiDevUrl ? undefined : findPackagedGui(extensionUri);
  const bootstrap = serializeScriptJson({
    bridgeVersion,
    requestId: createRequestId(),
    productId: identity.product.id,
    displayName: identity.product.displayName,
    runtimeUrl: connection.runtimeUrl,
    cloudRequired: false,
    guiDevOrigin,
  });
  const frameSource = connection.guiDevUrl
    ? `<iframe title="${escapeHtml(identity.vscode.displayName)} GUI" src="${escapeHtml(connection.guiDevUrl)}"></iframe>`
    : "";
  const placeholder = connection.guiDevUrl || packagedGui ? "" : `<main><h1>${escapeHtml(identity.vscode.displayName)}</h1><p>Local runtime shell is ready.</p><p>Runtime: <code>${escapeHtml(connection.runtimeUrl)}</code></p><p>Run <code>cd apps/gui && npm run build</code> and <code>cd apps/plugins/vscode && npm run copy:gui</code> to package the GUI, or set <code>yetai.guiDevUrl</code> to a loopback Vite dev server during development.</p></main>`;
  const packagedGuiHtml = packagedGui ? rewritePackagedGuiHtml(packagedGui.html, packagedGui.root, webview) : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src ${webview.cspSource} 'nonce-${nonce}'; connect-src http://127.0.0.1:* http://localhost:* http://[::1]:* https://127.0.0.1:* https://localhost:* https://[::1]:*; frame-src http://127.0.0.1:* http://localhost:* http://[::1]:* https://127.0.0.1:* https://localhost:* https://[::1]:*;">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(identity.vscode.displayName)}</title>
<style nonce="${nonce}">
body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; }
main { padding: 24px; }
code { color: var(--vscode-textLink-foreground); }
iframe { width: 100vw; height: 100vh; border: 0; }
</style>
</head>
<body>
${placeholder}${frameSource}${packagedGuiHtml}
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const bootstrap = ${bootstrap};
window.yetAiBootstrap = bootstrap;
const frame = document.querySelector("iframe");
const frameTargetOrigin = bootstrap.guiDevOrigin;
const maxForwardedApplyWorkspaceEditMessageBytes = ${maxForwardedApplyWorkspaceEditMessageBytes};
const maxForwardedIdeActionMessageBytes = ${maxForwardedIdeActionMessageBytes};
const maxForwardedControlledFileReadMessageBytes = ${maxForwardedControlledFileReadMessageBytes};
const maxForwardedControlledAgentEditMessageBytes = ${maxForwardedControlledAgentEditMessageBytes};
let latestHostReady;
let frameReady = false;
const isPlainObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const hasSecretRequestIdMarker = (value) => /authorization|bearer|api[_-]?key|token|secret|access[_-]?token|provider[_-]?key|openai[_-]?api[_-]?key|sk-(?:proj-)?[A-Za-z0-9_-]{8,}/i.test(value);
const isBoundedRequestId = (value) => value === undefined || (typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value) && !hasSecretRequestIdMarker(value));
const isRequiredRequestId = (value) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value) && !hasSecretRequestIdMarker(value);
const isBoundedForwardedApplyWorkspaceEditMessage = (value) => {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length <= maxForwardedApplyWorkspaceEditMessageBytes;
  } catch {
    return false;
  }
};
const isBoundedForwardedIdeActionMessage = (value) => {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length <= maxForwardedIdeActionMessageBytes;
  } catch {
    return false;
  }
};
const isBoundedForwardedControlledFileReadMessage = (value) => {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length <= maxForwardedControlledFileReadMessageBytes;
  } catch {
    return false;
  }
};
const isBoundedForwardedControlledAgentEditMessage = (value) => {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length <= maxForwardedControlledAgentEditMessageBytes;
  } catch {
    return false;
  }
};
const isStrictGuiReadyPayload = (payload) => {
  if (payload === undefined) {
    return true;
  }
  return isPlainObject(payload) && Object.keys(payload).every((key) => key === "supportedBridgeVersion") && (payload.supportedBridgeVersion === undefined || payload.supportedBridgeVersion === bootstrap.bridgeVersion);
};
const isSecretLikePathSegment = (value) => /^(?:auth|authorization|bearer|cookie|credential|credentials|password|secret|token|access[_-]?token|api[_-]?key)(?:\.|-|_|$)/i.test(value) || /(?:^|[._-])(?:auth|credential|credentials|password|secret|token|access[_-]?token|api[_-]?key)(?:[._-]|$)/i.test(value) || /^sk-(?:proj-)?[A-Za-z0-9_-]{8,}/i.test(value);
const isStrictSafeRelativePath = (value) => typeof value === "string" && value.length > 0 && value.length <= 512 && !value.startsWith("/") && !value.startsWith("~") && !value.includes("%") && !value.includes("\\\\") && !value.includes(":") && !value.includes("?") && !value.includes("#") && !/[\u0000-\u001f\u007f-\u009f]/.test(value) && !/(^|\/)\.\.?(\/|$)/.test(value) && !value.includes("//") && !value.endsWith("/") && !value.split("/").some(isSecretLikePathSegment);
const isControlledFileReadPath = (value) => isStrictSafeRelativePath(value) && value.length <= 180 && !value.split("/").some((segment) => segment.startsWith(".") || ["node_modules", "vendor", "dist", "build", "out", "target", "coverage", "generated", "tmp", "temp"].includes(segment) || /auth|credential|password|secret|token|access[_-]?token|api[_-]?key|^\.env$/i.test(segment));
const isControlledFileReadId = (value) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value) && !/assistant|sk-(?:proj-)?/i.test(value);
const isControlledFileReadPayload = (payload) => isPlainObject(payload) && Object.keys(payload).every((key) => ["requestIdMintedBy", "source", "assistantMinted", "controlledWorkspaceId", "runId", "runtimeSessionId", "sessionId", "workspaceRelativePath", "maxBytes", "maxLines", "allowBody", "singleFileOnly", "recursive", "globAllowed", "regexAllowed", "indexingAllowed"].includes(key)) && payload.requestIdMintedBy === "gui" && payload.source === "gui" && payload.assistantMinted === false && isControlledFileReadId(payload.controlledWorkspaceId) && isControlledFileReadId(payload.runId) && (payload.runtimeSessionId === undefined || isControlledFileReadId(payload.runtimeSessionId)) && (payload.sessionId === undefined || isControlledFileReadId(payload.sessionId)) && isControlledFileReadPath(payload.workspaceRelativePath) && Number.isInteger(payload.maxBytes) && payload.maxBytes >= 1 && payload.maxBytes <= 8192 && Number.isInteger(payload.maxLines) && payload.maxLines >= 1 && payload.maxLines <= 240 && typeof payload.allowBody === "boolean" && payload.singleFileOnly === true && payload.recursive === false && payload.globAllowed === false && payload.regexAllowed === false && payload.indexingAllowed === false;
const isControlledAgentEditId = (value) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(value) && !/assistant|sk-(?:proj-)?/i.test(value);
const isSha256Hash = (value) => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
const isControlledAgentEditPath = (value) => isStrictSafeRelativePath(value) && value.length <= 180 && !value.split("/").some((segment) => segment.startsWith(".") || ["node_modules", "vendor", "dist", "build", "out", "target", "coverage", "__pycache__", "generated", "tmp", "temp", "secret", "secrets", "credential", "credentials", "private"].includes(segment) || /auth|credential|password|secret|token|access[_-]?token|api[_-]?key|^\.env$/i.test(segment));
const isControlledAgentEditSafeSummary = (value) => typeof value === "string" && value.length > 0 && value.length <= 240 && !/[\u0000-\u001f\u007f-\u009f]/.test(value) && !/(?:api[_-]?key|authorization|bearer|cookie|token|secret|password|raw|provider|shell|command|cwd|env|git|tool|network|chmod|symlink|binary|create|delete|rename|move|sk-(?:proj-)?[A-Za-z0-9_-]{8,})/i.test(value) && !/(?:\/(?:Users|home|tmp|var|Volumes|Private|etc|opt|mnt)(?=\/|$|[^A-Za-z0-9_])|~[\/\\]|[A-Za-z]:[\/\\])/i.test(value);
const isControlledAgentEditLimits = (value) => isPlainObject(value) && Object.keys(value).every((key) => ["maxFiles", "maxEdits", "maxPatchBytes"].includes(key)) && Number.isInteger(value.maxFiles) && value.maxFiles >= 1 && value.maxFiles <= 4 && Number.isInteger(value.maxEdits) && value.maxEdits >= 1 && value.maxEdits <= 16 && Number.isInteger(value.maxPatchBytes) && value.maxPatchBytes >= 1 && value.maxPatchBytes <= 12000;
const isControlledAgentReplacementEdit = (value) => isPlainObject(value) && Object.keys(value).every((key) => ["operation", "workspaceRelativePath", "fileLabel", "expectedContentHash", "startLine", "endLine", "replacementText", "replacementByteCount", "sanitizedSummary"].includes(key)) && value.operation === "replace" && isControlledAgentEditPath(value.workspaceRelativePath) && value.fileLabel === value.workspaceRelativePath && isSha256Hash(value.expectedContentHash) && Number.isInteger(value.startLine) && value.startLine >= 1 && value.startLine <= 1000000 && Number.isInteger(value.endLine) && value.endLine >= value.startLine && value.endLine <= 1000000 && typeof value.replacementText === "string" && new TextEncoder().encode(value.replacementText).length <= 12000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value.replacementText) && !/(?:authorization|bearer|api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|credential|cookie|BEGIN [A-Z ]*PRIVATE KEY|sk-(?:proj-)?[A-Za-z0-9_-]{8,})/i.test(value.replacementText) && Number.isInteger(value.replacementByteCount) && value.replacementByteCount >= 0 && value.replacementByteCount <= 12000 && new TextEncoder().encode(value.replacementText).length === value.replacementByteCount && isControlledAgentEditSafeSummary(value.sanitizedSummary);
const isControlledAgentEditPayload = (payload) => isPlainObject(payload) && Object.keys(payload).every((key) => ["requestId", "requestIdMintedBy", "source", "assistantMinted", "controlledWorkspaceId", "runId", "runtimeSessionId", "sessionId", "workspaceReadinessId", "userConfirmed", "limits", "edits"].includes(key)) && isControlledAgentEditId(payload.requestId) && payload.requestIdMintedBy === "gui" && payload.source === "gui" && payload.assistantMinted === false && isControlledAgentEditId(payload.controlledWorkspaceId) && isControlledAgentEditId(payload.runId) && (payload.runtimeSessionId === undefined || isControlledAgentEditId(payload.runtimeSessionId)) && (payload.sessionId === undefined || isControlledAgentEditId(payload.sessionId)) && isControlledAgentEditId(payload.workspaceReadinessId) && payload.userConfirmed === true && isControlledAgentEditLimits(payload.limits) && Array.isArray(payload.edits) && payload.edits.length >= 1 && payload.edits.length <= payload.limits.maxEdits && new Set(payload.edits.map((edit) => isPlainObject(edit) ? edit.workspaceRelativePath : undefined)).size <= payload.limits.maxFiles && payload.edits.reduce((total, edit) => total + (isPlainObject(edit) && Number.isInteger(edit.replacementByteCount) ? edit.replacementByteCount : 12001), 0) <= payload.limits.maxPatchBytes && payload.edits.every(isControlledAgentReplacementEdit);
const isStrictPosition = (value) => isPlainObject(value) && Object.keys(value).every((key) => key === "line" || key === "character") && Number.isInteger(value.line) && Number.isInteger(value.character) && value.line >= 0 && value.line <= 1000000 && value.character >= 0 && value.character <= 1000000;
const isStrictRange = (value) => isPlainObject(value) && Object.keys(value).every((key) => key === "start" || key === "end") && isStrictPosition(value.start) && isStrictPosition(value.end) && (value.end.line > value.start.line || (value.end.line === value.start.line && value.end.character >= value.start.character));
const isVerificationCommandId = (value) => value === "repository-check" || value === "gui-app-tests" || value === "engine-chat-tests";
const isWorkspaceSnippetSearchQuery = (value) => typeof value === "string" && value.length > 0 && value.length <= 120 && /\S/.test(value) && !/[\u0000-\u001f\u007f-\u009f]/.test(value) && !/[*/\\~]/.test(value) && !value.includes("..") && !/[{}[\]()^$+?|]/.test(value) && !/[;&\`$<>]/.test(value) && !/\b(?:cwd|env|shell|git|tool|provider|model|apiKey|requestId|assistant|regex|glob|path)\b/.test(value) && !/(?:authorization|bearer|cookie|api[_-]?key|token|secret|password|private[_-]?path|provider[_-]?response|raw[_-]?prompt|file[_-]?content|sk-(?:proj-)?[A-Za-z0-9_-]{8,})/i.test(value) && !/(?:\/(?:Users|home|tmp|var|Volumes|Private|etc|opt|mnt)(?=\/|$|[^A-Za-z0-9_])|~[\/\\]|[A-Za-z]:[\/\\])/.test(value) && !/[A-Za-z]:/.test(value);
const isStrictIdeActionPayload = (payload) => isPlainObject(payload) && ((Object.keys(payload).every((key) => key === "action") && (payload.action === "getContextSnapshot" || payload.action === "getActiveFileExcerpt")) || (Object.keys(payload).every((key) => key === "action" || key === "workspaceRelativePath") && payload.action === "openWorkspaceFile" && isStrictSafeRelativePath(payload.workspaceRelativePath)) || (Object.keys(payload).every((key) => key === "action" || key === "workspaceRelativePath" || key === "range") && payload.action === "revealWorkspaceRange" && isStrictSafeRelativePath(payload.workspaceRelativePath) && isStrictRange(payload.range)) || (Object.keys(payload).every((key) => key === "action" || key === "commandId") && payload.action === "runVerificationCommand" && isVerificationCommandId(payload.commandId)) || (Object.keys(payload).every((key) => key === "action" || key === "query") && payload.action === "searchWorkspaceSnippets" && isWorkspaceSnippetSearchQuery(payload.query)));
const isFrameGuiMessage = (message) => isPlainObject(message) && Object.keys(message).every((key) => key === "version" || key === "type" || key === "requestId" || key === "payload") && message.version === bootstrap.bridgeVersion && ((message.type === "gui.ready" && isBoundedRequestId(message.requestId) && isStrictGuiReadyPayload(message.payload)) || (message.type === "gui.ideActionRequest" && isRequiredRequestId(message.requestId) && isBoundedForwardedIdeActionMessage(message) && isStrictIdeActionPayload(message.payload)) || (message.type === "gui.applyWorkspaceEditRequest" && isRequiredRequestId(message.requestId) && isBoundedForwardedApplyWorkspaceEditMessage(message)) || (message.type === "gui.controlledAgentFileReadRequest" && isRequiredRequestId(message.requestId) && isBoundedForwardedControlledFileReadMessage(message) && isControlledFileReadPayload(message.payload)) || (message.type === "gui.controlledAgentEditRequest" && isRequiredRequestId(message.requestId) && isBoundedForwardedControlledAgentEditMessage(message) && isControlledAgentEditPayload(message.payload) && message.payload.requestId === message.requestId));
const isEmptyHostPayload = (payload) => payload === undefined || (isPlainObject(payload) && Object.keys(payload).length === 0);
const isSafeRuntimeStatusText = (value) => typeof value === "string" && value.length > 0 && value.length <= 1000 && !/[\u0000-\u001f\u007f-\u009f]/.test(value) && !/(?:authorization|bearer|cookie|api[_-]?key|token|secret|password|private[_-]?path|provider[_-]?response|raw[_-]?prompt|file[_-]?content|sk-(?:proj-)?[A-Za-z0-9_-]{8,})/i.test(value) && !/(?:\/(?:Users|home|tmp|var|Volumes|Private|etc|opt|mnt)(?=\/|$|[^A-Za-z0-9_])|~[\/\\]|[A-Za-z]:[\/\\])/i.test(value);
const isHostRuntimeStatusPayload = (payload) => isPlainObject(payload) && Object.keys(payload).every((key) => key === "protocolVersion" || key === "surface" || key === "lifecycle" || key === "runtimeOwner" || key === "launchMode" || key === "tokenState" || key === "processState" || key === "diagnosis" || key === "nextAction" || key === "cloudRequired" || key === "authority") && payload.protocolVersion === "2026-06-21" && payload.surface === "vscode" && ["unknown", "checking", "starting", "connected", "degraded", "disconnected", "restarting", "stopped", "auth_mismatch", "invalid_settings", "failed"].includes(payload.lifecycle) && ["ide_host", "external", "user", "test_harness"].includes(payload.runtimeOwner) && ["auto", "connect", "launch", "preview", "manual", "unknown"].includes(payload.launchMode) && ["unknown", "not_required", "absent", "present", "mismatch", "invalid"].includes(payload.tokenState) && ["unknown", "not_owned", "checking", "starting", "running", "exited", "stopped", "failed"].includes(payload.processState) && isSafeRuntimeStatusText(payload.diagnosis) && isSafeRuntimeStatusText(payload.nextAction) && payload.cloudRequired === false && payload.authority === "metadata_only";
const isHostMessage = (message) => isPlainObject(message) && Object.keys(message).every((key) => key === "version" || key === "type" || key === "requestId" || key === "payload") && message.version === bootstrap.bridgeVersion && (message.type === "host.openedFromCommand" ? message.requestId === undefined && isEmptyHostPayload(message.payload) : message.type === "host.runtimeStatus" ? message.requestId === undefined && isHostRuntimeStatusPayload(message.payload) : (message.type === "host.ready" || message.type === "host.contextSnapshot" || message.type === "host.ideActionProgress" || message.type === "host.ideActionResult" || message.type === "host.applyWorkspaceEditResult" || message.type === "host.controlledAgentFileReadResult" || message.type === "host.controlledAgentEditResult"));
const sendToFrame = (message) => {
  if (frame && frame.contentWindow && frameTargetOrigin) {
    frame.contentWindow.postMessage(message, frameTargetOrigin);
  }
};
const replayHostReady = () => {
  if (frameReady && latestHostReady) {
    sendToFrame(latestHostReady);
  }
};
vscode.postMessage({ version: bootstrap.bridgeVersion, type: "gui.ready", requestId: bootstrap.requestId, payload: { supportedBridgeVersion: bootstrap.bridgeVersion } });
window.addEventListener("message", (event) => {
  if (event.source === frame?.contentWindow) {
    if (event.origin !== frameTargetOrigin) {
      console.log("Yet AI rejected iframe message from unexpected origin");
      return;
    }
    if (isFrameGuiMessage(event.data)) {
      if (event.data.type === "gui.ready") {
        frameReady = true;
      }
      vscode.postMessage(event.data);
      replayHostReady();
    } else {
      console.log("Yet AI rejected invalid iframe GUI bridge message");
    }
    return;
  }
  if (isHostMessage(event.data)) {
    console.log("Yet AI host message", event.data.type);
    if (event.data.type === "host.ready") {
      latestHostReady = event.data;
      replayHostReady();
      return;
    }
    sendToFrame(event.data);
  }
});
</script>
</body>
</html>`;
}

type PackagedGui = {
  root: vscode.Uri;
  html: string;
};

function findPackagedGui(extensionUri: vscode.Uri): PackagedGui | undefined {
  const root = vscode.Uri.joinPath(extensionUri, "media", "gui");
  const index = vscode.Uri.joinPath(root, "index.html");
  try {
    return {
      root,
      html: fs.readFileSync(index.fsPath, "utf8"),
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }
    throw error;
  }
}

function rewritePackagedGuiHtml(html: string, root: vscode.Uri, webview: vscode.Webview): string {
  const head = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? "";
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? "";
  return `${rewritePackagedGuiHeadAssets(head, root, webview)}${rewritePackagedGuiAssetReferences(body, root, webview)}`;
}

function rewritePackagedGuiHeadAssets(head: string, root: vscode.Uri, webview: vscode.Webview): string {
  const assets: string[] = [];
  for (const match of head.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = getHtmlAttribute(tag, "rel");
    const href = getHtmlAttribute(tag, "href");
    if (rel?.toLowerCase() === "stylesheet" && href && resolvePackagedAssetUri(href, root, webview)) {
      assets.push(rewritePackagedGuiAssetReferences(tag, root, webview));
    }
  }
  for (const match of head.matchAll(/<script\b[^>]*\bsrc=("|').+?\1[^>]*><\/script>/gi)) {
    const tag = match[0];
    const src = getHtmlAttribute(tag, "src");
    if (src && resolvePackagedAssetUri(src, root, webview)) {
      assets.push(rewritePackagedGuiAssetReferences(tag, root, webview));
    }
  }
  return assets.join("\n");
}

function rewritePackagedGuiAssetReferences(html: string, root: vscode.Uri, webview: vscode.Webview): string {
  return html.replace(/\b(src|href)=("|')(.+?)\2/g, (_match: string, attribute: string, quote: string, value: string) => {
    const uri = resolvePackagedAssetUri(value, root, webview);
    return `${attribute}=${quote}${uri ?? value}${quote}`;
  });
}

function getHtmlAttribute(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${name}=("|')(.+?)\\1`, "i"));
  return match?.[2];
}

function resolvePackagedAssetUri(value: string, root: vscode.Uri, webview: vscode.Webview): string | undefined {
  if (!value.startsWith("./") && !value.startsWith("/")) {
    return undefined;
  }
  if (value.length === 0 || value.startsWith("//") || value.includes("\\") || value.includes("?") || value.includes("#")) {
    return undefined;
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) {
    return undefined;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return undefined;
  }
  if (decoded.includes("\\") || decoded.includes("?") || decoded.includes("#")) {
    return undefined;
  }

  const relativePath = decoded.replace(/^\.\//, "").replace(/^\//, "");
  if (relativePath.length === 0 || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(relativePath)) {
    return undefined;
  }

  const segments = relativePath.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    return undefined;
  }

  return webview.asWebviewUri(vscode.Uri.joinPath(root, ...segments)).toString();
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

function getDocumentDisplayLabel(document: vscode.TextDocument): string | undefined {
  if (document.isUntitled) {
    return sanitizeDisplayPath(path.posix.basename(document.uri.path)) ?? "untitled";
  }
  if (document.uri.scheme === "file") {
    return path.basename(document.uri.fsPath);
  }
  return path.posix.basename(document.uri.path);
}

function sanitizeLanguageId(value: string): string | undefined {
  if (/^[A-Za-z0-9_.+-]{1,64}$/.test(value)) {
    return value;
  }
  return undefined;
}

function sanitizePositionNumber(value: number): number | undefined {
  if (Number.isInteger(value) && value >= 0 && value <= 1000000) {
    return value;
  }
  return undefined;
}

function sanitizeSelectionText(value: string): string | undefined {
  if (value.length === 0 || value.length > 8000 || hasSecretLikeText(value) || hasBinaryLikeText(value)) {
    return undefined;
  }
  return value;
}

function sanitizeActiveFileExcerptText(value: string): string | undefined {
  if (value.length === 0 || value.length > maxActiveFileExcerptTextLength || hasSecretLikeText(value) || hasPrivatePathLikeText(value) || hasBinaryLikeText(value)) {
    return undefined;
  }
  return value;
}

function sanitizeDisplayPath(value: string | undefined): string | undefined {
  return sanitizeSafePath(value, 256);
}

function sanitizeRelativePath(value: string | undefined, maxLength: number): string | undefined {
  return sanitizeSafePath(value, maxLength);
}

function sanitizeSafePath(value: string | undefined, maxLength: number): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.replaceAll(path.sep, "/");
  if (
    normalized.length === 0 ||
    normalized.length > maxLength ||
    normalized.startsWith("/") ||
    normalized.startsWith("~") ||
    normalized.includes("\\") ||
    normalized.includes(":") ||
    normalized.includes("%") ||
    normalized.includes("?") ||
    normalized.includes("#") ||
    /[\u0000-\u001f\u007f-\u009f]/.test(normalized) ||
    /(?:^|\/)\.\.?(?:\/|$)/.test(normalized) ||
    hasSecretLikeText(normalized) ||
    normalized.split("/").some(isSecretLikePathSegment) ||
    normalized.split("/").some((segment) => segment.length === 0)
  ) {
    return undefined;
  }
  return normalized;
}

function isSecretLikePathSegment(value: string): boolean {
  return /^(?:auth|authorization|bearer|cookie|credential|credentials|password|secret|token|access[_-]?token|api[_-]?key)(?:\.|-|_|$)/i.test(value) ||
    /(?:^|[._-])(?:auth|credential|credentials|password|secret|token|access[_-]?token|api[_-]?key)(?:[._-]|$)/i.test(value) ||
    /^sk-(?:proj-)?[A-Za-z0-9_-]{8,}/i.test(value);
}

function hasSecretLikeText(value: string): boolean {
  return /(?:authorization|bearer|cookie|api[_-]?key|token|secret|password|private[_-]?path|provider[_-]?response|raw[_-]?prompt|file[_-]?content|sk-(?:proj-)?[A-Za-z0-9_-]{8,})/i.test(value);
}

function hasBinaryLikeText(value: string): boolean {
  return value.includes("\u0000") || /[\u0001-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
}

export function serializeScriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function isGuiMessage(value: unknown): value is GuiMessage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    hasOnlyKeys(record, ["version", "type", "requestId", "payload"]) &&
    record.version === bridgeVersion &&
    ((record.type === "gui.ready" && isBoundedRequestId(record.requestId) && isGuiReadyPayload(record.payload)) ||
      (record.type === "gui.ideActionRequest" && parseIdeActionRequest(record as GuiMessage) !== undefined) ||
      (record.type === "gui.applyWorkspaceEditRequest" && isBoundedForwardedApplyWorkspaceEditMessage(record) && parseApplyWorkspaceEditRequest(record as GuiMessage) !== undefined) ||
      (record.type === "gui.controlledAgentFileReadRequest" && isBoundedForwardedControlledFileReadMessage(record) && isControlledFileReadGuiMessage(record)) ||
      (record.type === "gui.controlledAgentEditRequest" && isBoundedForwardedControlledAgentEditMessage(record) && isControlledAgentEditGuiMessage(record)))
  );
}

export function isInvalidApplyWorkspaceEditRequestMessage(value: unknown): value is GuiMessage & { requestId: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    hasOnlyKeys(record, ["version", "type", "requestId", "payload"]) &&
    record.version === bridgeVersion &&
    record.type === "gui.applyWorkspaceEditRequest" &&
    isRequiredRequestId(record.requestId) &&
    isBoundedForwardedApplyWorkspaceEditMessage(record) &&
    parseApplyWorkspaceEditRequest(record as GuiMessage) === undefined
  );
}

export function isInvalidIdeActionRequestMessage(value: unknown): value is GuiMessage & { requestId: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    hasOnlyKeys(record, ["version", "type", "requestId", "payload"]) &&
    record.version === bridgeVersion &&
    record.type === "gui.ideActionRequest" &&
    isRequiredRequestId(record.requestId) &&
    isBoundedForwardedIdeActionMessage(record) &&
    parseIdeActionRequest(record as GuiMessage) === undefined
  );
}

function isBoundedForwardedApplyWorkspaceEditMessage(value: Record<string, unknown>): boolean {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8") <= maxForwardedApplyWorkspaceEditMessageBytes;
  } catch {
    return false;
  }
}

function isBoundedForwardedIdeActionMessage(value: Record<string, unknown>): boolean {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8") <= maxForwardedIdeActionMessageBytes;
  } catch {
    return false;
  }
}

function isBoundedForwardedControlledFileReadMessage(value: Record<string, unknown>): boolean {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8") <= maxForwardedControlledFileReadMessageBytes;
  } catch {
    return false;
  }
}

function isBoundedForwardedControlledAgentEditMessage(value: Record<string, unknown>): boolean {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8") <= maxForwardedControlledAgentEditMessageBytes;
  } catch {
    return false;
  }
}

export function createNonce(): string {
  return crypto.randomBytes(24).toString("base64url");
}

function isBoundedRequestId(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value) && !hasSecretRequestIdMarker(value));
}

function hasSecretRequestIdMarker(value: string): boolean {
  return /authorization|bearer|api[_-]?key|token|secret|access[_-]?token|provider[_-]?key|openai[_-]?api[_-]?key|sk-(?:proj-)?[A-Za-z0-9_-]{8,}/i.test(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGuiReadyPayload(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return hasOnlyKeys(record, ["supportedBridgeVersion"]) && (record.supportedBridgeVersion === undefined || record.supportedBridgeVersion === bridgeVersion);
}

function hasOnlyKeys(record: Record<string, unknown>, allowedKeys: string[]): boolean {
  return Object.keys(record).every((key) => allowedKeys.includes(key));
}

function hasPrivatePathLikeText(value: string): boolean {
  return /(?:\/(?:Users|home|tmp|var|Volumes|Private|etc|opt|mnt)(?=\/|$|[^A-Za-z0-9_])|~[\/\\]|[A-Za-z]:[\/\\])/i.test(value);
}

function createRequestId(): string {
  return `${Date.now().toString(36)}-${createNonce()}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return character;
    }
  });
}
