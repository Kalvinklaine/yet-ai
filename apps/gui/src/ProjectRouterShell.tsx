import { useEffect, useState } from "react";
import { App } from "./App";
import { buildProjectRoute, navigateProjectRoute, parseProjectRoute, subscribeToProjectRoute, type AppRoute } from "./services/projectRouting";

export function ProjectRouterShell() {
  const [route, setRoute] = useState<AppRoute>(() => {
    if (window.location.pathname === "/") {
      navigateProjectRoute(window, { kind: "projects" }, true);
      return { kind: "projects" };
    }
    return parseProjectRoute(window.location.pathname);
  });

  useEffect(() => subscribeToProjectRoute(window, setRoute), []);

  if (route.kind === "not_found") {
    return <RouteStatus title="Not Found" detail="This Yet AI route is not recognized." />;
  }
  if (route.kind === "projects") {
    return <RouteStatus title="Projects" detail="Choose or register a local project." />;
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
