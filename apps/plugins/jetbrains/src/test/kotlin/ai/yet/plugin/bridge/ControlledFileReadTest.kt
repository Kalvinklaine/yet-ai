package ai.yet.plugin.bridge

import ai.yet.plugin.identity.ProductIdentity
import ai.yet.plugin.ui.JetBrainsControlledFileReadBridge
import com.google.gson.JsonParser
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ControlledFileReadTest {
    @Test
    fun parsesExplicitSafeRequest() {
        val request = assertNotNull(ControlledFileRead.parse(validRequest()))

        assertEquals("gui-s83-read-request", request.requestId)
        assertEquals("workspace-s83-request", request.controlledWorkspaceId)
        assertEquals("docs/architecture/013-agent-readiness-milestone.md", request.workspaceRelativePath)
        assertEquals(2048, request.maxBytes)
        assertEquals(80, request.maxLines)
        assertEquals(true, request.allowBody)
    }

    @Test
    fun rejectsUnsafeReadRequests() {
        assertNull(ControlledFileRead.parse(validRequest(path = "../README.md")))
        assertNull(ControlledFileRead.parse(validRequest(path = "node_modules/pkg/index.js")))
        assertNull(ControlledFileRead.parse(validRequest(path = "docs/.hidden.md")))
        assertNull(ControlledFileRead.parse(validRequest(requestId = "provider_key")))
        assertNull(ControlledFileRead.parse(validRequest(extra = ""","command":"cat""")))
        assertNull(ControlledFileRead.parse(validRequest(maxBytes = 8193)))
        assertNull(ControlledFileRead.parse(validRequest(recursive = true)))
    }

    @Test
    fun unsupportedResultIsFailClosedAndSanitized() {
        val request = assertNotNull(ControlledFileRead.parse(validRequest()))
        val message = JsonParser.parseString(ControlledFileRead.unsupportedResult(request)).asJsonObject
        val payload = message.getAsJsonObject("payload")
        val workspace = payload.getAsJsonObject("workspace")
        val readRequest = payload.getAsJsonObject("request")
        val budget = readRequest.getAsJsonObject("budget")
        val policy = payload.getAsJsonObject("policyFlags")
        val result = payload.getAsJsonObject("result")

        assertEquals(ProductIdentity.bridgeVersion, message.get("version").asString)
        assertEquals("host.controlledAgentFileReadResult", message.get("type").asString)
        assertEquals("gui-s83-read-request", message.get("requestId").asString)
        assertEquals("controlled_agent_file_read", payload.get("kind").asString)
        assertEquals("jetbrains", workspace.get("host").asString)
        assertEquals(false, workspace.get("privatePathExposed").asBoolean)
        assertEquals("docs/architecture/013-agent-readiness-milestone.md", readRequest.get("workspaceRelativePath").asString)
        assertEquals(false, budget.get("allowBody").asBoolean)
        assertEquals(false, policy.get("fileReadAllowed").asBoolean)
        assertEquals(false, policy.get("shellAllowed").asBoolean)
        assertEquals(false, policy.get("gitAllowed").asBoolean)
        assertEquals(false, policy.get("providerAllowed").asBoolean)
        assertEquals("disabled", result.get("status").asString)
        assertEquals("read_disabled", result.get("blockedReason").asString)
        assertEquals(false, result.get("bodyIncluded").asBoolean)
        assertFalse(result.has("text"))
        assertFalse(ControlledFileRead.unsupportedResult(request).contains("/Users/"))
    }

    @Test
    fun bridgeHandlesOnlyExplicitControlledReadAndReturnsUnsupported() {
        val sent = mutableListOf<String>()
        val handled = JetBrainsControlledFileReadBridge.handleControlledFileReadRequest(validRequest(), sent::add)

        assertTrue(handled)
        assertEquals(1, sent.size)
        val result = JsonParser.parseString(sent.single()).asJsonObject.getAsJsonObject("payload").getAsJsonObject("result")
        assertEquals("disabled", result.get("status").asString)
        assertEquals(false, result.get("bodyIncluded").asBoolean)
        assertFalse(JetBrainsControlledFileReadBridge.handleControlledFileReadRequest("""{"version":"${ProductIdentity.bridgeVersion}","type":"gui.ready"}""", sent::add))
    }

    private fun validRequest(
        requestId: String = "gui-s83-read-request",
        path: String = "docs/architecture/013-agent-readiness-milestone.md",
        maxBytes: Int = 2048,
        recursive: Boolean = false,
        extra: String = "",
    ): String = """
        {
          "version": "${ProductIdentity.bridgeVersion}",
          "type": "gui.controlledAgentFileReadRequest",
          "requestId": "$requestId",
          "payload": {
            "requestIdMintedBy": "gui",
            "source": "gui",
            "assistantMinted": false,
            "controlledWorkspaceId": "workspace-s83-request",
            "runId": "run-s83-request",
            "runtimeSessionId": "runtime-s83-request",
            "sessionId": "session-s83-request",
            "workspaceRelativePath": "$path",
            "maxBytes": $maxBytes,
            "maxLines": 80,
            "allowBody": true,
            "singleFileOnly": true,
            "recursive": $recursive,
            "globAllowed": false,
            "regexAllowed": false,
            "indexingAllowed": false
            $extra
          }
        }
    """.trimIndent()
}
