import React, { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectRouterShell } from "./ProjectRouterShell";
import { navigateProjectRoute } from "./services/projectRouting";
import type { RuntimeSettings } from "./services/runtimeClient";

vi.mock("./App", () => ({
  App: ({ route }: { route: { kind: string; page?: string; chatId?: string } }) => <div data-testid="app-route">{[route.kind, route.page, route.chatId].filter(Boolean).join(":")}</div>,
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
  CurrentWorkspaceDashboard: ({ onOpen }: { onOpen: (route: object) => void }) => <div data-testid="workspace-dashboard"><button type="button" onClick={() => onOpen({ kind: "project", projectId: "prj_abcdefghijklmnopqrstuA", page: "chat", chatId: "chat-new" })}>Start new chat</button></div>,
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

    await sendHostReady("ready-2", "/panel/panel-next");

    expect(container.querySelector("[data-testid='app-route']")).toBeNull();
    expect(container.querySelector("[data-testid='workspace-dashboard']")).not.toBeNull();
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

    await sendHostReady("ready-1");

    expect(container.querySelector("[data-testid='app-route']")?.textContent).toBe("project:chat:chat-new");
    expect(container.querySelector("[data-testid='workspace-dashboard']")).toBeNull();
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

    await sendWorkspaceBinding("ready-1", otherProjectId);

    expect(container.querySelector("[data-testid='app-route']")).toBeNull();
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
