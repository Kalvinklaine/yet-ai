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
  { path: `/p/${projectId}/chat/chat_one-2`, route: { kind: "project", projectId: validatedProjectId, page: "chat", chatId: "chat_one-2" } },
  { path: `/p/${projectId}/memory`, route: { kind: "project", projectId: validatedProjectId, page: "memory" } },
  { path: `/p/${projectId}/agent`, route: { kind: "project", projectId: validatedProjectId, page: "agent" } },
];

describe("projectRouting", () => {
  it.each(routes)("round trips $path", ({ path, route }) => {
    expect(parseProjectRoute(path)).toEqual(route);
    expect(buildProjectRoute(route)).toBe(path);
  });

  it.each([
    "/projects/", "/projects/legacy/more", `/p/${projectId}`, `/p/${projectId}/chat/`,
    `/p/${projectId}/memory/more`, "/p/prj_short/chat", `/p/${projectId}/unknown`,
    `/p/${projectId}/chat/%2f`, `/p/${projectId}/chat/chat%2Fone`, `/p/${projectId}/chat/chat%5Cone`,
    `/p/${projectId}/chat/chat%20one`, `/p/${projectId}/chat/..`, `/p/${projectId}/chat/%ZZ`,
    `/p/${projectId}/chat/-chat`, `/p/${projectId}/chat/${"a".repeat(129)}`,
  ])("rejects malformed or extra path %s", (path) => {
    expect(parseProjectRoute(path)).toEqual({ kind: "not_found" });
  });

  it("validates only contract-shaped project ids", () => {
    expect(parseProjectId(projectId)).toBe(projectId);
    expect(parseProjectId(`${projectId}/chat`)).toBeNull();
    expect(parseProjectId("prj_abcdefghijklmnopqrstu%2F")).toBeNull();
  });

  it("refuses to build chat routes the engine rejects", () => {
    for (const chatId of ["", "..", "bad/id", "bad\\id", "bad id", "-bad", "a".repeat(129)]) {
      expect(() => buildProjectRoute({ kind: "project", projectId: validatedProjectId, page: "chat", chatId })).toThrow("Invalid chat id");
    }
  });

  it("navigates through the supplied history without global state", () => {
    const history = { history: { pushState: vi.fn(), replaceState: vi.fn() }, dispatchEvent: vi.fn() };
    expect(navigateProjectRoute(history, { kind: "project", projectId: parseProjectId(projectId)!, page: "chat" })).toBe(`/p/${projectId}/chat`);
    expect(history.history.pushState).toHaveBeenCalledWith(null, "", `/p/${projectId}/chat`);
    expect(history.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ detail: { kind: "project", projectId, page: "chat" } }));
    navigateProjectRoute(history, { kind: "projects" }, true);
    expect(history.history.replaceState).toHaveBeenCalledWith(null, "", "/projects");
  });

  it("parses history popstate paths and unsubscribes", () => {
    const handlers = new Map<string, EventListener>();
    const target = {
      location: { pathname: "/projects" } as Location,
      addEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => { handlers.set(type, listener as EventListener); }),
      removeEventListener: vi.fn(),
    };
    const listener = vi.fn();
    const unsubscribe = subscribeToProjectRoute(target, listener);
    target.location.pathname = `/p/${projectId}/chat`;
    handlers.get("popstate")?.(new PopStateEvent("popstate"));
    expect(listener).toHaveBeenCalledWith({ kind: "project", projectId, page: "chat" });
    handlers.get("yet-ai:project-route-change")?.(new CustomEvent("yet-ai:project-route-change", { detail: { kind: "settings" } }));
    expect(listener).toHaveBeenLastCalledWith({ kind: "settings" });
    unsubscribe();
    expect(target.removeEventListener).toHaveBeenCalledWith("popstate", handlers.get("popstate"));
    expect(target.removeEventListener).toHaveBeenCalledWith("yet-ai:project-route-change", handlers.get("yet-ai:project-route-change"));
  });
});
