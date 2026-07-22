import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";

export const projectIdPattern = /^prj_[A-Za-z0-9_-]{22}$/;
const chatIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const projectRouteChangeEvent = "yet-ai:project-route-change";

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
  if (segments.length === 5 && segments[3] === "chat") {
    const chatId = parseChatIdSegment(segments[4]);
    if (chatId !== null) return { kind: "project", projectId, page: "chat", chatId };
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
  if (route.page === "chat") {
    if (route.chatId === undefined) return `${base}/chat`;
    if (!chatIdPattern.test(route.chatId)) throw new TypeError("Invalid chat id.");
    return `${base}/chat/${encodeURIComponent(route.chatId)}`;
  }
  return `${base}/${route.page}`;
}

export type ProjectHistory = { history: Pick<History, "pushState" | "replaceState"> } & Pick<EventTarget, "dispatchEvent">;
export type ProjectNavigation = (route: Exclude<AppRoute, { kind: "not_found" }>) => void;

export function navigateProjectRoute(history: ProjectHistory, route: Exclude<AppRoute, { kind: "not_found" }>, replace = false): string {
  const path = buildProjectRoute(route);
  if (replace) history.history.replaceState(null, "", path);
  else history.history.pushState(null, "", path);
  history.dispatchEvent(new CustomEvent<AppRoute>(projectRouteChangeEvent, { detail: route }));
  return path;
}

export function ProjectLink({ route, navigate, children, ...props }: { route: Exclude<AppRoute, { kind: "not_found" }>; navigate: ProjectNavigation; children: ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onClick">) {
  const onClick = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || props.target === "_blank") return;
    event.preventDefault();
    navigate(route);
  };
  return <a {...props} href={buildProjectRoute(route)} onClick={onClick}>{children}</a>;
}

export function subscribeToProjectRoute(target: Pick<Window, "addEventListener" | "removeEventListener" | "location">, listener: (route: AppRoute) => void): () => void {
  const onPopState = () => listener(parseProjectRoute(target.location.pathname));
  const onRouteChange = (event: Event) => listener((event as CustomEvent<AppRoute>).detail);
  target.addEventListener("popstate", onPopState);
  target.addEventListener(projectRouteChangeEvent, onRouteChange);
  return () => {
    target.removeEventListener("popstate", onPopState);
    target.removeEventListener(projectRouteChangeEvent, onRouteChange);
  };
}

function parseChatIdSegment(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value);
    return chatIdPattern.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}
