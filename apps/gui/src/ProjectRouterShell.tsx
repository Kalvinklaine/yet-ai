import { useCallback, useEffect, useState } from "react";
import { App } from "./App";
import { ProjectHub } from "./components/ProjectHub";
import { ProjectShell } from "./components/ProjectShell";
import { LegacyData } from "./components/LegacyData";
import { CurrentWorkspaceDashboard } from "./components/CurrentWorkspaceDashboard";
import { ProjectLink, navigateProjectRoute, parseProjectRoute, subscribeToProjectRoute, type AppRoute, type ProjectNavigation } from "./services/projectRouting";
import { useLiveRuntimeSettings } from "./services/useLiveRuntimeSettings";

export function ProjectRouterShell() {
  const hostedChatEntry = isHostedChatEntry(window.location.pathname, window.__yetAiInitialRuntimeConfig?.entryMode);
  const [route, setRoute] = useState<AppRoute>(() => {
    if (hostedChatEntry) {
      return { kind: "legacy" };
    }
    if (window.location.pathname === "/") {
      navigateProjectRoute(window, { kind: "projects" }, true);
      return { kind: "projects" };
    }
    return parseProjectRoute(window.location.pathname);
  });
  const [openedHostedRoute, setOpenedHostedRoute] = useState<OpenedHostedRoute | null>(null);
  const { settings, updateSettings, bridgeAdapter, workspaceBinding, hostReadyGeneration } = useLiveRuntimeSettings();
  const navigate = useCallback<ProjectNavigation>((nextRoute) => { navigateProjectRoute(window, nextRoute); }, []);
  const openHostedRoute = useCallback((nextRoute: HostedRoute) => {
    if (hostReadyGeneration === null || workspaceBinding?.state !== "auto_bound") return;
    if (nextRoute.kind === "project" && nextRoute.projectId !== workspaceBinding.projectId) return;
    setOpenedHostedRoute({ route: nextRoute, generation: hostReadyGeneration });
  }, [hostReadyGeneration, workspaceBinding]);
  const authorizedHostedRoute = openedHostedRoute
    && openedHostedRoute.generation === hostReadyGeneration
    && workspaceBinding?.state === "auto_bound"
    && (openedHostedRoute.route.kind !== "project" || openedHostedRoute.route.projectId === workspaceBinding.projectId)
    ? openedHostedRoute.route
    : null;

  useEffect(() => subscribeToProjectRoute(window, setRoute), []);
  useEffect(() => {
    if (!hostedChatEntry || authorizedHostedRoute) return;
    setOpenedHostedRoute((current) => {
      if (!current) return current;
      return null;
    });
  }, [authorizedHostedRoute, hostedChatEntry]);

  if (hostedChatEntry) {
    if (authorizedHostedRoute) {
      return <App route={authorizedHostedRoute} runtimeSettings={settings} onRuntimeSettingsChange={updateSettings} bridgeAdapter={bridgeAdapter} />;
    }
    return <CurrentWorkspaceDashboard settings={settings} binding={workspaceBinding} hostReadyGeneration={hostReadyGeneration} onOpen={openHostedRoute} />;
  }
  if (route.kind === "not_found") {
    return <RouteStatus title="Not Found" detail="This Yet AI route is not recognized." navigate={navigate} />;
  }
  if (route.kind === "projects") {
    return <ProjectHub settings={settings} navigate={navigate} />;
  }
  if (route.kind === "project") {
    return <ProjectShell route={route} settings={settings} navigate={navigate}>{route.page === "home" ? null : <App route={route} navigate={navigate} runtimeSettings={settings} onRuntimeSettingsChange={updateSettings} bridgeAdapter={bridgeAdapter} />}</ProjectShell>;
  }
  if (route.kind === "legacy") return <LegacyData settings={settings} navigate={navigate} />;
  return <App route={route} runtimeSettings={settings} onRuntimeSettingsChange={updateSettings} bridgeAdapter={bridgeAdapter} />;
}

type HostedRoute = Extract<AppRoute, { kind: "legacy" | "settings" | "project" }>;
type OpenedHostedRoute = { route: HostedRoute; generation: string };

export function isHostedChatEntry(pathname: string, entryMode: unknown): boolean {
  return entryMode === "hosted_chat" && (
    /^\/panel\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}\/hosted-chat$/.test(pathname)
    || pathname === "/vscode/hosted-chat"
  );
}

function RouteStatus({ title, detail, navigate }: { title: string; detail: string; navigate: ProjectNavigation }) {
  return (
    <main className="app-shell">
      <section className="card stack" role="status">
        <h1>{title}</h1>
        <p>{detail}</p>
        <ProjectLink route={{ kind: "projects" }} navigate={navigate}>Open projects</ProjectLink>
      </section>
    </main>
  );
}
