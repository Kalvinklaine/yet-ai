// @vitest-environment jsdom
import React, { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./SettingsPage";
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

function installFetch(options: { auth?: Record<string, unknown>; failPing?: boolean } = {}) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/v1/ping")) return options.failPing ? json({ message: "private-token <script>" }, 503) : json({ productId: "yet-ai", displayName: "Yet AI", version: "1", ready: true, serverTime: "now" });
    if (url.endsWith("/v1/caps")) return json({ productId: "yet-ai", protocolVersion: "1", runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: [], features: {}, providers: [], ide: { bridge: false, lsp: false } });
    if (url.endsWith("/v1/models")) return json({ models: [{ id: "secret-model-id", displayName: "Private Model" }] });
    if (url.endsWith("/v1/demo-mode") && init?.method === "POST") return json({ enabled: true, providerId: "yet-demo", modelId: "yet-demo-chat", displayName: "Yet AI Demo Mode", cloudRequired: false, providerAccess: "direct", message: "enabled" });
    if (url.endsWith("/v1/demo-mode")) return json({ enabled: false, providerId: "yet-demo", modelId: "yet-demo-chat", displayName: "Yet AI Demo Mode", cloudRequired: false, providerAccess: "direct", message: "disabled" });
    if (url.endsWith("/v1/providers") && init?.method === "POST") return json({ id: "saved", kind: "openai-compatible", displayName: "Saved", enabled: true, baseUrl: "https://example.com/v1", auth: { type: "api_key", configured: true, redacted: "must-not-render" }, models: [], capabilities: { chat: true, completion: false, embeddings: false } });
    if (url.endsWith("/v1/providers")) return json({ providers: [{ id: "local", kind: "ollama", displayName: "Local provider", enabled: true, baseUrl: "http://127.0.0.1:11434", auth: { type: "none", configured: true }, models: [{ id: "llama", displayName: "Llama" }], capabilities: { chat: true, completion: false, embeddings: false } }], cloudRequired: false, providerAccess: "direct" });
    if (url.endsWith("/v1/providers/local/test")) return json({ ok: true, providerId: "local", status: "reachable", message: "Provider reached", cloudRequired: false });
    if (url.endsWith("/v1/provider-auth/openai/status")) return json(options.auth ?? authBase);
    if (url.endsWith("/v1/provider-auth/openai/start")) return json({ ...authBase, success: true, status: "pending", authSource: "oauth", authorizationUrl: "https://login.example.test/authorize?state=safe-state", sessionId: "private-session" });
    if (url.endsWith("/v1/provider-auth/openai/exchange")) return json({ ...authBase, success: true, configured: true, status: "connected", authSource: "oauth", accountLabel: "person@example.test" });
    if (url.endsWith("/v1/provider-auth/openai/disconnect")) return json({ ...authBase, success: true, status: "not_configured" });
    return json({}, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
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

  it("supports pending login manual exchange without exposing session, state, or code", async () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const fetchMock = installFetch();
    await renderPage();
    await act(async () => button("Start account login").click());
    await flush();

    expect(container?.textContent).toContain("pending");
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
    await act(async () => button("Disconnect account").click());
    await flush();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/v1/provider-auth/openai/disconnect"))).toBe(true);
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
