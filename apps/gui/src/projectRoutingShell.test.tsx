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

let root: ReactDOM.Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  hubSettings = undefined;
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
      payload: { runtimeUrl: "http://127.0.0.1:9123", sessionToken: "hidden-session" },
    } })));

    expect(hubSettings).toEqual({ baseUrl: "http://127.0.0.1:9123", token: "hidden-session", runtimeAccess: "direct" });
    expect(container.textContent).not.toContain("hidden-session");
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
    const projectId = "prj_abcdefghijklmnopqrstuv" as never;
    window.history.replaceState(null, "", `/p/${projectId}/chat/chat-a`);
    const container = document.createElement("div");
    document.body.append(container);
    act(() => {
      root = ReactDOM.createRoot(container);
      root.render(<ProjectRouterShell />);
    });
    expect(container.querySelector("[data-testid='app-route']")?.textContent).toBe("project:chat:chat-a");

    window.history.pushState(null, "", `/p/${projectId}/memory`);
    act(() => window.dispatchEvent(new PopStateEvent("popstate")));
    expect(container.querySelector("[data-testid='app-route']")?.textContent).toBe("project:memory");

    window.history.replaceState(null, "", `/p/${projectId}/chat/chat-a`);
    act(() => window.dispatchEvent(new PopStateEvent("popstate")));
    expect(container.querySelector("[data-testid='app-route']")?.textContent).toBe("project:chat:chat-a");

    act(() => root?.unmount());
    root = undefined;
    window.history.replaceState(null, "", `/p/${projectId}/agent`);
    act(() => window.dispatchEvent(new PopStateEvent("popstate")));
    expect(container.textContent).toBe("");
  });
});
