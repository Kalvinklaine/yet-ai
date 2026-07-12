package ai.yet.plugin.ui

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PackagedGuiServerTest {
    @Test
    fun mapsSafePathsToPackagedResources() {
        assertEquals("/yet-ai-gui/index.html", resourcePath("/"))
        assertEquals("/yet-ai-gui/index.html", resourcePath("/index.html"))
        assertEquals("/yet-ai-gui/assets/index.js", resourcePath("/assets/index.js"))
        assertEquals("/yet-ai-gui/assets/app.css", resourcePath("/assets/app.css"))
        assertEquals("/yet-ai-gui/assets/app+chunk.js", resourcePath("/assets/app+chunk.js"))
        assertEquals("/yet-ai-gui/assets/app+chunk.js", resourcePath("/assets/app%2Bchunk.js"))
    }

    @Test
    fun rejectsTraversalAndUnexpectedPaths() {
        assertNull(resourcePath("/assets/../index.html"))
        assertNull(resourcePath("/assets/%2e%2e/index.html"))
        assertNull(resourcePath("/assets/%252e%252e/index.html"))
        assertNull(resourcePath("/assets/%5c..%5cindex.html"))
        assertNull(resourcePath("/assets/..%2findex.html"))
        assertNull(resourcePath("/assets/%E0%A4%A"))
        assertNull(resourcePath("/assets\\index.js"))
        assertNull(resourcePath("/favicon.ico"))
        assertNull(resourcePath("/assets/"))
    }

    @Test
    fun forwardsPanelScopedV1RequestsWithServerSideAuthorization() {
        val decision = packagedGuiProxyDecision(
            "panel-1",
            "/v1/ping",
            mapOf("panel-1" to PackagedGuiPanelRuntime("http://127.0.0.1:8765", "safe-test-token")),
        )

        assertTrue(decision is PackagedGuiProxyDecision.Forward)
        assertEquals("http://127.0.0.1:8765/v1/ping", decision.request.targetUrl)
        assertEquals("Bearer safe-test-token", decision.request.headers["Authorization"])
    }

    @Test
    fun forwardsWithoutAuthorizationWhenRuntimeTokenIsAbsent() {
        val decision = packagedGuiProxyDecision(
            "panel-1",
            "/v1/models",
            mapOf("panel-1" to PackagedGuiPanelRuntime("http://localhost:8765", null)),
        )

        assertTrue(decision is PackagedGuiProxyDecision.Forward)
        assertEquals("http://localhost:8765/v1/models", decision.request.targetUrl)
        assertEquals(emptyMap(), decision.request.headers)
    }

    @Test
    fun failsClosedForUnknownPanelOrNonV1Path() {
        val panels = mapOf("panel-1" to PackagedGuiPanelRuntime("http://127.0.0.1:8765", "safe-test-token"))

        assertEquals(PackagedGuiProxyDecision.Reject, packagedGuiProxyDecision("missing", "/v1/ping", panels))
        assertEquals(PackagedGuiProxyDecision.Reject, packagedGuiProxyDecision("panel-1", "/assets/index.js", panels))
    }

    @Test
    fun rejectsNonLoopbackRuntimeTargets() {
        for (runtimeUrl in listOf(
            "https://example.test:8765",
            "http://192.168.0.2:8765",
            "http://127.0.0.1:8765/runtime",
            "http://user:pass@127.0.0.1:8765",
            "http://127.0.0.1:8765?token=value",
        )) {
            assertEquals(
                PackagedGuiProxyDecision.Reject,
                packagedGuiProxyDecision("panel-1", "/v1/ping", mapOf("panel-1" to PackagedGuiPanelRuntime(runtimeUrl, "safe-test-token"))),
            )
        }
    }

    @Test
    fun returnsExpectedMimeTypes() {
        assertEquals("text/html; charset=utf-8", mimeType("/yet-ai-gui/index.html"))
        assertEquals("application/javascript; charset=utf-8", mimeType("/yet-ai-gui/assets/index.js"))
        assertEquals("text/css; charset=utf-8", mimeType("/yet-ai-gui/assets/index.css"))
        assertEquals("image/svg+xml", mimeType("/yet-ai-gui/assets/icon.svg"))
        assertEquals("application/json; charset=utf-8", mimeType("/yet-ai-gui/assets/index.js.map"))
        assertEquals("application/octet-stream", mimeType("/yet-ai-gui/assets/font.woff2"))
    }
}
