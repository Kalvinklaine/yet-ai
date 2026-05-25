import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const pluginDir = process.cwd();
const rootDir = path.resolve(pluginDir, "../../..");
const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, "package.json"), "utf8"));
const identityPath = path.join(rootDir, "product/identity.json");
const identity = JSON.parse(fs.readFileSync(identityPath, "utf8"));
const expected = identity.vscode;

const checks = [
  ["publisher", manifest.publisher, expected.publisher],
  ["name", manifest.name, expected.name],
  ["displayName", manifest.displayName, expected.displayName],
];

for (const [label, actual, wanted] of checks) {
  if (actual !== wanted) {
    throw new Error(`VS Code manifest ${label} must be ${wanted}, got ${actual}`);
  }
}

const command = `${expected.commandPrefix}.openChat`;
if (!manifest.activationEvents.includes(`onCommand:${command}`)) {
  throw new Error(`VS Code activationEvents must include onCommand:${command}`);
}

const contributedCommand = manifest.contributes.commands.some((item) => item.command === command);
if (!contributedCommand) {
  throw new Error(`VS Code contributes.commands must include ${command}`);
}

const properties = manifest.contributes.configuration.properties;
for (const key of ["runtimeUrl", "sessionToken", "guiDevUrl", "launchMode", "engineBinaryPath"]) {
  const propertyName = `${expected.configurationPrefix}.${key}`;
  if (!Object.hasOwn(properties, propertyName)) {
    throw new Error(`VS Code configuration must include ${propertyName}`);
  }
}

const activityBar = manifest.contributes.viewsContainers.activitybar;
if (!activityBar.some((item) => item.id === expected.activityBarId)) {
  throw new Error(`VS Code activity bar id must include ${expected.activityBarId}`);
}

const bundledIdentityPath = path.join(pluginDir, "out", "product", "identity.json");
if (fs.existsSync(bundledIdentityPath)) {
  const bundledIdentity = JSON.parse(fs.readFileSync(bundledIdentityPath, "utf8"));
  assert.deepEqual(bundledIdentity, identity, "Bundled VS Code product identity must match root product/identity.json");
}

const { loadProductIdentity } = await import("../out/identity.js");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yet-ai-vscode-identity-"));
try {
  const tempIdentityPath = path.join(tempRoot, "out", "product", "identity.json");
  fs.mkdirSync(path.dirname(tempIdentityPath), { recursive: true });
  fs.copyFileSync(identityPath, tempIdentityPath);
  assert.deepEqual(loadProductIdentity(tempRoot), identity, "Package-like VS Code extension root must load bundled product identity");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
