package ai.yet.plugin.bridge

import ai.yet.plugin.identity.ProductIdentity
import com.google.gson.JsonParser
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ControlledIdeActionsTest {
    @Test
    fun validParseForAllowedActions() {
        val context = ControlledIdeActions.parse(message("req-1", """{"action":"getContextSnapshot"}"""))
        assertIs<ControlledIdeActions.Request.GetContextSnapshot>(context)
        assertEquals("req-1", context.requestId)

        val open = ControlledIdeActions.parse(message("req-2", """{"action":"openWorkspaceFile","workspaceRelativePath":"src/main.kt"}"""))
        assertIs<ControlledIdeActions.Request.OpenWorkspaceFile>(open)
        assertEquals("src/main.kt", open.workspaceRelativePath)

        val reveal = ControlledIdeActions.parse(message("req-3", """{"action":"revealWorkspaceRange","workspaceRelativePath":"src/main.kt","range":{"start":{"line":1,"character":2},"end":{"line":3,"character":4}}}"""))
        assertIs<ControlledIdeActions.Request.RevealWorkspaceRange>(reveal)
        assertEquals("src/main.kt", reveal.workspaceRelativePath)
        assertEquals(ControlledIdeActions.Range(ControlledIdeActions.Position(1, 2), ControlledIdeActions.Position(3, 4)), reveal.range)
    }

    @Test
    fun rejectsInvalidEnvelopeAndRequestId() {
        assertNull(ControlledIdeActions.parse("not-json"))
        assertNull(ControlledIdeActions.parse("[]"))
        assertNull(ControlledIdeActions.parse("""{"version":"old","type":"gui.ideActionRequest","requestId":"req-1","payload":{"action":"getContextSnapshot"}}"""))
        assertNull(ControlledIdeActions.parse("""{"version":"${ProductIdentity.bridgeVersion}","type":"gui.ideActionRequest","payload":{"action":"getContextSnapshot"}}"""))
        assertNull(ControlledIdeActions.parse(message("token-abc", """{"action":"getContextSnapshot"}""")))
        assertNull(ControlledIdeActions.parse(message("provider_key", """{"action":"getContextSnapshot"}""")))
        assertNull(ControlledIdeActions.parse(message("openai_api_key", """{"action":"getContextSnapshot"}""")))
        assertNull(ControlledIdeActions.parse(message("sk-proj-12345678", """{"action":"getContextSnapshot"}""")))
        assertNull(ControlledIdeActions.parse(message("bad id", """{"action":"getContextSnapshot"}""")))
        assertNull(ControlledIdeActions.parse(message("req-1", """{"action":"getContextSnapshot"}""", extra = ""","unexpected":true""")))
    }

    @Test
    fun extractsOnlySafeRequestIdForRejectedResult() {
        assertEquals(
            "req-1",
            ControlledIdeActions.safeRequestIdFromRaw(message("req-1", """{"action":"runShellCommand"}""")),
        )
        assertNull(ControlledIdeActions.safeRequestIdFromRaw(message("token-abc", """{"action":"runShellCommand"}""")))
        assertNull(ControlledIdeActions.safeRequestIdFromRaw(message("provider_key", """{"action":"runShellCommand"}""")))
        assertNull(ControlledIdeActions.safeRequestIdFromRaw(message("openai_api_key", """{"action":"runShellCommand"}""")))
        assertNull(ControlledIdeActions.safeRequestIdFromRaw("not-json"))
        assertNull(ControlledIdeActions.safeRequestIdFromRaw("""{"version":"${ProductIdentity.bridgeVersion}","type":"gui.ready","requestId":"req-1","payload":{}}"""))
        assertNull(ControlledIdeActions.safeRequestIdFromRaw(message("req-1", """{"action":"runShellCommand"}""", extra = ""","extra":true""")))
    }

    @Test
    fun rejectsUnknownWriteApplyShellGitTaskToolProviderAndIndexingActions() {
        listOf(
            "writeWorkspaceFile",
            "applyWorkspaceEdit",
            "gui.applyWorkspaceEditRequest",
            "runShellCommand",
            "gitStatus",
            "runTask",
            "executeIdeTool",
            "callProvider",
            "readWorkspaceFile",
            "indexWorkspace",
        ).forEach { action ->
            assertNull(ControlledIdeActions.parse(message("req-1", """{"action":"$action","workspaceRelativePath":"src/main.kt"}""")), action)
        }
    }

    @Test
    fun rejectsUnsafePaths() {
        val unsafe = listOf(
            "",
            "/src/main.kt",
            "~/src/main.kt",
            "src/../main.kt",
            "src/./main.kt",
            "src//main.kt",
            "src\\main.kt",
            "C:/src/main.kt",
            "src/main.kt?raw=1",
            "src/main.kt#frag",
            "src/%2e%2e/main.kt",
            "src/main.kt/",
            "src/token/main.kt",
            "src/api_key.txt",
            "src/sk-proj-12345678/main.kt",
            "src/line\nbreak.kt",
            "a".repeat(513),
        )
        unsafe.forEach { path ->
            assertNull(ControlledIdeActions.parse(message("req-1", """{"action":"openWorkspaceFile","workspaceRelativePath":${jsonString(path)}}""")), path)
        }
    }

    @Test
    fun rejectsInvalidRangesAndCloudRequiredOrUnknownPayloadFields() {
        assertNull(ControlledIdeActions.parse(message("req-1", """{"action":"revealWorkspaceRange","workspaceRelativePath":"src/main.kt","range":{"start":{"line":2,"character":0},"end":{"line":1,"character":0}}}""")))
        assertNull(ControlledIdeActions.parse(message("req-1", """{"action":"revealWorkspaceRange","workspaceRelativePath":"src/main.kt","range":{"start":{"line":1,"character":5},"end":{"line":1,"character":4}}}""")))
        assertNull(ControlledIdeActions.parse(message("req-1", """{"action":"revealWorkspaceRange","workspaceRelativePath":"src/main.kt","range":{"start":{"line":-1,"character":0},"end":{"line":1,"character":0}}}""")))
        assertNull(ControlledIdeActions.parse(message("req-1", """{"action":"revealWorkspaceRange","workspaceRelativePath":"src/main.kt","range":{"start":{"line":1.5,"character":0},"end":{"line":1,"character":1}}}""")))
        assertNull(ControlledIdeActions.parse(message("req-1", """{"action":"revealWorkspaceRange","workspaceRelativePath":"src/main.kt","range":{"start":{"line":1000001,"character":0},"end":{"line":1000001,"character":1}}}""")))
        assertNull(ControlledIdeActions.parse(message("req-1", """{"action":"getContextSnapshot","cloudRequired":true}""")))
        assertNull(ControlledIdeActions.parse(message("req-1", """{"action":"openWorkspaceFile","workspaceRelativePath":"src/main.kt","extra":true}""")))
    }

    @Test
    fun progressAndResultJsonIsSanitizedAndExactForWrapper() {
        val progress = JsonParser.parseString(
            ControlledIdeActions.ideActionProgress(
                requestId = "req-1",
                phase = "checkingPolicy",
                status = ControlledIdeActions.ProgressStatus.InProgress,
                summary = "Checking IDE action policy.",
                action = "openWorkspaceFile",
                workspaceRelativePath = "src/main.kt",
            ),
        ).asJsonObject

        assertEquals(ProductIdentity.bridgeVersion, progress.get("version").asString)
        assertEquals("host.ideActionProgress", progress.get("type").asString)
        assertEquals("req-1", progress.get("requestId").asString)
        val progressPayload = progress.getAsJsonObject("payload")
        assertEquals(setOf("phase", "status", "summary", "cloudRequired", "action", "workspaceRelativePath"), progressPayload.keySet())
        assertEquals("checkingPolicy", progressPayload.get("phase").asString)
        assertEquals("inProgress", progressPayload.get("status").asString)
        assertFalse(progressPayload.get("cloudRequired").asBoolean)

        val result = JsonParser.parseString(
            ControlledIdeActions.ideActionResult(
                requestId = "req-2",
                status = ControlledIdeActions.ResultStatus.Succeeded,
                message = "Workspace file opened.",
                action = "openWorkspaceFile",
                workspaceRelativePath = "src/main.kt",
            ),
        ).asJsonObject
        val resultPayload = result.getAsJsonObject("payload")
        assertEquals(setOf("status", "message", "cloudRequired", "action", "workspaceRelativePath"), resultPayload.keySet())
        assertEquals("host.ideActionResult", result.get("type").asString)
        assertEquals("succeeded", resultPayload.get("status").asString)
        assertEquals("Workspace file opened.", resultPayload.get("message").asString)
        assertFalse(resultPayload.get("cloudRequired").asBoolean)

        val sanitized = JsonParser.parseString(
            ControlledIdeActions.ideActionResult("bad token", ControlledIdeActions.ResultStatus.Failed, "secret token /Users/me/file content", "readWorkspaceFile", "secret/token.txt"),
        ).asJsonObject
        assertEquals("jetbrains-request", sanitized.get("requestId").asString)
        val sanitizedPayload = sanitized.getAsJsonObject("payload")
        assertEquals("IDE action status changed.", sanitizedPayload.get("message").asString)
        assertFalse(sanitizedPayload.has("action"))
        assertFalse(sanitizedPayload.has("workspaceRelativePath"))
    }

    @Test
    fun contextResultMetadataUsesJetBrainsAndApplyEditResultUnsupported() {
        val result = JsonParser.parseString(
            ControlledIdeActions.ideActionResult("req-1", ControlledIdeActions.ResultStatus.Succeeded, "IDE context snapshot captured.", action = "getContextSnapshot"),
        ).asJsonObject
        val payload = result.getAsJsonObject("payload")
        val context = payload.getAsJsonObject("context")
        assertEquals("jetbrains", context.get("source").asString)
        assertEquals(false, context.get("hasActiveEditor").asBoolean)
        assertEquals(0, context.get("workspaceFolderCount").asInt)
        assertFalse(context.has("kind"))
        assertFalse(payload.has("workspaceRelativePath"))
        assertTrue("host.applyWorkspaceEditResult" !in result.toString())
        assertFalse(ControlledIdeActions.supportsApplyWorkspaceEditResult)
    }

    @Test
    fun validApplyWorkspaceEditRequestParseDefinesConfirmedBoundary() {
        val request = ControlledIdeActions.parseApplyWorkspaceEdit(applyMessage("req-apply-1", validApplyPayload()))

        assertNotNull(request)
        assertEquals("req-apply-1", request.requestId)
        assertEquals("Replace reviewed range.", request.summary)
        assertEquals(1, request.edits.size)
        val fileEdit = request.edits.single()
        assertEquals("src/main.kt", fileEdit.workspaceRelativePath)
        assertEquals(1, fileEdit.textReplacements.size)
        assertEquals(
            ControlledIdeActions.Range(ControlledIdeActions.Position(1, 2), ControlledIdeActions.Position(1, 6)),
            fileEdit.textReplacements.single().range,
        )
        assertEquals("updated", fileEdit.textReplacements.single().replacementText)
    }

    @Test
    fun rejectsApplyWorkspaceEditWithoutExplicitLocalUserConfirmationContract() {
        assertNull(ControlledIdeActions.parseApplyWorkspaceEdit(applyMessage("req-apply-1", validApplyPayload(requiresUserConfirmation = "false"))))
        assertNull(ControlledIdeActions.parseApplyWorkspaceEdit(applyMessage("req-apply-1", validApplyPayload(requiresUserConfirmation = "null"))))
        assertNull(ControlledIdeActions.parseApplyWorkspaceEdit(applyMessage("req-apply-1", validApplyPayload(cloudRequired = "true"))))
        assertNull(ControlledIdeActions.parseApplyWorkspaceEdit(applyMessage("req-apply-1", validApplyPayload(cloudRequired = "null"))))
        assertNull(ControlledIdeActions.parseApplyWorkspaceEdit(applyMessage("req-apply-1", validApplyPayload(summary = "secret token /Users/person/private.kt"))))
    }

    @Test
    fun rejectsApplyWorkspaceEditMalformedEnvelopeAndPrivilegedFields() {
        assertNull(ControlledIdeActions.parseApplyWorkspaceEdit("not-json"))
        assertNull(ControlledIdeActions.parseApplyWorkspaceEdit("[]"))
        assertNull(ControlledIdeActions.parseApplyWorkspaceEdit("""{"version":"old","type":"gui.applyWorkspaceEditRequest","requestId":"req-apply-1","payload":${validApplyPayload()}}"""))
        assertNull(ControlledIdeActions.parseApplyWorkspaceEdit("""{"version":"${ProductIdentity.bridgeVersion}","type":"gui.ideActionRequest","requestId":"req-apply-1","payload":${validApplyPayload()}}"""))
        assertNull(ControlledIdeActions.parseApplyWorkspaceEdit("""{"version":"${ProductIdentity.bridgeVersion}","type":"gui.applyWorkspaceEditRequest","payload":${validApplyPayload()}}"""))
        assertNull(ControlledIdeActions.parseApplyWorkspaceEdit(applyMessage("token-abc", validApplyPayload())))
        assertNull(ControlledIdeActions.parseApplyWorkspaceEdit(applyMessage("req-apply-1", validApplyPayload(), extra = """, "tool": "shell""")))
        assertNull(ControlledIdeActions.parseApplyWorkspaceEdit(applyMessage("req-apply-1", validApplyPayload(payloadExtra = """, "action": "runShellCommand"""))))
        assertNull(ControlledIdeActions.parseApplyWorkspaceEdit(applyMessage("req-apply-1", validApplyPayload(payloadExtra = """, "shell": "rm -rf ."""))))
        assertNull(ControlledIdeActions.parseApplyWorkspaceEdit(applyMessage("req-apply-1", validApplyPayload(payloadExtra = """, "git": {"commit": true}"""))))
        assertNull(ControlledIdeActions.parseApplyWorkspaceEdit(applyMessage("req-apply-1", validApplyPayload(fileExtra = """, "targetUri": "file:///Users/person/project/src/main.kt"""))))
        assertNull(ControlledIdeActions.parseApplyWorkspaceEdit(applyMessage("req-apply-1", validApplyPayload(replacementExtra = """, "command": "execute"""))))
    }

    @Test
    fun rejectsApplyWorkspaceEditUnsafePathsDuplicateFilesInvalidRangesAndOversize() {
        listOf(
            "",
            "/src/main.kt",
            "~/src/main.kt",
            "../src/main.kt",
            "src/../main.kt",
            "src//main.kt",
            "src\\main.kt",
            "C:/src/main.kt",
            "src/main.kt?raw=1",
            "src/main.kt#frag",
            "src/%2e%2e/main.kt",
            "src/token/main.kt",
            "src/api_key.txt",
            "src/sk-proj-12345678/main.kt",
            "a".repeat(513),
        ).forEach { path ->
            assertNull(ControlledIdeActions.parseApplyWorkspaceEdit(applyMessage("req-apply-1", validApplyPayload(path = path))), path)
        }

        val duplicateFiles = validApplyPayload(edits = """
            [
              ${fileEditJson("src/main.kt")},
              ${fileEditJson("src/main.kt")}
            ]
        """.trimIndent())
        assertNull(ControlledIdeActions.parseApplyWorkspaceEdit(applyMessage("req-apply-1", duplicateFiles)))
        assertNull(ControlledIdeActions.parseApplyWorkspaceEdit(applyMessage("req-apply-1", validApplyPayload(range = rangeJson(2, 0, 1, 0)))))
        assertNull(ControlledIdeActions.parseApplyWorkspaceEdit(applyMessage("req-apply-1", validApplyPayload(range = rangeJson(1, 5, 1, 4)))))
        assertNull(ControlledIdeActions.parseApplyWorkspaceEdit(applyMessage("req-apply-1", validApplyPayload(range = """{"start":{"line":1.5,"character":0},"end":{"line":1,"character":1}}"""))))
        assertNull(ControlledIdeActions.parseApplyWorkspaceEdit(applyMessage("req-apply-1", validApplyPayload(range = rangeJson(-1, 0, 1, 0)))))
        assertNull(ControlledIdeActions.parseApplyWorkspaceEdit(applyMessage("req-apply-1", validApplyPayload(range = rangeJson(1000001, 0, 1000001, 1)))))
        assertNull(ControlledIdeActions.parseApplyWorkspaceEdit(applyMessage("req-apply-1", validApplyPayload(replacementText = "a".repeat(8193)))))
        assertNull(ControlledIdeActions.parseApplyWorkspaceEdit(applyMessage("req-apply-1", validApplyPayload(replacementText = "bad\u0000text"))))
        assertNull(ControlledIdeActions.parseApplyWorkspaceEdit(applyMessage("req-apply-1", validApplyPayload(summary = "x".repeat(65000)))))
    }

    @Test
    fun applyWorkspaceEditResultIsSanitizedAndBounded() {
        val result = JsonParser.parseString(
            ControlledIdeActions.applyWorkspaceEditResult(
                requestId = "req-apply-result-1",
                status = ControlledIdeActions.ApplyWorkspaceEditStatus.Applied,
                message = "Edit request applied.",
                appliedEditCount = 999,
                affectedFiles = listOf("src/main.kt", "../secret.kt", "src/second.kt", "src/token/file.kt", "src/third.kt", "src/fourth.kt", "src/fifth.kt"),
            ),
        ).asJsonObject

        assertEquals("host.applyWorkspaceEditResult", result.get("type").asString)
        assertEquals("req-apply-result-1", result.get("requestId").asString)
        val payload = result.getAsJsonObject("payload")
        assertEquals(setOf("status", "message", "cloudRequired", "appliedEditCount", "affectedFiles"), payload.keySet())
        assertEquals("applied", payload.get("status").asString)
        assertEquals("Edit request applied.", payload.get("message").asString)
        assertEquals(64, payload.get("appliedEditCount").asInt)
        assertEquals(listOf("src/main.kt", "src/second.kt", "src/third.kt", "src/fourth.kt"), payload.getAsJsonArray("affectedFiles").map { it.asString })
        assertFalse(payload.get("cloudRequired").asBoolean)

        val sanitized = JsonParser.parseString(
            ControlledIdeActions.applyWorkspaceEditResult("bad token", ControlledIdeActions.ApplyWorkspaceEditStatus.Failed, "raw provider response sk-proj-12345678 /Users/person/file.kt", -1, listOf("/Users/person/file.kt", "secret/token.txt")),
        ).asJsonObject
        val sanitizedPayload = sanitized.getAsJsonObject("payload")
        assertEquals("jetbrains-request", sanitized.get("requestId").asString)
        assertEquals("Edit request status changed.", sanitizedPayload.get("message").asString)
        assertEquals(0, sanitizedPayload.get("appliedEditCount").asInt)
        assertFalse(sanitizedPayload.has("affectedFiles"))
        assertFalse(sanitized.toString().contains("sk-proj-12345678"))
        assertFalse(sanitized.toString().contains("/Users/person"))
    }

    @Test
    fun safeApplyWorkspaceEditRequestIdFromRawRequiresApplyEnvelopeOnly() {
        assertEquals("req-apply-1", ControlledIdeActions.safeApplyWorkspaceEditRequestIdFromRaw(applyMessage("req-apply-1", validApplyPayload(payloadExtra = """, "shell": true"""))))
        assertNull(ControlledIdeActions.safeApplyWorkspaceEditRequestIdFromRaw(message("req-apply-1", """{"action":"getContextSnapshot"}""")))
        assertNull(ControlledIdeActions.safeApplyWorkspaceEditRequestIdFromRaw(applyMessage("token-abc", validApplyPayload())))
        assertNull(ControlledIdeActions.safeApplyWorkspaceEditRequestIdFromRaw(applyMessage("req-apply-1", validApplyPayload(), extra = """, "extra": true""")))
    }

    private fun message(requestId: String, payload: String, extra: String = ""): String =
        """{"version":"${ProductIdentity.bridgeVersion}","type":"gui.ideActionRequest","requestId":"$requestId","payload":$payload$extra}"""

    private fun applyMessage(requestId: String, payload: String, extra: String = ""): String =
        """{"version":"${ProductIdentity.bridgeVersion}","type":"gui.applyWorkspaceEditRequest","requestId":"$requestId","payload":$payload$extra}"""

    private fun validApplyPayload(
        requiresUserConfirmation: String = "true",
        cloudRequired: String = "false",
        summary: String = "Replace reviewed range.",
        path: String = "src/main.kt",
        range: String = rangeJson(1, 2, 1, 6),
        replacementText: String = "updated",
        payloadExtra: String = "",
        fileExtra: String = "",
        replacementExtra: String = "",
        edits: String? = null,
    ): String = """
        {
          "requiresUserConfirmation": $requiresUserConfirmation,
          "summary": ${jsonString(summary)},
          "cloudRequired": $cloudRequired,
          "edits": ${edits ?: "[${fileEditJson(path, range, replacementText, fileExtra, replacementExtra)}]"}$payloadExtra
        }
    """.trimIndent()

    private fun fileEditJson(
        path: String,
        range: String = rangeJson(1, 2, 1, 6),
        replacementText: String = "updated",
        fileExtra: String = "",
        replacementExtra: String = "",
    ): String = """{"workspaceRelativePath":${jsonString(path)},"textReplacements":[{"range":$range,"replacementText":${jsonString(replacementText)}$replacementExtra}]$fileExtra}"""

    private fun rangeJson(startLine: Int, startCharacter: Int, endLine: Int, endCharacter: Int): String =
        """{"start":{"line":$startLine,"character":$startCharacter},"end":{"line":$endLine,"character":$endCharacter}}"""

    private fun jsonString(value: String): String = com.google.gson.JsonPrimitive(value).toString()
}
