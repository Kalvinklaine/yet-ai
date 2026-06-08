package ai.yet.plugin.lsp

import java.net.URI
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class JetBrainsLspDocumentPolicyTest {
    @Test
    fun safeLocalFileAccepted() {
        val policy = JetBrainsLspDocumentPolicy()

        assertTrue(policy.open(URI("file:///tmp/main.kt"), "fun main() = println(\"hi\")"))
        assertTrue(policy.isTracked(URI("file:///tmp/main.kt")))
    }

    @Test
    fun unsupportedUriSchemesRejected() {
        val policy = JetBrainsLspDocumentPolicy()
        listOf(
            URI("https://example.com/main.kt"),
            URI("jar:file:///tmp/app.jar!/Main.kt"),
            URI("untitled:Untitled-1"),
            URI("vfs://tmp/main.kt"),
        ).forEach { uri ->
            assertFalse(policy.open(uri, "text"), uri.toString())
        }
    }

    @Test
    fun oversizedUriRejected() {
        val policy = JetBrainsLspDocumentPolicy()
        val uri = URI("file:///" + "a".repeat(600) + ".kt")

        assertFalse(policy.open(uri, "text"))
        assertFalse(policy.isTracked(uri))
    }

    @Test
    fun oversizedTextRejected() {
        val policy = JetBrainsLspDocumentPolicy()

        assertFalse(policy.open(URI("file:///tmp/big.kt"), "x".repeat(256 * 1024 + 1)))
    }

    @Test
    fun binaryControlTextRejected() {
        val policy = JetBrainsLspDocumentPolicy()

        assertFalse(policy.open(URI("file:///tmp/bin.kt"), "hello\u0000world"))
    }

    @Test
    fun documentCountBounded() {
        val policy = JetBrainsLspDocumentPolicy()
        repeat(32) {
            assertTrue(policy.open(URI("file:///tmp/$it.kt"), "text $it"))
        }
        assertFalse(policy.open(URI("file:///tmp/overflow.kt"), "text"))
    }

    @Test
    fun closeClearsTrackedState() {
        val policy = JetBrainsLspDocumentPolicy()
        val uri = URI("file:///tmp/close.kt")

        assertTrue(policy.open(uri, "text"))
        policy.close(uri)

        assertFalse(policy.isTracked(uri))
        assertNull(policy.trackedText(uri))
    }

    @Test
    fun unsafeTransitionDoesNotRetainBody() {
        val policy = JetBrainsLspDocumentPolicy()
        val uri = URI("file:///tmp/body.kt")

        assertTrue(policy.open(uri, "safe text"))
        assertFalse(policy.open(uri, "unsafe\u0000text"))
        assertFalse(policy.isTracked(uri))
        assertNull(policy.trackedText(uri))
    }

    @Test
    fun sourceHasNoProviderRuntimeSessionTokenCoupling() {
        val source = java.nio.file.Files.readString(java.nio.file.Path.of("src/main/kotlin/ai/yet/plugin/lsp/JetBrainsLspDocumentPolicy.kt"))

        listOf("provider", "runtime", "sessionToken", "token").forEach {
            assertFalse(source.contains(it), source)
        }
    }
}
