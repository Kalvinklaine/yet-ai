import { afterEach, describe, expect, it } from "vitest";
import { createBridgeAdapter, isHostMessage } from "./bridgeAdapter";

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
    expect(isHostMessage({ version: "1", type: "host.ready" })).toBe(true);
    expect(isHostMessage({ version: "1", type: "host.themeChanged", requestId: "r1", payload: { theme: "dark" } })).toBe(true);
  });

  it("rejects unknown or invalid host messages", () => {
    expect(isHostMessage({ version: "1", type: "host.unknown" })).toBe(false);
    expect(isHostMessage({ version: "", type: "host.ready" })).toBe(false);
    expect(isHostMessage({ version: "1", type: "host.ready", requestId: "" })).toBe(false);
    expect(isHostMessage({ version: "1", type: "host.ready", payload: [] })).toBe(false);
  });

  it("logs rejected host messages", () => {
    const logs: string[] = [];
    const adapter = createBridgeAdapter((entry) => logs.push(entry));
    window.dispatchEvent(new MessageEvent("message", { data: { version: "1", type: "host.unknown" } }));
    window.dispatchEvent(new MessageEvent("message", { data: { version: "1", type: "host.ready" } }));
    expect(logs).toContain("Rejected invalid host bridge message");
    expect(logs).toContain("Host message host.ready");
    adapter.dispose();
  });
});
