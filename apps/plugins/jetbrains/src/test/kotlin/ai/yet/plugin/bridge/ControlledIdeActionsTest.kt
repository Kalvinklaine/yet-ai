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

    private fun message(requestId: String, payload: String, extra: String = ""): String =
        """{"version":"${ProductIdentity.bridgeVersion}","type":"gui.ideActionRequest","requestId":"$requestId","payload":$payload$extra}"""

    private fun jsonString(value: String): String = JsonParser.parseString("""{"value":"${value.replace("\\", "\\\\").replace("\n", "\\n").replace("\"", "\\\"")}"}""").asJsonObject.get("value").toString()
}
