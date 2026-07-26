import { useCallback, useEffect, useRef, useState } from "react";
import { App } from "./App";
import { ProjectHub } from "./components/ProjectHub";
import { ProjectShell } from "./components/ProjectShell";
import { LegacyData } from "./components/LegacyData";
import { CurrentWorkspaceDashboard, type HostedAuthorityToken } from "./components/CurrentWorkspaceDashboard";
import { ProjectLink, navigateProjectRoute, parseProjectId, parseProjectRoute, subscribeToProjectRoute, type AppRoute, type ProjectNavigation } from "./services/projectRouting";
import type { WorkspaceBindingPayload } from "./bridge/bridgeAdapter";
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
  const hostedAuthorityRef = useRef({ hostReadyGeneration, workspaceBinding });
  hostedAuthorityRef.current = { hostReadyGeneration, workspaceBinding };
  const navigate = useCallback<ProjectNavigation>((nextRoute) => { navigateProjectRoute(window, nextRoute); }, []);
  const getHostedAuthorityToken = useCallback((selectedProjectId?: string): HostedAuthorityToken | null => {
    const { hostReadyGeneration: currentGeneration, workspaceBinding: currentBinding } = hostedAuthorityRef.current;
    if (currentGeneration === null || !currentBinding) return null;
    const selectedId = selectedProjectId ? parseHostedProjectId(selectedProjectId) : null;
    if (selectedProjectId && !selectedId) return null;
    return hostedAuthorityToken(currentGeneration, currentBinding, selectedId);
  }, []);
  const openHostedRoute = useCallback((nextRoute: HostedRoute, originatingToken: HostedAuthorityToken, selectedProjectId?: string) => {
    const { workspaceBinding: currentBinding } = hostedAuthorityRef.current;
    if (!currentBinding) return false;
    const selectedId = selectedProjectId ? parseHostedProjectId(selectedProjectId) : null;
    if (originatingToken !== getHostedAuthorityToken(selectedProjectId)) return false;
    if (!isHostedRouteAllowed(nextRoute, currentBinding, selectedId)) return false;
    setOpenedHostedRoute({
      route: nextRoute,
      authorityToken: originatingToken,
      bindingFingerprint: workspaceBindingFingerprint(currentBinding),
      selectedProjectId: selectedId,
    });
    return true;
  }, [getHostedAuthorityToken]);
  const authorizedHostedRoute = openedHostedRoute
    && openedHostedRoute.authorityToken === getHostedAuthorityToken(openedHostedRoute.selectedProjectId ?? undefined)
    && workspaceBinding
    && openedHostedRoute.bindingFingerprint === workspaceBindingFingerprint(workspaceBinding)
    && isHostedRouteAllowed(openedHostedRoute.route, workspaceBinding, openedHostedRoute.selectedProjectId)
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
    return <CurrentWorkspaceDashboard settings={settings} binding={workspaceBinding} hostReadyGeneration={hostReadyGeneration} getAuthorityToken={getHostedAuthorityToken} onOpen={openHostedRoute} />;
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
type OpenedHostedRoute = { route: HostedRoute; authorityToken: HostedAuthorityToken; bindingFingerprint: string; selectedProjectId: string | null };

function isHostedRouteAllowed(route: HostedRoute, binding: WorkspaceBindingPayload, selectedProjectId: string | null): boolean {
  if (route.kind !== "project") return binding.state === "auto_bound";
  if (binding.state === "auto_bound") return selectedProjectId === null && route.projectId === binding.projectId;
  return selectedProjectId !== null && route.projectId === selectedProjectId;
}

function workspaceBindingFingerprint(binding: WorkspaceBindingPayload): string {
  return binding.state === "auto_bound"
    ? `${binding.requestId}\u0000${binding.state}\u0000${binding.projectId}`
    : `${binding.requestId}\u0000${binding.state}\u0000${binding.reason}`;
}

function hostedAuthorityToken(generation: string, binding: WorkspaceBindingPayload, selectedProjectId: string | null): HostedAuthorityToken {
  const projectToken = binding.state === "auto_bound" ? binding.projectId : selectedProjectId ?? "";
  return `${generation}\u0000${workspaceBindingFingerprint(binding)}\u0000${projectToken}` as HostedAuthorityToken;
}

function parseHostedProjectId(projectId: string): string | null {
  return parseProjectId(projectId);
}

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
