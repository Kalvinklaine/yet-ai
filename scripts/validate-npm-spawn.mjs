import assert from "node:assert/strict";
import { npmInvocation, npmRunInvocation } from "./lib/npm-spawn.mjs";

assert.deepEqual(npmInvocation(["run", "smoke:example"], { platform: "win32", env: {}, execPath: "node.exe" }), {
  command: "npm.cmd",
  args: ["run", "smoke:example"],
});

assert.deepEqual(npmInvocation(["run", "smoke:example"], { platform: "linux", env: {}, execPath: "node" }), {
  command: "npm",
  args: ["run", "smoke:example"],
});

assert.deepEqual(npmRunInvocation("smoke:example", ["--headed"], { platform: "win32", env: { npm_execpath: "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js" }, execPath: "C:\\Program Files\\nodejs\\node.exe" }), {
  command: "C:\\Program Files\\nodejs\\node.exe",
  args: ["C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js", "run", "smoke:example", "--", "--headed"],
});

console.log("npm spawn validation passed.");
