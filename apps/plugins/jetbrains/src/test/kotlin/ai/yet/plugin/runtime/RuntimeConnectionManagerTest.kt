package ai.yet.plugin.runtime

import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class RuntimeConnectionManagerTest {
    @Test
    fun launchCommandPassesSessionTokenAndPort() {
        val command = buildEngineLaunchCommand(
            runtimeUrl = "http://127.0.0.1:8123",
            binaryPath = Path.of("/tmp/yet-lsp"),
            sessionToken = "session-secret",
            baseEnvironment = mapOf("PATH" to "/bin"),
        )

        assertEquals(Path.of("/tmp/yet-lsp"), command.binaryPath)
        assertEquals("session-secret", command.environment["YET_AI_AUTH_TOKEN"])
        assertEquals("8123", command.environment["YET_AI_HTTP_PORT"])
        assertEquals("/bin", command.environment["PATH"])
    }

    @Test
    fun defaultPortsFollowScheme() {
        assertEquals(80, parseRuntimePort("http://127.0.0.1"))
        assertEquals(443, parseRuntimePort("https://localhost"))
    }

    @Test
    fun launchModePolicyIsStrict() {
        assertEquals(LaunchMode.AUTO, parseLaunchMode("auto"))
        assertEquals(LaunchMode.CONNECT, parseLaunchMode("connect"))
        assertEquals(LaunchMode.LAUNCH, parseLaunchMode("launch"))
        assertFailsWith<IllegalArgumentException> { parseLaunchMode("remote") }
    }
}
