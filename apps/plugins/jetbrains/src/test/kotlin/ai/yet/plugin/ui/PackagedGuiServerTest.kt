package ai.yet.plugin.ui

import ai.yet.plugin.logging.YetProxyAuthDiagnosticsStore
import ai.yet.plugin.runtime.RuntimeSettings
import com.sun.net.httpserver.HttpServer
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.URI
import java.net.ServerSocket
import java.util.concurrent.ExecutorService
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PackagedGuiServerTest {
    @Test
    fun partialStartupFailureStopsServersAndExecutorWithoutPublishingRunningState() {
        lateinit var guiServer: HttpServer
        lateinit var wrapperServer: HttpServer
        lateinit var executor: ExecutorService
        var startupAttempts = 0
        val service = PackagedGuiServer { createdGuiServer, createdWrapperServer, createdExecutor ->
            guiServer = createdGuiServer
            wrapperServer = createdWrapperServer
            executor = createdExecutor
            startupAttempts += 1
            if (startupAttempts == 1) error("simulated partial startup failure")
        }

        assertFailsWith<IllegalStateException> { service.start() }

        assertTrue(executor.isShutdown)
        assertFalse(isReachable(guiServer))
        assertFalse(isReachable(wrapperServer))

        val gui = service.start() ?: error("packaged GUI test resource unavailable")
        try {
            assertEquals(2, startupAttempts)
            assertTrue(URI(gui.origin).authority != URI(gui.wrapperOrigin).authority)
        } finally {
            service.dispose()
        }
    }

    @Test
    fun successfulStartupReturnsDistinctBoundOrigins() {
        val service = PackagedGuiServer()
        val gui = service.start() ?: error("packaged GUI test resource unavailable")
        try {
            assertTrue(URI(gui.origin).authority != URI(gui.wrapperOrigin).authority)
            assertEquals(200, request(gui.indexUrl).status)
        } finally {
            service.dispose()
        }
    }

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
    fun panelScopedIndexInjectsInitialProxyRuntimeConfigWithoutToken() {
        val html = injectPanelBootstrap("<html><head><title>Yet</title></head><body><div id=\"root\"></div></body></html>", "panel-1")

        assertTrue(html.contains("window.__yetAiInitialRuntimeConfig"))
        assertTrue(html.contains("runtimeAccess:\"same_origin_proxy\""))
        assertTrue(html.contains("runtimeBaseUrl:\"/panel/panel-1\""))
        assertTrue(html.contains("runtimeProxyBaseUrl:\"/panel/panel-1\""))
        assertTrue(html.indexOf("window.__yetAiInitialRuntimeConfig") < html.indexOf("<title>Yet</title>"))
        assertTrue(!html.contains("sessionToken"))
        assertTrue(!html.contains("Authorization"))
        assertTrue(!html.contains("entryMode"))
    }

    @Test
    fun hostedChatIndexInjectsStrictEntryMode() {
        val html = injectPanelBootstrap("<html><head></head><body></body></html>", "panel-1", hostedChatEntry = true)

        assertTrue(html.contains("entryMode:\"hosted_chat\""))
        assertTrue(html.contains("runtimeAccess:\"same_origin_proxy\""))
    }

    @Test
    fun packagedGuiPanelUrlUsesPanelScopedIndex() {
        val gui = PackagedGui("http://127.0.0.1:49221/index.html", "http://127.0.0.1:49221", "http://127.0.0.1:49222")
        val panel = PackagedGuiPanel("panel-1", "/panel/panel-1")
        val panelGui = gui.forPanel(panel)

        assertEquals("http://127.0.0.1:49221/panel/panel-1/hosted-chat", panelGui.indexUrl)
        assertEquals("http://127.0.0.1:49222/panel/panel-1/wrapper.html", panelGui.wrapperUrl(panel))
        assertEquals(gui.origin, panelGui.origin)
        assertTrue(URI(panelGui.wrapperUrl(panel)).authority != URI(panelGui.indexUrl).authority)
    }

    @Test
    fun serverInjectsHostedChatEntryModeOnlyOnHostedChatRoute() {
        val server = PackagedGuiServer()
        val gui = server.start() ?: error("packaged GUI test resource unavailable")
        try {
            val panel = server.registerPanel(RuntimeSettings("http://127.0.0.1:8765", null, null))

            val hosted = request(gui.forPanel(panel).indexUrl)
            val ordinary = request("${gui.origin}${panel.proxyBaseUrl}/index.html")

            assertEquals(200, hosted.status)
            assertEquals(200, ordinary.status)
            assertTrue(hosted.body.contains("entryMode:\"hosted_chat\""))
            assertFalse(ordinary.body.contains("entryMode"))
        } finally {
            server.dispose()
        }
    }

    @Test
    fun hostedPanelIndexRelativeAssetsResolveThroughProductionHandler() {
        val panels = mapOf("panel-1" to PackagedGuiPanelRuntime("http://127.0.0.1:8765", null))
        val indexHtml = """
            <!doctype html>
            <html><head>
            <link rel="stylesheet" href="./assets/index-Css9f3a1.css">
            <script type="module" src="./assets/index-Js8d4e2b.js"></script>
            </head><body><div id="root"></div></body></html>
        """.trimIndent()
        val resources = mapOf(
            "/yet-ai-gui/index.html" to indexHtml.toByteArray(),
            "/yet-ai-gui/assets/index-Js8d4e2b.js" to "built-javascript".toByteArray(),
            "/yet-ai-gui/assets/index-Css9f3a1.css" to "built-css".toByteArray(),
        )
        withPackagedServer(panels, resources = resources) { proxy ->
            val hostedUrl = "${proxy.origin}/panel/panel-1/hosted-chat"
            val hosted = request(hostedUrl)
            val relativeAssets = Regex("""(?:src|href)="(\./assets/[^"]+)"""")
                .findAll(hosted.body)
                .map { match -> match.groupValues[1] }
                .toList()

            assertEquals(200, hosted.status)
            assertEquals(listOf("./assets/index-Css9f3a1.css", "./assets/index-Js8d4e2b.js"), relativeAssets)

            val resolvedAssets = relativeAssets.associateWith { relativePath ->
                val resolvedUrl = URI(hostedUrl).resolve(relativePath).toString()
                assertEquals("/panel/panel-1/${relativePath.removePrefix("./")}", URI(resolvedUrl).path)
                request(resolvedUrl)
            }
            val javascript = resolvedAssets.getValue("./assets/index-Js8d4e2b.js")
            val css = resolvedAssets.getValue("./assets/index-Css9f3a1.css")

            assertEquals(200, javascript.status)
            assertEquals("built-javascript", javascript.body)
            assertEquals("application/javascript; charset=utf-8", javascript.contentType)
            assertEquals("no-store", javascript.cacheControl)
            assertEquals(200, css.status)
            assertEquals("built-css", css.body)
            assertEquals("text/css; charset=utf-8", css.contentType)
            assertEquals("no-store", css.cacheControl)
        }
    }

    @Test
    fun registeredPanelAssetPreservesGetOnlyStaticMethodSemantics() {
        val panels = mapOf("panel-1" to PackagedGuiPanelRuntime("http://127.0.0.1:8765", null))
        val resources = mapOf("/yet-ai-gui/assets/index.js" to "built-javascript".toByteArray())
        withPackagedServer(panels, resources = resources) { proxy ->
            val response = request("${proxy.origin}/panel/panel-1/assets/index.js", "HEAD")

            assertEquals(405, response.status)
            assertEquals("", response.body)
            assertEquals("text/plain; charset=utf-8", response.contentType)
            assertEquals("no-store", response.cacheControl)
        }
    }

    @Test
    fun panelAssetsRequireRegistrationAndRejectUnsafePathsAndMethods() {
        val panels = mapOf("panel-1" to PackagedGuiPanelRuntime("http://127.0.0.1:8765", null))
        val resources = mapOf("/yet-ai-gui/assets/index.js" to "built-javascript".toByteArray())
        withPackagedServer(panels, resources = resources) { proxy ->
            assertEquals(404, request("${proxy.origin}/panel/missing/assets/index.js").status)
            assertEquals(405, request("${proxy.origin}/panel/panel-1/assets/index.js", "POST").status)
            for (path in listOf(
                "/panel/panel-1/assets/",
                "/panel/panel-1/assets//index.js",
                "/panel/panel-1/assets/%5cindex.js",
                "/panel/panel-1/assets/../index.js",
                "/panel/panel-1/assets/%2e%2e/index.js",
                "/panel/panel-1/assets/%252e%252e/index.js",
            )) {
                assertEquals(404, request(proxy.origin + path).status, path)
            }
        }
    }

    @Test
    fun rootAssetsKeepExistingStaticBehavior() {
        val resources = mapOf("/yet-ai-gui/assets/index.js" to "root-javascript".toByteArray())
        withPackagedServer(emptyMap(), resources = resources) { proxy ->
            val response = request("${proxy.origin}/assets/index.js")

            assertEquals(200, response.status)
            assertEquals("root-javascript", response.body)
            assertEquals("application/javascript; charset=utf-8", response.contentType)
            assertEquals("no-store", response.cacheControl)
        }
    }

    @Test
    fun registeredPanelWrapperIsServedOnlyForItsPanel() {
        val panels = mapOf("panel-1" to PackagedGuiPanelRuntime("http://127.0.0.1:8765", null))
        val wrappers = mapOf("panel-1" to "<html>panel-one-wrapper</html>")
        withPackagedServer(panels, wrappers) { proxy ->
            val response = request("${proxy.origin}/panel/panel-1/wrapper.html")

            assertEquals(200, response.status)
            assertEquals("<html>panel-one-wrapper</html>", response.body)
            assertEquals(404, request("${proxy.origin}/panel/missing/wrapper.html").status)
        }
    }

    @Test
    fun panelWrapperRejectsMethodsMalformedPathsAndTraversal() {
        val panels = mapOf("panel-1" to PackagedGuiPanelRuntime("http://127.0.0.1:8765", null))
        val wrappers = mapOf("panel-1" to "<html>safe-wrapper</html>")
        withPackagedServer(panels, wrappers) { proxy ->
            assertEquals(405, request("${proxy.origin}/panel/panel-1/wrapper.html", "POST").status)
            assertEquals(404, request("${proxy.origin}/panel/%2e%2e/wrapper.html").status)
            assertEquals(404, request("${proxy.origin}/panel/panel-1/%2e%2e/wrapper.html").status)
            assertEquals(404, request("${proxy.origin}/panel/panel-1/wrapper.html/extra").status)
        }
    }

    @Test
    fun stalePanelCannotReadRetainedWrapperSnapshot() {
        val panels = mutableMapOf("panel-1" to PackagedGuiPanelRuntime("http://127.0.0.1:8765", null))
        val wrappers = mutableMapOf("panel-1" to "<html>panel-one-wrapper</html>")
        withPackagedServer(panels, wrappers) { proxy ->
            assertEquals(200, request("${proxy.origin}/panel/panel-1/wrapper.html").status)
            panels.remove("panel-1")
            assertEquals(404, request("${proxy.origin}/panel/panel-1/wrapper.html").status)
        }
    }

    @Test
    fun unregisterPanelRemovesLiveWrapperRoute() {
        val server = PackagedGuiServer()
        val gui = server.start() ?: error("packaged GUI test resource unavailable")
        try {
            val panel = server.registerPanel(RuntimeSettings("http://127.0.0.1:8765", null, null))
            val wrapperUri = URI(gui.wrapperUrl(panel))
            val iframeUri = URI(gui.forPanel(panel).indexUrl)
            assertEquals(iframeUri.scheme, wrapperUri.scheme)
            assertEquals(iframeUri.host, wrapperUri.host)
            assertTrue(wrapperUri.port != iframeUri.port)
            assertTrue(server.registerWrapper(panel.id, "<html>live-panel-wrapper</html>"))
            assertEquals(200, request(gui.wrapperUrl(panel)).status)
            assertEquals(404, request("${gui.origin}/panel/${panel.id}/wrapper.html").status)

            server.unregisterPanel(panel.id)

            assertEquals(404, request(gui.wrapperUrl(panel)).status)
            assertTrue(!server.registerWrapper(panel.id, "<html>stale-wrapper</html>"))
        } finally {
            server.dispose()
        }
    }

    @Test
    fun wrapperRegistrationRequiresRunningServers() {
        val server = PackagedGuiServer()
        val panel = server.registerPanel(RuntimeSettings("http://127.0.0.1:8765", null, null))

        assertTrue(!server.registerWrapper(panel.id, "<html>unserved</html>"))
        server.dispose()
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
        YetProxyAuthDiagnosticsStore.directTokenBridge()
        withPackagedServer(mapOf("panel-1" to PackagedGuiPanelRuntime(runtime.origin, "safe-test-token"))) { proxy ->
            val response = request("${proxy.origin}/panel/panel-1/v1/ping?hello=world")

            assertEquals(200, response.status)
            assertEquals("runtime-ok", response.body)
            assertEquals("/v1/ping?hello=world", runtime.requests.single().target)
            assertEquals("Bearer safe-test-token", runtime.requests.single().authorization)
            val diagnostics = YetProxyAuthDiagnosticsStore.snapshot()
            assertEquals("same_origin_proxy", diagnostics.runtimePath)
            assertEquals("yes", diagnostics.sessionRegistered)
            assertEquals("present", diagnostics.authInjectedUpstream)
            assertEquals("panel-1", diagnostics.safeSessionId)
            assertEquals("200", diagnostics.upstreamStatus)
        }
    }

    @Test
    fun refusedRuntimeConnectionReturnsSanitizedBadGateway() {
        val unavailablePort = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1")).use { it.localPort }
        val runtimeUrl = "http://127.0.0.1:$unavailablePort"
        val sessionToken = "private-session-token"

        withPackagedServer(mapOf("panel-refused" to PackagedGuiPanelRuntime(runtimeUrl, sessionToken))) { proxy ->
            val response = request("${proxy.origin}/panel/panel-refused/v1/private-provider-path")

            assertEquals(502, response.status)
            assertEquals("{\"error\":\"runtime_proxy_unavailable\"}", response.body)
            assertProxyFailureDoesNotLeak(response.body, runtimeUrl, sessionToken, "private-provider-path", "Connection refused")
        }
    }

    @Test
    fun slowRuntimeResponseReturnsSanitizedGatewayTimeout() = withRuntimeServer(delayMillis = 500, body = "provider-secret-body") { runtime ->
        val sessionToken = "private-timeout-token"
        withPackagedServer(
            mapOf("panel-timeout" to PackagedGuiPanelRuntime(runtime.origin, sessionToken)),
            proxyTimeouts = PackagedGuiProxyTimeouts(connectMillis = 200, readMillis = 100),
        ) { proxy ->
            val response = request("${proxy.origin}/panel/panel-timeout/v1/slow-private-path")

            assertEquals(504, response.status)
            assertEquals("{\"error\":\"runtime_proxy_timeout\"}", response.body)
            assertProxyFailureDoesNotLeak(response.body, runtime.origin, sessionToken, "slow-private-path", "provider-secret-body", "timed out")
        }
    }

    @Test
    fun proxyDiagnosticsRecordAbsentAuthorizationAndUpstream401WithoutTokenValue() = withRuntimeServer(401) { runtime ->
        YetProxyAuthDiagnosticsStore.directTokenBridge()
        withPackagedServer(mapOf("panel-401" to PackagedGuiPanelRuntime(runtime.origin, null))) { proxy ->
            val response = request("${proxy.origin}/panel/panel-401/v1/ping")

            assertEquals(401, response.status)
            assertEquals(null, runtime.requests.single().authorization)
            val diagnostics = YetProxyAuthDiagnosticsStore.snapshot()
            assertEquals("same_origin_proxy", diagnostics.runtimePath)
            assertEquals("yes", diagnostics.sessionRegistered)
            assertEquals("absent", diagnostics.authInjectedUpstream)
            assertEquals("panel-401", diagnostics.safeSessionId)
            assertEquals("401", diagnostics.upstreamStatus)
            assertTrue(!diagnostics.toString().contains("safe-test-token"))
            assertTrue(!diagnostics.toString().contains("Bearer", ignoreCase = true))
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
        YetProxyAuthDiagnosticsStore.directTokenBridge()
        val server = PackagedGuiServer()
        val panel = server.registerPanel(RuntimeSettings("http://127.0.0.1:8765", null, "safe-test-token"))

        assertTrue(isValidPanelId(panel.id))
        assertEquals("/panel/${panel.id}", panel.proxyBaseUrl)
        assertEquals("same_origin_proxy", YetProxyAuthDiagnosticsStore.snapshot().runtimePath)
        assertEquals("yes", YetProxyAuthDiagnosticsStore.snapshot().sessionRegistered)
        assertTrue(packagedGuiProxyDecision(panel.id, "/v1/ping", mapOf(panel.id to PackagedGuiPanelRuntime("http://127.0.0.1:8765", "safe-test-token"))) is PackagedGuiProxyDecision.Forward)
        server.unregisterPanel(panel.id)
        assertEquals("no", YetProxyAuthDiagnosticsStore.snapshot().sessionRegistered)
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

private data class Response(val status: Int, val body: String, val contentType: String?, val cacheControl: String?)
private data class RuntimeRequest(val target: String, val authorization: String?)

private class TestServer(private val server: HttpServer) {
    val origin = "http://127.0.0.1:${server.address.port}"
    fun stop() = server.stop(0)
}

private class RuntimeTestServer(private val server: HttpServer, val requests: MutableList<RuntimeRequest>) {
    val origin = "http://127.0.0.1:${server.address.port}"
    fun stop() = server.stop(0)
}

private fun withRuntimeServer(status: Int = 200, delayMillis: Long = 0, body: String = "runtime-ok", block: (RuntimeTestServer) -> Unit) {
    val requests = mutableListOf<RuntimeRequest>()
    val server = HttpServer.create(InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0), 0)
    server.createContext("/") { exchange ->
        requests.add(RuntimeRequest(exchange.requestURI.rawPath + exchange.requestURI.rawQuery?.let { "?$it" }.orEmpty(), exchange.requestHeaders.getFirst("Authorization")))
        if (delayMillis > 0) Thread.sleep(delayMillis)
        val responseBody = body.toByteArray()
        exchange.sendResponseHeaders(status, responseBody.size.toLong())
        exchange.responseBody.use { it.write(responseBody) }
        exchange.close()
    }
    server.start()
    try {
        block(RuntimeTestServer(server, requests))
    } finally {
        server.stop(0)
    }
}

private fun withPackagedServer(
    panels: Map<String, PackagedGuiPanelRuntime>,
    wrappers: Map<String, String> = emptyMap(),
    resources: Map<String, ByteArray> = emptyMap(),
    proxyTimeouts: PackagedGuiProxyTimeouts = PackagedGuiProxyTimeouts(),
    block: (TestServer) -> Unit,
) {
    val server = HttpServer.create(InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0), 0)
    server.createContext("/") { exchange ->
        if (wrappers.isEmpty()) {
            handle(exchange, resources::get, { panels.toMap() }, proxyTimeouts)
        } else {
            handleWrapper(exchange, { panels.toMap() }, { wrappers.toMap() })
        }
    }
    server.start()
    try {
        block(TestServer(server))
    } finally {
        server.stop(0)
    }
}

private fun assertProxyFailureDoesNotLeak(body: String, vararg forbidden: String) {
    forbidden.forEach { value -> assertFalse(body.contains(value, ignoreCase = true), body) }
}

private fun isReachable(server: HttpServer): Boolean = runCatching {
    request("http://127.0.0.1:${server.address.port}/")
}.isSuccess

private fun request(url: String, method: String = "GET"): Response {
    val connection = URI(url).toURL().openConnection() as HttpURLConnection
    connection.requestMethod = method
    connection.connectTimeout = 2000
    connection.readTimeout = 2000
    val status = connection.responseCode
    val stream = if (status >= 400) connection.errorStream else connection.inputStream
    val body = stream?.use { String(it.readBytes()) }.orEmpty()
    val contentType = connection.getHeaderField("Content-Type")
    val cacheControl = connection.getHeaderField("Cache-Control")
    connection.disconnect()
    return Response(status, body, contentType, cacheControl)
}
