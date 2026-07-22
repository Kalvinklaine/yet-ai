export const projectIdPattern = /^prj_[A-Za-z0-9_-]{22}$/;

export type ProjectId = string & { readonly __projectId: unique symbol };

export type AppRoute =
  | { kind: "projects" }
  | { kind: "legacy" }
  | { kind: "settings" }
  | { kind: "project"; projectId: ProjectId; page: "home" | "chat" | "memory" | "agent"; chatId?: string }
  | { kind: "not_found" };

export function parseProjectId(value: string): ProjectId | null {
  return projectIdPattern.test(value) ? value as ProjectId : null;
}

export function parseProjectRoute(pathname: string): AppRoute {
  if (pathname === "/projects") return { kind: "projects" };
  if (pathname === "/projects/legacy") return { kind: "legacy" };
  if (pathname === "/settings") return { kind: "settings" };

  const segments = pathname.split("/");
  if (segments.length < 4 || segments[0] !== "" || segments[1] !== "p") {
    return { kind: "not_found" };
  }
  const projectId = parseProjectId(segments[2]);
  if (!projectId) return { kind: "not_found" };
  if (segments.length === 4 && segments[3] === "") return { kind: "project", projectId, page: "home" };
  if (segments.length === 4 && segments[3] === "chat") return { kind: "project", projectId, page: "chat" };
  if (segments.length === 5 && segments[3] === "chat" && isPathSegment(segments[4])) {
    return { kind: "project", projectId, page: "chat", chatId: decodeURIComponent(segments[4]) };
  }
  if (segments.length === 4 && segments[3] === "memory") return { kind: "project", projectId, page: "memory" };
  if (segments.length === 4 && segments[3] === "agent") return { kind: "project", projectId, page: "agent" };
  return { kind: "not_found" };
}

export function buildProjectRoute(route: Exclude<AppRoute, { kind: "not_found" }>): string {
  if (route.kind === "projects") return "/projects";
  if (route.kind === "legacy") return "/projects/legacy";
  if (route.kind === "settings") return "/settings";
  const base = `/p/${route.projectId}`;
  if (route.page === "home") return `${base}/`;
  if (route.page === "chat") return route.chatId === undefined ? `${base}/chat` : `${base}/chat/${encodeURIComponent(route.chatId)}`;
  return `${base}/${route.page}`;
}

export type ProjectHistory = Pick<History, "pushState" | "replaceState">;

export function navigateProjectRoute(history: ProjectHistory, route: Exclude<AppRoute, { kind: "not_found" }>, replace = false): string {
  const path = buildProjectRoute(route);
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  return path;
}

export function subscribeToProjectRoute(target: Pick<Window, "addEventListener" | "removeEventListener" | "location">, listener: (route: AppRoute) => void): () => void {
  const onPopState = () => listener(parseProjectRoute(target.location.pathname));
  target.addEventListener("popstate", onPopState);
  return () => target.removeEventListener("popstate", onPopState);
}

function isPathSegment(value: string): boolean {
  if (!value) return false;
  try {
    return encodeURIComponent(decodeURIComponent(value)) === value;
  } catch {
    return false;
  }
}
