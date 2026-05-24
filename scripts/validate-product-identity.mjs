import { readFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const identityPath = "product/identity.json";
const schemaPath = "product/identity.schema.json";
const errors = [];

function addError(path, message) {
  errors.push(`${path}: ${message}`);
}

async function readJson(path) {
  let content;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    addError(path, `cannot read file (${error.message})`);
    return null;
  }

  try {
    return JSON.parse(content);
  } catch (error) {
    addError(path, `cannot parse JSON (${error.message})`);
    return null;
  }
}

function valueAt(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object);
}

function requireString(object, path) {
  const value = valueAt(object, path);
  if (typeof value !== "string" || value.length === 0) {
    addError(path, "must be a non-empty string");
    return null;
  }
  return value;
}

function schemaPathFor(error) {
  if (error.instancePath) {
    return error.instancePath
      .slice(1)
      .split("/")
      .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
      .join(".");
  }
  return identityPath;
}

function validateWithSchema(identity, schema) {
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  if (validate(identity)) {
    return;
  }

  for (const error of validate.errors ?? []) {
    const path = schemaPathFor(error);
    addError(path, error.message ?? "schema validation failed");
  }
}

function isRealDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }

  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return (
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day)
  );
}

function runCustomChecks(identity) {
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

  const lastReviewed = requireString(identity, "metadata.lastReviewed");
  if (lastReviewed && !isRealDate(lastReviewed)) {
    addError("metadata.lastReviewed", "must be a real calendar date in YYYY-MM-DD format");
  }
}

const identity = await readJson(identityPath);
const schema = await readJson(schemaPath);

if (identity && schema) {
  validateWithSchema(identity, schema);
  runCustomChecks(identity);
}

if (errors.length > 0) {
  console.error("Product identity validation failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Product identity validation passed.");
