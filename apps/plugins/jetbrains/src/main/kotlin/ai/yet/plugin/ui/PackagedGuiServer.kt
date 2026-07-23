package ai.yet.plugin.ui

import ai.yet.plugin.logging.YetProxyAuthDiagnosticsStore
import ai.yet.plugin.runtime.RuntimeSettings
import com.intellij.openapi.Disposable
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import java.io.ByteArrayInputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.SocketTimeoutException
import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

@Service(Service.Level.APP)
class PackagedGuiServer internal constructor(
    private val afterGuiServerStarted: (HttpServer, HttpServer, ExecutorService) -> Unit = { _, _, _ -> },
) : Disposable {
    private val panels = ConcurrentHashMap<String, PackagedGuiPanelRuntime>()
    private val wrappers = ConcurrentHashMap<String, String>()
    private val random = SecureRandom()
    private var running: RunningServer? = null

    @Synchronized
    fun start(): PackagedGui? {
        val existing = running
        if (existing != null) {
            return existing.gui
        }
        if (resourceBytes("/yet-ai-gui/index.html") == null) {
            return null
        }
        val executor = Executors.newFixedThreadPool(4) { runnable ->
            Thread(runnable, "Yet AI packaged GUI server").apply { isDaemon = true }
        }
        var server: HttpServer? = null
        var wrapperServer: HttpServer? = null
        try {
            server = HttpServer.create(InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0), 0)
            wrapperServer = HttpServer.create(InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0), 0)
            server.executor = executor
            wrapperServer.executor = executor
            server.createContext("/") { exchange -> handle(exchange, ::resourceBytes, panels::toMap) }
            wrapperServer.createContext("/") { exchange -> handleWrapper(exchange, panels::toMap, wrappers::toMap) }
            server.start()
            afterGuiServerStarted(server, wrapperServer, executor)
            wrapperServer.start()
            val origin = "http://127.0.0.1:${server.address.port}"
            val wrapperOrigin = "http://127.0.0.1:${wrapperServer.address.port}"
            val gui = PackagedGui("$origin/index.html", origin, wrapperOrigin)
            running = RunningServer(server, wrapperServer, executor, gui)
            return gui
        } catch (error: Throwable) {
            runCatching { server?.stop(0) }
            runCatching { wrapperServer?.stop(0) }
            executor.shutdownNow()
            throw error
        }
    }

    fun registerPanel(settings: RuntimeSettings): PackagedGuiPanel {
        val panelId = generatePanelId()
        updatePanel(panelId, settings)
        YetProxyAuthDiagnosticsStore.sameOriginProxyRegistered(panelId)
        return PackagedGuiPanel(panelId, "/panel/$panelId")
    }

    fun updatePanel(panelId: String, settings: RuntimeSettings) {
        if (!isValidPanelId(panelId)) return
        panels[panelId] = PackagedGuiPanelRuntime(settings.runtimeUrl, settings.sessionToken)
    }

    @Synchronized
    fun registerWrapper(panelId: String, wrapperHtml: String): Boolean {
        if (running == null || !isValidPanelId(panelId) || !panels.containsKey(panelId)) return false
        wrappers[panelId] = wrapperHtml
        return true
    }

    @Synchronized
    fun unregisterPanel(panelId: String) {
        wrappers.remove(panelId)
        panels.remove(panelId)
        YetProxyAuthDiagnosticsStore.sameOriginProxyUnregistered(panelId)
    }

    @Synchronized
    override fun dispose() {
        val current = running
        if (current != null) {
            current.server.stop(0)
            current.wrapperServer.stop(0)
            current.executor.shutdownNow()
        }
        panels.clear()
        wrappers.clear()
        running = null
    }

    private fun generatePanelId(): String {
        val bytes = ByteArray(16)
        while (true) {
            random.nextBytes(bytes)
            val id = bytes.joinToString("") { byte -> "%02x".format(byte) }
            if (!panels.containsKey(id)) return id
        }
    }

    private fun resourceBytes(path: String): ByteArray? = PackagedGuiServer::class.java.getResourceAsStream(path)?.use { it.readBytes() }

    private data class RunningServer(val server: HttpServer, val wrapperServer: HttpServer, val executor: ExecutorService, val gui: PackagedGui)

    companion object {
        fun getInstance(): PackagedGuiServer = service()
    }
}

data class PackagedGui(val indexUrl: String, val origin: String, val wrapperOrigin: String) {
    fun forPanel(panel: PackagedGuiPanel): PackagedGui = copy(indexUrl = origin + panel.proxyBaseUrl + "/hosted-chat")
    fun wrapperUrl(panel: PackagedGuiPanel): String = wrapperOrigin + panel.proxyBaseUrl + "/wrapper.html"
}

data class PackagedGuiPanel(val id: String, val proxyBaseUrl: String)

data class PackagedGuiPanelRuntime(val runtimeUrl: String, val sessionToken: String?)

data class PackagedGuiProxyRequest(val targetUrl: String, val headers: Map<String, String>)

data class PackagedGuiProxyTimeouts(val connectMillis: Int = 2_000, val readMillis: Int = 10_000)

sealed class PackagedGuiProxyDecision {
    data class Forward(val request: PackagedGuiProxyRequest) : PackagedGuiProxyDecision()
    data object Reject : PackagedGuiProxyDecision()
}

fun packagedGuiProxyDecision(panelId: String, rawPath: String, panels: Map<String, PackagedGuiPanelRuntime>): PackagedGuiProxyDecision {
    if (!isValidPanelId(panelId)) return PackagedGuiProxyDecision.Reject
    val panel = panels[panelId] ?: return PackagedGuiProxyDecision.Reject
    if (!rawPath.startsWith("/v1/") && rawPath != "/v1") return PackagedGuiProxyDecision.Reject
    if (!isLoopbackRuntimeRoot(panel.runtimeUrl)) return PackagedGuiProxyDecision.Reject
    val targetUrl = URI(panel.runtimeUrl).resolve(rawPath.removePrefix("/")).toString()
    val headers = panel.sessionToken?.takeIf { it.isNotBlank() }?.let { token -> mapOf("Authorization" to ("Bearer " + token)) } ?: emptyMap()
    return PackagedGuiProxyDecision.Forward(PackagedGuiProxyRequest(targetUrl, headers))
}

fun isValidPanelId(panelId: String): Boolean = Regex("^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$").matches(panelId)

private fun isLoopbackRuntimeRoot(value: String): Boolean {
    val uri = try {
        URI(value)
    } catch (_: Exception) {
        return false
    }
    val scheme = uri.scheme?.lowercase() ?: return false
    val host = uri.host?.removeSurrounding("[", "]")?.lowercase() ?: return false
    val path = uri.rawPath ?: ""
    return uri.isAbsolute &&
        (scheme == "http" || scheme == "https") &&
        (host == "127.0.0.1" || host == "localhost" || host == "::1") &&
        uri.rawUserInfo == null &&
        uri.port in 1..65535 &&
        uri.rawQuery == null &&
        uri.rawFragment == null &&
        (path.isEmpty() || path == "/")
}

fun handle(
    exchange: HttpExchange,
    loadResource: (String) -> ByteArray?,
    panels: () -> Map<String, PackagedGuiPanelRuntime> = { emptyMap() },
    proxyTimeouts: PackagedGuiProxyTimeouts = PackagedGuiProxyTimeouts(),
) {
    try {
        val panelIndex = panelIndexRoute(exchange.requestURI.rawPath)
        if (panelIndex != null) {
            servePanelIndex(exchange, panelIndex, loadResource, panels())
            return
        }
        val panelAsset = panelAssetRoute(exchange.requestURI.rawPath)
        if (panelAsset != null) {
            servePanelAsset(exchange, panelAsset.first, panelAsset.second, loadResource, panels())
            return
        }
        val panelRoute = panelProxyRoute(exchange.requestURI.rawPath)
        if (panelRoute != null) {
            proxyPanelRequest(exchange, panelRoute.first, panelRoute.second, panels(), proxyTimeouts)
            return
        }
        if (exchange.requestMethod != "GET") {
            send(exchange, 405, "text/plain; charset=utf-8", "method not allowed".toByteArray(StandardCharsets.UTF_8))
            return
        }
        val resource = resourcePath(exchange.requestURI.rawPath)
        if (resource == null) {
            send(exchange, 404, "text/plain; charset=utf-8", "not found".toByteArray(StandardCharsets.UTF_8))
            return
        }
        val body = loadResource(resource)
        if (body == null) {
            send(exchange, 404, "text/plain; charset=utf-8", "not found".toByteArray(StandardCharsets.UTF_8))
            return
        }
        send(exchange, 200, mimeType(resource), body)
    } finally {
        exchange.close()
    }
}

private fun panelAssetRoute(rawPath: String): Pair<String, String>? {
    val prefix = "/panel/"
    if (!rawPath.startsWith(prefix)) return null
    val remainder = rawPath.removePrefix(prefix)
    val separator = remainder.indexOf('/')
    if (separator < 0) return null
    val panelId = remainder.substring(0, separator)
    val path = remainder.substring(separator)
    if (!isValidPanelId(panelId) || !path.startsWith("/assets/")) return null
    return panelId to path
}

private fun servePanelAsset(
    exchange: HttpExchange,
    panelId: String,
    rawPath: String,
    loadResource: (String) -> ByteArray?,
    panels: Map<String, PackagedGuiPanelRuntime>,
) {
    if (exchange.requestMethod != "GET") {
        send(exchange, 405, "text/plain; charset=utf-8", "method not allowed".toByteArray(StandardCharsets.UTF_8))
        return
    }
    if (!panels.containsKey(panelId)) {
        send(exchange, 404, "text/plain; charset=utf-8", "not found".toByteArray(StandardCharsets.UTF_8))
        return
    }
    val resource = resourcePath(rawPath)
    if (resource == null) {
        send(exchange, 404, "text/plain; charset=utf-8", "not found".toByteArray(StandardCharsets.UTF_8))
        return
    }
    val body = loadResource(resource)
    if (body == null) {
        send(exchange, 404, "text/plain; charset=utf-8", "not found".toByteArray(StandardCharsets.UTF_8))
        return
    }
    send(exchange, 200, mimeType(resource), body)
}

fun handleWrapper(
    exchange: HttpExchange,
    panels: () -> Map<String, PackagedGuiPanelRuntime>,
    wrappers: () -> Map<String, String>,
) {
    try {
        val panelId = panelWrapperRoute(exchange.requestURI.rawPath)
        if (panelId == null) {
            send(exchange, 404, "text/plain; charset=utf-8", "not found".toByteArray(StandardCharsets.UTF_8))
            return
        }
        servePanelWrapper(exchange, panelId, panels(), wrappers())
    } finally {
        exchange.close()
    }
}

private fun panelWrapperRoute(rawPath: String): String? {
    val prefix = "/panel/"
    if (!rawPath.startsWith(prefix)) return null
    val remainder = rawPath.removePrefix(prefix)
    val separator = remainder.indexOf('/')
    if (separator < 0) return null
    val panelId = remainder.substring(0, separator)
    val path = remainder.substring(separator)
    if (!isValidPanelId(panelId) || path != "/wrapper.html") return null
    return panelId
}

private fun servePanelWrapper(exchange: HttpExchange, panelId: String, panels: Map<String, PackagedGuiPanelRuntime>, wrappers: Map<String, String>) {
    if (exchange.requestMethod != "GET") {
        send(exchange, 405, "text/plain; charset=utf-8", "method not allowed".toByteArray(StandardCharsets.UTF_8))
        return
    }
    val wrapper = wrappers[panelId]
    if (!panels.containsKey(panelId) || wrapper == null) {
        send(exchange, 404, "text/plain; charset=utf-8", "not found".toByteArray(StandardCharsets.UTF_8))
        return
    }
    send(exchange, 200, "text/html; charset=utf-8", wrapper.toByteArray(StandardCharsets.UTF_8))
}

private data class PanelIndexRoute(val panelId: String, val hostedChatEntry: Boolean)

private fun panelIndexRoute(rawPath: String): PanelIndexRoute? {
    val prefix = "/panel/"
    if (!rawPath.startsWith(prefix)) return null
    val remainder = rawPath.removePrefix(prefix)
    val separator = remainder.indexOf('/')
    if (separator < 0) return null
    val panelId = remainder.substring(0, separator)
    val path = remainder.substring(separator)
    if (!isValidPanelId(panelId)) return null
    if (path != "/" && path != "/index.html" && path != "/hosted-chat") return null
    return PanelIndexRoute(panelId, path == "/hosted-chat")
}

private fun servePanelIndex(exchange: HttpExchange, route: PanelIndexRoute, loadResource: (String) -> ByteArray?, panels: Map<String, PackagedGuiPanelRuntime>) {
    if (exchange.requestMethod != "GET") {
        send(exchange, 405, "text/plain; charset=utf-8", "method not allowed".toByteArray(StandardCharsets.UTF_8))
        return
    }
    if (!panels.containsKey(route.panelId)) {
        send(exchange, 404, "text/plain; charset=utf-8", "not found".toByteArray(StandardCharsets.UTF_8))
        return
    }
    val index = loadResource("/yet-ai-gui/index.html")
    if (index == null) {
        send(exchange, 404, "text/plain; charset=utf-8", "not found".toByteArray(StandardCharsets.UTF_8))
        return
    }
    send(exchange, 200, "text/html; charset=utf-8", injectPanelBootstrap(String(index, StandardCharsets.UTF_8), route.panelId, route.hostedChatEntry).toByteArray(StandardCharsets.UTF_8))
}

fun injectPanelBootstrap(indexHtml: String, panelId: String, hostedChatEntry: Boolean = false): String {
    if (!isValidPanelId(panelId)) return indexHtml
    val entryMode = if (hostedChatEntry) "entryMode:\"hosted_chat\"," else ""
    val script = """
        <script>window.__yetAiInitialRuntimeConfig={${entryMode}runtimeAccess:"same_origin_proxy",runtimeBaseUrl:"/panel/$panelId",runtimeProxyBaseUrl:"/panel/$panelId"};</script>
    """.trimIndent()
    return if (indexHtml.contains("<head>")) {
        indexHtml.replace("<head>", "<head>\n$script", ignoreCase = false)
    } else {
        "$script\n$indexHtml"
    }
}

private fun panelProxyRoute(rawPath: String): Pair<String, String>? {
    val prefix = "/panel/"
    if (!rawPath.startsWith(prefix)) return null
    val remainder = rawPath.removePrefix(prefix)
    val separator = remainder.indexOf('/')
    if (separator < 0) return null
    val panelId = remainder.substring(0, separator)
    val proxiedPath = remainder.substring(separator)
    if (!isValidPanelId(panelId)) return null
    if (!proxiedPath.startsWith("/v1/")) return null
    return panelId to proxiedPath
}

private fun proxyPanelRequest(
    exchange: HttpExchange,
    panelId: String,
    rawPath: String,
    panels: Map<String, PackagedGuiPanelRuntime>,
    timeouts: PackagedGuiProxyTimeouts,
) {
    if (exchange.requestMethod != "GET" && exchange.requestMethod != "POST") {
        send(exchange, 405, "text/plain; charset=utf-8", "method not allowed".toByteArray(StandardCharsets.UTF_8))
        return
    }
    val decision = packagedGuiProxyDecision(panelId, rawPath, panels)
    if (decision !is PackagedGuiProxyDecision.Forward) {
        send(exchange, 404, "text/plain; charset=utf-8", "not found".toByteArray(StandardCharsets.UTF_8))
        return
    }
    val target = URI(decision.request.targetUrl).let { uri ->
        val rawQuery = exchange.requestURI.rawQuery
        if (rawQuery == null) uri else URI(uri.scheme, uri.authority, uri.path, rawQuery, null)
    }
    var connection: HttpURLConnection? = null
    val response = try {
        connection = target.toURL().openConnection() as HttpURLConnection
        connection.connectTimeout = timeouts.connectMillis
        connection.readTimeout = timeouts.readMillis
        connection.requestMethod = exchange.requestMethod
        connection.instanceFollowRedirects = false
        decision.request.headers.forEach { (name, value) -> connection.setRequestProperty(name, value) }
        exchange.requestHeaders["Content-Type"]?.firstOrNull()?.let { connection.setRequestProperty("Content-Type", it) }
        if (exchange.requestMethod == "POST") {
            connection.doOutput = true
            exchange.requestBody.use { input -> connection.outputStream.use { output -> input.copyTo(output) } }
        }
        val status = connection.responseCode
        YetProxyAuthDiagnosticsStore.sameOriginProxyRequest(panelId, decision.request.headers.containsKey("Authorization"), status)
        val contentType = connection.headerFields["Content-Type"]?.firstOrNull() ?: "application/octet-stream"
        val body = (if (status >= 400) connection.errorStream else connection.inputStream)?.use { it.readBytes() } ?: ByteArray(0)
        PackagedGuiProxyResponse(status, contentType, body)
    } catch (_: SocketTimeoutException) {
        YetProxyAuthDiagnosticsStore.sameOriginProxyRequest(panelId, decision.request.headers.containsKey("Authorization"), 504)
        proxyFailure(504, "runtime_proxy_timeout")
    } catch (_: IOException) {
        YetProxyAuthDiagnosticsStore.sameOriginProxyRequest(panelId, decision.request.headers.containsKey("Authorization"), 502)
        proxyFailure(502, "runtime_proxy_unavailable")
    } finally {
        connection?.disconnect()
    }
    send(exchange, response.status, response.contentType, response.body)
}

private data class PackagedGuiProxyResponse(val status: Int, val contentType: String, val body: ByteArray)

private fun proxyFailure(status: Int, error: String) =
    PackagedGuiProxyResponse(status, "application/json; charset=utf-8", "{\"error\":\"$error\"}".toByteArray(StandardCharsets.UTF_8))

fun resourcePath(rawPath: String): String? {
    if (rawPath.contains('\\')) {
        return null
    }
    val decoded = decodePath(rawPath) ?: return null
    if (decoded.contains('\\') || decoded.contains("..")) {
        return null
    }
    if (decoded == "/" || decoded == "/index.html") {
        return "/yet-ai-gui/index.html"
    }
    if (!decoded.startsWith("/assets/") || decoded == "/assets/" || decoded.contains("//")) {
        return null
    }
    return "/yet-ai-gui$decoded"
}

fun mimeType(resourcePath: String): String = when {
    resourcePath.endsWith(".html") -> "text/html; charset=utf-8"
    resourcePath.endsWith(".js") -> "application/javascript; charset=utf-8"
    resourcePath.endsWith(".css") -> "text/css; charset=utf-8"
    resourcePath.endsWith(".svg") -> "image/svg+xml"
    resourcePath.endsWith(".map") -> "application/json; charset=utf-8"
    else -> "application/octet-stream"
}

private fun decodePath(rawPath: String): String? {
    var current = rawPath
    repeat(4) {
        val decoded = try {
            URLDecoder.decode(current.replace("+", "%2B"), StandardCharsets.UTF_8)
        } catch (_: IllegalArgumentException) {
            return null
        }
        if (decoded == current) {
            return decoded
        }
        current = decoded
    }
    return null
}

private fun send(exchange: HttpExchange, status: Int, contentType: String, body: ByteArray) {
    exchange.responseHeaders.set("Content-Type", contentType)
    exchange.responseHeaders.set("Cache-Control", "no-store")
    exchange.sendResponseHeaders(status, body.size.toLong())
    ByteArrayInputStream(body).use { input -> input.copyTo(exchange.responseBody) }
}
