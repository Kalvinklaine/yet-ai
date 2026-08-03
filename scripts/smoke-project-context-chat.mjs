import { spawnSync } from "node:child_process";

const result = spawnSync("cargo", ["test", "-p", "yet-lsp", "project_chat_context", "--", "--nocapture"], { stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log("project-context-chat smoke passed: project/about and auth-location context selection, revalidation, removal, and provider prompt capture are covered by focused loopback-safe engine tests");
