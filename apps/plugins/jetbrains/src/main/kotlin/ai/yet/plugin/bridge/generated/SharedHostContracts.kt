package ai.yet.plugin.bridge.generated

import com.google.gson.JsonObject

object SharedHostContracts {
    const val PROVENANCE = "Generated from packages/contracts/schemas/bridge/host-message.schema.json; run npm run generate:bridge-contracts"
    const val RUNTIME_PROTOCOL_VERSION = "2026-06-21"
    const val WORKSPACE_BINDING_PROTOCOL_VERSION = "workspace_binding_v1"

    data class RuntimeStatusPayload(val protocolVersion: String, val surface: String, val lifecycle: String, val runtimeOwner: String, val launchMode: String, val tokenState: String, val processState: String, val diagnosis: String, val nextAction: String, val cloudRequired: Boolean, val authority: String)
    sealed interface WorkspaceBindingPayload {
        data class AutoBound(val protocolVersion: String, val requestId: String, val state: String, val projectId: String, val displayName: String) : WorkspaceBindingPayload
        data class SelectionRequired(val protocolVersion: String, val requestId: String, val state: String, val reason: String) : WorkspaceBindingPayload
    }

    private val runtimeKeys = setOf("protocolVersion", "surface", "lifecycle", "runtimeOwner", "launchMode", "tokenState", "processState", "diagnosis", "nextAction", "cloudRequired", "authority")
    private val autoBoundKeys = setOf("protocolVersion", "requestId", "state", "projectId", "displayName")
    private val selectionRequiredKeys = setOf("protocolVersion", "requestId", "state", "reason")
    private val surfaces = setOf("browser", "vscode", "jetbrains")
    private val lifecycles = setOf("unknown", "checking", "starting", "connected", "degraded", "disconnected", "restarting", "stopped", "auth_mismatch", "invalid_settings", "failed")
    private val runtimeOwners = setOf("browser_preview", "ide_host", "external", "user", "test_harness")
    private val launchModes = setOf("auto", "connect", "launch", "preview", "manual", "unknown")
    private val tokenStates = setOf("unknown", "not_required", "absent", "present", "mismatch", "invalid")
    private val processStates = setOf("unknown", "not_owned", "checking", "starting", "running", "exited", "stopped", "failed")
    private val bindingReasons = setOf("no_root", "multiple_roots", "root_unavailable")
    private val requestId = Regex("^(?!.*(?:[Aa][Uu][Tt][Hh][Oo][Rr][Ii][Zz][Aa][Tt][Ii][Oo][Nn]|[Bb][Ee][Aa][Rr][Ee][Rr]|[Aa][Pp][Ii][-_]?[Kk][Ee][Yy]|[Tt][Oo][Kk][Ee][Nn]|[Ss][Ee][Cc][Rr][Ee][Tt]|[Aa][Cc][Cc][Ee][Ss][Ss][-_]?[Tt][Oo][Kk][Ee][Nn]|[Pp][Rr][Oo][Vv][Ii][Dd][Ee][Rr][-_]?[Kk][Ee][Yy]|[Oo][Pp][Ee][Nn][Aa][Ii][-_]?[Aa][Pp][Ii][-_]?[Kk][Ee][Yy]|[Ss][Kk]-(?:[Pp][Rr][Oo][Jj]-)?[A-Za-z0-9_-]{8,}))[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
    private val projectId = Regex("^prj_[A-Za-z0-9_-]{21}[AQgw]$")
    private val displayName = Regex("^(?!\\s)(?![\\s\\S]*\\s$)(?![\\s\\S]*(?:[Aa][Pp][Ii][-_ ]?[Kk][Ee][Yy]|[Aa][Uu][Tt][Hh][Oo][Rr][Ii][Zz][Aa][Tt][Ii][Oo][Nn]|[Bb][Ee][Aa][Rr][Ee][Rr]|[Tt][Oo][Kk][Ee][Nn]|[Ss][Ee][Cc][Rr][Ee][Tt]|[Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd]|(?:^|[^A-Za-z0-9_-])[Ss][Kk]-(?:[Pp][Rr][Oo][Jj]-)?[A-Za-z0-9_-]{8,}|https?://|file:))[^\\x00-\\x1F\\x7F-\\x9F/\\\\]+$")
    fun isRuntimeStatusPayload(value: JsonObject, isSafeMessage: (String) -> Boolean): Boolean = value.keySet() == runtimeKeys && value.string("protocolVersion") == RUNTIME_PROTOCOL_VERSION && value.string("surface") in surfaces && value.string("lifecycle") in lifecycles && value.string("runtimeOwner") in runtimeOwners && value.string("launchMode") in launchModes && value.string("tokenState") in tokenStates && value.string("processState") in processStates && value.string("diagnosis")?.let(isSafeMessage) == true && value.string("nextAction")?.let(isSafeMessage) == true && value.boolean("cloudRequired") == false && value.string("authority") == "metadata_only"

    fun isWorkspaceBindingPayload(value: JsonObject): Boolean {
        if (value.string("protocolVersion") != WORKSPACE_BINDING_PROTOCOL_VERSION || value.string("requestId")?.let { it.length in 1..128 && requestId.matches(it) } != true) return false
        return when (value.string("state")) {
            "auto_bound" -> value.keySet() == autoBoundKeys && value.string("projectId")?.let(projectId::matches) == true && value.string("displayName")?.let { it.codePointCount(0, it.length) in 1..120 && displayName.matches(it) } == true
            "selection_required" -> value.keySet() == selectionRequiredKeys && value.string("reason") in bindingReasons
            else -> false
        }
    }

    private fun JsonObject.string(name: String): String? = get(name)?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isString }?.asString
    private fun JsonObject.boolean(name: String): Boolean? = get(name)?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isBoolean }?.asBoolean
}
