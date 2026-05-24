export type BridgeHost = "browser" | "vscode" | "jetbrains";

export type GuiMessage = {
  version: string;
  type: "gui.ready";
  requestId?: string;
  payload?: Record<string, unknown>;
};

export type HostMessage = {
  version: string;
  type:
    | "host.ready"
    | "host.themeChanged"
    | "host.activeFileChanged"
    | "host.selectionChanged"
    | "host.workspaceChanged"
    | "host.toolResult"
    | "host.openedFromCommand";
  requestId?: string;
  payload?: Record<string, unknown>;
};

export type BridgeAdapter = {
  host: BridgeHost;
  log: string[];
  post: (message: GuiMessage) => void;
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
  "host.themeChanged",
  "host.activeFileChanged",
  "host.selectionChanged",
  "host.workspaceChanged",
  "host.toolResult",
  "host.openedFromCommand",
]);

export function createBridgeAdapter(onLog: (entry: string) => void): BridgeAdapter {
  const log: string[] = [];
  const append = (entry: string) => {
    log.push(entry);
    onLog(entry);
  };

  const vscode = window.acquireVsCodeApi?.();
  const postIntellijMessage = window.postIntellijMessage;
  const host: BridgeHost = vscode ? "vscode" : postIntellijMessage ? "jetbrains" : "browser";

  const post = (message: GuiMessage) => {
    if (!isGuiMessage(message)) {
      append("Rejected invalid GUI bridge message");
      return;
    }
    if (vscode) {
      vscode.postMessage(message);
    } else if (postIntellijMessage) {
      postIntellijMessage(message);
    } else {
      append(`Browser mock sent ${message.type}`);
    }
  };

  const onMessage = (event: MessageEvent<unknown>) => {
    const message = event.data;
    if (!isHostMessage(message)) {
      append("Rejected invalid host bridge message");
      return;
    }
    append(`Host message ${message.type}`);
  };

  window.addEventListener("message", onMessage);
  append(`Bridge host ${host}`);
  post({
    version: bridgeVersion,
    type: "gui.ready",
    payload: { supportedBridgeVersion: bridgeVersion },
  });

  return {
    host,
    log,
    post,
    dispose: () => window.removeEventListener("message", onMessage),
  };
}

export function isGuiMessage(value: unknown): value is GuiMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.version === "string" &&
    record.version.length > 0 &&
    record.type === "gui.ready" &&
    (record.requestId === undefined || (typeof record.requestId === "string" && record.requestId.length > 0)) &&
    (record.payload === undefined || (typeof record.payload === "object" && record.payload !== null && !Array.isArray(record.payload)))
  );
}

export function isHostMessage(value: unknown): value is HostMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.version === "string" &&
    record.version.length > 0 &&
    typeof record.type === "string" &&
    hostMessageTypes.has(record.type as HostMessage["type"]) &&
    (record.requestId === undefined || (typeof record.requestId === "string" && record.requestId.length > 0)) &&
    (record.payload === undefined || (typeof record.payload === "object" && record.payload !== null && !Array.isArray(record.payload)))
  );
}
