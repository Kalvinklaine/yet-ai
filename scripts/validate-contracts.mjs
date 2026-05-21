import { readFile } from "node:fs/promises";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const mappings = [
  ["packages/contracts/examples/engine/ping-response.json", "packages/contracts/schemas/engine/ping.schema.json"],
  ["packages/contracts/examples/engine/caps-response.json", "packages/contracts/schemas/engine/caps.schema.json"],
  ["packages/contracts/examples/engine/user-message-command.json", "packages/contracts/schemas/engine/chat-command.schema.json"],
  ["packages/contracts/examples/engine/snapshot-sse-event.json", "packages/contracts/schemas/engine/sse-event.schema.json"],
  ["packages/contracts/examples/bridge/host-ready-message.json", "packages/contracts/schemas/bridge/host-message.schema.json"],
  ["packages/contracts/examples/bridge/gui-ready-message.json", "packages/contracts/schemas/bridge/gui-message.schema.json"]
];

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`${path}: cannot parse JSON (${error.message})`);
  }
}

const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);

const failures = [];

for (const [examplePath, schemaPath] of mappings) {
  try {
    const schema = await readJson(schemaPath);
    const example = await readJson(examplePath);
    const validate = ajv.compile(schema);

    if (!validate(example)) {
      const details = ajv.errorsText(validate.errors, { separator: "\n  " });
      failures.push(`${examplePath} does not match ${schemaPath}:\n  ${details}`);
    }
  } catch (error) {
    failures.push(error.message);
  }
}

if (failures.length > 0) {
  console.error("Contract validation failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Contract validation passed.");
