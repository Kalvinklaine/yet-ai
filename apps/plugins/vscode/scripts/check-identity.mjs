import fs from "node:fs";
import path from "node:path";

const pluginDir = process.cwd();
const rootDir = path.resolve(pluginDir, "../../..");
const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, "package.json"), "utf8"));
const identity = JSON.parse(fs.readFileSync(path.join(rootDir, "product/identity.json"), "utf8"));
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
