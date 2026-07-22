import { describe, expect, it, vi } from "vitest";
import { buildProjectRoute, navigateProjectRoute, parseProjectId, parseProjectRoute, subscribeToProjectRoute, type AppRoute } from "./projectRouting";

const projectId = "prj_abcdefghijklmnopqrstuv";
const validatedProjectId = parseProjectId(projectId)!;

const routes: Array<{ path: string; route: Exclude<AppRoute, { kind: "not_found" }> }> = [
  { path: "/projects", route: { kind: "projects" } },
  { path: "/projects/legacy", route: { kind: "legacy" } },
  { path: "/settings", route: { kind: "settings" } },
  { path: `/p/${projectId}/`, route: { kind: "project", projectId: validatedProjectId, page: "home" } },
  { path: `/p/${projectId}/chat`, route: { kind: "project", projectId: validatedProjectId, page: "chat" } },
  { path: `/p/${projectId}/chat/chat%2Fone`, route: { kind: "project", projectId: validatedProjectId, page: "chat", chatId: "chat/one" } },
  { path: `/p/${projectId}/memory`, route: { kind: "project", projectId: validatedProjectId, page: "memory" } },
  { path: `/p/${projectId}/agent`, route: { kind: "project", projectId: validatedProjectId, page: "agent" } },
];

describe("projectRouting", () => {
  it.each(routes)("round trips $path", ({ path, route }) => {
    expect(parseProjectRoute(path)).toEqual(route);
    expect(buildProjectRoute(route)).toBe(path);
  });

  it.each([
    "/", "/projects/", "/projects/legacy/more", `/p/${projectId}`, `/p/${projectId}/chat/`,
    `/p/${projectId}/memory/more`, "/p/prj_short/chat", `/p/${projectId}/unknown`,
    `/p/${projectId}/chat/%2f`, `/p/${projectId}/chat/%ZZ`,
  ])("rejects malformed or extra path %s", (path) => {
    expect(parseProjectRoute(path)).toEqual({ kind: "not_found" });
  });

  it("validates only contract-shaped project ids", () => {
    expect(parseProjectId(projectId)).toBe(projectId);
    expect(parseProjectId(`${projectId}/chat`)).toBeNull();
    expect(parseProjectId("prj_abcdefghijklmnopqrstu%2F")).toBeNull();
  });

  it("navigates through the supplied history without global state", () => {
    const history = { pushState: vi.fn(), replaceState: vi.fn() };
    expect(navigateProjectRoute(history, { kind: "project", projectId: parseProjectId(projectId)!, page: "chat" })).toBe(`/p/${projectId}/chat`);
    expect(history.pushState).toHaveBeenCalledWith(null, "", `/p/${projectId}/chat`);
    navigateProjectRoute(history, { kind: "projects" }, true);
    expect(history.replaceState).toHaveBeenCalledWith(null, "", "/projects");
  });

  it("parses history popstate paths and unsubscribes", () => {
    let handler: (() => void) | undefined;
    const target = {
      location: { pathname: "/projects" } as Location,
      addEventListener: vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => { handler = listener as () => void; }),
      removeEventListener: vi.fn(),
    };
    const listener = vi.fn();
    const unsubscribe = subscribeToProjectRoute(target, listener);
    target.location.pathname = `/p/${projectId}/chat`;
    handler?.();
    expect(listener).toHaveBeenCalledWith({ kind: "project", projectId, page: "chat" });
    unsubscribe();
    expect(target.removeEventListener).toHaveBeenCalledWith("popstate", handler);
  });
});
