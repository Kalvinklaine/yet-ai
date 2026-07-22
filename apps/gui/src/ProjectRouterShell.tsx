import { useCallback, useEffect, useState } from "react";
import { App } from "./App";
import { ProjectHub } from "./components/ProjectHub";
import { ProjectShell } from "./components/ProjectShell";
import { LegacyData } from "./components/LegacyData";
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
  const { settings, updateSettings, bridgeAdapter } = useLiveRuntimeSettings();
  const navigate = useCallback<ProjectNavigation>((nextRoute) => { navigateProjectRoute(window, nextRoute); }, []);

  useEffect(() => subscribeToProjectRoute(window, setRoute), []);

  if (hostedChatEntry) {
    return <App route={{ kind: "legacy" }} runtimeSettings={settings} onRuntimeSettingsChange={updateSettings} bridgeAdapter={bridgeAdapter} />;
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

export function isHostedChatEntry(pathname: string, entryMode: unknown): boolean {
  return entryMode === "hosted_chat" && /^\/panel\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}\/hosted-chat$/.test(pathname);
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
