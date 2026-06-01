export type BridgeHost = "browser" | "vscode" | "jetbrains";

export type GuiMessage = {
  version: string;
  type: "gui.ready" | "gui.unloaded";
  requestId?: string;
  payload?: Record<string, unknown>;
};

export type HostMessage = {
  version: string;
  type: "host.ready" | "host.openedFromCommand" | "host.contextSnapshot";
  requestId?: string;
  payload?: Record<string, unknown>;
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
  return (
    value.version === bridgeVersion &&
    value.type === "gui.ready" &&
    isBoundedRequestId(value.requestId) &&
    isGuiReadyPayload(value.payload)
  );
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
  return value.type !== "host.openedFromCommand" || isEmptyPayload(value.payload);
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isBoundedRequestId(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && value.length > 0 && value.length <= 128 && [...value].every((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code >= 0x20 && (code < 0x7f || code > 0x9f);
  }));
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
  return value === undefined || safePath(value, 512);
}

function safePath(value: unknown, maxLength: number): boolean {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || value.startsWith("/") || value.startsWith("~") || value.includes("\\") || value.includes(":")) {
    return false;
  }
  if (/^[^\u0000-\u001f]+$/.test(value) === false) {
    return false;
  }
  return value.split("/").every((part) => part !== "." && part !== "..");
}

function optionalLanguageId(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && value.length > 0 && value.length <= 64 && /^[A-Za-z0-9_.+-]+$/.test(value));
}

function optionalBoundedInteger(value: unknown, min: number, max: number): boolean {
  return value === undefined || (Number.isInteger(value) && (value as number) >= min && (value as number) <= max);
}
