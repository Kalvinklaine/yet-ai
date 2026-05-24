package ai.yet.plugin.bridge

import ai.yet.plugin.identity.ProductIdentity
import ai.yet.plugin.runtime.RuntimeSettings
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
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
}
