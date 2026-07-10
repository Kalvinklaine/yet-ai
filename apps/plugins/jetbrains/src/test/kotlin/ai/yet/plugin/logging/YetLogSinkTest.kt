package ai.yet.plugin.logging

import java.nio.file.Files
import kotlin.concurrent.thread
import kotlin.io.path.createTempDirectory
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class YetLogSinkTest {
    @Test
    fun writesSanitizedBoundedLineOrientedLog() {
        val dir = createTempDirectory("yet-log-sink")
        val sink = YetLogSink(directoryProvider = { dir })

        sink.append(
            "INFO",
            "runtime.launch",
            mapOf(
                "Authorization" to "Bearer session-token-secret-that-must-not-leak",
                "path" to "/Users/alice/private/project/file.kt",
                "apiKey" to "sk-secret-provider-key",
                "cookie" to "sid=cookie-secret",
                "oauth_code" to "oauth-code-secret",
            ),
        )

        val text = Files.readString(sink.logPath())
        assertContains(text, "runtime.launch")
        assertContains(text, "info")
        listOf("session-token-secret", "/Users/alice", "sk-secret", "cookie-secret", "oauth-code-secret", "Bearer session").forEach { secret ->
            assertFalse(text.contains(secret, ignoreCase = true), text)
        }
        assertEquals(1, text.lines().filter { it.isNotBlank() }.size)
    }

    @Test
    fun tailAndFileStayBounded() {
        val dir = createTempDirectory("yet-log-sink-bounded")
        val sink = YetLogSink(directoryProvider = { dir }, maxBytes = 500, maxLineLength = 200)

        repeat(50) { index ->
            sink.append("info", "runtime.health", mapOf("index" to index, "payload" to "x".repeat(80)))
        }

        assertTrue(Files.size(sink.logPath()) <= 500, Files.size(sink.logPath()).toString())
        val tail = sink.tail(maxBytes = 120)
        assertTrue(tail.toByteArray().size <= 500)
        assertContains(tail, "runtime.health")
    }

    @Test
    fun concurrentAppendsRemainLineOrientedAndSanitized() {
        val dir = createTempDirectory("yet-log-sink-concurrent")
        val sink = YetLogSink(directoryProvider = { dir }, maxBytes = 20 * 1024)
        val threads = (0 until 8).map { worker ->
            thread {
                repeat(20) { index ->
                    sink.append("info", "runtime.output", mapOf("worker" to worker, "index" to index, "token" to "worker-token-$worker-$index-${"x".repeat(32)}"))
                }
            }
        }

        threads.forEach { it.join() }

        val lines = Files.readString(sink.logPath()).lines().filter { it.isNotBlank() }
        assertEquals(160, lines.size)
        assertTrue(lines.all { it.contains("runtime.output") })
        assertFalse(lines.joinToString("\n").contains("worker-token"))
    }
}
