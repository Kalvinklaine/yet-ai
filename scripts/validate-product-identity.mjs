import { readFile } from "node:fs/promises";

const identityPath = "product/identity.json";
const schemaPath = "product/identity.schema.json";
const errors = [];

function addError(path, message) {
  errors.push(`${path}: ${message}`);
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    addError(path, `cannot parse JSON (${error.message})`);
    return null;
  }
}

function valueAt(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object);
}

function requireObject(object, path) {
  const value = valueAt(object, path);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    addError(path, "must be an object");
    return null;
  }
  return value;
}

function requireString(object, path, options = {}) {
  const value = valueAt(object, path);
  if (typeof value !== "string" || value.length === 0) {
    addError(path, "must be a non-empty string");
    return null;
  }
  if (options.pattern && !options.pattern.test(value)) {
    addError(path, `must match ${options.pattern}`);
  }
  if (options.enum && !options.enum.includes(value)) {
    addError(path, `must be one of ${options.enum.join(", ")}`);
  }
  return value;
}

const identity = await readJson(identityPath);
const schema = await readJson(schemaPath);

if (identity && schema) {
  const topLevelRequired = schema.required ?? [];
  for (const section of topLevelRequired) {
    requireObject(identity, section);
  }

  const requiredFields = [
    ["product", ["displayName", "id", "shortName", "strategy", "description"]],
    ["storage", ["projectDir", "configDir", "cacheDir"]],
    ["engine", ["rustCrate", "binaryName"]],
    ["gui", ["npmPackage"]],
    ["vscode", ["publisher", "name", "displayName", "configurationPrefix", "commandPrefix", "activityBarId"]],
    ["jetbrains", ["pluginId", "pluginGroup", "pluginName", "packageNamespace"]],
    ["urls", ["repository", "documentation", "support", "homepage"]],
    ["metadata", ["status", "owner", "lastReviewed"]]
  ];

  for (const [section, fields] of requiredFields) {
    if (!requireObject(identity, section)) {
      continue;
    }
    for (const field of fields) {
      requireString(identity, `${section}.${field}`);
    }
  }

  const patterns = [
    ["product.id", /^[a-z][a-z0-9-]*$/],
    ["storage.projectDir", /^\.[a-z][a-z0-9-]*$/],
    ["storage.configDir", /^[a-z][a-z0-9-]*$/],
    ["storage.cacheDir", /^[a-z][a-z0-9-]*$/],
    ["engine.rustCrate", /^[a-z][a-z0-9-]*$/],
    ["engine.binaryName", /^[a-z][a-z0-9-]*$/],
    ["gui.npmPackage", /^(@[a-z0-9-]+\/[a-z0-9-]+|[a-z][a-z0-9-]*)$/],
    ["vscode.publisher", /^[a-z0-9][a-z0-9-]*$/],
    ["vscode.name", /^[a-z0-9][a-z0-9-]*$/],
    ["vscode.configurationPrefix", /^[a-z][a-z0-9]*$/],
    ["vscode.commandPrefix", /^[a-z][a-z0-9]*$/],
    ["vscode.activityBarId", /^[a-z][a-z0-9-]*$/],
    ["jetbrains.pluginId", /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/],
    ["jetbrains.pluginGroup", /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$/],
    ["jetbrains.packageNamespace", /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/],
    ["metadata.lastReviewed", /^\d{4}-\d{2}-\d{2}$/]
  ];

  for (const [path, pattern] of patterns) {
    requireString(identity, path, { pattern });
  }

  requireString(identity, "product.strategy", { enum: ["architecture-inspired-rebuild"] });
  requireString(identity, "metadata.status", { enum: ["temporary-placeholders", "final"] });

  for (const path of ["urls.repository", "urls.documentation", "urls.support", "urls.homepage"]) {
    const value = requireString(identity, path);
    if (value) {
      try {
        new URL(value);
      } catch {
        addError(path, "must be a valid URL");
      }
    }
  }
}

if (errors.length > 0) {
  console.error("Product identity validation failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Product identity validation passed.");
