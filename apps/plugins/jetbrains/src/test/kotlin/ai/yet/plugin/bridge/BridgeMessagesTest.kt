package ai.yet.plugin.bridge

import ai.yet.plugin.identity.ProductIdentity
import ai.yet.plugin.runtime.RuntimeSettings
import com.google.gson.JsonParser
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class BridgeMessagesTest {
    @Test
    fun validGuiReadyPasses() {
        val parsed = BridgeMessages.parseGuiReady("""{"version":"${ProductIdentity.bridgeVersion}","type":"gui.ready","requestId":"abc","payload":{}}""")

        assertNotNull(parsed)
        assertEquals("abc", parsed.requestId)
    }

    @Test
    fun exactVersionRequired() {
        assertNull(BridgeMessages.parseGuiReady("""{"version":"other","type":"gui.ready"}"""))
    }

    @Test
    fun unknownTypeRejected() {
        assertNull(BridgeMessages.parseGuiReady("""{"version":"${ProductIdentity.bridgeVersion}","type":"host.ready"}"""))
    }

    @Test
    fun invalidJsonShapesRejected() {
        assertNull(BridgeMessages.parseGuiReady("not-json"))
        assertNull(BridgeMessages.parseGuiReady("[]"))
        assertNull(BridgeMessages.parseGuiReady("1"))
        assertNull(BridgeMessages.parseGuiReady("null"))
    }

    @Test
    fun invalidRequestIdsRejected() {
        assertNull(BridgeMessages.parseGuiReady("""{"version":"${ProductIdentity.bridgeVersion}","type":"gui.ready","requestId":""}"""))
        assertNull(BridgeMessages.parseGuiReady("""{"version":"${ProductIdentity.bridgeVersion}","type":"gui.ready","requestId":"line\nbreak"}"""))
        assertNull(BridgeMessages.parseGuiReady("""{"version":"${ProductIdentity.bridgeVersion}","type":"gui.ready","requestId":"${"a".repeat(129)}"}"""))
    }

    @Test
    fun payloadArrayRejected() {
        assertNull(BridgeMessages.parseGuiReady("""{"version":"${ProductIdentity.bridgeVersion}","type":"gui.ready","payload":[]}"""))
    }

    @Test
    fun hostReadyEchoesRequestId() {
        val message = BridgeMessages.hostReady(RuntimeSettings("http://127.0.0.1:8001", null, "secret"), "request-1")

        assertContains(message, "\"requestId\":\"request-1\"")
        assertContains(message, "\"sessionToken\":\"secret\"")
    }

    @Test
    fun contextSnapshotSerializesStrictHostMessage() {
        val snapshot = ActiveEditorContext.snapshot(
            workspaceRelativePath = "src/main/App.kt",
            displayPath = "src/main/App.kt",
            languageId = "kotlin",
            selectionStartLine = 1,
            selectionStartCharacter = 2,
            selectionEndLine = 3,
            selectionEndCharacter = 4,
            selectionText = "safe selection",
        )

        assertNotNull(snapshot)
        val message = JsonParser.parseString(BridgeMessages.contextSnapshot(snapshot, "request-2")).asJsonObject
        val payload = message.getAsJsonObject("payload")
        val file = payload.getAsJsonObject("file")
        val selection = payload.getAsJsonObject("selection")

        assertEquals(setOf("version", "type", "requestId", "payload"), message.keySet())
        assertEquals(ProductIdentity.bridgeVersion, message.get("version").asString)
        assertEquals("host.contextSnapshot", message.get("type").asString)
        assertEquals("request-2", message.get("requestId").asString)
        assertEquals(setOf("kind", "source", "file", "selection"), payload.keySet())
        assertEquals("active_editor", payload.get("kind").asString)
        assertEquals("jetbrains", payload.get("source").asString)
        assertEquals(setOf("displayPath", "workspaceRelativePath", "languageId"), file.keySet())
        assertEquals("src/main/App.kt", file.get("displayPath").asString)
        assertEquals("src/main/App.kt", file.get("workspaceRelativePath").asString)
        assertEquals("kotlin", file.get("languageId").asString)
        assertEquals(setOf("startLine", "startCharacter", "endLine", "endCharacter", "text"), selection.keySet())
        assertEquals(1, selection.get("startLine").asInt)
        assertEquals(2, selection.get("startCharacter").asInt)
        assertEquals(3, selection.get("endLine").asInt)
        assertEquals(4, selection.get("endCharacter").asInt)
        assertEquals("safe selection", selection.get("text").asString)
    }

    @Test
    fun contextSnapshotOmitsInvalidRequestId() {
        val snapshot = ActiveEditorContext.snapshot(languageId = "kotlin")

        assertNotNull(snapshot)
        val message = JsonParser.parseString(BridgeMessages.contextSnapshot(snapshot, "")).asJsonObject

        assertFalse(message.has("requestId"))
    }
}
