import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

function normalizeContractPath(path) {
  return path.replace(/\\/g, "/");
}

const mappings = [
  ["packages/contracts/examples/engine/ping-response.json", "packages/contracts/schemas/engine/ping.schema.json"],
  ["packages/contracts/examples/engine/caps-response.json", "packages/contracts/schemas/engine/caps.schema.json"],
  ["packages/contracts/examples/engine/provider-response.json", "packages/contracts/schemas/engine/provider.schema.json"],
  ["packages/contracts/examples/engine/providers-response.json", "packages/contracts/schemas/engine/providers.schema.json"],
  ["packages/contracts/examples/engine/provider-auth-start-pending.json", "packages/contracts/schemas/engine/provider-auth-start-response.schema.json"],
  ["packages/contracts/examples/engine/provider-auth-status-api-key-configured.json", "packages/contracts/schemas/engine/provider-auth-status-response.schema.json"],
  ["packages/contracts/examples/engine/provider-auth-status-connected.json", "packages/contracts/schemas/engine/provider-auth-status-response.schema.json"],
  ["packages/contracts/examples/engine/provider-auth-status-login-unavailable.json", "packages/contracts/schemas/engine/provider-auth-status-response.schema.json"],
  ["packages/contracts/examples/engine/provider-auth-disconnect-success.json", "packages/contracts/schemas/engine/provider-auth-disconnect-response.schema.json"],
  ["packages/contracts/examples/engine/models-response.json", "packages/contracts/schemas/engine/models.schema.json"],
  ["packages/contracts/examples/engine/user-message-command.json", "packages/contracts/schemas/engine/chat-command.schema.json"],
  ["packages/contracts/examples/engine/snapshot-sse-event.json", "packages/contracts/schemas/engine/sse-event.schema.json"],
  ["packages/contracts/examples/bridge/host-ready-message.json", "packages/contracts/schemas/bridge/host-message.schema.json"],
  ["packages/contracts/examples/bridge/gui-ready-message.json", "packages/contracts/schemas/bridge/gui-message.schema.json"]
].map(([examplePath, schemaPath]) => [normalizeContractPath(examplePath), normalizeContractPath(schemaPath)]);

const allowlistedUnmappedExamples = [].map(normalizeContractPath);

const identityChecks = [
  {
    examplePath: "packages/contracts/examples/engine/ping-response.json",
    field: "productId",
    identityPath: "product.id"
  },
  {
    examplePath: "packages/contracts/examples/engine/ping-response.json",
    field: "displayName",
    identityPath: "product.displayName"
  },
  {
    examplePath: "packages/contracts/examples/engine/caps-response.json",
    field: "productId",
    identityPath: "product.id"
  }
].map((check) => ({ ...check, examplePath: normalizeContractPath(check.examplePath) }));

async function discoverJsonFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) {
        return discoverJsonFiles(path);
      }
      return entry.isFile() && entry.name.endsWith(".json") ? [normalizeContractPath(path)] : [];
    })
  );

  return files.flat().sort();
}

async function readText(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`${path}: read failure (${error.message})`);
  }
}

async function readJson(path) {
  const text = await readText(path);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${path}: JSON parse failure (${error.message})`);
  }
}

function getIdentityValue(identity, identityPath) {
  return identityPath.split(".").reduce((value, key) => value?.[key], identity);
}

function collectMappingCoverageFailures(exampleFiles, schemaFiles) {
  const discoveredExamples = new Set(exampleFiles.map(normalizeContractPath));
  const discoveredSchemas = new Set(schemaFiles.map(normalizeContractPath));
  const mappedExamples = new Set(mappings.map(([examplePath]) => examplePath));
  const mappedSchemas = new Set(mappings.map(([, schemaPath]) => schemaPath));
  const allowlistedExamples = new Set(allowlistedUnmappedExamples);
  const failures = [];

  for (const examplePath of discoveredExamples) {
    if (!mappedExamples.has(examplePath) && !allowlistedExamples.has(examplePath)) {
      failures.push(
        `${examplePath}: unmapped contract example; add an explicit example→schema mapping or an allowlist entry with a clear reason`
      );
    }
  }

  for (const examplePath of mappedExamples) {
    if (!discoveredExamples.has(examplePath)) {
      failures.push(`${examplePath}: mapped example file was not discovered`);
    }
  }

  for (const schemaPath of mappedSchemas) {
    if (!discoveredSchemas.has(schemaPath)) {
      failures.push(`${schemaPath}: mapped schema file was not discovered`);
    }
  }

  for (const examplePath of allowlistedExamples) {
    if (!discoveredExamples.has(examplePath)) {
      failures.push(`${examplePath}: allowlisted unmapped example file was not discovered`);
    }
  }

  return failures;
}

const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);

const failures = [];
const compiledSchemas = new Map();
const parsedExamples = new Map();

let schemaFiles = [];
let exampleFiles = [];
let identity = null;

try {
  schemaFiles = await discoverJsonFiles("packages/contracts/schemas");
} catch (error) {
  failures.push(`packages/contracts/schemas: read failure (${error.message})`);
}

try {
  exampleFiles = await discoverJsonFiles("packages/contracts/examples");
} catch (error) {
  failures.push(`packages/contracts/examples: read failure (${error.message})`);
}

try {
  identity = await readJson("product/identity.json");
} catch (error) {
  failures.push(error.message);
}

if (schemaFiles.length > 0 && exampleFiles.length > 0) {
  failures.push(...collectMappingCoverageFailures(exampleFiles, schemaFiles));
}

for (const schemaPath of schemaFiles) {
  try {
    const schema = await readJson(schemaPath);
    compiledSchemas.set(schemaPath, ajv.compile(schema));
  } catch (error) {
    failures.push(`${schemaPath}: schema compilation failure (${error.message})`);
  }
}

for (const examplePath of exampleFiles) {
  try {
    parsedExamples.set(examplePath, await readJson(examplePath));
  } catch (error) {
    failures.push(error.message);
  }
}

for (const [examplePath, schemaPath] of mappings) {
  try {
    const validate = compiledSchemas.get(schemaPath);
    const example = parsedExamples.get(examplePath);

    if (validate === undefined || example === undefined) {
      continue;
    }

    if (!validate(example)) {
      const details = ajv.errorsText(validate.errors, { separator: "\n  " });
      failures.push(`${examplePath}: schema validation failure against ${schemaPath}:\n  ${details}`);
    }
  } catch (error) {
    failures.push(error.message);
  }
}

if (identity !== null) {
  for (const { examplePath, field, identityPath } of identityChecks) {
    const example = parsedExamples.get(examplePath);
    if (example === undefined) {
      continue;
    }

    const actual = example[field];
    const expected = getIdentityValue(identity, identityPath);
    if (actual !== expected) {
      failures.push(
        `${examplePath}: identity mismatch for ${field}; expected product/identity.json ${identityPath} (${JSON.stringify(
          expected
        )}), got ${JSON.stringify(actual)}`
      );
    }
  }
}

if (failures.length > 0) {
  console.error("Contract validation failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  `Contract validation passed (${schemaFiles.length} schemas, ${exampleFiles.length} examples).`
);
