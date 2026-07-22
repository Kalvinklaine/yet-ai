import { useEffect, useMemo, useState } from "react";
import { App } from "./App";
import { ProjectHub } from "./components/ProjectHub";
import { ProjectShell } from "./components/ProjectShell";
import { buildProjectRoute, navigateProjectRoute, parseProjectRoute, subscribeToProjectRoute, type AppRoute } from "./services/projectRouting";
import { isSameOriginProxyBaseUrl, type RuntimeSettings } from "./services/runtimeClient";

export function ProjectRouterShell() {
  const [route, setRoute] = useState<AppRoute>(() => {
    if (window.location.pathname === "/") {
      navigateProjectRoute(window, { kind: "projects" }, true);
      return { kind: "projects" };
    }
    return parseProjectRoute(window.location.pathname);
  });
  const settings = useMemo<RuntimeSettings>(() => {
    const configured = window.__yetAiInitialRuntimeConfig;
    const configuredBase = configured?.runtimeProxyBaseUrl ?? configured?.runtimeBaseUrl;
    if (configured?.runtimeAccess === "same_origin_proxy" && configuredBase && isSameOriginProxyBaseUrl(configuredBase)) {
      return { baseUrl: configuredBase, token: "", runtimeAccess: "same_origin_proxy" };
    }
    return { baseUrl: "http://127.0.0.1:8001", token: "", runtimeAccess: "direct" };
  }, []);

  useEffect(() => subscribeToProjectRoute(window, setRoute), []);

  if (route.kind === "not_found") {
    return <RouteStatus title="Not Found" detail="This Yet AI route is not recognized." />;
  }
  if (route.kind === "projects") {
    return <ProjectHub settings={settings} />;
  }
  if (route.kind === "project") {
    return <ProjectShell route={route} settings={settings}>{route.page === "home" ? null : <App route={route} />}</ProjectShell>;
  }
  return <App route={route} />;
}

function RouteStatus({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="app-shell">
      <section className="card stack" role="status">
        <h1>{title}</h1>
        <p>{detail}</p>
        <a href={buildProjectRoute({ kind: "projects" })}>Open projects</a>
      </section>
    </main>
  );
}
