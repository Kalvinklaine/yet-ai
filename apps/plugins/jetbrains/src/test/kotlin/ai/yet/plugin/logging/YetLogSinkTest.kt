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
    fun writesAndTailsRedactCredentialFilePaths() {
        val dir = createTempDirectory("yet-log-sink-credential-paths")
        val sink = YetLogSink(directoryProvider = { dir })

        sink.append(
            "warn",
            "runtime.output",
            mapOf(
                "bare" to "credentials.json",
                "relative" to "../yet/credential.json",
                "unix" to "/Users/Alice Smith/.config/yet/credentials.json",
                "windows" to "C:\\Users\\Alice Smith\\AppData\\Roaming\\yet\\credential.json",
            ),
        )

        val text = Files.readString(sink.logPath())
        val tail = sink.tail(maxBytes = 1024)
        listOf(text, tail).forEach { output ->
            assertContains(output, "runtime.output")
            listOf("credential.json", "credentials.json", "Alice Smith", ".config/yet", "AppData").forEach { privateValue ->
                assertFalse(output.contains(privateValue, ignoreCase = true), output)
            }
        }
    }

    @Test
    fun tailAndFileStayBounded() {
        val dir = createTempDirectory("yet-log-sink-bounded")
        val sink = YetLogSink(directoryProvider = { dir }, maxBytes = 500, maxLineLength = 200)

        repeat(50) { index ->
            sink.append("info", "runtime.health", mapOf("index" to index, "payload" to "x".repeat(80)))
        }

        assertTrue(Files.size(sink.logPath()) <= 500, Files.size(sink.logPath()).toString())
        sink.append("info", "runtime.newest", mapOf("payload" to "done"))
        val tail = sink.tail(maxBytes = 120)
        assertTrue(tail.toByteArray().size <= 120, tail.toByteArray().size.toString())
        assertContains(tail, "runtime.newest")
        assertFalse(tail.contains("index=0"), tail)
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
