package ai.yet.plugin.ui

import ai.yet.plugin.runtime.RuntimeSettings
import com.sun.net.httpserver.HttpServer
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.URI
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
    fun failsClosedForUnknownInvalidPanelOrNonV1Path() {
        val panels = mapOf("panel-1" to PackagedGuiPanelRuntime("http://127.0.0.1:8765", "safe-test-token"))

        assertEquals(PackagedGuiProxyDecision.Reject, packagedGuiProxyDecision("missing", "/v1/ping", panels))
        assertEquals(PackagedGuiProxyDecision.Reject, packagedGuiProxyDecision("../panel-1", "/v1/ping", panels))
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
    fun registeredPanelProxyForwardsToRuntimeAndInjectsAuthorization() = withRuntimeServer { runtime ->
        withPackagedServer(mapOf("panel-1" to PackagedGuiPanelRuntime(runtime.origin, "safe-test-token"))) { proxy ->
            val response = request("${proxy.origin}/panel/panel-1/v1/ping?hello=world")

            assertEquals(200, response.status)
            assertEquals("runtime-ok", response.body)
            assertEquals("/v1/ping?hello=world", runtime.requests.single().target)
            assertEquals("Bearer safe-test-token", runtime.requests.single().authorization)
        }
    }

    @Test
    fun unknownPanelAndNonLoopbackRuntimeFailClosed() = withRuntimeServer { runtime ->
        withPackagedServer(
            mapOf(
                "panel-1" to PackagedGuiPanelRuntime(runtime.origin, "safe-test-token"),
                "bad-panel" to PackagedGuiPanelRuntime("https://example.test:8765", "safe-test-token"),
            ),
        ) { proxy ->
            assertEquals(404, request("${proxy.origin}/panel/missing/v1/ping").status)
            assertEquals(404, request("${proxy.origin}/panel/bad-panel/v1/ping").status)
            assertEquals(emptyList(), runtime.requests)
        }
    }

    @Test
    fun tokenUpdatesForExistingPanelAffectNextProxyRequest() = withRuntimeServer { runtime ->
        val panels = mutableMapOf("panel-1" to PackagedGuiPanelRuntime(runtime.origin, "old-token"))
        withPackagedServer(panels) { proxy ->
            assertEquals(200, request("${proxy.origin}/panel/panel-1/v1/ping").status)
            panels["panel-1"] = PackagedGuiPanelRuntime(runtime.origin, "fresh-token")
            assertEquals(200, request("${proxy.origin}/panel/panel-1/v1/ping").status)

            assertEquals(listOf("Bearer old-token", "Bearer fresh-token"), runtime.requests.map { it.authorization })
        }
    }

    @Test
    fun twoPanelsKeepSeparateRuntimeAndTokenState() = withRuntimeServer { first ->
        withRuntimeServer { second ->
            withPackagedServer(
                mapOf(
                    "panel-1" to PackagedGuiPanelRuntime(first.origin, "first-token"),
                    "panel-2" to PackagedGuiPanelRuntime(second.origin, "second-token"),
                ),
            ) { proxy ->
                assertEquals(200, request("${proxy.origin}/panel/panel-1/v1/ping").status)
                assertEquals(200, request("${proxy.origin}/panel/panel-2/v1/ping").status)

                assertEquals(listOf("Bearer first-token"), first.requests.map { it.authorization })
                assertEquals(listOf("Bearer second-token"), second.requests.map { it.authorization })
            }
        }
    }

    @Test
    fun panelRegistryGeneratesScopedProxyBaseAndUnregisters() {
        val server = PackagedGuiServer()
        val panel = server.registerPanel(RuntimeSettings("http://127.0.0.1:8765", null, "safe-test-token"))

        assertTrue(isValidPanelId(panel.id))
        assertEquals("/panel/${panel.id}", panel.proxyBaseUrl)
        assertTrue(packagedGuiProxyDecision(panel.id, "/v1/ping", mapOf(panel.id to PackagedGuiPanelRuntime("http://127.0.0.1:8765", "safe-test-token"))) is PackagedGuiProxyDecision.Forward)
        server.unregisterPanel(panel.id)
        server.dispose()
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

private data class Response(val status: Int, val body: String)
private data class RuntimeRequest(val target: String, val authorization: String?)

private class TestServer(private val server: HttpServer) {
    val origin = "http://127.0.0.1:${server.address.port}"
    fun stop() = server.stop(0)
}

private class RuntimeTestServer(private val server: HttpServer, val requests: MutableList<RuntimeRequest>) {
    val origin = "http://127.0.0.1:${server.address.port}"
    fun stop() = server.stop(0)
}

private fun withRuntimeServer(block: (RuntimeTestServer) -> Unit) {
    val requests = mutableListOf<RuntimeRequest>()
    val server = HttpServer.create(InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0), 0)
    server.createContext("/") { exchange ->
        requests.add(RuntimeRequest(exchange.requestURI.rawPath + exchange.requestURI.rawQuery?.let { "?$it" }.orEmpty(), exchange.requestHeaders.getFirst("Authorization")))
        val body = "runtime-ok".toByteArray()
        exchange.sendResponseHeaders(200, body.size.toLong())
        exchange.responseBody.use { it.write(body) }
        exchange.close()
    }
    server.start()
    try {
        block(RuntimeTestServer(server, requests))
    } finally {
        server.stop(0)
    }
}

private fun withPackagedServer(panels: Map<String, PackagedGuiPanelRuntime>, block: (TestServer) -> Unit) {
    val server = HttpServer.create(InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0), 0)
    server.createContext("/") { exchange -> handle(exchange, { null }, { panels.toMap() }) }
    server.start()
    try {
        block(TestServer(server))
    } finally {
        server.stop(0)
    }
}

private fun request(url: String): Response {
    val connection = URI(url).toURL().openConnection() as HttpURLConnection
    connection.requestMethod = "GET"
    connection.connectTimeout = 2000
    connection.readTimeout = 2000
    val status = connection.responseCode
    val stream = if (status >= 400) connection.errorStream else connection.inputStream
    val body = stream?.use { String(it.readBytes()) }.orEmpty()
    connection.disconnect()
    return Response(status, body)
}
