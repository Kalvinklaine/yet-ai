import { spawnSync } from "node:child_process";

for (const [command, args] of [
  ["cargo", ["test", "-p", "yet-lsp", "chat_continue", "--", "--nocapture"]],
  ["npm", ["--prefix", "apps/gui", "test", "--", "chatViewState"]],
]) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log("project-context-continue smoke passed: interrupted project turns continue with durable lineage and bounded prompts");
