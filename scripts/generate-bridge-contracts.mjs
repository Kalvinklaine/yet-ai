import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(new URL("..", import.meta.url).pathname);
const schemaPath = "packages/contracts/schemas/bridge/host-message.schema.json";
const outputs = [
  "apps/gui/src/bridge/generated/sharedHostContracts.ts",
  "apps/plugins/vscode/src/generated/sharedHostContracts.ts",
  "apps/plugins/jetbrains/src/main/kotlin/ai/yet/plugin/bridge/generated/SharedHostContracts.kt",
];

const quoted = (values) => values.map((value) => JSON.stringify(value)).join(" | ");
const array = (values) => values.map((value) => JSON.stringify(value)).join(", ");

function typescript(schema) {
  const runtime = schema.$defs.runtimeStatusPayload;
  const binding = schema.$defs.workspaceBindingPayload;
  const autoBound = binding.oneOf[0];
  const selectionRequired = binding.oneOf[1];
  const runtimeType = (name) => quoted(schema.$defs[name].enum);
  return `export const GENERATED_BRIDGE_CONTRACT_PROVENANCE = ${JSON.stringify(`Generated from ${schemaPath}; run npm run generate:bridge-contracts`)};

export type GeneratedRuntimeStatusPayload = {
  protocolVersion: ${JSON.stringify(runtime.properties.protocolVersion.const)};
  surface: ${runtimeType("runtimeSurface")};
  lifecycle: ${runtimeType("runtimeLifecycleState")};
  runtimeOwner: ${quoted(runtime.properties.runtimeOwner.enum)};
  launchMode: ${quoted(runtime.properties.launchMode.enum)};
  tokenState: ${quoted(runtime.properties.tokenState.enum)};
  processState: ${quoted(runtime.properties.processState.enum)};
  diagnosis: string;
  nextAction: string;
  cloudRequired: false;
  authority: ${JSON.stringify(runtime.properties.authority.const)};
};

export type GeneratedWorkspaceBindingPayload =
  | { protocolVersion: ${JSON.stringify(autoBound.properties.protocolVersion.const)}; requestId: string; state: ${JSON.stringify(autoBound.properties.state.const)}; projectId: string; displayName: string }
  | { protocolVersion: ${JSON.stringify(selectionRequired.properties.protocolVersion.const)}; requestId: string; state: ${JSON.stringify(selectionRequired.properties.state.const)}; reason: ${quoted(selectionRequired.properties.reason.enum)} };

const runtimeKeys = [${array(runtime.required)}] as const;
const autoBoundKeys = [${array(autoBound.required)}] as const;
const selectionRequiredKeys = [${array(selectionRequired.required)}] as const;
const lifecycleValues = new Set<string>([${array(schema.$defs.runtimeLifecycleState.enum)}]);
const surfaceValues = new Set<string>([${array(schema.$defs.runtimeSurface.enum)}]);
const runtimeOwnerValues = new Set<string>([${array(runtime.properties.runtimeOwner.enum)}]);
const launchModeValues = new Set<string>([${array(runtime.properties.launchMode.enum)}]);
const tokenStateValues = new Set<string>([${array(runtime.properties.tokenState.enum)}]);
const processStateValues = new Set<string>([${array(runtime.properties.processState.enum)}]);
const bindingReasons = new Set<string>([${array(selectionRequired.properties.reason.enum)}]);
const requestIdPattern = ${JSON.stringify(schema.$defs.requestId.pattern)};
const projectIdPattern = ${JSON.stringify(autoBound.properties.projectId.pattern)};
const displayNamePattern = ${JSON.stringify(autoBound.properties.displayName.pattern)};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
const matches = (value: unknown, pattern: string) => typeof value === "string" && new RegExp(pattern, "u").test(value);

export function isGeneratedRuntimeStatusPayload(value: unknown): value is GeneratedRuntimeStatusPayload {
  return isRecord(value) && hasExactKeys(value, runtimeKeys) && value.protocolVersion === ${JSON.stringify(runtime.properties.protocolVersion.const)} && typeof value.surface === "string" && surfaceValues.has(value.surface) && typeof value.lifecycle === "string" && lifecycleValues.has(value.lifecycle) && typeof value.runtimeOwner === "string" && runtimeOwnerValues.has(value.runtimeOwner) && typeof value.launchMode === "string" && launchModeValues.has(value.launchMode) && typeof value.tokenState === "string" && tokenStateValues.has(value.tokenState) && typeof value.processState === "string" && processStateValues.has(value.processState) && typeof value.diagnosis === "string" && value.diagnosis.length >= ${schema.$defs.safeMessage.minLength} && value.diagnosis.length <= ${schema.$defs.safeMessage.maxLength} && matches(value.diagnosis, ${JSON.stringify(schema.$defs.safeMessage.pattern)}) && typeof value.nextAction === "string" && value.nextAction.length >= ${schema.$defs.safeMessage.minLength} && value.nextAction.length <= ${schema.$defs.safeMessage.maxLength} && matches(value.nextAction, ${JSON.stringify(schema.$defs.safeMessage.pattern)}) && value.cloudRequired === false && value.authority === ${JSON.stringify(runtime.properties.authority.const)};
}

export function isGeneratedWorkspaceBindingPayload(value: unknown): value is GeneratedWorkspaceBindingPayload {
  if (!isRecord(value) || value.protocolVersion !== ${JSON.stringify(autoBound.properties.protocolVersion.const)} || typeof value.requestId !== "string" || value.requestId.length < ${schema.$defs.requestId.minLength} || value.requestId.length > ${schema.$defs.requestId.maxLength} || !matches(value.requestId, requestIdPattern)) return false;
  if (value.state === ${JSON.stringify(autoBound.properties.state.const)}) return hasExactKeys(value, autoBoundKeys) && matches(value.projectId, projectIdPattern) && typeof value.displayName === "string" && Array.from(value.displayName).length >= ${autoBound.properties.displayName.minLength} && Array.from(value.displayName).length <= ${autoBound.properties.displayName.maxLength} && matches(value.displayName, displayNamePattern);
  return value.state === ${JSON.stringify(selectionRequired.properties.state.const)} && hasExactKeys(value, selectionRequiredKeys) && typeof value.reason === "string" && bindingReasons.has(value.reason);
}
`;
}

function kotlin(schema) {
  const runtime = schema.$defs.runtimeStatusPayload;
  const binding = schema.$defs.workspaceBindingPayload;
  const autoBound = binding.oneOf[0];
  const selectionRequired = binding.oneOf[1];
  const kotlinSet = (values) => values.map((value) => `"${value}"`).join(", ");
  return `package ai.yet.plugin.bridge.generated

import com.google.gson.JsonObject

object SharedHostContracts {
    const val PROVENANCE = "Generated from ${schemaPath}; run npm run generate:bridge-contracts"
    const val RUNTIME_PROTOCOL_VERSION = "${runtime.properties.protocolVersion.const}"
    const val WORKSPACE_BINDING_PROTOCOL_VERSION = "${autoBound.properties.protocolVersion.const}"

    data class RuntimeStatusPayload(val protocolVersion: String, val surface: String, val lifecycle: String, val runtimeOwner: String, val launchMode: String, val tokenState: String, val processState: String, val diagnosis: String, val nextAction: String, val cloudRequired: Boolean, val authority: String)
    sealed interface WorkspaceBindingPayload {
        data class AutoBound(val protocolVersion: String, val requestId: String, val state: String, val projectId: String, val displayName: String) : WorkspaceBindingPayload
        data class SelectionRequired(val protocolVersion: String, val requestId: String, val state: String, val reason: String) : WorkspaceBindingPayload
    }

    private val runtimeKeys = setOf(${kotlinSet(runtime.required)})
    private val autoBoundKeys = setOf(${kotlinSet(autoBound.required)})
    private val selectionRequiredKeys = setOf(${kotlinSet(selectionRequired.required)})
    private val surfaces = setOf(${kotlinSet(schema.$defs.runtimeSurface.enum)})
    private val lifecycles = setOf(${kotlinSet(schema.$defs.runtimeLifecycleState.enum)})
    private val runtimeOwners = setOf(${kotlinSet(runtime.properties.runtimeOwner.enum)})
    private val launchModes = setOf(${kotlinSet(runtime.properties.launchMode.enum)})
    private val tokenStates = setOf(${kotlinSet(runtime.properties.tokenState.enum)})
    private val processStates = setOf(${kotlinSet(runtime.properties.processState.enum)})
    private val bindingReasons = setOf(${kotlinSet(selectionRequired.properties.reason.enum)})
    private val requestId = Regex(${JSON.stringify(schema.$defs.requestId.pattern)})
    private val projectId = Regex(${JSON.stringify(autoBound.properties.projectId.pattern)})
    private val displayName = Regex(${JSON.stringify(autoBound.properties.displayName.pattern)})
    fun isRuntimeStatusPayload(value: JsonObject, isSafeMessage: (String) -> Boolean): Boolean = value.keySet() == runtimeKeys && value.string("protocolVersion") == RUNTIME_PROTOCOL_VERSION && value.string("surface") in surfaces && value.string("lifecycle") in lifecycles && value.string("runtimeOwner") in runtimeOwners && value.string("launchMode") in launchModes && value.string("tokenState") in tokenStates && value.string("processState") in processStates && value.string("diagnosis")?.let(isSafeMessage) == true && value.string("nextAction")?.let(isSafeMessage) == true && value.boolean("cloudRequired") == false && value.string("authority") == "${runtime.properties.authority.const}"

    fun isWorkspaceBindingPayload(value: JsonObject): Boolean {
        if (value.string("protocolVersion") != WORKSPACE_BINDING_PROTOCOL_VERSION || value.string("requestId")?.let { it.length in ${schema.$defs.requestId.minLength}..${schema.$defs.requestId.maxLength} && requestId.matches(it) } != true) return false
        return when (value.string("state")) {
            "${autoBound.properties.state.const}" -> value.keySet() == autoBoundKeys && value.string("projectId")?.let(projectId::matches) == true && value.string("displayName")?.let { it.codePointCount(0, it.length) in ${autoBound.properties.displayName.minLength}..${autoBound.properties.displayName.maxLength} && displayName.matches(it) } == true
            "${selectionRequired.properties.state.const}" -> value.keySet() == selectionRequiredKeys && value.string("reason") in bindingReasons
            else -> false
        }
    }

    private fun JsonObject.string(name: String): String? = get(name)?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isString }?.asString
    private fun JsonObject.boolean(name: String): Boolean? = get(name)?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isBoolean }?.asBoolean
}
`;
}

export async function bridgeContractOutputs() {
  const schema = JSON.parse(await readFile(resolve(root, schemaPath), "utf8"));
  const ts = typescript(schema);
  const kt = kotlin(schema);
  return new Map([[outputs[0], ts], [outputs[1], ts], [outputs[2], kt]]);
}

export async function checkBridgeContractFreshness() {
  const stale = [];
  for (const [path, expected] of await bridgeContractOutputs()) {
    const actual = await readFile(resolve(root, path), "utf8").catch(() => "");
    if (actual !== expected) stale.push(path);
  }
  return stale;
}

async function main() {
  const generated = await bridgeContractOutputs();
  if (process.argv.includes("--check")) {
    const stale = await checkBridgeContractFreshness();
    if (stale.length) throw new Error(`Generated bridge contracts are stale: ${stale.join(", ")}`);
    console.log(`Generated bridge contracts are fresh (${generated.size} artifacts).`);
    return;
  }
  for (const [path, content] of generated) await writeFile(resolve(root, path), content);
  console.log(`Generated bridge contracts (${generated.size} artifacts).`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { console.error(error.message); process.exit(1); });
