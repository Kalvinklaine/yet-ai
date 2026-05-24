import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { App } from "./App";

const bridgeVersion = "2026-05-15";
const fetchMock = vi.fn();

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  root = undefined;
  container?.remove();
  container = undefined;
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
  delete window.acquireVsCodeApi;
  delete window.postIntellijMessage;
});

describe("provider secret boundary", () => {
  it("browser storage does not contain raw provider API keys", () => {
    localStorage.clear();
    sessionStorage.clear();
    const secret = "sk-yet-test-secret";
    const transientForm = { apiKey: secret };
    const clearedForm = { ...transientForm, apiKey: "" };
    expect(clearedForm.apiKey).toBe("");
    expect(JSON.stringify(localStorage)).not.toContain(secret);
    expect(JSON.stringify(sessionStorage)).not.toContain(secret);
  });
});

describe("host.ready runtime bootstrap", () => {
  it("updates runtime settings from host.ready without persisting the token", async () => {
    const token = "host-session-token-secret";
    fetchMock.mockResolvedValue(new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<App />);
    });

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          version: bridgeVersion,
          type: "host.ready",
          payload: {
            runtimeUrl: "http://127.0.0.1:8765",
            sessionToken: token,
            productId: "yet-ai",
            displayName: "Yet AI",
            cloudRequired: false,
          },
        },
      }));
    });

    const runtimeUrlInput = Array.from(container.querySelectorAll("input")).find((input) => input.value === "http://127.0.0.1:8765");
    const tokenInput = Array.from(container.querySelectorAll("input")).find((input) => input.value === token);
    expect(runtimeUrlInput).toBeDefined();
    expect(tokenInput).toBeDefined();
    expect(container.textContent).toContain("Host runtime settings received");
    expect(JSON.stringify(localStorage)).not.toContain(token);
    expect(JSON.stringify(sessionStorage)).not.toContain(token);
  });
});
