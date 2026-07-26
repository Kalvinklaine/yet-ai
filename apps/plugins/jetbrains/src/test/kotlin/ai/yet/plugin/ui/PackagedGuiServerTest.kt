package ai.yet.plugin.ui

import ai.yet.plugin.logging.YetProxyAuthDiagnosticsStore
import ai.yet.plugin.runtime.RuntimeSettings
import com.sun.net.httpserver.HttpServer
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.URI
import java.net.ServerSocket
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
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
            assertEquals(200, request("${gui.origin}/").status)
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
    fun hostedChatIndexInjectsProxyRuntimeConfigWithoutToken() {
        val html = injectPanelBootstrap("<html><head><title>Yet</title></head><body><div id=\"root\"></div></body></html>", "panel-1")

        assertTrue(html.contains("window.__yetAiInitialRuntimeConfig"))
        assertTrue(html.contains("entryMode:\"hosted_chat\""))
        assertTrue(html.contains("runtimeAccess:\"same_origin_proxy\""))
        assertTrue(html.contains("runtimeBaseUrl:\"/panel/panel-1\""))
        assertTrue(html.contains("runtimeProxyBaseUrl:\"/panel/panel-1\""))
        assertTrue(html.indexOf("window.__yetAiInitialRuntimeConfig") < html.indexOf("<title>Yet</title>"))
        assertTrue(!html.contains("sessionToken"))
        assertTrue(!html.contains("Authorization"))
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
    fun serverServesOnlyRegisteredHostedChatPanelEntry() {
        val server = PackagedGuiServer()
        val gui = server.start() ?: error("packaged GUI test resource unavailable")
        try {
            val panel = server.registerPanel(RuntimeSettings("http://127.0.0.1:8765", null, null))

            val hosted = request(gui.forPanel(panel).indexUrl)
            val panelRoot = request("${gui.origin}${panel.proxyBaseUrl}/")
            val panelIndex = request("${gui.origin}${panel.proxyBaseUrl}/index.html")

            assertEquals(200, hosted.status)
            assertEquals(404, panelRoot.status)
            assertEquals(404, panelIndex.status)
            assertTrue(hosted.body.contains("entryMode:\"hosted_chat\""))
            assertTrue(hosted.body.contains("runtimeAccess:\"same_origin_proxy\""))
            assertTrue(hosted.body.contains("runtimeBaseUrl:\"${panel.proxyBaseUrl}\""))
            assertTrue(hosted.body.contains("runtimeProxyBaseUrl:\"${panel.proxyBaseUrl}\""))
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
    fun nonEventChatSubscriptionBodyUsesOrdinaryReadTimeout() {
        val runtime = HttpServer.create(InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0), 0)
        runtime.createContext("/") { exchange ->
            exchange.responseHeaders.set("Content-Type", "application/json")
            exchange.sendResponseHeaders(200, 0)
            exchange.responseBody.write("{".toByteArray())
            exchange.responseBody.flush()
            Thread.sleep(300)
            runCatching { exchange.responseBody.write("\"private\":true}".toByteArray()) }
            exchange.close()
        }
        runtime.start()
        try {
            val runtimeOrigin = "http://127.0.0.1:${runtime.address.port}"
            withPackagedServer(
                mapOf("panel-timeout" to PackagedGuiPanelRuntime(runtimeOrigin, "private-timeout-token")),
                proxyTimeouts = PackagedGuiProxyTimeouts(connectMillis = 200, readMillis = 100),
            ) { proxy ->
                val startedAt = System.nanoTime()
                val response = request("${proxy.origin}/panel/panel-timeout/v1/chats/subscribe")
                val elapsedMillis = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startedAt)

                assertEquals(504, response.status)
                assertEquals("{\"error\":\"runtime_proxy_timeout\"}", response.body)
                assertTrue(elapsedMillis < 750, "buffered subscribe timed out after $elapsedMillis ms")
                assertEquals(0, proxy.activeWork.size)
                assertProxyFailureDoesNotLeak(response.body, runtimeOrigin, "private-timeout-token", "private")
            }
        } finally {
            runtime.stop(0)
        }
    }

    @Test
    fun chatSubscriptionStreamsEventsPastOrdinaryReadTimeout() {
        val upstreamCanClose = CountDownLatch(1)
        val upstreamClosed = CountDownLatch(1)
        val requests = Collections.synchronizedList(mutableListOf<RuntimeRequest>())
        val runtime = HttpServer.create(InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0), 0)
        runtime.createContext("/") { exchange ->
            requests.add(RuntimeRequest(exchange.requestURI.toString(), exchange.requestHeaders.getFirst("Authorization")))
            exchange.responseHeaders.set("Content-Type", "text/event-stream; charset=utf-8")
            exchange.sendResponseHeaders(200, 0)
            exchange.responseBody.write("data: first-event\n\n".toByteArray())
            exchange.responseBody.flush()
            Thread.sleep(250)
            exchange.responseBody.write("data: second-event\n\n".toByteArray())
            exchange.responseBody.flush()
            upstreamCanClose.await(2, TimeUnit.SECONDS)
            exchange.close()
            upstreamClosed.countDown()
        }
        runtime.start()
        try {
            val runtimeOrigin = "http://127.0.0.1:${runtime.address.port}"
            withPackagedServer(
                mapOf("panel-stream" to PackagedGuiPanelRuntime(runtimeOrigin, "private-stream-token")),
                proxyTimeouts = PackagedGuiProxyTimeouts(connectMillis = 200, readMillis = 100),
            ) { proxy ->
                val connection = URI("${proxy.origin}/panel/panel-stream/v1/chats/subscribe?chat_id=chat_1").toURL().openConnection() as HttpURLConnection
                connection.connectTimeout = 2_000
                connection.readTimeout = 1_000
                try {
                    assertEquals(200, connection.responseCode)
                    assertEquals("text/event-stream; charset=utf-8", connection.getHeaderField("Content-Type"))
                    val expected = "data: first-event\n\ndata: second-event\n\n"
                    val events = ByteArray(expected.length)
                    connection.inputStream.readNBytes(events, 0, events.size)

                    assertEquals(expected, String(events))
                    assertEquals(1L, upstreamClosed.count)
                    assertEquals("/v1/chats/subscribe?chat_id=chat_1", requests.single().target)
                    assertEquals("Bearer private-stream-token", requests.single().authorization)
                    assertFalse(YetProxyAuthDiagnosticsStore.snapshot().toString().contains("private-stream-token"))
                } finally {
                    upstreamCanClose.countDown()
                    connection.disconnect()
                }
            }
        } finally {
            upstreamCanClose.countDown()
            runtime.stop(0)
        }
    }

    @Test
    fun rejectedSseHandoffReturnsSanitizedBadGatewayBeforeCommit() = withRuntimeServer(
        contentType = "text/event-stream",
        body = "data: private-provider-body\n\n",
    ) { runtime ->
        val rejectedExecutor = Executors.newSingleThreadExecutor().apply { shutdownNow() }
        withPackagedServer(
            mapOf("panel-stream" to PackagedGuiPanelRuntime(runtime.origin, "private-stream-token")),
            streamingExecutor = rejectedExecutor,
        ) { proxy ->
            val response = request("${proxy.origin}/panel/panel-stream/v1/chats/subscribe")

            assertEquals(502, response.status)
            assertEquals("{\"error\":\"runtime_proxy_unavailable\"}", response.body)
            assertProxyFailureDoesNotLeak(response.body, runtime.origin, "private-stream-token", "private-provider-body")
        }
    }

    @Test
    fun clientDisconnectClosesUpstreamStreamPromptly() {
        val upstreamStarted = CountDownLatch(1)
        val upstreamClosed = CountDownLatch(1)
        val runtime = streamingRuntimeServer { exchange ->
            exchange.responseHeaders.set("Content-Type", "text/event-stream")
            exchange.sendResponseHeaders(200, 0)
            upstreamStarted.countDown()
            try {
                while (true) {
                    exchange.responseBody.write("data: heartbeat\n\n".toByteArray())
                    exchange.responseBody.flush()
                    Thread.sleep(20)
                }
            } catch (_: Exception) {
                upstreamClosed.countDown()
            } finally {
                exchange.close()
            }
        }
        try {
            withPackagedServer(mapOf("panel-stream" to PackagedGuiPanelRuntime(runtime.origin, null))) { proxy ->
                val connection = URI("${proxy.origin}/panel/panel-stream/v1/chats/subscribe").toURL().openConnection() as HttpURLConnection
                connection.readTimeout = 2_000
                assertEquals(200, connection.responseCode)
                assertTrue(upstreamStarted.await(1, TimeUnit.SECONDS))
                assertTrue(connection.inputStream.read() >= 0)

                connection.inputStream.close()
                connection.disconnect()

                assertTrue(upstreamClosed.await(2, TimeUnit.SECONDS))
            }
        } finally {
            runtime.stop()
        }
    }

    @Test
    fun disposingServerClosesActiveStreamAndWorkerPromptly() {
        val upstreamStarted = CountDownLatch(1)
        val upstreamClosed = CountDownLatch(1)
        val runtime = streamingRuntimeServer { exchange ->
            exchange.responseHeaders.set("Content-Type", "text/event-stream")
            exchange.sendResponseHeaders(200, 0)
            upstreamStarted.countDown()
            try {
                while (true) {
                    exchange.responseBody.write("data: heartbeat\n\n".toByteArray())
                    exchange.responseBody.flush()
                    Thread.sleep(20)
                }
            } catch (_: Exception) {
                upstreamClosed.countDown()
            } finally {
                exchange.close()
            }
        }
        val service = PackagedGuiServer()
        val clientExecutor = Executors.newSingleThreadExecutor()
        var connection: HttpURLConnection? = null
        try {
            val panel = service.registerPanel(RuntimeSettings(runtime.origin, null, null))
            val gui = service.start() ?: error("packaged GUI test resource unavailable")
            connection = URI("${gui.origin}${panel.proxyBaseUrl}/v1/chats/subscribe").toURL().openConnection() as HttpURLConnection
            connection.readTimeout = 2_000
            val client = connection
            val responseStarted = clientExecutor.submit<Int> {
                val status = client.responseCode
                client.inputStream.read()
                status
            }

            assertEquals(200, responseStarted.get(2, TimeUnit.SECONDS))
            assertTrue(upstreamStarted.await(1, TimeUnit.SECONDS))
            assertEquals(1, service.activeStreamCount())

            val startedAt = System.nanoTime()
            service.dispose()
            val elapsedMillis = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startedAt)

            assertTrue(upstreamClosed.await(1, TimeUnit.SECONDS))
            assertEquals(0, service.activeStreamCount())
            assertTrue(elapsedMillis < 1_000, "server disposal took $elapsedMillis ms")
        } finally {
            service.dispose()
            connection?.disconnect()
            clientExecutor.shutdownNow()
            runtime.stop()
        }
    }

    @Test
    fun unregisterPanelClosesOnlyItsActiveWorkPromptly() {
        val bufferedStarted = CountDownLatch(1)
        val bufferedClosed = CountDownLatch(1)
        val firstStreamClosed = CountDownLatch(1)
        val secondStreamClosed = CountDownLatch(1)
        val runtime = streamingRuntimeServer { exchange ->
            if (exchange.requestURI.rawQuery == "mode=buffered") {
                exchange.responseHeaders.set("Content-Type", "application/json")
                exchange.sendResponseHeaders(200, 0)
                bufferedStarted.countDown()
                try {
                    while (true) {
                        exchange.responseBody.write(" ".toByteArray())
                        exchange.responseBody.flush()
                        Thread.sleep(20)
                    }
                } catch (_: Exception) {
                    bufferedClosed.countDown()
                } finally {
                    exchange.close()
                }
            } else {
                val closed = if (exchange.requestURI.rawQuery == "stream=first") firstStreamClosed else secondStreamClosed
                exchange.responseHeaders.set("Content-Type", "text/event-stream")
                exchange.sendResponseHeaders(200, 0)
                try {
                    while (true) {
                        exchange.responseBody.write("data: active\n\n".toByteArray())
                        exchange.responseBody.flush()
                        Thread.sleep(20)
                    }
                } catch (_: Exception) {
                    closed.countDown()
                } finally {
                    exchange.close()
                }
            }
        }
        val service = PackagedGuiServer()
        val clientExecutor = Executors.newSingleThreadExecutor()
        val streamClients = mutableListOf<HttpURLConnection>()
        try {
            val first = service.registerPanel(RuntimeSettings(runtime.origin, null, null))
            val second = service.registerPanel(RuntimeSettings(runtime.origin, null, null))
            val gui = service.start() ?: error("packaged GUI test resource unavailable")
            val bufferedResponse = clientExecutor.submit<Response> {
                request("${gui.origin}${first.proxyBaseUrl}/v1/chats/subscribe?mode=buffered")
            }
            assertTrue(bufferedStarted.await(1, TimeUnit.SECONDS))
            for ((panel, query) in listOf(first to "first", second to "second")) {
                val client = URI("${gui.origin}${panel.proxyBaseUrl}/v1/chats/subscribe?stream=$query").toURL().openConnection() as HttpURLConnection
                client.readTimeout = 2_000
                assertEquals(200, client.responseCode)
                assertTrue(client.inputStream.read() >= 0)
                streamClients.add(client)
            }
            assertEquals(3, service.activeWorkCount())

            service.unregisterPanel(first.id)

            assertTrue(bufferedClosed.await(1, TimeUnit.SECONDS))
            assertTrue(firstStreamClosed.await(1, TimeUnit.SECONDS))
            assertTrue(bufferedResponse.get(2, TimeUnit.SECONDS).status in listOf(502, 504))
            assertEquals(1L, secondStreamClosed.count)
            assertEquals(1, service.activeStreamCount())
            assertEquals(1, service.activeWorkCount())
            assertTrue(streamClients[1].inputStream.read() >= 0)
            assertEquals(200, request(gui.forPanel(second).indexUrl).status)
        } finally {
            service.dispose()
            streamClients.forEach { it.disconnect() }
            clientExecutor.shutdownNow()
            runtime.stop()
        }
    }

    @Test
    fun disposingServerCancelsHangingBufferedResponseWithoutLeakingWork() {
        val bufferedStarted = CountDownLatch(1)
        val runtime = streamingRuntimeServer { exchange ->
            exchange.responseHeaders.set("Content-Type", "application/json")
            exchange.sendResponseHeaders(200, 0)
            bufferedStarted.countDown()
            try {
                while (true) {
                    exchange.responseBody.write(" ".toByteArray())
                    exchange.responseBody.flush()
                    Thread.sleep(20)
                }
            } catch (_: Exception) {
            } finally {
                exchange.close()
            }
        }
        val service = PackagedGuiServer()
        val clientExecutor = Executors.newSingleThreadExecutor()
        try {
            val panel = service.registerPanel(RuntimeSettings(runtime.origin, null, null))
            val gui = service.start() ?: error("packaged GUI test resource unavailable")
            val response = clientExecutor.submit {
                runCatching { request("${gui.origin}${panel.proxyBaseUrl}/v1/chats/subscribe") }
            }
            assertTrue(bufferedStarted.await(1, TimeUnit.SECONDS))
            assertTrue(awaitCondition { service.activeWorkCount() == 1 })

            service.dispose()

            response.get(2, TimeUnit.SECONDS)
            assertEquals(0, service.activeWorkCount())
        } finally {
            service.dispose()
            clientExecutor.shutdownNow()
            runtime.stop()
        }
    }

    @Test
    fun unregisterThenUpdateSamePanelIdPermitsNewBufferedRequest() = withRuntimeServer { runtime ->
        val service = PackagedGuiServer()
        try {
            val panelId = "reused-panel"
            val settings = RuntimeSettings(runtime.origin, null, null)
            service.updatePanel(panelId, settings)
            val gui = service.start() ?: error("packaged GUI test resource unavailable")

            assertEquals(200, request("${gui.origin}/panel/$panelId/v1/chats/subscribe").status)
            service.unregisterPanel(panelId)
            service.updatePanel(panelId, settings)

            val response = request("${gui.origin}/panel/$panelId/v1/chats/subscribe")

            assertEquals(200, response.status)
            assertEquals("runtime-ok", response.body)
            assertEquals(0, service.activeWorkCount())
        } finally {
            service.dispose()
        }
    }

    @Test
    fun longLivedStreamsDoNotStarveOrdinaryPanelAssets() {
        val streamCount = 4
        val streamsStarted = CountDownLatch(streamCount)
        val releaseStreams = CountDownLatch(1)
        val runtime = streamingRuntimeServer { exchange ->
            exchange.responseHeaders.set("Content-Type", "text/event-stream")
            exchange.sendResponseHeaders(200, 0)
            exchange.responseBody.write("data: ready\n\n".toByteArray())
            exchange.responseBody.flush()
            streamsStarted.countDown()
            releaseStreams.await(3, TimeUnit.SECONDS)
            exchange.close()
        }
        val clients = mutableListOf<HttpURLConnection>()
        try {
            withPackagedServer(
                mapOf("panel-stream" to PackagedGuiPanelRuntime(runtime.origin, null)),
                resources = mapOf("/yet-ai-gui/assets/index.js" to "asset-ok".toByteArray()),
            ) { proxy ->
                repeat(streamCount) {
                    val connection = URI("${proxy.origin}/panel/panel-stream/v1/chats/subscribe?id=$it").toURL().openConnection() as HttpURLConnection
                    connection.readTimeout = 2_000
                    assertEquals(200, connection.responseCode)
                    assertTrue(connection.inputStream.read() >= 0)
                    clients.add(connection)
                }
                assertTrue(streamsStarted.await(1, TimeUnit.SECONDS))

                val asset = request("${proxy.origin}/panel/panel-stream/assets/index.js")

                assertEquals(200, asset.status)
                assertEquals("asset-ok", asset.body)
            }
        } finally {
            releaseStreams.countDown()
            clients.forEach { it.disconnect() }
            runtime.stop()
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

private class TestServer(private val server: HttpServer, val activeWork: PackagedGuiActiveWorkRegistry) {
    val origin = "http://127.0.0.1:${server.address.port}"
    fun stop() = server.stop(0)
}

private class RuntimeTestServer(private val server: HttpServer, val requests: MutableList<RuntimeRequest>) {
    val origin = "http://127.0.0.1:${server.address.port}"
    fun stop() = server.stop(0)
}

private fun withRuntimeServer(
    status: Int = 200,
    delayMillis: Long = 0,
    body: String = "runtime-ok",
    contentType: String? = null,
    block: (RuntimeTestServer) -> Unit,
) {
    val requests = mutableListOf<RuntimeRequest>()
    val server = HttpServer.create(InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0), 0)
    server.createContext("/") { exchange ->
        requests.add(RuntimeRequest(exchange.requestURI.rawPath + exchange.requestURI.rawQuery?.let { "?$it" }.orEmpty(), exchange.requestHeaders.getFirst("Authorization")))
        if (delayMillis > 0) Thread.sleep(delayMillis)
        val responseBody = body.toByteArray()
        contentType?.let { exchange.responseHeaders.set("Content-Type", it) }
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
    streamingExecutor: ExecutorService = Executors.newCachedThreadPool(),
    block: (TestServer) -> Unit,
) {
    val server = HttpServer.create(InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0), 0)
    val requestExecutor = Executors.newFixedThreadPool(4)
    val bufferedExecutor = Executors.newFixedThreadPool(4)
    val activeWork = PackagedGuiActiveWorkRegistry()
    panels.keys.forEach(activeWork::activatePanel)
    server.executor = requestExecutor
    server.createContext("/") { exchange ->
        if (wrappers.isEmpty()) {
            handle(exchange, resources::get, { panels.toMap() }, proxyTimeouts, streamingExecutor, bufferedExecutor, activeWork)
        } else {
            handleWrapper(exchange, { panels.toMap() }, { wrappers.toMap() })
        }
    }
    server.start()
    try {
        block(TestServer(server, activeWork))
    } finally {
        server.stop(0)
        requestExecutor.shutdownNow()
        activeWork.closeAll()
        bufferedExecutor.shutdownNow()
        streamingExecutor.shutdownNow()
    }
}

private fun streamingRuntimeServer(handler: (com.sun.net.httpserver.HttpExchange) -> Unit): RuntimeTestServer {
    val server = HttpServer.create(InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0), 0)
    server.executor = Executors.newCachedThreadPool()
    server.createContext("/", handler)
    server.start()
    return RuntimeTestServer(server, mutableListOf())
}

private fun assertProxyFailureDoesNotLeak(body: String, vararg forbidden: String) {
    forbidden.forEach { value -> assertFalse(body.contains(value, ignoreCase = true), body) }
}

private fun isReachable(server: HttpServer): Boolean = runCatching {
    request("http://127.0.0.1:${server.address.port}/")
}.isSuccess

private fun awaitCondition(timeoutMillis: Long = 1_000, condition: () -> Boolean): Boolean {
    val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMillis)
    while (System.nanoTime() < deadline) {
        if (condition()) return true
        Thread.sleep(10)
    }
    return condition()
}

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
