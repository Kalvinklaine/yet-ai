import React from "react";
import ReactDOM from "react-dom/client";
import { ProjectRouterShell } from "./ProjectRouterShell";
import { initializeHostedEntry } from "./services/hostedEntryBootstrap";
import "./styles/global.css";

async function start() {
  await initializeHostedEntry();
  const root = document.getElementById("root");
  if (root) {
    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <ProjectRouterShell />
      </React.StrictMode>,
    );
  }
}

void start();
