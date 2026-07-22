import React, { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectRouterShell } from "./ProjectRouterShell";
import { navigateProjectRoute } from "./services/projectRouting";

vi.mock("./App", () => ({
  App: ({ route }: { route: { kind: string } }) => <div data-testid="app-route">{route.kind}</div>,
}));

let root: ReactDOM.Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

describe("ProjectRouterShell", () => {
  it("replaces the root URL with projects and renders the project hub route", () => {
    window.history.replaceState(null, "", "/");
    const replaceState = vi.spyOn(window.history, "replaceState");
    const container = document.createElement("div");
    document.body.append(container);

    act(() => {
      root = ReactDOM.createRoot(container);
      root.render(<ProjectRouterShell />);
    });

    expect(replaceState).toHaveBeenCalledWith(null, "", "/projects");
    expect(window.location.pathname).toBe("/projects");
    expect(container.textContent).toContain("Projects");
    replaceState.mockRestore();
  });

  it("renders programmatic navigation immediately", () => {
    window.history.replaceState(null, "", "/projects/legacy");
    const container = document.createElement("div");
    document.body.append(container);
    act(() => {
      root = ReactDOM.createRoot(container);
      root.render(<ProjectRouterShell />);
    });
    expect(container.querySelector("[data-testid='app-route']")?.textContent).toBe("legacy");

    act(() => navigateProjectRoute(window, { kind: "settings" }));

    expect(container.querySelector("[data-testid='app-route']")?.textContent).toBe("settings");
  });
});
