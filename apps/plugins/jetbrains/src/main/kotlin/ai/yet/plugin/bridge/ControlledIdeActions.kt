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
    private const val MaxControlledAgentEditRequestBytes = 65_536
    private const val MaxControlledAgentEditPathLength = 180
    private const val MaxControlledAgentEditIdLength = 120
    private const val MaxControlledAgentEditLabelLength = 160
    private const val MaxControlledAgentEditSummaryLength = 240
    private const val MaxControlledAgentEditPatchBytes = 12_000

    val supportedActions: Set<String> = setOf("getContextSnapshot", "openWorkspaceFile", "revealWorkspaceRange", "getActiveFileExcerpt")
    const val supportsApplyWorkspaceEditResult: Boolean = true

    sealed class Request {
        abstract val requestId: String
        abstract val action: String

        data class GetContextSnapshot(override val requestId: String) : Request() {
            override val action: String = "getContextSnapshot"
        }

        data class GetActiveFileExcerpt(override val requestId: String) : Request() {
            override val action: String = "getActiveFileExcerpt"
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
    data class ActiveFileExcerptAttachment(
        val displayPath: String,
        val workspaceRelativePath: String,
        val languageId: String?,
        val range: Range,
        val text: String,
        val truncated: Boolean,
    )
    data class ApplyWorkspaceEditRequest(val requestId: String, val summary: String, val edits: List<ApplyWorkspaceFileEdit>)
    data class ApplyWorkspaceFileEdit(val workspaceRelativePath: String, val textReplacements: List<ApplyWorkspaceTextReplacement>)
    data class ApplyWorkspaceTextReplacement(val range: Range, val replacementText: String)
    data class ControlledAgentEditRequest(
        val requestId: String,
        val requestIdMintedBy: String,
        val controlledWorkspaceId: String,
        val runId: String,
        val runtimeSessionId: String?,
        val workspaceReadinessId: String,
        val limits: ControlledAgentEditLimits,
        val edits: List<ControlledAgentReplacementEdit>,
    )
    data class ControlledAgentEditLimits(val maxFiles: Int, val maxEdits: Int, val maxPatchBytes: Int)
    data class ControlledAgentReplacementEdit(
        val workspaceRelativePath: String,
        val fileLabel: String,
        val expectedContentHash: String,
        val startLine: Int,
        val endLine: Int,
        val replacementText: String,
        val replacementByteCount: Int,
        val sanitizedSummary: String,
    )

    enum class ApplyWorkspaceEditStatus(val wireValue: String) {
        Applied("applied"),
        Denied("denied"),
        Rejected("rejected"),
        Failed("failed"),
    }

    enum class ControlledAgentEditStatus(val wireValue: String) {
        Applied("applied"),
        Blocked("blocked"),
        Failed("failed"),
    }

    enum class ControlledAgentEditBlockedReason(val wireValue: String) {
        EditDisabled("edit_disabled"),
        PolicyDenied("policy_denied"),
        UnsafePath("unsafe_path"),
        OutsideWorkspace("outside_workspace"),
        HiddenPath("hidden_path"),
        DependencyPath("dependency_path"),
        GeneratedPath("generated_path"),
        UnsupportedOperation("unsupported_operation"),
        MissingExpectedHash("missing_expected_hash"),
        HashMismatch("hash_mismatch"),
        UnconfirmedRequest("unconfirmed_request"),
        AssistantMinted("assistant_minted"),
        BudgetExceeded("budget_exceeded"),
        LineRangeInvalid("line_range_invalid"),
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
            "getActiveFileExcerpt" -> {
                if (!payload.keySet().all { it == "action" }) return null
                Request.GetActiveFileExcerpt(requestId)
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

    fun parseControlledAgentEdit(raw: String): ControlledAgentEditRequest? {
        if (raw.toByteArray(Charsets.UTF_8).size > MaxControlledAgentEditRequestBytes) return null
        val element = try {
            JsonParser.parseString(raw)
        } catch (_: RuntimeException) {
            return null
        }
        if (!element.isJsonObject) return null
        val record = element.asJsonObject
        if (!record.keySet().all { it in setOf("version", "type", "requestId", "payload") }) return null
        if (record.stringValue("version") != ProductIdentity.bridgeVersion) return null
        if (record.stringValue("type") != "gui.controlledAgentEditRequest") return null
        val envelopeRequestId = record.stringValue("requestId")?.takeIf(::isRequiredRequestId) ?: return null
        val payload = record.get("payload")?.takeIf { it.isJsonObject }?.asJsonObject ?: return null
        if (!payload.keySet().all { it in setOf("requestId", "requestIdMintedBy", "source", "assistantMinted", "controlledWorkspaceId", "runId", "runtimeSessionId", "sessionId", "workspaceReadinessId", "userConfirmed", "limits", "edits") }) return null
        val payloadRequestId = payload.stringValue("requestId")?.takeIf(::isSafeControlledAgentEditId) ?: return null
        if (payloadRequestId != envelopeRequestId) return null
        val mintedBy = payload.stringValue("requestIdMintedBy")?.takeIf { it == "gui" } ?: return null
        if (payload.stringValue("source") != "gui") return null
        if (payload.booleanValue("assistantMinted") != false) return null
        if (payload.booleanValue("userConfirmed") != true) return null
        val controlledWorkspaceId = payload.stringValue("controlledWorkspaceId")?.takeIf(::isSafeControlledAgentEditId) ?: return null
        val runId = payload.stringValue("runId")?.takeIf(::isSafeControlledAgentEditId) ?: return null
        val runtimeSessionId = payload.stringValue("runtimeSessionId")?.takeIf(::isSafeControlledAgentEditId)
        val sessionId = payload.stringValue("sessionId")?.takeIf(::isSafeControlledAgentEditId)
        if (payload.has("runtimeSessionId") && runtimeSessionId == null) return null
        if (payload.has("sessionId") && sessionId == null) return null
        val workspaceReadinessId = payload.stringValue("workspaceReadinessId")?.takeIf(::isSafeControlledAgentEditId) ?: return null
        val limits = parseControlledAgentEditLimits(payload.get("limits")) ?: return null
        val editsArray = payload.get("edits")?.takeIf { it.isJsonArray }?.asJsonArray ?: return null
        if (editsArray.size() !in 1..limits.maxEdits || editsArray.size() > 16) return null
        val seenPaths = mutableSetOf<String>()
        val edits = mutableListOf<ControlledAgentReplacementEdit>()
        var totalPatchBytes = 0
        for (editElement in editsArray) {
            val edit = parseControlledAgentReplacementEdit(editElement) ?: return null
            if (!seenPaths.add(edit.workspaceRelativePath)) return null
            totalPatchBytes += edit.replacementByteCount
            if (totalPatchBytes > limits.maxPatchBytes || totalPatchBytes > MaxControlledAgentEditPatchBytes) return null
            edits.add(edit)
        }
        if (seenPaths.size > limits.maxFiles) return null
        return ControlledAgentEditRequest(envelopeRequestId, mintedBy, controlledWorkspaceId, runId, runtimeSessionId ?: sessionId, workspaceReadinessId, limits, edits)
    }

    fun isControlledAgentEditRequestType(raw: String): Boolean = raw.contains("\"gui.controlledAgentEditRequest\"")

    fun safeControlledAgentEditRequestIdFromRaw(raw: String): String? {
        if (raw.toByteArray(Charsets.UTF_8).size > MaxControlledAgentEditRequestBytes) return null
        val element = try {
            JsonParser.parseString(raw)
        } catch (_: RuntimeException) {
            return null
        }
        if (!element.isJsonObject) return null
        val record = element.asJsonObject
        if (!record.keySet().all { it in setOf("version", "type", "requestId", "payload") }) return null
        if (record.stringValue("version") != ProductIdentity.bridgeVersion) return null
        if (record.stringValue("type") != "gui.controlledAgentEditRequest") return null
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
        contextAttachment: ActiveFileExcerptAttachment? = null,
    ): String {
        val safeAction = action?.takeIf { it in supportedActions }
        val safeContextAttachment = contextAttachment?.takeIf(::isSafeActiveFileExcerptAttachment)
        val missingRequiredAttachment = status == ResultStatus.Succeeded && safeAction == "getActiveFileExcerpt" && safeContextAttachment == null
        val effectiveStatus = if (missingRequiredAttachment) ResultStatus.Rejected else status
        val effectiveMessage = if (missingRequiredAttachment) "IDE action request was rejected by policy." else message
        return JsonObject().apply {
            addProperty("version", ProductIdentity.bridgeVersion)
            addProperty("type", "host.ideActionResult")
            addProperty("requestId", sanitizeRequestIdForHost(requestId))
            add("payload", JsonObject().apply {
                addProperty("status", effectiveStatus.wireValue)
                addProperty("message", sanitizeStatusMessage(effectiveMessage))
                addProperty("cloudRequired", false)
                safeAction?.let { addProperty("action", it) }
                if (safeAction != "getContextSnapshot" && safeAction != "getActiveFileExcerpt") {
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
                if (effectiveStatus == ResultStatus.Succeeded && safeAction == "getActiveFileExcerpt") {
                    safeContextAttachment?.let { add("contextAttachment", it.toJson()) }
                }
            })
        }.toString()
    }

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

    fun controlledAgentEditUnsupportedResult(request: ControlledAgentEditRequest): String = controlledAgentEditResult(
        request = request,
        status = ControlledAgentEditStatus.Blocked,
        message = "Bounded replacement edit is not available in JetBrains yet.",
        boundedReplacementEditAllowed = false,
        appliedEditCount = 0,
        blockedReason = ControlledAgentEditBlockedReason.EditDisabled,
    )

    fun controlledAgentEditRejectedResult(requestId: String): String = JsonObject().apply {
        addProperty("version", ProductIdentity.bridgeVersion)
        addProperty("type", "host.controlledAgentEditResult")
        addProperty("requestId", sanitizeRequestIdForHost(requestId))
        add("payload", JsonObject().apply {
            addProperty("type", "controlled_agent_edit_executor")
            addProperty("schemaVersion", "2026-07-02")
            addProperty("state", ControlledAgentEditStatus.Blocked.wireValue)
            addProperty("authority", "bounded_replacement_edit")
            addProperty("cloudRequired", false)
            addProperty("controlledWorkspaceId", "jetbrains-workspace")
            addProperty("runId", "jetbrains-run")
            addProperty("workspaceReadinessId", "jetbrains-ready")
            addProperty("requestId", sanitizeControlledAgentEditId(requestId))
            addProperty("requestIdMintedBy", "gui")
            addProperty("userConfirmed", true)
            add("limits", controlledAgentEditLimitsJson(1, 1, MaxControlledAgentEditPatchBytes))
            add("edits", com.google.gson.JsonArray().apply {
                add(JsonObject().apply {
                    addProperty("operation", "replace")
                    addProperty("workspaceRelativePath", "src/Main.kt")
                    addProperty("fileLabel", "src/Main.kt")
                    addProperty("expectedContentHash", "sha256:0000000000000000000000000000000000000000000000000000000000000000")
                    addProperty("startLine", 1)
                    addProperty("endLine", 1)
                    addProperty("replacementByteCount", 0)
                    addProperty("sanitizedSummary", "Edit request rejected by policy.")
                })
            })
            add("policyFlags", controlledAgentEditPolicyFlags(false))
            add("result", controlledAgentEditResultDetails(ControlledAgentEditStatus.Blocked, "Edit request blocked by policy.", 0, emptyList(), ControlledAgentEditBlockedReason.PolicyDenied))
        })
    }.toString()

    private fun controlledAgentEditResult(
        request: ControlledAgentEditRequest,
        status: ControlledAgentEditStatus,
        message: String,
        boundedReplacementEditAllowed: Boolean,
        appliedEditCount: Int,
        affectedFiles: List<String> = emptyList(),
        blockedReason: ControlledAgentEditBlockedReason? = null,
    ): String = JsonObject().apply {
        addProperty("version", ProductIdentity.bridgeVersion)
        addProperty("type", "host.controlledAgentEditResult")
        addProperty("requestId", sanitizeRequestIdForHost(request.requestId))
        add("payload", JsonObject().apply {
            addProperty("type", "controlled_agent_edit_executor")
            addProperty("schemaVersion", "2026-07-02")
            addProperty("state", status.wireValue)
            addProperty("authority", "bounded_replacement_edit")
            addProperty("cloudRequired", false)
            addProperty("controlledWorkspaceId", request.controlledWorkspaceId)
            addProperty("runId", request.runId)
            request.runtimeSessionId?.let { addProperty("runtimeSessionId", it) }
            addProperty("workspaceReadinessId", request.workspaceReadinessId)
            addProperty("requestId", request.requestId)
            addProperty("requestIdMintedBy", request.requestIdMintedBy)
            addProperty("userConfirmed", true)
            add("limits", controlledAgentEditLimitsJson(request.limits.maxFiles, request.limits.maxEdits, request.limits.maxPatchBytes))
            add("edits", com.google.gson.JsonArray().apply {
                request.edits.forEach { edit -> add(edit.toResultJson()) }
            })
            add("policyFlags", controlledAgentEditPolicyFlags(boundedReplacementEditAllowed))
            add("result", controlledAgentEditResultDetails(status, message, appliedEditCount, affectedFiles, blockedReason))
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

    private fun parseControlledAgentEditLimits(element: JsonElement?): ControlledAgentEditLimits? {
        if (element == null || !element.isJsonObject) return null
        val limits = element.asJsonObject
        if (!limits.keySet().all { it in setOf("maxFiles", "maxEdits", "maxPatchBytes") }) return null
        val maxFiles = limits.intValue("maxFiles") ?: return null
        val maxEdits = limits.intValue("maxEdits") ?: return null
        val maxPatchBytes = limits.intValue("maxPatchBytes") ?: return null
        if (maxFiles !in 1..4 || maxEdits !in 1..16 || maxPatchBytes !in 1..MaxControlledAgentEditPatchBytes) return null
        return ControlledAgentEditLimits(maxFiles, maxEdits, maxPatchBytes)
    }

    private fun parseControlledAgentReplacementEdit(element: JsonElement): ControlledAgentReplacementEdit? {
        if (!element.isJsonObject) return null
        val edit = element.asJsonObject
        if (!edit.keySet().all { it in setOf("operation", "workspaceRelativePath", "fileLabel", "expectedContentHash", "startLine", "endLine", "replacementText", "replacementByteCount", "sanitizedSummary") }) return null
        if (edit.stringValue("operation") != "replace") return null
        val path = edit.stringValue("workspaceRelativePath")?.takeIf(::isControlledAgentEditPath) ?: return null
        val fileLabel = edit.stringValue("fileLabel")?.takeIf { isControlledAgentEditSafeText(it, 1, MaxControlledAgentEditLabelLength) } ?: return null
        val expectedHash = edit.stringValue("expectedContentHash")?.takeIf(::isSafeSha256Hash) ?: return null
        val startLine = edit.intValue("startLine") ?: return null
        val endLine = edit.intValue("endLine") ?: return null
        if (startLine !in 1..MaxPositionValue || endLine !in startLine..MaxPositionValue) return null
        val replacementText = edit.stringValue("replacementText") ?: return null
        if (replacementText.length > MaxControlledAgentEditPatchBytes || replacementText.any { it.isISOControl() && it != '\n' && it != '\r' && it != '\t' }) return null
        val replacementByteCount = edit.intValue("replacementByteCount") ?: return null
        if (replacementByteCount !in 0..MaxControlledAgentEditPatchBytes || replacementText.toByteArray(Charsets.UTF_8).size != replacementByteCount) return null
        val summary = edit.stringValue("sanitizedSummary")?.takeIf { isControlledAgentEditSafeText(it, 1, MaxControlledAgentEditSummaryLength) } ?: return null
        return ControlledAgentReplacementEdit(path, fileLabel, expectedHash, startLine, endLine, replacementText, replacementByteCount, summary)
    }

    private fun ControlledAgentReplacementEdit.toResultJson(): JsonObject = JsonObject().apply {
        addProperty("operation", "replace")
        addProperty("workspaceRelativePath", workspaceRelativePath)
        addProperty("fileLabel", fileLabel)
        addProperty("expectedContentHash", expectedContentHash)
        addProperty("startLine", startLine)
        addProperty("endLine", endLine)
        addProperty("replacementByteCount", replacementByteCount)
        addProperty("sanitizedSummary", sanitizedSummary)
    }

    private fun controlledAgentEditLimitsJson(maxFiles: Int, maxEdits: Int, maxPatchBytes: Int): JsonObject = JsonObject().apply {
        addProperty("maxFiles", maxFiles.coerceIn(1, 4))
        addProperty("maxEdits", maxEdits.coerceIn(1, 16))
        addProperty("maxPatchBytes", maxPatchBytes.coerceIn(1, MaxControlledAgentEditPatchBytes))
    }

    private fun controlledAgentEditPolicyFlags(boundedReplacementEditAllowed: Boolean): JsonObject = JsonObject().apply {
        addProperty("boundedReplacementEditAllowed", boundedReplacementEditAllowed)
        addProperty("fileCreateAllowed", false)
        addProperty("fileDeleteAllowed", false)
        addProperty("fileRenameAllowed", false)
        addProperty("fileMoveAllowed", false)
        addProperty("chmodAllowed", false)
        addProperty("symlinkAllowed", false)
        addProperty("binaryEditAllowed", false)
        addProperty("directoryEditAllowed", false)
        addProperty("shellAllowed", false)
        addProperty("gitAllowed", false)
        addProperty("providerAllowed", false)
        addProperty("toolAllowed", false)
        addProperty("networkAllowed", false)
        addProperty("autoApplyAllowed", false)
        addProperty("autoRunAllowed", false)
    }

    private fun controlledAgentEditResultDetails(
        status: ControlledAgentEditStatus,
        message: String,
        appliedEditCount: Int,
        affectedFiles: List<String>,
        blockedReason: ControlledAgentEditBlockedReason?,
    ): JsonObject = JsonObject().apply {
        addProperty("status", status.wireValue)
        addProperty("cloudRequired", false)
        addProperty("privatePathExposed", false)
        addProperty("rawBodyIncluded", false)
        addProperty("rawDiffIncluded", false)
        addProperty("authority", "bounded_replacement_edit")
        addProperty("message", sanitizeControlledAgentEditSummary(message))
        addProperty("appliedEditCount", appliedEditCount.coerceIn(0, 16))
        val safeAffectedFiles = affectedFiles.filter(::isControlledAgentEditPath).take(4)
        if (safeAffectedFiles.isNotEmpty()) {
            add("affectedFiles", com.google.gson.JsonArray().apply {
                safeAffectedFiles.forEach { add(it) }
            })
        }
        blockedReason?.let { addProperty("blockedReason", it.wireValue) }
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

    fun isSafeActiveFileExcerptContent(value: String): Boolean =
        value.isNotEmpty() &&
            value.none { it.isISOControl() && it != '\n' && it != '\r' && it != '\t' } &&
            !SecretTextRegex.containsMatchIn(value) &&
            !PrivatePathRegex.containsMatchIn(value)

    fun isSafeActiveFileExcerptText(value: String): Boolean =
        value.length <= ActiveEditorContext.MaxExcerptTextLength && isSafeActiveFileExcerptContent(value)

    private fun isSafeActiveFileExcerptAttachment(value: ActiveFileExcerptAttachment): Boolean =
        isStrictSafeWorkspaceRelativePath(value.displayPath) &&
            isStrictSafeWorkspaceRelativePath(value.workspaceRelativePath) &&
            value.languageId?.let { it.isNotEmpty() && it.length <= 64 && LanguageIdRegex.matches(it) } ?: true &&
            isSafeActiveFileExcerptText(value.text)

    private fun ActiveFileExcerptAttachment.toJson(): JsonObject = JsonObject().apply {
        addProperty("kind", "active_file_excerpt")
        addProperty("source", "jetbrains")
        add("file", JsonObject().apply {
            addProperty("displayPath", displayPath)
            addProperty("workspaceRelativePath", workspaceRelativePath)
            languageId?.let { addProperty("languageId", it) }
        })
        add("range", range.toJson())
        addProperty("text", text)
        addProperty("truncated", truncated)
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

    private fun sanitizeControlledAgentEditSummary(value: String): String =
        value.takeIf { isControlledAgentEditSafeText(it, 1, MaxControlledAgentEditSummaryLength) } ?: "Edit request status changed."

    private fun isSafeStatusMessage(value: String): Boolean =
        value.isNotEmpty() &&
            value.length <= MaxMessageLength &&
            value.none { it.isISOControl() } &&
            !SecretTextRegex.containsMatchIn(value) &&
            !PrivatePathRegex.containsMatchIn(value)

    private fun isSafeControlledAgentEditId(value: String): Boolean =
        value.length in 1..MaxControlledAgentEditIdLength && ControlledAgentEditIdRegex.matches(value) && !SecretRequestIdRegex.containsMatchIn(value)

    private fun sanitizeControlledAgentEditId(value: String): String = value.takeIf(::isSafeControlledAgentEditId) ?: "jetbrains-edit"

    private fun isSafeSha256Hash(value: String): Boolean = Sha256HashRegex.matches(value)

    private fun isControlledAgentEditPath(value: String): Boolean {
        if (value.length !in 1..MaxControlledAgentEditPathLength) return false
        if (!isStrictSafeWorkspaceRelativePath(value)) return false
        val segments = value.split('/')
        return segments.none { DependencyOrGeneratedPathRegex.matches(it) || it.startsWith(".") }
    }

    private fun isControlledAgentEditSafeText(value: String, minLength: Int, maxLength: Int): Boolean =
        value.length in minLength..maxLength &&
            value.none { it.isISOControl() } &&
            !ControlledAgentUnsafeTextRegex.containsMatchIn(value) &&
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

    private val LanguageIdRegex = Regex("^[A-Za-z0-9_.+-]+$")
    private val RequestIdRegex = Regex("^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
    private val ControlledAgentEditIdRegex = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$")
    private val Sha256HashRegex = Regex("^sha256:[a-f0-9]{64}$")
    private val DependencyOrGeneratedPathRegex = Regex("^(node_modules|vendor|dist|build|out|target|coverage|__pycache__|generated|tmp|temp|secrets?|credentials?|private)$", RegexOption.IGNORE_CASE)
    private val SecretRequestIdRegex = Regex("authorization|bearer|api[_-]?key|token|secret|access[_-]?token|provider[_-]?key|openai[_-]?api[_-]?key|sk-(?:proj-)?[A-Za-z0-9_-]{8,}", RegexOption.IGNORE_CASE)
    private val SecretPathSegmentPrefixRegex = Regex("^(?:auth|authorization|bearer|cookie|credential|credentials|password|secret|token|access[_-]?token|api[_-]?key)(?:[._-]|$)", RegexOption.IGNORE_CASE)
    private val SecretPathSegmentMarkerRegex = Regex("(?:^|[._-])(?:auth|credential|credentials|password|secret|token|access[_-]?token|api[_-]?key)(?:[._-]|$)", RegexOption.IGNORE_CASE)
    private val SecretPathSegmentTokenRegex = Regex("^sk-(?:proj-)?[A-Za-z0-9_-]{8,}", RegexOption.IGNORE_CASE)
    private val SecretTextRegex = Regex("authorization|bearer|cookie|api[_-]?key|token|secret|password|private[_-]?path|provider[_-]?response|raw[_-]?prompt|file[_-]?content|sk-(?:proj-)?[A-Za-z0-9_-]{8,}", RegexOption.IGNORE_CASE)
    private val ControlledAgentUnsafeTextRegex = Regex("api[_-]?key|authorization|bearer|cookie|token|secret|password|raw[-_ ]?(file|body|patch|diff|command)|file[-_ ]?(body|content)|provider|shell|command|cwd|env|git|tool|chmod|symlink|binary|create|delete|rename|move|auto[-_ ]?(apply|run|repair)|sk-(?:proj-)?[A-Za-z0-9_-]{8,}", RegexOption.IGNORE_CASE)
    private val PrivatePathRegex = Regex("/(?:Users|Home|Tmp|Var|Etc|Opt|Mnt|Volumes|Private)(?=/|$|[^A-Za-z0-9_])|[A-Za-z]:(?:/|\\\\)|~(?:/|\\\\)", RegexOption.IGNORE_CASE)
}
