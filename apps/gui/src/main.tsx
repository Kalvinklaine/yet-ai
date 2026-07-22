import React from "react";
import ReactDOM from "react-dom/client";
import { ProjectRouterShell } from "./ProjectRouterShell";
import "./styles/global.css";

const root = document.getElementById("root");

if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <ProjectRouterShell />
    </React.StrictMode>,
  );
}
