package ai.yet.plugin.ui

import ai.yet.plugin.runtime.RuntimeSettings
import com.intellij.openapi.Disposable
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import java.io.ByteArrayInputStream
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

@Service(Service.Level.APP)
class PackagedGuiServer : Disposable {
    private val panels = ConcurrentHashMap<String, PackagedGuiPanelRuntime>()
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
        val server = HttpServer.create(InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0), 0)
        val executor = Executors.newFixedThreadPool(4) { runnable ->
            Thread(runnable, "Yet AI packaged GUI server").apply { isDaemon = true }
        }
        server.executor = executor
        server.createContext("/") { exchange -> handle(exchange, ::resourceBytes, panels::toMap) }
        server.start()
        val origin = "http://127.0.0.1:${server.address.port}"
        val gui = PackagedGui("$origin/index.html", origin)
        running = RunningServer(server, executor, gui)
        return gui
    }

    fun registerPanel(settings: RuntimeSettings): PackagedGuiPanel {
        val panelId = generatePanelId()
        updatePanel(panelId, settings)
        return PackagedGuiPanel(panelId, "/panel/$panelId")
    }

    fun updatePanel(panelId: String, settings: RuntimeSettings) {
        if (!isValidPanelId(panelId)) return
        panels[panelId] = PackagedGuiPanelRuntime(settings.runtimeUrl, settings.sessionToken)
    }

    fun unregisterPanel(panelId: String) {
        panels.remove(panelId)
    }

    @Synchronized
    override fun dispose() {
        val current = running
        if (current != null) {
            current.server.stop(0)
            current.executor.shutdownNow()
        }
        panels.clear()
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

    private data class RunningServer(val server: HttpServer, val executor: ExecutorService, val gui: PackagedGui)

    companion object {
        fun getInstance(): PackagedGuiServer = service()
    }
}

data class PackagedGui(val indexUrl: String, val origin: String)

data class PackagedGuiPanel(val id: String, val proxyBaseUrl: String)

data class PackagedGuiPanelRuntime(val runtimeUrl: String, val sessionToken: String?)

data class PackagedGuiProxyRequest(val targetUrl: String, val headers: Map<String, String>)

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

fun handle(exchange: HttpExchange, loadResource: (String) -> ByteArray?, panels: () -> Map<String, PackagedGuiPanelRuntime> = { emptyMap() }) {
    try {
        val panelRoute = panelProxyRoute(exchange.requestURI.rawPath)
        if (panelRoute != null) {
            proxyPanelRequest(exchange, panelRoute.first, panelRoute.second, panels())
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

private fun proxyPanelRequest(exchange: HttpExchange, panelId: String, rawPath: String, panels: Map<String, PackagedGuiPanelRuntime>) {
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
    val connection = target.toURL().openConnection() as HttpURLConnection
    connection.requestMethod = exchange.requestMethod
    connection.instanceFollowRedirects = false
    decision.request.headers.forEach { (name, value) -> connection.setRequestProperty(name, value) }
    exchange.requestHeaders["Content-Type"]?.firstOrNull()?.let { connection.setRequestProperty("Content-Type", it) }
    if (exchange.requestMethod == "POST") {
        connection.doOutput = true
        exchange.requestBody.use { input -> connection.outputStream.use { output -> input.copyTo(output) } }
    }
    val status = connection.responseCode
    val contentType = connection.headerFields["Content-Type"]?.firstOrNull() ?: "application/octet-stream"
    val body = try {
        (if (status >= 400) connection.errorStream else connection.inputStream)?.use { it.readBytes() } ?: ByteArray(0)
    } finally {
        connection.disconnect()
    }
    send(exchange, status, contentType, body)
}

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
