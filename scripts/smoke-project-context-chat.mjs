import { spawnSync } from "node:child_process";

const result = spawnSync("cargo", ["test", "-p", "yet-lsp", "project_chat_context", "--", "--nocapture"], { stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);
const http = spawnSync("cargo", ["test", "-p", "yet-lsp", "project_context_plan_http_requires_auth_and_fails_closed_on_stale_context", "--", "--nocapture"], { stdio: "inherit" });
if (http.status !== 0) process.exit(http.status ?? 1);
console.log("project-context-chat smoke passed: authenticated HTTP planning plus actual chat execution retain manifest linkage and capture the bounded provider prompt");
