import { afterEach, describe, expect, it } from "vitest";
import { createBridgeAdapter, isHostMessage } from "./bridgeAdapter";

const bridgeVersion = "2026-05-15";

afterEach(() => {
  delete window.acquireVsCodeApi;
  delete window.postIntellijMessage;
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

  it("accepts allowlisted host messages", () => {
    expect(isHostMessage({ version: bridgeVersion, type: "host.ready" })).toBe(true);
    expect(isHostMessage({ version: bridgeVersion, type: "host.themeChanged", requestId: "r1", payload: { theme: "dark" } })).toBe(true);
  });

  it("rejects unknown or invalid host messages", () => {
    expect(isHostMessage({ version: bridgeVersion, type: "host.unknown" })).toBe(false);
    expect(isHostMessage({ version: "", type: "host.ready" })).toBe(false);
    expect(isHostMessage({ version: "1", type: "host.ready" })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ready", requestId: "" })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ready", payload: [] })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ready", payload: { sessionToken: 123 } })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ready", payload: { cloudRequired: "false" } })).toBe(false);
  });

  it("logs rejected host messages", () => {
    const logs: string[] = [];
    const adapter = createBridgeAdapter((entry) => logs.push(entry));
    window.dispatchEvent(new MessageEvent("message", { data: { version: bridgeVersion, type: "host.unknown" } }));
    window.dispatchEvent(new MessageEvent("message", { data: { version: bridgeVersion, type: "host.ready" } }));
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
      data: {
        version: bridgeVersion,
        type: "host.ready",
        requestId: "r1",
        payload: {
          runtimeUrl: "http://127.0.0.1:8765",
          sessionToken: token,
          productId: "yet-ai",
          displayName: "Yet AI",
          cloudRequired: false,
        },
      },
    }));
    expect(messages).toHaveLength(1);
    expect(JSON.stringify(messages[0])).toContain(token);
    expect(logs).toContain("Host runtime settings received");
    expect(logs.join("\n")).not.toContain(token);
    adapter.dispose();
  });
});
