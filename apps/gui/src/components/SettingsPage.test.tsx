// @vitest-environment jsdom
import React, { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./SettingsPage";
import type { BridgeAdapter, HostMessageHandler, HostRuntimeStatusPayload } from "../bridge/bridgeAdapter";
import type { RuntimeSettings } from "../services/runtimeClient";

let root: ReactDOM.Root | undefined;
let container: HTMLDivElement | undefined;
const settings: RuntimeSettings = { baseUrl: "http://127.0.0.1:8001", token: "hidden-runtime-token", runtimeAccess: "direct" };

const authBase = {
  provider: "openai",
  configured: false,
  status: "login_available",
  authSource: "none",
  supportsLogin: true,
  supportsApiKey: true,
  cloudRequired: false,
};

function json(data: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }));
}

function installFetch(options: { auth?: Record<string, unknown>; failPing?: boolean; authResponse?: Promise<Response>; startResponse?: Promise<Response>; disconnectResponse?: Promise<Response> } = {}) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/v1/ping")) return options.failPing ? json({ message: "private-token <script>" }, 503) : json({ productId: "yet-ai", displayName: "Yet AI", version: "1", ready: true, serverTime: "now" });
    if (url.endsWith("/v1/caps")) return json({ productId: "yet-ai", protocolVersion: "1", runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: [], features: {}, providers: [], ide: { bridge: false, lsp: false } });
    if (url.endsWith("/v1/models")) return json({ models: [{ id: "secret-model-id", displayName: "Private Model" }] });
    if (url.endsWith("/v1/demo-mode") && init?.method === "POST") return json({ enabled: true, providerId: "yet-demo", modelId: "yet-demo-chat", displayName: "Yet AI Demo Mode", cloudRequired: false, providerAccess: "direct", message: "enabled" });
    if (url.endsWith("/v1/demo-mode")) return json({ enabled: false, providerId: "yet-demo", modelId: "yet-demo-chat", displayName: "Yet AI Demo Mode", cloudRequired: false, providerAccess: "direct", message: "disabled" });
    if (url.endsWith("/v1/providers") && init?.method === "POST") return json({ id: "saved", kind: "openai-compatible", displayName: "Saved", enabled: true, baseUrl: "https://example.com/v1", auth: { type: "api_key", configured: true, redacted: "must-not-render" }, models: [], capabilities: { chat: true, completion: false, embeddings: false } });
    if (url.endsWith("/v1/providers/local") && init?.method === "PATCH") return json({ id: "local", kind: "ollama", displayName: "Local provider", enabled: true, baseUrl: "http://127.0.0.1:11434", auth: { type: "none", configured: true }, models: [{ id: "llama", displayName: "Llama" }, { id: "coder", displayName: "Coder" }], capabilities: { chat: true, completion: true, embeddings: true } });
    if (url.endsWith("/v1/providers")) return json({ providers: [{ id: "local", kind: "ollama", displayName: "Local provider", enabled: true, baseUrl: "http://127.0.0.1:11434", auth: { type: "none", configured: true }, models: [{ id: "llama", displayName: "Llama" }, { id: "coder", displayName: "Coder" }], capabilities: { chat: true, completion: true, embeddings: true } }], cloudRequired: false, providerAccess: "direct" });
    if (url.endsWith("/v1/providers/local/test")) return json({ ok: true, providerId: "local", status: "reachable", message: "Provider reached", cloudRequired: false });
    if (url.endsWith("/v1/provider-auth/openai/status")) return options.authResponse ?? json(options.auth ?? authBase);
    if (url.endsWith("/v1/provider-auth/openai/start")) return options.startResponse ?? json({ ...authBase, success: true, status: "pending", authSource: "oauth", authorizationUrl: "https://login.example.test/authorize?state=safe-state", sessionId: "private-session" });
    if (url.endsWith("/v1/provider-auth/openai/exchange")) return json({ ...authBase, success: true, configured: true, status: "connected", authSource: "oauth", accountLabel: "person@example.test" });
    if (url.endsWith("/v1/provider-auth/openai/disconnect")) return options.disconnectResponse ?? json({ ...authBase, success: true, status: "not_configured" });
    return json({}, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function runtimeStatus(surface: HostRuntimeStatusPayload["surface"]): HostRuntimeStatusPayload {
  return {
    protocolVersion: "2026-06-21",
    surface,
    lifecycle: "connected",
    runtimeOwner: "ide_host",
    launchMode: "auto",
    tokenState: "present",
    processState: "running",
    diagnosis: "runtime connected",
    nextAction: "Refresh account readiness.",
    cloudRequired: false,
    authority: "metadata_only",
  };
}

function bridgeAdapter(host: BridgeAdapter["host"]) {
  let handler: HostMessageHandler | undefined;
  const adapter: BridgeAdapter = {
    host,
    log: [],
    post: vi.fn(),
    subscribe: vi.fn((next) => { handler = next; return () => { handler = undefined; }; }),
    dispose: vi.fn(),
  };
  return { adapter, emit: (payload: HostRuntimeStatusPayload) => handler?.({ version: "2026-05-15", type: "host.runtimeStatus", payload }) };
}

async function renderPage(props: Partial<React.ComponentProps<typeof SettingsPage>> = {}) {
  container = document.createElement("div");
  document.body.append(container);
  await act(async () => {
    root = ReactDOM.createRoot(container!);
    root.render(<SettingsPage settings={settings} settingsRevision={0} onSettingsChange={vi.fn()} {...props} />);
  });
  await flush();
}

async function flush() {
  await act(async () => { await Promise.resolve(); await new Promise((resolve) => setTimeout(resolve, 0)); });
}

function button(label: string) {
  return Array.from(container!.querySelectorAll("button")).find((item) => item.textContent === label)!;
}

function input(label: string) {
  return Array.from(container!.querySelectorAll("label")).find((item) => item.textContent?.includes(label))!.querySelector("input")!;
}

async function change(element: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SettingsPage", () => {
  it("renders every owned section and performs no chat request or chat rendering", async () => {
    const fetchMock = installFetch();
    await renderPage();

    expect(container?.textContent).toContain("Runtime");
    expect(container?.textContent).toContain("Providers & models");
    expect(container?.textContent).toContain("Account login");
    expect(container?.textContent).toContain("Diagnostics");
    expect(container?.querySelector(".chat-workbench")).toBeNull();
    expect(container?.querySelector("[data-testid='chat-composer']")).toBeNull();
    expect(container?.textContent).not.toContain("Send");
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls.some((url) => /\/v1\/chats(?:\/|$)|subscribe/.test(url))).toBe(false);
  });

  it("uses an accessible local section tablist with status summaries", async () => {
    installFetch();
    await renderPage();

    const tablist = container!.querySelector<HTMLElement>("[role='tablist']")!;
    const tabs = Array.from(tablist.querySelectorAll<HTMLButtonElement>("[role='tab']"));
    expect(tablist.getAttribute("aria-orientation")).toBe("vertical");
    expect(tabs.map((tab) => tab.textContent?.replace("›", ""))).toEqual(["Runtime", "Providers & models", "Account login", "Diagnostics"]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(tabs[0].tabIndex).toBe(0);
    expect(container!.querySelector<HTMLElement>("#settings-runtime")!.hidden).toBe(false);
    expect(container!.querySelector<HTMLElement>("#settings-providers")!.hidden).toBe(true);
    expect(container!.querySelector("[aria-label='Settings status summary']")?.textContent).toContain("RuntimeConnected");
    expect(container!.querySelector("[aria-label='Settings status summary']")?.textContent).toContain("Providers1 configured");

    await act(async () => tabs[1].click());
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(tabs[1].tabIndex).toBe(0);
    expect(container!.querySelector<HTMLElement>("#settings-runtime")!.hidden).toBe(true);
    expect(container!.querySelector<HTMLElement>("#settings-providers")!.hidden).toBe(false);
    expect(window.location.hash).toBe("");
  });

  it("supports arrow, Home, and End keyboard navigation between sections", async () => {
    installFetch();
    await renderPage();
    const tabs = Array.from(container!.querySelectorAll<HTMLButtonElement>("[role='tab']"));

    await act(async () => tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    await act(async () => tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    await act(async () => tabs[1].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
    expect(document.activeElement).toBe(tabs[3]);
    expect(container!.querySelector<HTMLElement>("#settings-diagnostics")!.hidden).toBe(false);
    await act(async () => tabs[3].dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
    expect(document.activeElement).toBe(tabs[0]);
  });

  it("exposes scoped shell, responsive layout, and card hierarchy classes", async () => {
    installFetch();
    await renderPage();

    expect(container!.querySelector("main.settings-page-shell.host-browser")).not.toBeNull();
    expect(container!.querySelector(".settings-readiness .settings-readiness-statuses")).not.toBeNull();
    expect(container!.querySelector(".settings-layout > .settings-section-nav")).not.toBeNull();
    expect(container!.querySelector(".settings-layout > .settings-section-content")).not.toBeNull();
    expect(container!.querySelectorAll(".settings-section-card[role='tabpanel']")).toHaveLength(4);
    expect(container!.querySelector(".workbench-surface-toolbar")).toBeNull();
  });

  it("keeps runtime and provider secrets transient while runtime-owned controls work", async () => {
    const fetchMock = installFetch();
    const onSettingsChange = vi.fn();
    await renderPage({ onSettingsChange });

    expect(container?.textContent).not.toContain("hidden-runtime-token");
    expect((input("Session token") as HTMLInputElement).value).toBe("");
    await change(input("Session token"), "replacement-runtime-token");
    await act(async () => button("Apply Session token").click());
    expect(onSettingsChange).toHaveBeenCalledWith(expect.objectContaining({ token: "replacement-runtime-token" }));

    await change(input("Provider API key"), "raw-provider-secret");
    await act(async () => container!.querySelector<HTMLFormElement>("[aria-label='Provider editor']")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await flush();
    expect(input("Provider API key").value).toBe("");
    expect(container?.textContent).not.toContain("raw-provider-secret");
    expect(container?.textContent).not.toContain("must-not-render");
    const saveCall = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/v1/providers") && (init as RequestInit | undefined)?.method === "POST");
    expect(String((saveCall?.[1] as RequestInit).body)).toContain("raw-provider-secret");

    await act(async () => button("Try Demo Mode").click());
    await flush();
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/v1/demo-mode") && (init as RequestInit | undefined)?.method === "POST")).toBe(true);
  });

  it("patches an existing provider without replacing models, capabilities, or its saved secret", async () => {
    const fetchMock = installFetch();
    await renderPage();

    await act(async () => button("Edit").click());
    expect(Array.from(container!.querySelectorAll("label")).some((item) => item.textContent?.includes("Model id"))).toBe(false);
    await change(input("Display name"), "Renamed local provider");
    await act(async () => container!.querySelector<HTMLFormElement>("[aria-label='Provider editor']")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await flush();

    const patchCall = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/v1/providers/local") && (init as RequestInit | undefined)?.method === "PATCH");
    const body = JSON.parse(String((patchCall?.[1] as RequestInit).body)) as Record<string, unknown>;
    expect(body).toMatchObject({ displayName: "Renamed local provider", auth: { type: "none" } });
    expect(body).not.toHaveProperty("models");
    expect(body).not.toHaveProperty("capabilities");
    expect(body).not.toHaveProperty("id");
    expect(body.auth as Record<string, unknown>).not.toHaveProperty("apiKey");
  });

  it("preserves host-managed restrictions and never renders its hidden token", async () => {
    installFetch();
    const onSettingsChange = vi.fn();
    await renderPage({ settings: { baseUrl: "/panel/runtime", token: "host-secret", runtimeAccess: "same_origin_proxy" }, host: "vscode", onSettingsChange });

    expect(input("Runtime base URL").readOnly).toBe(true);
    expect(Array.from(container!.querySelectorAll("label")).some((item) => item.textContent?.includes("Session token"))).toBe(false);
    expect(container?.textContent).not.toContain("host-secret");
    expect(container?.textContent).toContain("in-memory Session token is never displayed");
    expect(onSettingsChange).not.toHaveBeenCalled();
  });

  it.each(["vscode", "jetbrains"] as const)("keeps the heading and Back action visible for the %s host", async (host) => {
    installFetch();
    const onBackToProjects = vi.fn();
    await renderPage({ host, onBackToProjects });

    expect(container?.querySelector(".settings-header h1")?.textContent).toBe("Settings");
    expect(container?.querySelector(".hero")).toBeNull();
    await act(async () => button("Back to Projects").click());
    expect(onBackToProjects).toHaveBeenCalledOnce();
  });

  it("accepts only current-authority lifecycle status and refreshes provider auth", async () => {
    let resolveAuth!: (response: Response) => void;
    const authResponse = new Promise<Response>((resolve) => { resolveAuth = resolve; });
    const fetchMock = installFetch({ authResponse });
    const bridge = bridgeAdapter("vscode");
    let currentAuthority = "authority-current";
    await renderPage({
      host: "vscode",
      bridgeAdapter: bridge.adapter,
      runtimeAuthorityKey: "authority-current",
      getCurrentRuntimeAuthorityKey: () => currentAuthority,
    });
    const authRequestsBeforeLifecycle = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/v1/provider-auth/openai/status")).length;

    await act(async () => bridge.emit(runtimeStatus("vscode")));
    expect(container?.textContent).toContain("connected · VS Code reports runtime connected");
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/v1/provider-auth/openai/status"))).toHaveLength(authRequestsBeforeLifecycle + 1);

    currentAuthority = "authority-next";
    await act(async () => bridge.emit({ ...runtimeStatus("vscode"), lifecycle: "degraded", diagnosis: "runtime degraded" }));
    expect(container?.textContent).not.toContain("degraded ·");
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/v1/provider-auth/openai/status"))).toHaveLength(authRequestsBeforeLifecycle + 1);
    resolveAuth(await json(authBase));
    await flush();
  });

  it("supports pending login manual exchange without exposing session, state, or code", async () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const fetchMock = installFetch();
    await renderPage();
    await act(async () => button("Start account login").click());
    await flush();

    expect(container?.textContent).toContain("pending");
    expect(button("Start account login")).toBeUndefined();
    expect(button("Reconnect account")).toBeUndefined();
    expect(button("Cancel login")).not.toBeUndefined();
    expect(container?.textContent).not.toContain("private-session");
    expect(container?.textContent).not.toContain("safe-state");
    await change(input("Authorization code"), "one-time-code");
    await act(async () => container!.querySelector<HTMLFormElement>("[aria-label='Manual authorization exchange']")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await flush();
    expect(container?.querySelector("[aria-label='Manual authorization exchange']")).toBeNull();
    expect(container?.textContent).not.toContain("one-time-code");
    const exchange = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/exchange"));
    expect(String((exchange?.[1] as RequestInit).body)).toContain("one-time-code");
  });

  it("renders connected account state and disconnects through the runtime", async () => {
    const fetchMock = installFetch({ auth: { ...authBase, configured: true, status: "connected", authSource: "oauth", accountLabel: "person@example.test", redacted: "private-redaction" } });
    await renderPage();

    expect(container?.textContent).toContain("connected");
    expect(container?.textContent).not.toContain("person@example.test");
    expect(container?.textContent).not.toContain("private-redaction");
    expect(button("Reconnect account")).not.toBeUndefined();
    await act(async () => button("Disconnect account").click());
    await flush();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/v1/provider-auth/openai/disconnect"))).toBe(true);
  });

  it.each([
    ["Reconnect account", "startResponse"],
    ["Disconnect account", "disconnectResponse"],
  ] as const)("keeps connected account status when %s fails", async (label, responseKey) => {
    const failedResponse = json({ error: "failed access_token=private-token" }, 503);
    const fetchMock = installFetch({
      auth: { ...authBase, configured: true, status: "connected", authSource: "oauth", accountLabel: "private-account", redacted: "private-redaction" },
      [responseKey]: failedResponse,
    });
    await renderPage();

    await act(async () => button(label).click());
    await flush();

    expect(container?.textContent).toContain("connected");
    expect(container?.textContent).not.toContain("pending");
    expect(container?.textContent).not.toContain("not_configured");
    expect(container?.textContent).not.toContain("private-token");
    expect(container?.textContent).not.toContain("private-account");
    expect(container?.textContent).not.toContain("private-redaction");
    expect(button("Reconnect account")).not.toBeUndefined();
    expect(button("Disconnect account")).not.toBeUndefined();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith(responseKey === "startResponse" ? "/start" : "/disconnect"))).toHaveLength(1);
  });

  it.each([
    ["not_configured", false, "none", true, false],
    ["login_available", false, "none", true, false],
    ["login_unavailable", false, "none", false, false],
    ["api_key_configured", true, "api_key", true, false],
    ["expired", true, "oauth", true, true],
    ["revoked", true, "oauth", true, true],
    ["error", true, "oauth", true, true],
  ] as const)("renders truthful account actions for %s", async (status, configured, authSource, supportsLogin, canDisconnect) => {
    installFetch({ auth: { ...authBase, status, configured, authSource, supportsLogin } });
    await renderPage();

    const action = ["expired", "revoked", "error"].includes(status) ? "Reconnect account" : "Start account login";
    expect(button(action) !== undefined).toBe(supportsLogin || action === "Reconnect account");
    expect(button("Disconnect account") !== undefined).toBe(canDisconnect);
  });

  it("sanitizes errors and keeps diagnostics aggregate-only", async () => {
    installFetch({ failPing: true });
    await renderPage();

    expect(container?.textContent).toContain("private-token <script>");
    expect(container?.innerHTML).not.toContain("<script>");
    expect(container?.textContent).toContain("1 available");
    expect(container?.textContent).toContain("1 configured");
    expect(container?.textContent).not.toContain("secret-model-id");
    expect(container?.textContent).not.toContain("Private Model");
  });
});
