package ai.yet.plugin.bridge

import ai.yet.plugin.identity.ProductIdentity
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser

object ControlledIdeActions {
    private const val MaxRequestIdLength = 128
    private const val MaxWorkspaceRelativePathLength = 512
    private const val MaxMessageLength = 1000
    private const val MaxPositionValue = 1_000_000
    private const val MaxApplyWorkspaceEditRequestBytes = 65_536
    private const val MaxApplyWorkspaceFileGroups = 4
    private const val MaxApplyWorkspaceTextReplacementsPerFile = 16
    private const val MaxApplyWorkspaceReplacementTextLength = 8_192
    private const val MaxApplyWorkspaceTotalReplacementTextLength = 32_768

    val supportedActions: Set<String> = setOf("getContextSnapshot", "openWorkspaceFile", "revealWorkspaceRange")
    const val supportsApplyWorkspaceEditResult: Boolean = true

    sealed class Request {
        abstract val requestId: String
        abstract val action: String

        data class GetContextSnapshot(override val requestId: String) : Request() {
            override val action: String = "getContextSnapshot"
        }

        data class OpenWorkspaceFile(override val requestId: String, val workspaceRelativePath: String) : Request() {
            override val action: String = "openWorkspaceFile"
        }

        data class RevealWorkspaceRange(override val requestId: String, val workspaceRelativePath: String, val range: Range) : Request() {
            override val action: String = "revealWorkspaceRange"
        }
    }

    data class Position(val line: Int, val character: Int)
    data class Range(val start: Position, val end: Position)
    data class ApplyWorkspaceEditRequest(val requestId: String, val summary: String, val edits: List<ApplyWorkspaceFileEdit>)
    data class ApplyWorkspaceFileEdit(val workspaceRelativePath: String, val textReplacements: List<ApplyWorkspaceTextReplacement>)
    data class ApplyWorkspaceTextReplacement(val range: Range, val replacementText: String)

    enum class ApplyWorkspaceEditStatus(val wireValue: String) {
        Applied("applied"),
        Denied("denied"),
        Rejected("rejected"),
        Failed("failed"),
    }


    enum class ResultStatus(val wireValue: String) {
        Succeeded("succeeded"),
        Rejected("rejected"),
        Unavailable("unavailable"),
        Failed("failed"),
    }

    enum class ProgressStatus(val wireValue: String) {
        Pending("pending"),
        InProgress("inProgress"),
        Succeeded("succeeded"),
        Rejected("rejected"),
        Unavailable("unavailable"),
        Failed("failed"),
    }

    fun parse(raw: String): Request? {
        val element = try {
            JsonParser.parseString(raw)
        } catch (_: RuntimeException) {
            return null
        }
        if (!element.isJsonObject) return null
        val record = element.asJsonObject
        if (!record.keySet().all { it in setOf("version", "type", "requestId", "payload") }) return null
        if (record.stringValue("version") != ProductIdentity.bridgeVersion) return null
        if (record.stringValue("type") != "gui.ideActionRequest") return null
        val requestId = record.stringValue("requestId")?.takeIf(::isRequiredRequestId) ?: return null
        val payload = record.get("payload")?.takeIf { it.isJsonObject }?.asJsonObject ?: return null

        return when (payload.stringValue("action")) {
            "getContextSnapshot" -> {
                if (!payload.keySet().all { it == "action" }) return null
                Request.GetContextSnapshot(requestId)
            }
            "openWorkspaceFile" -> {
                if (!payload.keySet().all { it in setOf("action", "workspaceRelativePath") }) return null
                val path = payload.stringValue("workspaceRelativePath")?.takeIf(::isStrictSafeWorkspaceRelativePath) ?: return null
                Request.OpenWorkspaceFile(requestId, path)
            }
            "revealWorkspaceRange" -> {
                if (!payload.keySet().all { it in setOf("action", "workspaceRelativePath", "range") }) return null
                val path = payload.stringValue("workspaceRelativePath")?.takeIf(::isStrictSafeWorkspaceRelativePath) ?: return null
                val range = parseRange(payload.get("range")) ?: return null
                Request.RevealWorkspaceRange(requestId, path, range)
            }
            else -> null
        }
    }

    fun safeRequestIdFromRaw(raw: String): String? {
        val element = try {
            JsonParser.parseString(raw)
        } catch (_: RuntimeException) {
            return null
        }
        if (!element.isJsonObject) return null
        val record = element.asJsonObject
        if (!record.keySet().all { it in setOf("version", "type", "requestId", "payload") }) return null
        if (record.stringValue("version") != ProductIdentity.bridgeVersion) return null
        if (record.stringValue("type") != "gui.ideActionRequest") return null
        return record.stringValue("requestId")?.takeIf(::isRequiredRequestId)
    }

    fun parseApplyWorkspaceEdit(raw: String): ApplyWorkspaceEditRequest? {
        if (raw.toByteArray(Charsets.UTF_8).size > MaxApplyWorkspaceEditRequestBytes) return null
        val element = try {
            JsonParser.parseString(raw)
        } catch (_: RuntimeException) {
            return null
        }
        if (!element.isJsonObject) return null
        val record = element.asJsonObject
        if (!record.keySet().all { it in setOf("version", "type", "requestId", "payload") }) return null
        if (record.stringValue("version") != ProductIdentity.bridgeVersion) return null
        if (record.stringValue("type") != "gui.applyWorkspaceEditRequest") return null
        val requestId = record.stringValue("requestId")?.takeIf(::isRequiredRequestId) ?: return null
        val payload = record.get("payload")?.takeIf { it.isJsonObject }?.asJsonObject ?: return null
        if (!payload.keySet().all { it in setOf("requiresUserConfirmation", "summary", "cloudRequired", "edits") }) return null
        if (payload.booleanValue("requiresUserConfirmation") != true) return null
        if (payload.has("cloudRequired") && payload.booleanValue("cloudRequired") != false) return null
        val summary = payload.stringValue("summary")?.takeIf(::isSafeStatusMessage) ?: return null
        val editsArray = payload.get("edits")?.takeIf { it.isJsonArray }?.asJsonArray ?: return null
        if (editsArray.size() !in 1..MaxApplyWorkspaceFileGroups) return null

        val edits = mutableListOf<ApplyWorkspaceFileEdit>()
        val seenPaths = mutableSetOf<String>()
        var totalReplacementText = 0
        for (fileEditElement in editsArray) {
            if (!fileEditElement.isJsonObject) return null
            val fileEdit = fileEditElement.asJsonObject
            if (!fileEdit.keySet().all { it in setOf("workspaceRelativePath", "textReplacements") }) return null
            val path = fileEdit.stringValue("workspaceRelativePath")?.takeIf(::isStrictSafeWorkspaceRelativePath) ?: return null
            if (!seenPaths.add(path)) return null
            val replacementsArray = fileEdit.get("textReplacements")?.takeIf { it.isJsonArray }?.asJsonArray ?: return null
            if (replacementsArray.size() !in 1..MaxApplyWorkspaceTextReplacementsPerFile) return null
            val replacements = mutableListOf<ApplyWorkspaceTextReplacement>()
            for (replacementElement in replacementsArray) {
                if (!replacementElement.isJsonObject) return null
                val replacement = replacementElement.asJsonObject
                if (!replacement.keySet().all { it in setOf("range", "replacementText") }) return null
                val range = parseRange(replacement.get("range")) ?: return null
                val replacementText = replacement.stringValue("replacementText") ?: return null
                if (replacementText.length > MaxApplyWorkspaceReplacementTextLength || replacementText.any { it.isISOControl() && it != '\n' && it != '\r' && it != '\t' }) return null
                totalReplacementText += replacementText.length
                if (totalReplacementText > MaxApplyWorkspaceTotalReplacementTextLength) return null
                replacements.add(ApplyWorkspaceTextReplacement(range, replacementText))
            }
            edits.add(ApplyWorkspaceFileEdit(path, replacements))
        }
        return ApplyWorkspaceEditRequest(requestId, summary, edits)
    }

    fun isApplyWorkspaceEditRequestType(raw: String): Boolean = raw.contains("\"gui.applyWorkspaceEditRequest\"")

    fun safeApplyWorkspaceEditRequestIdFromRaw(raw: String): String? {
        if (raw.toByteArray(Charsets.UTF_8).size > MaxApplyWorkspaceEditRequestBytes) return null
        val element = try {
            JsonParser.parseString(raw)
        } catch (_: RuntimeException) {
            return null
        }
        if (!element.isJsonObject) return null
        val record = element.asJsonObject
        if (!record.keySet().all { it in setOf("version", "type", "requestId", "payload") }) return null
        if (record.stringValue("version") != ProductIdentity.bridgeVersion) return null
        if (record.stringValue("type") != "gui.applyWorkspaceEditRequest") return null
        return record.stringValue("requestId")?.takeIf(::isRequiredRequestId)
    }

    fun ideActionProgress(
        requestId: String,
        phase: String,
        status: ProgressStatus,
        summary: String,
        action: String? = null,
        workspaceRelativePath: String? = null,
    ): String = JsonObject().apply {
        addProperty("version", ProductIdentity.bridgeVersion)
        addProperty("type", "host.ideActionProgress")
        addProperty("requestId", sanitizeRequestIdForHost(requestId))
        add("payload", JsonObject().apply {
            addProperty("phase", sanitizePhase(phase))
            addProperty("status", status.wireValue)
            addProperty("summary", sanitizeStatusMessage(summary))
            addProperty("cloudRequired", false)
            action?.takeIf { it in supportedActions }?.let { addProperty("action", it) }
            workspaceRelativePath?.takeIf(::isStrictSafeWorkspaceRelativePath)?.let { addProperty("workspaceRelativePath", it) }
        })
    }.toString()

    fun ideActionResult(
        requestId: String,
        status: ResultStatus,
        message: String,
        action: String? = null,
        workspaceRelativePath: String? = null,
        range: Range? = null,
        includeContextMetadata: Boolean = false,
        hasActiveEditor: Boolean = false,
        workspaceFolderCount: Int = 0,
    ): String = JsonObject().apply {
        addProperty("version", ProductIdentity.bridgeVersion)
        addProperty("type", "host.ideActionResult")
        addProperty("requestId", sanitizeRequestIdForHost(requestId))
        add("payload", JsonObject().apply {
            addProperty("status", status.wireValue)
            addProperty("message", sanitizeStatusMessage(message))
            addProperty("cloudRequired", false)
            val safeAction = action?.takeIf { it in supportedActions }
            safeAction?.let { addProperty("action", it) }
            if (safeAction != "getContextSnapshot") {
                workspaceRelativePath?.takeIf(::isStrictSafeWorkspaceRelativePath)?.let { addProperty("workspaceRelativePath", it) }
            }
            if (safeAction == "revealWorkspaceRange" && range != null) {
                add("range", range.toJson())
            }
            if (includeContextMetadata || safeAction == "getContextSnapshot") {
                add("context", JsonObject().apply {
                    addProperty("source", "jetbrains")
                    addProperty("hasActiveEditor", hasActiveEditor)
                    addProperty("workspaceFolderCount", workspaceFolderCount.coerceAtLeast(0))
                })
            }
        })
    }.toString()

    fun applyWorkspaceEditResult(
        requestId: String,
        status: ApplyWorkspaceEditStatus,
        message: String,
        appliedEditCount: Int? = null,
        affectedFiles: List<String> = emptyList(),
    ): String = JsonObject().apply {
        addProperty("version", ProductIdentity.bridgeVersion)
        addProperty("type", "host.applyWorkspaceEditResult")
        addProperty("requestId", sanitizeRequestIdForHost(requestId))
        add("payload", JsonObject().apply {
            addProperty("status", status.wireValue)
            addProperty("message", sanitizeApplyWorkspaceEditStatusMessage(message))
            addProperty("cloudRequired", false)
            appliedEditCount?.let { addProperty("appliedEditCount", it.coerceIn(0, 64)) }
            val safeFiles = affectedFiles.filter(::isStrictSafeWorkspaceRelativePath).take(4)
            if (safeFiles.isNotEmpty()) {
                add("affectedFiles", com.google.gson.JsonArray().apply {
                    safeFiles.forEach { add(it) }
                })
            }
        })
    }.toString()

    fun isRequiredRequestId(value: String): Boolean =
        value.length in 1..MaxRequestIdLength &&
            RequestIdRegex.matches(value) &&
            !SecretRequestIdRegex.containsMatchIn(value)

    fun isStrictSafeWorkspaceRelativePath(value: String): Boolean {
        if (value.isEmpty() || value.length > MaxWorkspaceRelativePathLength) return false
        if (value.startsWith("/") || value.startsWith("~")) return false
        if (value.contains('\\') || value.contains(':') || value.contains('%') || value.contains('?') || value.contains('#')) return false
        if (value.any { it.isISOControl() }) return false
        if (value.contains("//") || value.endsWith('/')) return false
        val segments = value.split('/')
        if (segments.any { it.isEmpty() || it == "." || it == ".." || isSecretLikePathSegment(it) }) return false
        return true
    }

    private fun parseRange(element: JsonElement?): Range? {
        if (element == null || !element.isJsonObject) return null
        val range = element.asJsonObject
        if (!range.keySet().all { it in setOf("start", "end") }) return null
        val start = parsePosition(range.get("start")) ?: return null
        val end = parsePosition(range.get("end")) ?: return null
        if (end.line < start.line || (end.line == start.line && end.character < start.character)) return null
        return Range(start, end)
    }

    private fun parsePosition(element: JsonElement?): Position? {
        if (element == null || !element.isJsonObject) return null
        val position = element.asJsonObject
        if (!position.keySet().all { it in setOf("line", "character") }) return null
        val line = position.intValue("line") ?: return null
        val character = position.intValue("character") ?: return null
        if (line !in 0..MaxPositionValue || character !in 0..MaxPositionValue) return null
        return Position(line, character)
    }

    private fun Range.toJson(): JsonObject = JsonObject().apply {
        add("start", start.toJson())
        add("end", end.toJson())
    }

    private fun Position.toJson(): JsonObject = JsonObject().apply {
        addProperty("line", line)
        addProperty("character", character)
    }

    private fun sanitizeRequestIdForHost(value: String): String = value.takeIf(::isRequiredRequestId) ?: "jetbrains-request"

    private fun sanitizePhase(value: String): String = value.takeIf { it in setOf("queued", "checkingPolicy", "running", "completed") } ?: "completed"

    private fun sanitizeStatusMessage(value: String): String =
        if (value.isEmpty() || value.length > MaxMessageLength || value.any { it.isISOControl() } || SecretTextRegex.containsMatchIn(value) || PrivatePathRegex.containsMatchIn(value)) {
            "IDE action status changed."
        } else {
            value
        }

    private fun sanitizeApplyWorkspaceEditStatusMessage(value: String): String =
        if (!isSafeStatusMessage(value)) {
            "Edit request status changed."
        } else {
            value
        }

    private fun isSafeStatusMessage(value: String): Boolean =
        value.isNotEmpty() &&
            value.length <= MaxMessageLength &&
            value.none { it.isISOControl() } &&
            !SecretTextRegex.containsMatchIn(value) &&
            !PrivatePathRegex.containsMatchIn(value)

    private fun isSecretLikePathSegment(value: String): Boolean =
        SecretPathSegmentPrefixRegex.containsMatchIn(value) ||
            SecretPathSegmentMarkerRegex.containsMatchIn(value) ||
            SecretPathSegmentTokenRegex.containsMatchIn(value)

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
            val number = element.asNumber
            val asLong = number.toLong()
            if (asLong.toDouble() != number.toDouble() || asLong !in Int.MIN_VALUE..Int.MAX_VALUE) null else asLong.toInt()
        } catch (_: RuntimeException) {
            null
        }
    }

    private val RequestIdRegex = Regex("^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
    private val SecretRequestIdRegex = Regex("authorization|bearer|api[_-]?key|token|secret|access[_-]?token|provider[_-]?key|openai[_-]?api[_-]?key|sk-(?:proj-)?[A-Za-z0-9_-]{8,}", RegexOption.IGNORE_CASE)
    private val SecretPathSegmentPrefixRegex = Regex("^(?:auth|authorization|bearer|cookie|credential|credentials|password|secret|token|access[_-]?token|api[_-]?key)(?:[._-]|$)", RegexOption.IGNORE_CASE)
    private val SecretPathSegmentMarkerRegex = Regex("(?:^|[._-])(?:auth|credential|credentials|password|secret|token|access[_-]?token|api[_-]?key)(?:[._-]|$)", RegexOption.IGNORE_CASE)
    private val SecretPathSegmentTokenRegex = Regex("^sk-(?:proj-)?[A-Za-z0-9_-]{8,}", RegexOption.IGNORE_CASE)
    private val SecretTextRegex = Regex("authorization|bearer|cookie|api[_-]?key|token|secret|password|private[_-]?path|provider[_-]?response|raw[_-]?prompt|file[_-]?content|sk-(?:proj-)?[A-Za-z0-9_-]{8,}", RegexOption.IGNORE_CASE)
    private val PrivatePathRegex = Regex("/(?:Users|Home|Tmp|Var|Etc|Opt|Mnt|Volumes|Private)(?=/|$|[^A-Za-z0-9_])|[A-Za-z]:(?:/|\\\\)|~(?:/|\\\\)", RegexOption.IGNORE_CASE)
}
