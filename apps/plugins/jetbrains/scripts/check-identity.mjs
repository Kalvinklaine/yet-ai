import fs from "node:fs";
import path from "node:path";

const pluginDir = process.cwd();
const rootDir = path.resolve(pluginDir, "../../..");
const identity = JSON.parse(fs.readFileSync(path.join(rootDir, "product/identity.json"), "utf8"));
const expected = identity.jetbrains;
const pluginXml = fs.readFileSync(path.join(pluginDir, "src/main/resources/META-INF/plugin.xml"), "utf8");
const buildGradle = fs.readFileSync(path.join(pluginDir, "build.gradle.kts"), "utf8");
const productIdentity = fs.readFileSync(path.join(pluginDir, "src/main/kotlin/ai/yet/plugin/identity/ProductIdentity.kt"), "utf8");

const checks = [
  ["plugin.xml id", pluginXml.includes(`<id>${expected.pluginId}</id>`)],
  ["plugin.xml name", pluginXml.includes(`<name>${expected.pluginName}</name>`)],
  ["plugin.xml vendor", pluginXml.includes(`<vendor>${expected.pluginGroup}</vendor>`)],
  ["build group", buildGradle.includes(`group = "${expected.pluginGroup}"`)],
  ["build plugin id", buildGradle.includes(`id = "${expected.pluginId}"`)],
  ["build plugin name", buildGradle.includes(`name = "${expected.pluginName}"`)],
  ["package namespace", productIdentity.includes(`package ${expected.packageNamespace}.identity`)],
  ["identity pluginId", productIdentity.includes(`pluginId = "${expected.pluginId}"`)],
  ["identity pluginGroup", productIdentity.includes(`pluginGroup = "${expected.pluginGroup}"`)],
  ["identity pluginName", productIdentity.includes(`pluginName = "${expected.pluginName}"`)],
  ["identity packageNamespace", productIdentity.includes(`packageNamespace = "${expected.packageNamespace}"`)],
];

for (const [label, ok] of checks) {
  if (!ok) {
    throw new Error(`JetBrains identity check failed: ${label}`);
  }
}

console.log("JetBrains identity check passed.");
