package ai.yet.plugin.ui

import ai.yet.plugin.bridge.ControlledIdeActions
import com.google.gson.JsonParser
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ControlledEditBridgeTest {
    @Test
    fun controlledEditBridgeFailsClosedAsUnsupported() {
        val sent = mutableListOf<String>()
        val logs = mutableListOf<String>()
        val handled = JetBrainsControlledAgentEditBridge.handleControlledAgentEditRequest(
            controlledEditBridgeMessage(),
            send = { sent.add(it) },
            logStatus = { logs.add(it) },
        )

        assertTrue(handled)
        assertEquals(listOf("Yet AI disabled JetBrains controlled edit request"), logs)
        val message = JsonParser.parseString(sent.single()).asJsonObject
        assertEquals("host.controlledAgentEditResult", message.get("type").asString)
        assertEquals("edit-s84-c4", message.get("requestId").asString)
        val payload = message.getAsJsonObject("payload")
        val result = payload.getAsJsonObject("result")
        assertEquals("blocked", payload.get("state").asString)
        assertEquals("blocked", result.get("status").asString)
        assertEquals("edit_disabled", result.get("blockedReason").asString)
        assertEquals(false, payload.getAsJsonObject("policyFlags").get("boundedReplacementEditAllowed").asBoolean)
        assertEquals(0, result.get("appliedEditCount").asInt)
        assertFalse(sent.single().contains("val title"))
    }

    @Test
    fun controlledEditBridgeRejectsInvalidRequestWithoutMutationAuthority() {
        val sent = mutableListOf<String>()
        val handled = JetBrainsControlledAgentEditBridge.handleControlledAgentEditRequest(
            """{"version":"2026-05-15","type":"gui.controlledAgentEditRequest","requestId":"edit-invalid","payload":{"shell":true}}""",
            send = { sent.add(it) },
        )

        assertTrue(handled)
        val payload = JsonParser.parseString(sent.single()).asJsonObject.getAsJsonObject("payload")
        val result = payload.getAsJsonObject("result")
        assertEquals("blocked", result.get("status").asString)
        assertEquals("policy_denied", result.get("blockedReason").asString)
        assertEquals(false, payload.getAsJsonObject("policyFlags").get("shellAllowed").asBoolean)
        assertEquals(false, result.get("rawBodyIncluded").asBoolean)
        assertEquals(false, result.get("rawDiffIncluded").asBoolean)
    }

    @Test
    fun controlledEditBridgeIgnoresOversizedInvalidRequestIdCorrelation() {
        val sent = mutableListOf<String>()
        val raw = """{"version":"2026-05-15","type":"gui.controlledAgentEditRequest","requestId":"edit-oversized","payload":{"padding":"${"x".repeat(66000)}"}}"""
        val handled = JetBrainsControlledAgentEditBridge.handleControlledAgentEditRequest(raw, send = { sent.add(it) })

        assertFalse(handled)
        assertEquals(emptyList(), sent)
    }

    @Test
    fun controlledEditBridgeRejectsHostMintedRequestIdMetadata() {
        val sent = mutableListOf<String>()
        val handled = JetBrainsControlledAgentEditBridge.handleControlledAgentEditRequest(
            controlledEditBridgeMessage(requestIdMintedBy = "host"),
            send = { sent.add(it) },
        )

        assertTrue(handled)
        val payload = JsonParser.parseString(sent.single()).asJsonObject.getAsJsonObject("payload")
        val result = payload.getAsJsonObject("result")
        assertEquals("blocked", result.get("status").asString)
        assertEquals("policy_denied", result.get("blockedReason").asString)
        assertFalse(sent.single().contains("val title"))
    }

    @Test
    fun controlledEditBridgeRejectsHostSourceMetadata() {
        val sent = mutableListOf<String>()
        val handled = JetBrainsControlledAgentEditBridge.handleControlledAgentEditRequest(
            controlledEditBridgeMessage(source = "host"),
            send = { sent.add(it) },
        )

        assertTrue(handled)
        val payload = JsonParser.parseString(sent.single()).asJsonObject.getAsJsonObject("payload")
        val result = payload.getAsJsonObject("result")
        assertEquals("blocked", result.get("status").asString)
        assertEquals("policy_denied", result.get("blockedReason").asString)
        assertFalse(sent.single().contains("val title"))
    }

    @Test
    fun preReadyControlledEditReturnsTerminalBlockedResult() {
        val sent = mutableListOf<String>()
        val logs = mutableListOf<String>()
        val handled = handleControlledAgentEditWithReadiness(
            controlledEditBridgeMessage(),
            ready = false,
            send = { sent.add(it) },
            logStatus = { logs.add(it) },
        )

        assertTrue(handled)
        assertTrue(logs.contains("Yet AI disabled JetBrains controlled edit request"))
        assertTrue(logs.contains("Yet AI returned terminal controlled edit result before GUI bridge readiness"))
        val payload = JsonParser.parseString(sent.single()).asJsonObject.getAsJsonObject("payload")
        val result = payload.getAsJsonObject("result")
        assertEquals("blocked", result.get("status").asString)
        assertEquals("edit_disabled", result.get("blockedReason").asString)
        assertEquals(false, result.get("rawBodyIncluded").asBoolean)
        assertEquals(false, result.get("rawDiffIncluded").asBoolean)
        assertEquals(false, result.get("privatePathExposed").asBoolean)
        assertFalse(sent.single().contains("val title"))
    }

    @Test
    fun preReadyInvalidControlledEditReturnsTerminalRejectedResultForSafeRequestId() {
        val sent = mutableListOf<String>()
        val handled = handleControlledAgentEditWithReadiness(
            """{"version":"2026-05-15","type":"gui.controlledAgentEditRequest","requestId":"edit-invalid","payload":{"shell":true}}""",
            ready = false,
            send = { sent.add(it) },
        )

        assertTrue(handled)
        val message = JsonParser.parseString(sent.single()).asJsonObject
        assertEquals("edit-invalid", message.get("requestId").asString)
        val payload = message.getAsJsonObject("payload")
        val result = payload.getAsJsonObject("result")
        assertEquals("blocked", result.get("status").asString)
        assertEquals("policy_denied", result.get("blockedReason").asString)
        assertEquals(false, result.get("rawBodyIncluded").asBoolean)
        assertEquals(false, result.get("rawDiffIncluded").asBoolean)
        assertFalse(sent.single().contains("\"shell\":true"))
    }

    @Test
    fun controlledEditReadinessGateRequiresAcceptedHostReadyForCurrentFrame() {
        assertFalse(canHandleControlledAgentEdit(disposed = false, runtimePrepared = false, guiReadyRequestId = null, acceptedHostReadyRequestId = null))
        assertFalse(canHandleControlledAgentEdit(disposed = false, runtimePrepared = true, guiReadyRequestId = "ready-1", acceptedHostReadyRequestId = null))
        assertFalse(canHandleControlledAgentEdit(disposed = false, runtimePrepared = true, guiReadyRequestId = "ready-2", acceptedHostReadyRequestId = "ready-1"))
        assertFalse(canHandleControlledAgentEdit(disposed = true, runtimePrepared = true, guiReadyRequestId = "ready-1", acceptedHostReadyRequestId = "ready-1"))
        assertTrue(canHandleControlledAgentEdit(disposed = false, runtimePrepared = true, guiReadyRequestId = "ready-1", acceptedHostReadyRequestId = "ready-1"))
    }

    @Test
    fun wrapperMentionsControlledEditValidationAndResultDelivery() {
        val html = renderHtml(
            ai.yet.plugin.runtime.RuntimeConnectionResult(ai.yet.plugin.runtime.RuntimeSettings.safeFallback(), "ok", null),
            "return '';",
            null,
        )

        assertTrue(html.contains("const maxControlledAgentEditRequestBytes = 65536;"))
        assertTrue(html.contains("const isGuiControlledAgentEditRequest = (message) => {"))
        assertTrue(html.contains("message.type !== \"gui.controlledAgentEditRequest\""))
        assertTrue(html.contains("message.type === \"host.controlledAgentEditResult\""))
        assertTrue(html.contains("isControlledAgentEditResultPayload(message.payload)"))
        assertTrue(html.contains("payload.result.status === payload.state"))
        assertTrue(html.contains("payload.requestIdMintedBy !== \"gui\" || payload.source !== \"gui\""))
        assertTrue(html.contains("const isRecoverableGuiControlledAgentEditEnvelope = (message) => {"))
        assertTrue(html.contains("} else if (isRecoverableGuiControlledAgentEditEnvelope(event.data)) {"))
        assertTrue(html.contains("window.postIntellijMessage(event.data);"))
        assertTrue(html.contains("Yet AI rejected invalid controlled edit request after GUI bridge readiness"))
    }
}

private fun controlledEditBridgeMessage(
    requestIdMintedBy: String = "gui",
    source: String = "gui",
): String = """
    {
      "version":"2026-05-15",
      "type":"gui.controlledAgentEditRequest",
      "requestId":"edit-s84-c4",
      "payload":{
        "requestId":"edit-s84-c4",
        "requestIdMintedBy":"$requestIdMintedBy",
        "source":"$source",
        "assistantMinted":false,
        "controlledWorkspaceId":"workspace-s84-c4",
        "runId":"run-s84-c4",
        "runtimeSessionId":"runtime-s84-c4",
        "workspaceReadinessId":"ready-s84-c4",
        "userConfirmed":true,
        "limits":{"maxFiles":1,"maxEdits":1,"maxPatchBytes":4096},
        "edits":[{
          "operation":"replace",
          "workspaceRelativePath":"src/Main.kt",
          "fileLabel":"src/Main.kt",
          "expectedContentHash":"sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          "startLine":3,
          "endLine":4,
          "replacementText":"val title = \"Yet\"\n",
          "replacementByteCount":18,
          "sanitizedSummary":"Update selected UI metadata lines."
        }]
      }
    }
""".trimIndent()
