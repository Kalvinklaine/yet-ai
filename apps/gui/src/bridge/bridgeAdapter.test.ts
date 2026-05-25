import { afterEach, describe, expect, it, vi } from "vitest";
import { createBridgeAdapter, isGuiMessage, isHostMessage } from "./bridgeAdapter";

const bridgeVersion = "2026-05-15";
const parentDescriptor = Object.getOwnPropertyDescriptor(window, "parent");
const referrerDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, "referrer");

afterEach(() => {
  delete window.acquireVsCodeApi;
  delete window.postIntellijMessage;
  localStorage.clear();
  sessionStorage.clear();
  if (parentDescriptor) {
    Object.defineProperty(window, "parent", parentDescriptor);
  }
  if (referrerDescriptor) {
    Object.defineProperty(Document.prototype, "referrer", referrerDescriptor);
  }
});

describe("bridgeAdapter", () => {
  it("sends and logs gui.ready in browser mock mode", () => {
    const logs: string[] = [];
    const adapter = createBridgeAdapter((entry) => logs.push(entry));
    expect(adapter.host).toBe("browser");
    expect(logs).toContain("Bridge host browser");
    expect(logs).toContain("Browser mock sent gui.ready");
    adapter.dispose();
  });

  it("sends gui.ready to an iframe parent using the referrer origin when available", () => {
    const logs: string[] = [];
    const postMessage = vi.fn();
    Object.defineProperty(Document.prototype, "referrer", {
      configurable: true,
      get: () => "https://wrapper.example/shell.html",
    });
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: { postMessage },
    });

    const adapter = createBridgeAdapter((entry) => logs.push(entry));

    expect(adapter.host).toBe("browser");
    expect(logs).toContain("Bridge host browser");
    expect(logs).not.toContain("Browser mock sent gui.ready");
    expect(postMessage).toHaveBeenCalledWith({
      version: bridgeVersion,
      type: "gui.ready",
      payload: { supportedBridgeVersion: bridgeVersion },
    }, "https://wrapper.example");
    adapter.dispose();
  });

  it("accepts host.ready from the captured iframe parent without token logging or storage", () => {
    const token = "iframe-parent-session-token-secret";
    const logs: string[] = [];
    const messages: unknown[] = [];
    const parent = { postMessage: vi.fn() };
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: parent,
    });

    const adapter = createBridgeAdapter((entry) => logs.push(entry));
    adapter.subscribe((message) => messages.push(message));
    window.dispatchEvent(new MessageEvent("message", {
      data: hostReady({ sessionToken: token }),
      source: parent as unknown as Window,
    }));

    expect(messages).toHaveLength(1);
    expect(JSON.stringify(messages[0])).toContain(token);
    expect(logs).toContain("Host runtime settings received");
    expect(logs.join("\n")).not.toContain(token);
    expect(JSON.stringify(localStorage)).not.toContain(token);
    expect(JSON.stringify(sessionStorage)).not.toContain(token);
    adapter.dispose();
  });

  it("rejects valid-looking host messages from an unexpected iframe source", () => {
    const logs: string[] = [];
    const messages: unknown[] = [];
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: { postMessage: vi.fn() },
    });

    const adapter = createBridgeAdapter((entry) => logs.push(entry));
    adapter.subscribe((message) => messages.push(message));
    window.dispatchEvent(new MessageEvent("message", {
      data: hostReady(),
      source: { postMessage: vi.fn() } as unknown as Window,
    }));

    expect(messages).toHaveLength(0);
    expect(logs).toContain("Rejected host bridge message from unexpected source");
    expect(logs).not.toContain("Host runtime settings received");
    adapter.dispose();
  });

  it("rejects parent host messages from the wrong origin when referrer origin is known", () => {
    const logs: string[] = [];
    const messages: unknown[] = [];
    const parent = { postMessage: vi.fn() };
    Object.defineProperty(Document.prototype, "referrer", {
      configurable: true,
      get: () => "https://wrapper.example/shell.html",
    });
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: parent,
    });

    const adapter = createBridgeAdapter((entry) => logs.push(entry));
    adapter.subscribe((message) => messages.push(message));
    window.dispatchEvent(new MessageEvent("message", {
      data: hostReady(),
      origin: "https://attacker.example",
      source: parent as unknown as Window,
    }));

    expect(messages).toHaveLength(0);
    expect(logs).toContain("Rejected host bridge message from unexpected origin");
    adapter.dispose();
  });

  it("keeps top-level browser mock message behavior", () => {
    const logs: string[] = [];
    const messages: unknown[] = [];
    const adapter = createBridgeAdapter((entry) => logs.push(entry));
    adapter.subscribe((message) => messages.push(message));
    window.dispatchEvent(new MessageEvent("message", { data: hostReady() }));
    expect(messages).toHaveLength(1);
    expect(logs).toContain("Host runtime settings received");
    adapter.dispose();
  });

  it("keeps direct VS Code mode posting and receiving", () => {
    const logs: string[] = [];
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });

    const adapter = createBridgeAdapter((entry) => logs.push(entry));
    const messages: unknown[] = [];
    adapter.subscribe((message) => messages.push(message));
    window.dispatchEvent(new MessageEvent("message", { data: hostReady() }));

    expect(adapter.host).toBe("vscode");
    expect(postMessage).toHaveBeenCalledWith({
      version: bridgeVersion,
      type: "gui.ready",
      payload: { supportedBridgeVersion: bridgeVersion },
    });
    expect(messages).toHaveLength(1);
    adapter.dispose();
  });

  it("delivers synchronous VS Code host.ready replies after subscribe", () => {
    const logs: string[] = [];
    window.acquireVsCodeApi = () => ({
      postMessage: () => window.dispatchEvent(new MessageEvent("message", { data: hostReady({ sessionToken: "sync-vscode-token" }) })),
    });

    const adapter = createBridgeAdapter((entry) => logs.push(entry));
    const messages: unknown[] = [];
    adapter.subscribe((message) => messages.push(message));

    expect(messages).toHaveLength(1);
    expect(JSON.stringify(messages[0])).toContain("sync-vscode-token");
    expect(logs).toContain("Host runtime settings received");
    expect(logs.join("\n")).not.toContain("sync-vscode-token");
    adapter.dispose();
  });

  it("keeps direct JetBrains mode posting and receiving", () => {
    const logs: string[] = [];
    const postIntellijMessage = vi.fn();
    window.postIntellijMessage = postIntellijMessage;

    const adapter = createBridgeAdapter((entry) => logs.push(entry));
    const messages: unknown[] = [];
    adapter.subscribe((message) => messages.push(message));
    window.dispatchEvent(new MessageEvent("message", { data: hostReady() }));

    expect(adapter.host).toBe("jetbrains");
    expect(postIntellijMessage).toHaveBeenCalledWith({
      version: bridgeVersion,
      type: "gui.ready",
      payload: { supportedBridgeVersion: bridgeVersion },
    });
    expect(messages).toHaveLength(1);
    adapter.dispose();
  });

  it("delivers synchronous JetBrains host.ready replies after subscribe", () => {
    const logs: string[] = [];
    window.postIntellijMessage = () => window.dispatchEvent(new MessageEvent("message", { data: hostReady({ sessionToken: "sync-jetbrains-token" }) }));

    const adapter = createBridgeAdapter((entry) => logs.push(entry));
    const messages: unknown[] = [];
    adapter.subscribe((message) => messages.push(message));

    expect(adapter.host).toBe("jetbrains");
    expect(messages).toHaveLength(1);
    expect(JSON.stringify(messages[0])).toContain("sync-jetbrains-token");
    expect(logs.join("\n")).not.toContain("sync-jetbrains-token");
    adapter.dispose();
  });

  it("does not flush invalid queued host replies", () => {
    window.postIntellijMessage = () => window.dispatchEvent(new MessageEvent("message", { data: { version: bridgeVersion, type: "host.ready", payload: { sessionToken: 123 } } }));

    const logs: string[] = [];
    const adapter = createBridgeAdapter((entry) => logs.push(entry));
    const messages: unknown[] = [];
    adapter.subscribe((message) => messages.push(message));

    expect(messages).toHaveLength(0);
    expect(logs).toContain("Rejected invalid host bridge message");
    adapter.dispose();
  });

  it("does not flush wrong-source queued parent messages", () => {
    const parent = {
      postMessage: () => window.dispatchEvent(new MessageEvent("message", {
        data: hostReady(),
        source: { postMessage: vi.fn() } as unknown as Window,
      })),
    };
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: parent,
    });

    const logs: string[] = [];
    const adapter = createBridgeAdapter((entry) => logs.push(entry));
    const messages: unknown[] = [];
    adapter.subscribe((message) => messages.push(message));

    expect(messages).toHaveLength(0);
    expect(logs).toContain("Rejected host bridge message from unexpected source");
    adapter.dispose();
  });

  it("clears pending host replies on dispose", () => {
    window.postIntellijMessage = () => window.dispatchEvent(new MessageEvent("message", { data: hostReady() }));

    const adapter = createBridgeAdapter(() => undefined);
    adapter.dispose();
    const messages: unknown[] = [];
    adapter.subscribe((message) => messages.push(message));

    expect(messages).toHaveLength(0);
  });

  it("accepts current non-privileged host messages", () => {
    expect(isHostMessage(hostReady())).toBe(true);
    expect(isHostMessage({ version: bridgeVersion, type: "host.openedFromCommand" })).toBe(true);
    expect(isHostMessage({ version: bridgeVersion, type: "host.openedFromCommand", payload: {} })).toBe(true);
  });

  it("validates gui.ready against the strict current schema", () => {
    expect(isGuiMessage({ version: bridgeVersion, type: "gui.ready" })).toBe(true);
    expect(isGuiMessage({ version: bridgeVersion, type: "gui.ready", requestId: "r1", payload: { supportedBridgeVersion: bridgeVersion } })).toBe(true);
    expect(isGuiMessage({ version: "", type: "gui.ready" })).toBe(false);
    expect(isGuiMessage({ version: "1", type: "gui.ready" })).toBe(false);
    expect(isGuiMessage({ version: bridgeVersion, type: "gui.ready", requestId: "" })).toBe(false);
    expect(isGuiMessage({ version: bridgeVersion, type: "gui.ready", requestId: "a".repeat(129) })).toBe(false);
    expect(isGuiMessage({ version: bridgeVersion, type: "gui.ready", payload: { supportedBridgeVersion: "1" } })).toBe(false);
    expect(isGuiMessage({ version: bridgeVersion, type: "gui.ready", payload: { supportedBridgeVersion: bridgeVersion, extra: true } })).toBe(false);
    expect(isGuiMessage({ version: bridgeVersion, type: "gui.ready", extra: true })).toBe(false);
  });

  it("rejects unknown, disabled, or invalid host messages", () => {
    expect(isHostMessage({ version: bridgeVersion, type: "host.themeChanged", requestId: "r1", payload: { theme: "dark" } })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.openedFromCommand", payload: { action: "edit" } })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.unknown" })).toBe(false);
    expect(isHostMessage({ version: "", type: "host.ready", payload: {} })).toBe(false);
    expect(isHostMessage({ version: "1", type: "host.ready", payload: {} })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ready", requestId: "", payload: {} })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ready", requestId: "a".repeat(129), payload: {} })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ready", payload: [] })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ready", payload: { sessionToken: 123 } })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ready", payload: { cloudRequired: "false" } })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ready", payload: { cloudRequired: true } })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ready", payload: { unknown: true } })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ready", payload: {}, extra: true })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ready", payload: { runtimeUrl: "ftp://127.0.0.1:8765" } })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ready", payload: { productId: "" } })).toBe(false);
  });

  it("logs rejected host messages", () => {
    const logs: string[] = [];
    const adapter = createBridgeAdapter((entry) => logs.push(entry));
    window.dispatchEvent(new MessageEvent("message", { data: { version: bridgeVersion, type: "host.unknown" } }));
    window.dispatchEvent(new MessageEvent("message", { data: hostReady() }));
    expect(logs).toContain("Rejected invalid host bridge message");
    expect(logs).toContain("Host runtime settings received");
    adapter.dispose();
  });

  it("emits valid host.ready to subscribers without logging the token", () => {
    const token = "host-session-token-secret";
    const logs: string[] = [];
    const messages: unknown[] = [];
    const adapter = createBridgeAdapter((entry) => logs.push(entry));
    adapter.subscribe((message) => messages.push(message));
    window.dispatchEvent(new MessageEvent("message", {
      data: hostReady({ sessionToken: token }),
    }));
    expect(messages).toHaveLength(1);
    expect(JSON.stringify(messages[0])).toContain(token);
    expect(logs).toContain("Host runtime settings received");
    expect(logs.join("\n")).not.toContain(token);
    adapter.dispose();
  });
});

function hostReady(payload: Record<string, unknown> = {}) {
  return {
    version: bridgeVersion,
    type: "host.ready",
    requestId: "r1",
    payload: {
      runtimeUrl: "http://127.0.0.1:8765",
      productId: "yet-ai",
      displayName: "Yet AI",
      cloudRequired: false,
      ...payload,
    },
  };
}
