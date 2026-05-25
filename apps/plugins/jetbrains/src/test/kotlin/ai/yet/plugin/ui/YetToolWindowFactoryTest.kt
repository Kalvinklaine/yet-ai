package ai.yet.plugin.ui

import ai.yet.plugin.runtime.RuntimeConnectionResult
import ai.yet.plugin.runtime.RuntimeSettings
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFalse

class YetToolWindowFactoryTest {
    @Test
    fun packagedGuiUsesClasspathIndexIframe() {
        val packagedGui = PackagedGui(java.net.URL("jar:file:/tmp/yet-ai-jetbrains.jar!/yet-ai-gui/index.html"))
        val html = renderHtml(
            RuntimeConnectionResult(RuntimeSettings("http://127.0.0.1:8001", null, null), null, null),
            "console.log('bridge')",
            packagedGui,
        )

        assertContains(html, "<iframe title=\"Yet AI GUI\" src=\"jar:file:/tmp/yet-ai-jetbrains.jar!/yet-ai-gui/index.html\"></iframe>")
        assertContains(html, "const frameTargetOrigin = \"*\";")
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
        assertFalse(html.contains("<iframe title=\"Yet AI GUI\""))
    }
}
