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
        assertFalse(html.contains("isHostMessage(event.data)"))
        assertFalse(html.contains("window.postIntellijMessage({ version: bridgeVersion, type: \"gui.ready\""))
        assertFalse(html.contains("Yet AI host message"))
        assertFalse(html.contains("jar:file:"))
        assertFalse(html.contains("const frameTargetOrigin = \"*\";"))
        assertFalse(html.contains("<div id=\"root\"></div>"))
        assertFalse(html.contains("/assets/index-"))
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
