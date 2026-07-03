package ai.yet.plugin.bridge

import com.google.gson.JsonParser
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class ControlledEditTest {
    @Test
    fun parsesValidControlledAgentEditRequest() {
        val request = assertNotNull(ControlledIdeActions.parseControlledAgentEdit(controlledEditMessage()))

        assertEquals("edit-s84-c4", request.requestId)
        assertEquals("gui", request.requestIdMintedBy)
        assertEquals("workspace-s84-c4", request.controlledWorkspaceId)
        assertEquals("run-s84-c4", request.runId)
        assertEquals("runtime-s84-c4", request.runtimeSessionId)
        assertEquals("ready-s84-c4", request.workspaceReadinessId)
        assertEquals(1, request.limits.maxFiles)
        assertEquals(1, request.limits.maxEdits)
        assertEquals(4096, request.limits.maxPatchBytes)
        val edit = request.edits.single()
        assertEquals("src/Main.kt", edit.workspaceRelativePath)
        assertEquals(18, edit.replacementByteCount)
        assertEquals("val title = \"Yet\"\n", edit.replacementText)
    }

    @Test
    fun rejectsUnsafeControlledAgentEditRequests() {
        assertNull(ControlledIdeActions.parseControlledAgentEdit(controlledEditMessage(extraPayload = """,\"shell\":true""")))
        assertNull(ControlledIdeActions.parseControlledAgentEdit(controlledEditMessage(requestId = "edit-s84-c4", payloadRequestId = "other-id")))
        assertNull(ControlledIdeActions.parseControlledAgentEdit(controlledEditMessage(assistantMinted = true)))
        assertNull(ControlledIdeActions.parseControlledAgentEdit(controlledEditMessage(userConfirmed = false)))
        assertNull(ControlledIdeActions.parseControlledAgentEdit(controlledEditMessage(path = "node_modules/pkg/file.txt")))
        assertNull(ControlledIdeActions.parseControlledAgentEdit(controlledEditMessage(path = "../outside.txt")))
        assertNull(ControlledIdeActions.parseControlledAgentEdit(controlledEditMessage(operation = "create")))
        assertNull(ControlledIdeActions.parseControlledAgentEdit(controlledEditMessage(expectedHash = "sha256:not-a-hash")))
        assertNull(ControlledIdeActions.parseControlledAgentEdit(controlledEditMessage(startLine = 9, endLine = 8)))
        assertNull(ControlledIdeActions.parseControlledAgentEdit(controlledEditMessage(replacementText = "val title = \"Yet\"\n", replacementByteCount = 1)))
        assertNull(ControlledIdeActions.parseControlledAgentEdit(controlledEditMessage(summary = "run shell command")))
        assertNull(ControlledIdeActions.parseControlledAgentEdit(controlledEditMessage(requestIdMintedBy = "host")))
        assertNull(ControlledIdeActions.parseControlledAgentEdit(controlledEditMessage(source = "host")))
    }

    @Test
    fun safeRequestIdDoesNotCorrelateOversizedOrUnsafeEnvelope() {
        val oversized = """{"version":"2026-05-15","type":"gui.controlledAgentEditRequest","requestId":"edit-oversized","payload":{"padding":"${"x".repeat(66000)}"}}"""

        assertNull(ControlledIdeActions.safeControlledAgentEditRequestIdFromRaw(oversized))
        assertNull(ControlledIdeActions.safeControlledAgentEditRequestIdFromRaw(controlledEditMessage(requestId = "token-abc")))
        assertEquals("edit-s84-c4", ControlledIdeActions.safeControlledAgentEditRequestIdFromRaw(controlledEditMessage(operation = "create")))
    }

    @Test
    fun unsupportedResultIsFailClosedAndSanitized() {
        val request = assertNotNull(ControlledIdeActions.parseControlledAgentEdit(controlledEditMessage()))
        val resultText = ControlledIdeActions.controlledAgentEditUnsupportedResult(request)
        val message = JsonParser.parseString(resultText).asJsonObject
        val payload = message.getAsJsonObject("payload")
        val flags = payload.getAsJsonObject("policyFlags")
        val result = payload.getAsJsonObject("result")
        val edit = payload.getAsJsonArray("edits").single().asJsonObject

        assertEquals("host.controlledAgentEditResult", message.get("type").asString)
        assertEquals("blocked", payload.get("state").asString)
        assertEquals(false, flags.get("boundedReplacementEditAllowed").asBoolean)
        assertEquals(false, flags.get("shellAllowed").asBoolean)
        assertEquals(false, flags.get("gitAllowed").asBoolean)
        assertEquals(false, flags.get("providerAllowed").asBoolean)
        assertEquals(false, flags.get("toolAllowed").asBoolean)
        assertEquals(false, flags.get("networkAllowed").asBoolean)
        assertEquals(false, flags.get("autoApplyAllowed").asBoolean)
        assertEquals("edit_disabled", result.get("blockedReason").asString)
        assertEquals(false, result.get("rawBodyIncluded").asBoolean)
        assertEquals(false, result.get("rawDiffIncluded").asBoolean)
        assertEquals(false, result.get("privatePathExposed").asBoolean)
        assertEquals("src/Main.kt", edit.get("workspaceRelativePath").asString)
        assertFalse(resultText.contains("val title"))
        assertFalse(resultText.contains("/Users/"))
        assertFalse(resultText.contains("sk-proj"))
    }
}

private fun controlledEditMessage(
    requestId: String = "edit-s84-c4",
    payloadRequestId: String = requestId,
    operation: String = "replace",
    assistantMinted: Boolean = false,
    requestIdMintedBy: String = "gui",
    source: String = "gui",
    userConfirmed: Boolean = true,
    path: String = "src/Main.kt",
    expectedHash: String = "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    startLine: Int = 3,
    endLine: Int = 4,
    replacementText: String = "val title = \"Yet\"\n",
    replacementByteCount: Int = replacementText.toByteArray(Charsets.UTF_8).size,
    summary: String = "Update selected UI metadata lines.",
    extraPayload: String = "",
): String = """
    {
      "version":"2026-05-15",
      "type":"gui.controlledAgentEditRequest",
      "requestId":"$requestId",
      "payload":{
        "requestId":"$payloadRequestId",
        "requestIdMintedBy":"$requestIdMintedBy",
        "source":"$source",
        "assistantMinted":$assistantMinted,
        "controlledWorkspaceId":"workspace-s84-c4",
        "runId":"run-s84-c4",
        "runtimeSessionId":"runtime-s84-c4",
        "workspaceReadinessId":"ready-s84-c4",
        "userConfirmed":$userConfirmed,
        "limits":{"maxFiles":1,"maxEdits":1,"maxPatchBytes":4096},
        "edits":[{
          "operation":"$operation",
          "workspaceRelativePath":"$path",
          "fileLabel":"$path",
          "expectedContentHash":"$expectedHash",
          "startLine":$startLine,
          "endLine":$endLine,
          "replacementText":${com.google.gson.JsonPrimitive(replacementText)},
          "replacementByteCount":$replacementByteCount,
          "sanitizedSummary":"$summary"
        }]
        $extraPayload
      }
    }
""".trimIndent()
