// @vitest-environment jsdom
import React, { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectRouterShell } from "./ProjectRouterShell";
import { navigateProjectRoute } from "./services/projectRouting";
import type { RuntimeSettings } from "./services/runtimeClient";

const appRenderCalls = vi.hoisted(() => [] as string[]);
const appAuthorityCalls = vi.hoisted(() => [] as Array<{ hostedAuthorityKey?: string; hostReadyGeneration?: string | null; runtimeSettings?: RuntimeSettings }>);
const deferredHostedOpen = vi.hoisted(() => ({ run: null as null | (() => boolean) }));
vi.mock("./App", () => ({
  App: ({ route, hostedAuthorityKey, hostReadyGeneration, runtimeSettings }: { route: { kind: string; page?: string; chatId?: string }; hostedAuthorityKey?: string; hostReadyGeneration?: string | null; runtimeSettings?: RuntimeSettings }) => {
    const [context, setContext] = React.useState("");
    const label = [route.kind, route.page, route.chatId].filter(Boolean).join(":");
    appRenderCalls.push(label);
    appAuthorityCalls.push({ hostedAuthorityKey, hostReadyGeneration, runtimeSettings });
    React.useEffect(() => {
      const receiveContext = (event: MessageEvent) => {
        if (event.data?.type !== "host.contextSnapshot" || event.data?.requestId !== hostReadyGeneration) return;
        setContext(event.data.payload?.selection?.text ?? "");
      };
      window.addEventListener("message", receiveContext);
      return () => window.removeEventListener("message", receiveContext);
    }, [hostReadyGeneration]);
    const authorized = Boolean(hostedAuthorityKey && hostReadyGeneration && runtimeSettings?.baseUrl);
    return <div>
      <div data-testid="app-route">{label}</div>
      <div data-testid="app-runtime-state">{authorized ? `runtime-ready:${hostReadyGeneration}` : "runtime-gated"}</div>
      {context && <div data-testid="app-context">{context}</div>}
    </div>;
  },
}));

vi.mock("./components/ProjectShell", () => ({
  ProjectShell: ({ children }: { children?: React.ReactNode }) => <div data-testid="project-shell">{children}</div>,
}));
let hubSettings: RuntimeSettings | undefined;
vi.mock("./components/ProjectHub", () => ({
  ProjectHub: ({ settings }: { settings: RuntimeSettings }) => { hubSettings = settings; return <div>Projects</div>; },
}));
vi.mock("./components/LegacyData", () => ({
  LegacyData: () => <div data-testid="legacy-data">legacy</div>,
}));
vi.mock("./components/CurrentWorkspaceDashboard", () => ({
  CurrentWorkspaceDashboard: ({ getAuthorityToken, onOpen }: { getAuthorityToken: (selectedProjectId?: string) => string | null; onOpen: (route: object, token: string, selectedProjectId?: string) => boolean }) => <div data-testid="workspace-dashboard">
    <button type="button" onClick={() => { const token = getAuthorityToken(); if (token) onOpen({ kind: "project", projectId: "prj_abcdefghijklmnopqrstuA", page: "chat", chatId: "chat-new" }, token); }}>Start new chat</button>
    <button type="button" onClick={() => { const token = getAuthorityToken("prj_abcdefghijklmnopqrstuA"); if (token) onOpen({ kind: "project", projectId: "prj_abcdefghijklmnopqrstuA", page: "chat", chatId: "chat-selected" }, token, "prj_abcdefghijklmnopqrstuA"); }}>Start selected chat</button>
    <button type="button" onClick={() => { const token = getAuthorityToken("prj_abcdefghijklmnopqrstuA"); if (token) onOpen({ kind: "project", projectId: "prj_bcdefghijklmnopqrstuvQ", page: "chat", chatId: "chat-mismatch" }, token, "prj_abcdefghijklmnopqrstuA"); }}>Start mismatched chat</button>
    <button type="button" onClick={() => { const token = getAuthorityToken(); if (token) onOpen({ kind: "settings" }, token); }}>Settings</button>
    <button type="button" onClick={() => { const token = getAuthorityToken(); if (token) onOpen({ kind: "legacy" }, token); }}>Legacy data</button>
    <button type="button" onClick={() => { const token = getAuthorityToken(); if (token) deferredHostedOpen.run = () => onOpen({ kind: "project", projectId: "prj_abcdefghijklmnopqrstuA", page: "chat", chatId: "chat-deferred" }, token); }}>Capture deferred chat</button>
    <button type="button" onClick={() => { const token = getAuthorityToken("prj_abcdefghijklmnopqrstuA"); if (token) deferredHostedOpen.run = () => onOpen({ kind: "project", projectId: "prj_abcdefghijklmnopqrstuA", page: "chat", chatId: "chat-deferred-selected" }, token, "prj_abcdefghijklmnopqrstuA"); }}>Capture deferred selected chat</button>
  </div>,
}));

let root: ReactDOM.Root | undefined;
const projectId = "prj_abcdefghijklmnopqrstuA";
const otherProjectId = "prj_bcdefghijklmnopqrstuvQ";

async function sendHostReady(requestId: string, runtimeProxyBaseUrl = "/panel/panel-test") {
  await act(async () => window.dispatchEvent(new MessageEvent("message", { data: {
    version: "2026-05-15",
    type: "host.ready",
    requestId,
    payload: { runtimeProxyBaseUrl },
  } })));
}

async function sendWorkspaceBinding(requestId: string, boundProjectId: string = projectId) {
  await act(async () => window.dispatchEvent(new MessageEvent("message", { data: {
    version: "2026-05-15",
    type: "host.workspaceBinding",
    requestId,
    payload: { protocolVersion: "workspace_binding_v1", requestId, state: "auto_bound", projectId: boundProjectId, displayName: "Workspace" },
  } })));
}

async function sendSelectionBinding(requestId: string, reason: "no_root" | "multiple_roots" | "root_unavailable" = "multiple_roots") {
  await act(async () => window.dispatchEvent(new MessageEvent("message", { data: {
    version: "2026-05-15",
    type: "host.workspaceBinding",
    requestId,
    payload: { protocolVersion: "workspace_binding_v1", requestId, state: "selection_required", reason },
  } })));
}

async function openHostedChat(container: HTMLElement, requestId = "ready-1") {
  await sendHostReady(requestId);
  await sendWorkspaceBinding(requestId);
  act(() => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Start new chat")?.click());
  expect(container.querySelector("[data-testid='app-route']")?.textContent).toBe("project:chat:chat-new");
}

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  hubSettings = undefined;
  appRenderCalls.length = 0;
  appAuthorityCalls.length = 0;
  deferredHostedOpen.run = null;
  delete window.__yetAiInitialRuntimeConfig;
});

describe("ProjectRouterShell", () => {
  it("replaces the root URL with projects and renders the project hub route", async () => {
    window.history.replaceState(null, "", "/");
    const replaceState = vi.spyOn(window.history, "replaceState");
    const container = document.createElement("div");
    document.body.append(container);

    await act(async () => {
      root = ReactDOM.createRoot(container);
      root.render(<ProjectRouterShell />);
    });

    expect(replaceState).toHaveBeenCalledWith(null, "", "/projects");
    expect(window.location.pathname).toBe("/projects");
    expect(container.textContent).toContain("Projects");
    replaceState.mockRestore();
  });

  it.each([
    "/panel/panel-test/hosted-chat",
    "/vscode/hosted-chat",
  ])("denies the hosted chat path without wrapper bootstrap evidence: %s", async (pathname) => {
    window.history.replaceState(null, "", pathname);
    const container = document.createElement("div");
    document.body.append(container);

    await act(async () => {
      root = ReactDOM.createRoot(container);
      root.render(<ProjectRouterShell />);
    });

    expect(container.textContent).toContain("Not Found");
    expect(container.querySelector("[data-testid='app-route']")).toBeNull();
  });

  it("denies the hosted chat bootstrap flag on a non-panel path", async () => {
    window.history.replaceState(null, "", "/projects");
    window.__yetAiInitialRuntimeConfig = { entryMode: "hosted_chat" };
    const container = document.createElement("div");
    document.body.append(container);

    await act(async () => {
      root = ReactDOM.createRoot(container);
      root.render(<ProjectRouterShell />);
    });

    expect(container.textContent).toContain("Projects");
    expect(container.querySelector("[data-testid='app-route']")).toBeNull();
  });

  it.each([
    "/panel/panel-test/hosted-chat",
    "/vscode/hosted-chat",
  ])("renders the hosted workspace dashboard only with the strict wrapper path and bootstrap flag: %s", async (pathname) => {
    window.history.replaceState(null, "", pathname);
    window.__yetAiInitialRuntimeConfig = { entryMode: "hosted_chat" };
    const container = document.createElement("div");
    document.body.append(container);

    await act(async () => {
      root = ReactDOM.createRoot(container);
      root.render(<ProjectRouterShell />);
    });

    expect(window.location.pathname).toBe(pathname);
    expect(container.querySelector("[data-testid='workspace-dashboard']")).not.toBeNull();
    expect(container.querySelector("[data-testid='app-route']")).toBeNull();

    await openHostedChat(container);
    const currentAuthority = appAuthorityCalls[appAuthorityCalls.length - 1];
    expect(currentAuthority).toMatchObject({ hostReadyGeneration: "ready-1" });
    expect(currentAuthority?.hostedAuthorityKey).toBeTruthy();
  });

  it("returns an open hosted chat to the dashboard for a new accepted ready generation", async () => {
    window.history.replaceState(null, "", "/panel/panel-test/hosted-chat");
    window.__yetAiInitialRuntimeConfig = { entryMode: "hosted_chat" };
    const container = document.createElement("div");
    document.body.append(container);
    await act(async () => {
      root = ReactDOM.createRoot(container);
      root.render(<ProjectRouterShell />);
    });
    await openHostedChat(container);
    const rendersBeforeRebind = appRenderCalls.length;

    await sendHostReady("ready-2", "/panel/panel-next");

    expect(appRenderCalls).toHaveLength(rendersBeforeRebind);
    expect(container.querySelector("[data-testid='app-route']")).toBeNull();
    expect(container.querySelector("[data-testid='workspace-dashboard']")).not.toBeNull();
  });

  it("remounts dashboard chat with current runtime authority and context without replaying host.ready", async () => {
    window.history.replaceState(null, "", "/panel/panel-test/hosted-chat");
    window.__yetAiInitialRuntimeConfig = { entryMode: "hosted_chat" };
    const container = document.createElement("div");
    document.body.append(container);
    let hostReadyDispatches = 0;
    const countHostReady = (event: MessageEvent) => {
      if (event.data?.type === "host.ready") hostReadyDispatches += 1;
    };
    window.addEventListener("message", countHostReady);
    await act(async () => {
      root = ReactDOM.createRoot(container);
      root.render(<ProjectRouterShell />);
    });

    await sendHostReady("ready-remount");
    await sendWorkspaceBinding("ready-remount");
    expect(container.querySelector("[data-testid='workspace-dashboard']")).not.toBeNull();
    act(() => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Start new chat")?.click());

    expect(hostReadyDispatches).toBe(1);
    expect(container.querySelector("[data-testid='app-route']")?.textContent).toBe("project:chat:chat-new");
    expect(container.querySelector("[data-testid='app-runtime-state']")?.textContent).toBe("runtime-ready:ready-remount");
    expect(appAuthorityCalls[appAuthorityCalls.length - 1]).toMatchObject({
      hostReadyGeneration: "ready-remount",
      runtimeSettings: { baseUrl: "/panel/panel-test", token: "", runtimeAccess: "same_origin_proxy" },
    });

    await act(async () => window.dispatchEvent(new MessageEvent("message", { data: {
      version: "2026-05-15",
      type: "host.contextSnapshot",
      requestId: "ready-stale",
      payload: { selection: { text: "stale remount context" } },
    } })));
    expect(container.textContent).not.toContain("stale remount context");
    await act(async () => window.dispatchEvent(new MessageEvent("message", { data: {
      version: "2026-05-15",
      type: "host.contextSnapshot",
      requestId: "ready-remount",
      payload: { selection: { text: "current remount context" } },
    } })));
    expect(container.querySelector("[data-testid='app-context']")?.textContent).toBe("current remount context");
    expect(hostReadyDispatches).toBe(1);
    window.removeEventListener("message", countHostReady);
  });

  it("rejects a deferred open from an older generation even when the project is unchanged", async () => {
    window.history.replaceState(null, "", "/panel/panel-test/hosted-chat");
    window.__yetAiInitialRuntimeConfig = { entryMode: "hosted_chat" };
    const container = document.createElement("div");
    document.body.append(container);
    await act(async () => {
      root = ReactDOM.createRoot(container);
      root.render(<ProjectRouterShell />);
    });
    await sendHostReady("ready-1");
    await sendWorkspaceBinding("ready-1");
    act(() => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Capture deferred chat")?.click());

    await sendHostReady("ready-2", "/panel/panel-next");
    await sendWorkspaceBinding("ready-2");

    expect(deferredHostedOpen.run?.()).toBe(false);
    expect(container.querySelector("[data-testid='app-route']")).toBeNull();
  });

  it("preserves an open hosted chat for an accepted same-ID retry", async () => {
    window.history.replaceState(null, "", "/panel/panel-test/hosted-chat");
    window.__yetAiInitialRuntimeConfig = { entryMode: "hosted_chat" };
    const container = document.createElement("div");
    document.body.append(container);
    await act(async () => {
      root = ReactDOM.createRoot(container);
      root.render(<ProjectRouterShell />);
    });
    await openHostedChat(container);
    const rendersBeforeRetry = appRenderCalls.length;

    await sendHostReady("ready-1");

    expect(container.querySelector("[data-testid='app-route']")?.textContent).toBe("project:chat:chat-new");
    expect(container.querySelector("[data-testid='workspace-dashboard']")).toBeNull();
    expect(appRenderCalls.length).toBeGreaterThan(rendersBeforeRetry);
  });

  it("re-gates an open hosted project route when its correlated binding changes project", async () => {
    window.history.replaceState(null, "", "/panel/panel-test/hosted-chat");
    window.__yetAiInitialRuntimeConfig = { entryMode: "hosted_chat" };
    const container = document.createElement("div");
    document.body.append(container);
    await act(async () => {
      root = ReactDOM.createRoot(container);
      root.render(<ProjectRouterShell />);
    });
    await openHostedChat(container);
    const rendersBeforeMismatch = appRenderCalls.length;

    await sendWorkspaceBinding("ready-1", otherProjectId);

    expect(appRenderCalls).toHaveLength(rendersBeforeMismatch);
    expect(container.querySelector("[data-testid='app-route']")).toBeNull();
    expect(container.querySelector("[data-testid='workspace-dashboard']")).not.toBeNull();
  });

  it("authorizes only the explicitly selected project for a selection-required binding", async () => {
    window.history.replaceState(null, "", "/panel/panel-test/hosted-chat");
    window.__yetAiInitialRuntimeConfig = { entryMode: "hosted_chat" };
    const container = document.createElement("div");
    document.body.append(container);
    await act(async () => {
      root = ReactDOM.createRoot(container);
      root.render(<ProjectRouterShell />);
    });
    await sendHostReady("ready-1");
    await sendSelectionBinding("ready-1");

    act(() => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Start mismatched chat")?.click());
    expect(container.querySelector("[data-testid='app-route']")).toBeNull();

    act(() => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Start selected chat")?.click());
    expect(container.querySelector("[data-testid='app-route']")?.textContent).toBe("project:chat:chat-selected");
  });

  it("re-gates an explicitly selected route when the stable binding fingerprint changes", async () => {
    window.history.replaceState(null, "", "/panel/panel-test/hosted-chat");
    window.__yetAiInitialRuntimeConfig = { entryMode: "hosted_chat" };
    const container = document.createElement("div");
    document.body.append(container);
    await act(async () => {
      root = ReactDOM.createRoot(container);
      root.render(<ProjectRouterShell />);
    });
    await sendHostReady("ready-1");
    await sendSelectionBinding("ready-1");
    act(() => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Start selected chat")?.click());
    const rendersBeforeReplacement = appRenderCalls.length;

    await sendSelectionBinding("ready-1", "root_unavailable");

    expect(appRenderCalls).toHaveLength(rendersBeforeReplacement);
    expect(container.querySelector("[data-testid='app-route']")).toBeNull();
    expect(container.querySelector("[data-testid='workspace-dashboard']")).not.toBeNull();
  });

  it("rejects deferred explicit selection after a same-project binding replacement", async () => {
    window.history.replaceState(null, "", "/panel/panel-test/hosted-chat");
    window.__yetAiInitialRuntimeConfig = { entryMode: "hosted_chat" };
    const container = document.createElement("div");
    document.body.append(container);
    await act(async () => {
      root = ReactDOM.createRoot(container);
      root.render(<ProjectRouterShell />);
    });
    await sendHostReady("ready-1");
    await sendSelectionBinding("ready-1");
    act(() => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Capture deferred selected chat")?.click());

    await sendSelectionBinding("ready-1", "root_unavailable");

    expect(deferredHostedOpen.run?.()).toBe(false);
    expect(container.querySelector("[data-testid='app-route']")).toBeNull();
  });

  it.each([
    ["Settings", "settings"],
    ["Legacy data", "legacy"],
  ])("authorizes the hosted %s route only for the current auto-bound generation", async (buttonText, expectedRoute) => {
    window.history.replaceState(null, "", "/panel/panel-test/hosted-chat");
    window.__yetAiInitialRuntimeConfig = { entryMode: "hosted_chat" };
    const container = document.createElement("div");
    document.body.append(container);
    await act(async () => {
      root = ReactDOM.createRoot(container);
      root.render(<ProjectRouterShell />);
    });
    await sendHostReady("ready-1");
    await sendWorkspaceBinding("ready-1");

    act(() => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === buttonText)?.click());
    expect(container.querySelector("[data-testid='app-route']")?.textContent).toBe(expectedRoute);
    const rendersBeforeRebind = appRenderCalls.length;

    await sendHostReady("ready-2", "/panel/panel-next");

    expect(appRenderCalls).toHaveLength(rendersBeforeRebind);
    expect(container.querySelector("[data-testid='app-route']")).toBeNull();
    expect(container.querySelector("[data-testid='workspace-dashboard']")).not.toBeNull();
  });

  it.each(["Settings", "Legacy data"])("rejects the hosted %s action before the current generation is auto-bound", async (buttonText) => {
    window.history.replaceState(null, "", "/panel/panel-test/hosted-chat");
    window.__yetAiInitialRuntimeConfig = { entryMode: "hosted_chat" };
    const container = document.createElement("div");
    document.body.append(container);
    await act(async () => {
      root = ReactDOM.createRoot(container);
      root.render(<ProjectRouterShell />);
    });

    act(() => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === buttonText)?.click());

    expect(appRenderCalls).toHaveLength(0);
    expect(container.querySelector("[data-testid='workspace-dashboard']")).not.toBeNull();
  });

  it("applies trusted live host runtime settings to the hub", async () => {
    window.history.replaceState(null, "", "/projects");
    const container = document.createElement("div");
    document.body.append(container);
    await act(async () => {
      root = ReactDOM.createRoot(container);
      root.render(<ProjectRouterShell />);
    });

    await act(async () => window.dispatchEvent(new MessageEvent("message", { data: {
      version: "2026-05-15",
      type: "host.ready",
      requestId: "ready-direct",
      payload: { runtimeUrl: "http://127.0.0.1:9123", sessionToken: "hidden-session" },
    } })));

    expect(hubSettings).toEqual({ baseUrl: "http://127.0.0.1:9123", token: "hidden-session", runtimeAccess: "direct" });
    expect(container.textContent).not.toContain("hidden-session");
  });

  it("prefers proxy host settings and ignores a stale direct downgrade", async () => {
    window.history.replaceState(null, "", "/projects");
    const container = document.createElement("div");
    document.body.append(container);
    await act(async () => {
      root = ReactDOM.createRoot(container);
      root.render(<ProjectRouterShell />);
    });

    await act(async () => window.dispatchEvent(new MessageEvent("message", { data: {
      version: "2026-05-15",
      type: "host.ready",
      requestId: "ready-proxy",
      payload: { runtimeUrl: "http://127.0.0.1:9123", runtimeProxyBaseUrl: "/panel/panel-projects", sessionToken: "server-side" },
    } })));
    expect(hubSettings).toEqual({ baseUrl: "/panel/panel-projects", token: "", runtimeAccess: "same_origin_proxy" });

    await act(async () => window.dispatchEvent(new MessageEvent("message", { data: {
      version: "2026-05-15",
      type: "host.ready",
      requestId: "ready-stale",
      payload: { runtimeUrl: "http://127.0.0.1:9777", sessionToken: "stale-direct" },
    } })));
    expect(hubSettings).toEqual({ baseUrl: "/panel/panel-projects", token: "", runtimeAccess: "same_origin_proxy" });
  });

  it("renders programmatic navigation immediately", () => {
    window.history.replaceState(null, "", "/projects/legacy");
    const container = document.createElement("div");
    document.body.append(container);
    act(() => {
      root = ReactDOM.createRoot(container);
      root.render(<ProjectRouterShell />);
    });
    expect(container.querySelector("[data-testid='legacy-data']")?.textContent).toBe("legacy");

    act(() => navigateProjectRoute(window, { kind: "settings" }));

    expect(container.querySelector("[data-testid='app-route']")?.textContent).toBe("settings");
  });

  it("follows real browser back and forward popstate changes across chat and page routes", () => {
    const browserProjectId = projectId as never;
    window.history.replaceState(null, "", `/p/${browserProjectId}/chat/chat-a`);
    const container = document.createElement("div");
    document.body.append(container);
    act(() => {
      root = ReactDOM.createRoot(container);
      root.render(<ProjectRouterShell />);
    });
    expect(container.querySelector("[data-testid='app-route']")?.textContent).toBe("project:chat:chat-a");

    window.history.pushState(null, "", `/p/${browserProjectId}/memory`);
    act(() => window.dispatchEvent(new PopStateEvent("popstate")));
    expect(container.querySelector("[data-testid='app-route']")?.textContent).toBe("project:memory");

    window.history.replaceState(null, "", `/p/${browserProjectId}/chat/chat-a`);
    act(() => window.dispatchEvent(new PopStateEvent("popstate")));
    expect(container.querySelector("[data-testid='app-route']")?.textContent).toBe("project:chat:chat-a");

    act(() => root?.unmount());
    root = undefined;
    window.history.replaceState(null, "", `/p/${browserProjectId}/agent`);
    act(() => window.dispatchEvent(new PopStateEvent("popstate")));
    expect(container.textContent).toBe("");
  });
});
