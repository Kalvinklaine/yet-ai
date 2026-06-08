package ai.yet.plugin.lsp

import java.net.URI
import kotlin.test.Test
import kotlin.test.assertFalse
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
            URI("file://host/path.kt"),
            URI("file:relative.kt"),
            URI("file:///tmp/a.kt?token=x"),
            URI("file:///tmp/a.kt#frag"),
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
    }

    @Test
    fun unsafeTransitionDoesNotRetainState() {
        val policy = JetBrainsLspDocumentPolicy()
        val uri = URI("file:///tmp/body.kt")

        assertTrue(policy.open(uri, "safe text"))
        assertFalse(policy.open(uri, "unsafe\u0000text"))
        assertFalse(policy.isTracked(uri))
    }

    @Test
    fun reopenTrackedUriAtCapacityRemainsTracked() {
        val policy = JetBrainsLspDocumentPolicy()
        repeat(32) {
            assertTrue(policy.open(URI("file:///tmp/$it.kt"), "text $it"))
        }
        val uri = URI("file:///tmp/0.kt")

        assertTrue(policy.open(uri, "updated text"))
        assertTrue(policy.isTracked(uri))
        assertFalse(policy.open(URI("file:///tmp/new-safe.kt"), "text"))
        assertTrue(policy.trackedCount == 32)
    }

    @Test
    fun unsafeTransitionDropsTrackedUriAtCapacity() {
        val policy = JetBrainsLspDocumentPolicy()
        repeat(32) {
            assertTrue(policy.open(URI("file:///tmp/$it.kt"), "text $it"))
        }
        val uri = URI("file:///tmp/0.kt")

        assertFalse(policy.open(uri, "unsafe\u0000text"))
        assertFalse(policy.isTracked(uri))
        assertTrue(policy.open(URI("file:///tmp/new-safe.kt"), "text"))
    }
}
