package ai.yet.plugin.ui

import ai.yet.plugin.runtime.RuntimeConnectionResult
import ai.yet.plugin.runtime.RuntimeSettings
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFalse

class YetToolWindowFactoryTest {
    @Test
    fun packagedGuiUsesLoopbackServerIframe() {
        val packagedGui = PackagedGui("http://127.0.0.1:49221/index.html", "http://127.0.0.1:49221")
        val html = renderHtml(
            RuntimeConnectionResult(RuntimeSettings("http://127.0.0.1:8001", null, null), null, null),
            "console.log('bridge')",
            packagedGui,
        )

        assertContains(html, "<iframe title=\"Yet AI GUI\" src=\"http://127.0.0.1:49221/index.html\"></iframe>")
        assertContains(html, "const frameTargetOrigin = \"http://127.0.0.1:49221\";")
        assertContains(html, "Loading packaged Yet AI GUI from <code>http://127.0.0.1:49221/index.html</code>")
        assertContains(html, "Connecting to Yet AI local runtime")
        assertContains(html, "Packaged Yet AI GUI did not finish loading from the local loopback server")
        assertContains(html, "window.setTimeout")
        assertContains(html, "window.__yetAiSendHostMessageToFrame = sendToFrame")
        assertContains(html, "window.__yetAiSetRuntimeDiagnostic")
        assertContains(html, "const pendingHostMessages = Array.isArray(window.__yetAiPendingHostMessages) ? window.__yetAiPendingHostMessages : []")
        assertContains(html, "const pendingDiagnostics = Array.isArray(window.__yetAiPendingDiagnostics) ? window.__yetAiPendingDiagnostics : []")
        assertContains(html, "window.__yetAiPendingHostMessages = pendingHostMessages")
        assertContains(html, "window.__yetAiPendingDiagnostics = pendingDiagnostics")
        assertContains(html, "if (!frameReady) {")
        assertContains(html, "pendingHostMessages.push(message)")
        assertContains(html, "flushPending()")
        assertFalse(html.contains("isHostMessage(event.data)"))
        assertFalse(html.contains("window.postIntellijMessage({ version: bridgeVersion, type: \"gui.ready\""))
        assertFalse(html.contains("Yet AI host message"))
        assertFalse(html.contains("window.__yetAiSendHostMessageToFrame?."))
        assertFalse(html.contains("window.postMessage(message"))
        assertFalse(html.contains("jar:file:"))
        assertFalse(html.contains("const frameTargetOrigin = \"*\";"))
        assertFalse(html.contains("<div id=\"root\"></div>"))
        assertFalse(html.contains("/assets/index-"))
    }

    @Test
    fun wrapperFlushesQueuedMessagesWhenFrameLoadsOrGuiIsReady() {
        val html = renderHtml(
            RuntimeConnectionResult(RuntimeSettings("http://127.0.0.1:8001", null, null), null, "runtime unavailable"),
            "console.log('bridge')",
            PackagedGui("http://127.0.0.1:49221/index.html", "http://127.0.0.1:49221"),
        )

        assertContains(html, "let frameReady = false")
        assertContains(html, "while (pendingDiagnostics.length > 0) showDiagnostic(pendingDiagnostics.shift())")
        assertContains(html, "while (pendingHostMessages.length > 0) postToFrame(pendingHostMessages.shift())")
        assertContains(html, "frameReady = true;")
        assertContains(html, "flushPending();")
        assertContains(html, "window.postIntellijMessage(event.data);")
        assertContains(html, "sendToFrame(bootstrapHostReady);")
    }

    @Test
    fun panelSourceContainsDisposalGuardForAsyncDelivery() {
        val source = java.nio.file.Files.readString(java.nio.file.Path.of("src/main/kotlin/ai/yet/plugin/ui/YetToolWindowFactory.kt"))

        assertContains(source, "private var disposed = false")
        assertContains(source, "invokeLater {")
        assertContains(source, "if (!disposed) {")
        assertContains(source, "if (disposed) return")
        assertContains(source, "window.__yetAiPendingHostMessages = Array.isArray(window.__yetAiPendingHostMessages) ? window.__yetAiPendingHostMessages : []")
        assertContains(source, "window.__yetAiPendingDiagnostics = Array.isArray(window.__yetAiPendingDiagnostics) ? window.__yetAiPendingDiagnostics : []")
        assertContains(source, "window.__yetAiPendingHostMessages.push(message)")
        assertContains(source, "window.__yetAiPendingDiagnostics.push(message)")
        assertContains(source, "disposed = true")
    }

    @Test
    fun devGuiUrlKeepsLoopbackIframe() {
        val frame = buildGuiFrame("http://127.0.0.1:5173/gui", null)
        val origin = buildFrameOrigin("http://127.0.0.1:5173/gui", null)

        assertEquals("<iframe title=\"Yet AI GUI\" src=\"http://127.0.0.1:5173/gui\"></iframe>", frame)
        assertEquals("\"http://127.0.0.1:5173\"", origin)
    }

    @Test
    fun placeholderIsKeptWhenPackagedGuiIsMissing() {
        val html = renderHtml(
            RuntimeConnectionResult(RuntimeSettings("http://127.0.0.1:8001", null, null), "Connected", null),
            "console.log('bridge')",
            null,
        )

        assertContains(html, "Run <code>cd apps/gui && npm run build</code>")
        assertContains(html, "Connected")
        assertFalse(html.contains("<iframe title=\"Yet AI GUI\""))
    }
}
