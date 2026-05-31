package ai.yet.plugin.ui

import com.intellij.openapi.Disposable
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import java.io.ByteArrayInputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

@Service(Service.Level.APP)
class PackagedGuiServer : Disposable {
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
        server.createContext("/") { exchange -> handle(exchange, ::resourceBytes) }
        server.start()
        val origin = "http://127.0.0.1:${server.address.port}"
        val gui = PackagedGui("$origin/index.html", origin)
        running = RunningServer(server, executor, gui)
        return gui
    }

    @Synchronized
    override fun dispose() {
        val current = running
        if (current != null) {
            current.server.stop(0)
            current.executor.shutdownNow()
        }
        running = null
    }

    private fun resourceBytes(path: String): ByteArray? = PackagedGuiServer::class.java.getResourceAsStream(path)?.use { it.readBytes() }

    private data class RunningServer(val server: HttpServer, val executor: ExecutorService, val gui: PackagedGui)

    companion object {
        fun getInstance(): PackagedGuiServer = service()
    }
}

data class PackagedGui(val indexUrl: String, val origin: String)

fun handle(exchange: HttpExchange, loadResource: (String) -> ByteArray?) {
    try {
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
