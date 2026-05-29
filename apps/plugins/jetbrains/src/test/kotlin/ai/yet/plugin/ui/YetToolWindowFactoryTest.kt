package ai.yet.plugin.ui

import ai.yet.plugin.bridge.ActiveEditorContext
import com.google.gson.JsonParser
import ai.yet.plugin.runtime.RuntimeConnectionResult
import ai.yet.plugin.runtime.RuntimeSettings
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

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
        assertContains(html, "message.type === \"host.contextSnapshot\"")
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
    fun wrapperAcceptsOnlyStrictGuiReady() {
        val html = renderHtml(
            RuntimeConnectionResult(RuntimeSettings("http://127.0.0.1:8001", null, null), null, null),
            "console.log('bridge')",
            PackagedGui("http://127.0.0.1:49221/index.html", "http://127.0.0.1:49221"),
        )

        assertContains(html, "const isValidRequestId = (requestId) => typeof requestId === \"string\" && requestId.length > 0 && requestId.length <= 128")
        assertContains(html, "if (!message || typeof message !== \"object\" || Array.isArray(message)) return false")
        assertContains(html, "if (!keys.every((key) => key === \"version\" || key === \"type\" || key === \"requestId\" || key === \"payload\")) return false")
        assertContains(html, "if (message.version !== bridgeVersion || message.type !== \"gui.ready\") return false")
        assertContains(html, "Object.prototype.hasOwnProperty.call(message, \"requestId\") && !isValidRequestId(message.requestId)")
        assertContains(html, "Object.prototype.hasOwnProperty.call(message, \"payload\") && (typeof message.payload !== \"object\" || message.payload === null || Array.isArray(message.payload))")
        assertFalse(html.contains("message.type === \"gui.openFile\""))
        assertFalse(html.contains("message.type === \"gui.revealRange\""))
        assertFalse(html.contains("message.type === \"gui.applyWorkspaceEditRequest\""))
        assertFalse(html.contains("message.type === \"gui.executeIdeTool\""))
        assertFalse(html.contains("message.type === \"gui.copyText\""))
        assertFalse(html.contains("message.type === \"gui.showNotification\""))
        assertFalse(html.contains("message.type === \"gui.getHostContext\""))
        assertFalse(html.contains("workspaceRelativePath"))
        assertFalse(html.contains("clipboard"))
        assertFalse(html.contains("executeCommand"))
    }

    @Test
    fun deliveryGateSkipsJavaScriptAfterDispose() {
        val executed = mutableListOf<String>()
        val gate = TestDeliveryGate { executed.add(it) }

        assertTrue(gate.deliver("first"))
        gate.dispose()
        assertFalse(gate.deliver("second"))
        assertEquals(listOf("first"), executed)
    }

    @Test
    fun readyDeliverySendsContextAfterReadyMessagesWhenSupplierReturnsSnapshot() {
        val sent = mutableListOf<String>()
        val logs = mutableListOf<String>()
        val snapshot = ActiveEditorContext.snapshot(
            displayPath = "src/App.kt",
            workspaceRelativePath = "src/App.kt",
            languageId = "kotlin",
            selectionStartLine = 1,
            selectionStartCharacter = 2,
            selectionEndLine = 1,
            selectionEndCharacter = 6,
            selectionText = "safe text",
        )

        JetBrainsReadyMessageDelivery.deliver(
            settings = RuntimeSettings("http://127.0.0.1:8001", null, "session-token"),
            requestId = "ready-1",
            send = { sent.add(it) },
            contextSupplier = { snapshot },
            logContextStatus = { logs.add(it) },
        )

        assertEquals(listOf("host.ready", "host.openedFromCommand", "host.contextSnapshot"), sent.map(::messageType))
        assertContains(sent[0], "\"sessionToken\":\"session-token\"")
        assertContains(sent[2], "\"source\":\"jetbrains\"")
        assertContains(sent[2], "safe text")
        assertEquals(emptyList(), logs)
    }

    @Test
    fun readyDeliverySkipsContextWhenSupplierReturnsNull() {
        val sent = mutableListOf<String>()

        JetBrainsReadyMessageDelivery.deliver(
            settings = RuntimeSettings("http://127.0.0.1:8001", null, null),
            requestId = "ready-2",
            send = { sent.add(it) },
            contextSupplier = { null },
            logContextStatus = {},
        )

        assertEquals(listOf("host.ready", "host.openedFromCommand"), sent.map(::messageType))
    }

    @Test
    fun readyDeliveryKeepsReadyMessagesWhenSupplierThrowsAndLogsNoRawContext() {
        val sent = mutableListOf<String>()
        val logs = mutableListOf<String>()

        JetBrainsReadyMessageDelivery.deliver(
            settings = RuntimeSettings("http://127.0.0.1:8001", null, null),
            requestId = "ready-3",
            send = { sent.add(it) },
            contextSupplier = { throw IllegalStateException("raw-selected-text /Users/person/private/File.kt") },
            logContextStatus = { logs.add(it) },
        )

        assertEquals(listOf("host.ready", "host.openedFromCommand"), sent.map(::messageType))
        assertEquals(listOf("Yet AI active editor context collection failed"), logs)
        assertFalse(logs.joinToString("\n").contains("raw-selected-text"))
        assertFalse(logs.joinToString("\n").contains("/Users/person/private/File.kt"))
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
    fun wrapperScriptDeliveryQueuesBeforeWrapperHelpersExist() {
        val delivery = WrapperScriptDelivery()
        val hostScript = delivery.hostMessage("{\"version\":\"2026-05-15\",\"type\":\"host.ready\",\"payload\":{}}")
        val diagnosticScript = delivery.diagnostic("runtime failed")

        assertContains(hostScript, "if (typeof window.__yetAiSendHostMessageToFrame === \"function\")")
        assertContains(hostScript, "window.__yetAiSendHostMessageToFrame(message);")
        assertContains(hostScript, "window.__yetAiPendingHostMessages = Array.isArray(window.__yetAiPendingHostMessages) ? window.__yetAiPendingHostMessages : []")
        assertContains(hostScript, "window.__yetAiPendingHostMessages.push(message)")
        assertFalse(hostScript.contains("window.postMessage"))
        assertContains(diagnosticScript, "if (typeof window.__yetAiSetRuntimeDiagnostic === \"function\")")
        assertContains(diagnosticScript, "window.__yetAiSetRuntimeDiagnostic(message);")
        assertContains(diagnosticScript, "window.__yetAiPendingDiagnostics = Array.isArray(window.__yetAiPendingDiagnostics) ? window.__yetAiPendingDiagnostics : []")
        assertContains(diagnosticScript, "window.__yetAiPendingDiagnostics.push(message)")
        assertContains(diagnosticScript, "runtime failed")
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

private fun messageType(message: String): String = JsonParser.parseString(message).asJsonObject.get("type").asString

private class TestDeliveryGate(private val execute: (String) -> Unit) {
    private var disposed = false

    fun deliver(script: String): Boolean {
        if (disposed) return false
        execute(script)
        return true
    }

    fun dispose() {
        disposed = true
    }
}
