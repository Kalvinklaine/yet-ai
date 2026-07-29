import assert from "node:assert/strict";
import { defineGuiSmokeEntry } from "./lib/gui-smoke-bootstrap.mjs";

assert.deepEqual(defineGuiSmokeEntry({ mode: "browser", route: "/projects" }), {
  mode: "browser",
  route: "/projects",
  host: "browser",
  initialConfig: undefined,
});
assert.deepEqual(defineGuiSmokeEntry({ mode: "hosted", route: "/vscode/hosted-chat", entryMode: "hosted_chat" }), {
  mode: "hosted",
  route: "/vscode/hosted-chat",
  host: "vscode",
  initialConfig: { entryMode: "hosted_chat" },
});
assert.deepEqual(defineGuiSmokeEntry({ mode: "hosted", route: "/panel/panel-safe/hosted-chat", entryMode: "hosted_chat" }), {
  mode: "hosted",
  route: "/panel/panel-safe/hosted-chat",
  host: "panel",
  initialConfig: { entryMode: "hosted_chat" },
});

for (const mixed of [
  { mode: "browser", route: "/projects", entryMode: "hosted_chat" },
  { mode: "browser", route: "/vscode/hosted-chat" },
  { mode: "hosted", route: "/projects", entryMode: "hosted_chat" },
  { mode: "hosted", route: "/vscode/hosted-chat" },
  { mode: "hosted", route: "/index.html", entryMode: "hosted_chat" },
  { mode: "hosted", route: "/panel/unsafe.id/hosted-chat", entryMode: "hosted_chat" },
]) {
  assert.throws(() => defineGuiSmokeEntry(mixed), /canonical browser or hosted route/);
}

console.log("GUI smoke bootstrap self-test passed.");
