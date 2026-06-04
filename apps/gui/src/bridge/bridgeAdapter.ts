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

export type IdeActionType = "getContextSnapshot" | "openWorkspaceFile" | "revealWorkspaceRange";

export type IdeActionRequestPayload =
  | { action: "getContextSnapshot" }
  | { action: "openWorkspaceFile"; workspaceRelativePath: string }
  | { action: "revealWorkspaceRange"; workspaceRelativePath: string; range: WorkspaceEditRange };

export type IdeActionProgressPayload = {
  phase: "queued" | "checkingPolicy" | "running" | "completed";
  status: "pending" | "inProgress" | "succeeded" | "rejected" | "unavailable" | "failed";
  summary: string;
  cloudRequired: false;
  action?: IdeActionType;
  workspaceRelativePath?: string;
};

export type IdeActionResultPayload = {
  status: "succeeded" | "rejected" | "unavailable" | "failed";
  message: string;
  cloudRequired: false;
  action?: IdeActionType;
  workspaceRelativePath?: string;
  range?: WorkspaceEditRange;
  context?: {
    source?: BridgeHost;
    hasActiveEditor?: boolean;
    workspaceFolderCount?: number;
  };
};

export type GuiMessage = {
  version: string;
  type: "gui.ready" | "gui.unloaded" | "gui.ideActionRequest" | "gui.applyWorkspaceEditRequest";
  requestId?: string;
  payload?: Record<string, unknown> | IdeActionRequestPayload | ApplyWorkspaceEditPayload;
};

export type HostMessage = {
  version: string;
  type: "host.ready" | "host.openedFromCommand" | "host.contextSnapshot" | "host.ideActionProgress" | "host.ideActionResult" | "host.applyWorkspaceEditResult";
  requestId?: string;
  payload?: Record<string, unknown> | IdeActionProgressPayload | IdeActionResultPayload | ApplyWorkspaceEditResultPayload;
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
};

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
]);
const guiMessageTypes = new Set<GuiMessage["type"]>([
  "gui.ready",
  "gui.ideActionRequest",
  "gui.applyWorkspaceEditRequest",
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
  const host: BridgeHost = vscode ? "vscode" : postIntellijMessage ? "jetbrains" : "browser";

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
    if (!isGuiMessage(outbound) && !isGuiUnloadedMessage(outbound)) {
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
  if (value.type === "gui.ideActionRequest") {
    return typeof value.requestId === "string" && isIdeActionRequestPayload(value.payload);
  }
  return value.type === "gui.applyWorkspaceEditRequest" && typeof value.requestId === "string" && isApplyWorkspaceEditPayload(value.payload);
}

function isGuiUnloadedMessage(value: unknown): value is GuiMessage {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["version", "type", "payload"])) {
    return false;
  }
  return value.version === bridgeVersion && value.type === "gui.unloaded" && isEmptyPayload(value.payload);
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
  return value.type === "host.openedFromCommand" && value.requestId === undefined && isEmptyPayload(value.payload);
}

export function isHostReadyPayload(value: unknown): value is HostReadyPayload {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["runtimeUrl", "sessionToken", "productId", "displayName", "cloudRequired"])) {
    return false;
  }
  return (
    optionalHttpUrl(value.runtimeUrl) &&
    optionalString(value.sessionToken, 4096) &&
    optionalNonEmptyString(value.productId, 256) &&
    optionalNonEmptyString(value.displayName, 256) &&
    (value.cloudRequired === undefined || value.cloudRequired === false)
  );
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
  let totalReplacementText = 0;
  for (const fileEdit of value.edits) {
    if (!isFileTextEdits(fileEdit)) {
      return false;
    }
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
    safeMessage(value.message) &&
    value.cloudRequired === false &&
    optionalBoundedInteger(value.appliedEditCount, 0, 64) &&
    isOptionalAffectedFiles(value.affectedFiles)
  );
}

export function isIdeActionRequestPayload(value: unknown): value is IdeActionRequestPayload {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["action", "workspaceRelativePath", "range"])) {
    return false;
  }
  if (value.action === "getContextSnapshot") {
    return hasOnlyKeys(value, ["action"]);
  }
  if (value.action === "openWorkspaceFile") {
    return hasOnlyKeys(value, ["action", "workspaceRelativePath"]) && requiredSafeRelativePath(value.workspaceRelativePath);
  }
  if (value.action === "revealWorkspaceRange") {
    return hasOnlyKeys(value, ["action", "workspaceRelativePath", "range"]) && requiredSafeRelativePath(value.workspaceRelativePath) && isEditRange(value.range);
  }
  return false;
}

export function isIdeActionProgressPayload(value: unknown): value is IdeActionProgressPayload {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["phase", "status", "summary", "cloudRequired", "action", "workspaceRelativePath"])) {
    return false;
  }
  return (
    (value.phase === "queued" || value.phase === "checkingPolicy" || value.phase === "running" || value.phase === "completed") &&
    (value.status === "pending" || value.status === "inProgress" || value.status === "succeeded" || value.status === "rejected" || value.status === "unavailable" || value.status === "failed") &&
    safeMessage(value.summary) &&
    value.cloudRequired === false &&
    optionalIdeActionType(value.action) &&
    safeRelativePath(value.workspaceRelativePath)
  );
}

export function isIdeActionResultPayload(value: unknown): value is IdeActionResultPayload {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["status", "message", "cloudRequired", "action", "workspaceRelativePath", "range", "context"])) {
    return false;
  }
  return (
    (value.status === "succeeded" || value.status === "rejected" || value.status === "unavailable" || value.status === "failed") &&
    safeMessage(value.message) &&
    value.cloudRequired === false &&
    optionalIdeActionType(value.action) &&
    safeRelativePath(value.workspaceRelativePath) &&
    (value.range === undefined || isEditRange(value.range)) &&
    isOptionalIdeActionContext(value.context)
  );
}

function optionalIdeActionType(value: unknown): boolean {
  return value === undefined || value === "getContextSnapshot" || value === "openWorkspaceFile" || value === "revealWorkspaceRange";
}

function isOptionalIdeActionContext(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["source", "hasActiveEditor", "workspaceFolderCount"])) {
    return false;
  }
  return (value.source === undefined || value.source === "vscode" || value.source === "jetbrains" || value.source === "browser") &&
    (value.hasActiveEditor === undefined || typeof value.hasActiveEditor === "boolean") &&
    optionalBoundedInteger(value.workspaceFolderCount, 0, 100);
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isBoundedRequestId(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value));
}

function isEmptyPayload(value: unknown): boolean {
  return value === undefined || (isPlainObject(value) && Object.keys(value).length === 0);
}

function optionalString(value: unknown, maxLength: number): boolean {
  return value === undefined || (typeof value === "string" && value.length <= maxLength);
}

function optionalNonEmptyString(value: unknown, maxLength: number): boolean {
  return value === undefined || (typeof value === "string" && value.length > 0 && value.length <= maxLength);
}

function optionalHttpUrl(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
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
    optionalString(value.text, 8000)
  );
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
  return value.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

function optionalLanguageId(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && value.length > 0 && value.length <= 64 && /^[A-Za-z0-9_.+-]+$/.test(value));
}

function optionalBoundedInteger(value: unknown, min: number, max: number): boolean {
  return value === undefined || (Number.isInteger(value) && (value as number) >= min && (value as number) <= max);
}

function safeSummary(value: unknown): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 1000 && !unsafeDisplayText(value) && !hasPrivatePathLikeText(value) && !hasKeyLikeSecretText(value);
}

function safeMessage(value: unknown): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 1000 && !unsafeDisplayText(value) && !hasPrivatePathLikeText(value) && !hasKeyLikeSecretText(value);
}

function hasPrivatePathLikeText(value: string): boolean {
  return /(?:\/Users\/|\/home\/|\/tmp\/|\/var\/|\/Volumes\/|\/Private\/|~[\/\\]|[A-Za-z]:[\/\\])/.test(value);
}

function hasKeyLikeSecretText(value: string): boolean {
  return /(?:^|[^A-Za-z0-9_-])sk-(?:proj-)?[A-Za-z0-9_-]{8,}/.test(value);
}

function unsafeDisplayText(value: string): boolean {
  return /authorization|bearer|cookie|api[_-]?key|token|secret|password|private[_-]?path|provider[_-]?response|raw[_-]?prompt|file[_-]?content/i.test(value);
}
