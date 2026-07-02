package ai.yet.plugin.bridge

import ai.yet.plugin.identity.ProductIdentity
import com.google.gson.JsonObject
import com.google.gson.JsonParser

data class ControlledFileReadRequest(
    val requestId: String,
    val requestIdMintedBy: String,
    val source: String,
    val controlledWorkspaceId: String,
    val runId: String,
    val workspaceRelativePath: String,
    val maxBytes: Int,
    val maxLines: Int,
    val allowBody: Boolean,
)

object ControlledFileRead {
    private const val MaxRequestBytes = 8192
    private val RequestIdRegex = Regex("^(?!.*(?:authorization|bearer|api[_-]?key|token|secret|access[_-]?token|provider[_-]?key|openai[_-]?api[_-]?key|sk-(?:proj-)?[A-Za-z0-9_-]{8,}))[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$", RegexOption.IGNORE_CASE)
    private val SafeIdRegex = Regex("^(?!assistant(?:[._-]|$))(?!.*(?:assistant|sk-(?:proj-)?))[A-Za-z0-9][A-Za-z0-9._-]{0,79}$", RegexOption.IGNORE_CASE)
    private val WorkspacePathRegex = Regex("""^(?!/)(?![A-Za-z]:)(?!~)(?!.*(?:^|/)\.)(?!.*(?:^|/)\.\.(?:/|$))(?!.*//)(?!.*[\:*?"<>|{}\[\]$^+])(?!(?:^|.*/)(?:node_modules|vendor|dist|build|out|target|coverage|__pycache__|generated|tmp|temp|secrets?|credentials?|private)(?:/|$))[A-Za-z0-9][A-Za-z0-9._-]*(?:/[A-Za-z0-9][A-Za-z0-9._-]*)*$""")

    fun isRequestType(raw: String): Boolean = raw.contains("\"gui.controlledAgentFileReadRequest\"")

    fun safeRequestIdFromRaw(raw: String): String? {
        if (raw.toByteArray(Charsets.UTF_8).size > MaxRequestBytes) return null
        val record = parseRecord(raw) ?: return null
        if (record.stringValue("version") != ProductIdentity.bridgeVersion) return null
        if (record.stringValue("type") != "gui.controlledAgentFileReadRequest") return null
        return record.stringValue("requestId")?.takeIf(::isRequestId)
    }

    fun parse(raw: String): ControlledFileReadRequest? {
        if (raw.toByteArray(Charsets.UTF_8).size > MaxRequestBytes) return null
        val record = parseRecord(raw) ?: return null
        if (!record.keySet().all { it in setOf("version", "type", "requestId", "payload") }) return null
        if (record.stringValue("version") != ProductIdentity.bridgeVersion) return null
        if (record.stringValue("type") != "gui.controlledAgentFileReadRequest") return null
        val requestId = record.stringValue("requestId")?.takeIf(::isRequestId) ?: return null
        val payload = record.get("payload")?.takeIf { it.isJsonObject }?.asJsonObject ?: return null
        if (!payload.keySet().all { it in setOf("requestIdMintedBy", "source", "assistantMinted", "controlledWorkspaceId", "runId", "runtimeSessionId", "sessionId", "workspaceRelativePath", "maxBytes", "maxLines", "allowBody", "singleFileOnly", "recursive", "globAllowed", "regexAllowed", "indexingAllowed") }) return null
        val requestIdMintedBy = payload.stringValue("requestIdMintedBy")?.takeIf { it == "gui" || it == "host" } ?: return null
        val source = payload.stringValue("source")?.takeIf { it == "gui" || it == "host" } ?: return null
        if (payload.booleanValue("assistantMinted") != false) return null
        val controlledWorkspaceId = payload.stringValue("controlledWorkspaceId")?.takeIf(::isSafeId) ?: return null
        val runId = payload.stringValue("runId")?.takeIf(::isSafeId) ?: return null
        payload.stringValue("runtimeSessionId")?.takeIf(::isSafeId) ?: if (payload.has("runtimeSessionId")) return null else null
        payload.stringValue("sessionId")?.takeIf(::isSafeId) ?: if (payload.has("sessionId")) return null else null
        val workspaceRelativePath = payload.stringValue("workspaceRelativePath")?.takeIf(::isWorkspaceRelativePath) ?: return null
        val maxBytes = payload.intValue("maxBytes")?.takeIf { it in 1..8192 } ?: return null
        val maxLines = payload.intValue("maxLines")?.takeIf { it in 1..240 } ?: return null
        val allowBody = payload.booleanValue("allowBody") ?: return null
        if (payload.booleanValue("singleFileOnly") != true) return null
        if (payload.booleanValue("recursive") != false) return null
        if (payload.booleanValue("globAllowed") != false) return null
        if (payload.booleanValue("regexAllowed") != false) return null
        if (payload.booleanValue("indexingAllowed") != false) return null
        return ControlledFileReadRequest(
            requestId = requestId,
            requestIdMintedBy = requestIdMintedBy,
            source = source,
            controlledWorkspaceId = controlledWorkspaceId,
            runId = runId,
            workspaceRelativePath = workspaceRelativePath,
            maxBytes = maxBytes,
            maxLines = maxLines,
            allowBody = allowBody,
        )
    }

    fun unsupportedResult(request: ControlledFileReadRequest): String = JsonObject().apply {
        addProperty("version", ProductIdentity.bridgeVersion)
        addProperty("type", "host.controlledAgentFileReadResult")
        addProperty("requestId", request.requestId)
        add("payload", JsonObject().apply {
            addProperty("kind", "controlled_agent_file_read")
            addProperty("version", "2026-06-29")
            addProperty("authority", "bounded_text_file_read")
            addProperty("cloudRequired", false)
            addProperty("executionAllowed", false)
            addProperty("agentStartAllowed", false)
            add("workspace", JsonObject().apply {
                addProperty("controlledWorkspaceId", request.controlledWorkspaceId)
                addProperty("runId", request.runId)
                addProperty("workspaceMode", "worktree")
                addProperty("host", "jetbrains")
                addProperty("privatePathExposed", false)
                addProperty("workspaceLabel", "Controlled worktree")
            })
            add("request", JsonObject().apply {
                addProperty("requestId", request.requestId)
                addProperty("source", request.source)
                addProperty("requestIdMintedBy", request.requestIdMintedBy)
                addProperty("assistantMinted", false)
                addProperty("workspaceRelativePath", request.workspaceRelativePath)
                addProperty("textOnly", true)
                addProperty("maxBytes", request.maxBytes)
                add("budget", JsonObject().apply {
                    addProperty("scope", "single_explicit_file")
                    addProperty("maxBytes", request.maxBytes)
                    addProperty("maxLines", request.maxLines)
                    addProperty("allowBody", false)
                    addProperty("singleFileOnly", true)
                    addProperty("recursive", false)
                    addProperty("globAllowed", false)
                    addProperty("regexAllowed", false)
                    addProperty("indexingAllowed", false)
                    addProperty("budgetLabel", "Metadata only budget")
                })
                addProperty("reason", "JetBrains bounded read is disabled")
            })
            add("policyFlags", JsonObject().apply {
                addProperty("fileReadAllowed", false)
                addProperty("fileWriteAllowed", false)
                addProperty("shellAllowed", false)
                addProperty("gitAllowed", false)
                addProperty("providerAllowed", false)
                addProperty("toolAllowed", false)
                addProperty("hiddenSearchAllowed", false)
                addProperty("indexingAllowed", false)
                addProperty("binaryReadAllowed", false)
                addProperty("symlinkAllowed", false)
                addProperty("autoStartAllowed", false)
                addProperty("autoApplyAllowed", false)
                addProperty("autoRunAllowed", false)
            })
            add("result", JsonObject().apply {
                addProperty("status", "disabled")
                addProperty("cloudRequired", false)
                addProperty("executionAllowed", false)
                addProperty("bodyIncluded", false)
                addProperty("truncated", false)
                addProperty("blockedReason", "read_disabled")
                addProperty("message", "JetBrains bounded read is disabled")
            })
        })
    }.toString()

    fun rejectedResult(requestId: String): String = unsupportedResult(
        ControlledFileReadRequest(
            requestId = requestId,
            requestIdMintedBy = "host",
            source = "host",
            controlledWorkspaceId = "workspace-read-disabled",
            runId = "run-read-disabled",
            workspaceRelativePath = "docs/architecture/read-disabled.md",
            maxBytes = 1,
            maxLines = 1,
            allowBody = false,
        ),
    )

    private fun parseRecord(raw: String): JsonObject? {
        val element = try {
            JsonParser.parseString(raw)
        } catch (_: RuntimeException) {
            return null
        }
        return element.takeIf { it.isJsonObject }?.asJsonObject
    }

    private fun isRequestId(value: String): Boolean = RequestIdRegex.matches(value)

    private fun isSafeId(value: String): Boolean = SafeIdRegex.matches(value)

    private fun isWorkspaceRelativePath(value: String): Boolean = value.length <= 180 && WorkspacePathRegex.matches(value)

    private fun JsonObject.stringValue(name: String): String? {
        val element = get(name) ?: return null
        if (!element.isJsonPrimitive || !element.asJsonPrimitive.isString) return null
        return element.asString
    }

    private fun JsonObject.booleanValue(name: String): Boolean? {
        val element = get(name) ?: return null
        if (!element.isJsonPrimitive || !element.asJsonPrimitive.isBoolean) return null
        return element.asBoolean
    }

    private fun JsonObject.intValue(name: String): Int? {
        val element = get(name) ?: return null
        if (!element.isJsonPrimitive || !element.asJsonPrimitive.isNumber) return null
        return try {
            val value = element.asInt
            if (element.asString == value.toString()) value else null
        } catch (_: RuntimeException) {
            null
        }
    }
}
