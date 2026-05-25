package ai.yet.plugin.runtime

import java.nio.file.Path
import kotlin.io.path.createTempFile
import kotlin.io.path.deleteIfExists
import kotlin.io.path.setPosixFilePermissions
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

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
    fun launchCommandRequiresExplicitPort() {
        val error = assertFailsWith<IllegalArgumentException> {
            buildEngineLaunchCommand(
                runtimeUrl = "http://127.0.0.1",
                binaryPath = Path.of("/tmp/yet-lsp"),
                sessionToken = "session-secret",
                baseEnvironment = emptyMap(),
            )
        }

        assertEquals("Yet AI launch mode requires runtime URL with an explicit nonzero port such as http://127.0.0.1:8001", error.message)
    }

    @Test
    fun launchCommandRejectsZeroPort() {
        val error = assertFailsWith<IllegalArgumentException> {
            buildEngineLaunchCommand(
                runtimeUrl = "http://127.0.0.1:0",
                binaryPath = Path.of("/tmp/yet-lsp"),
                sessionToken = "session-secret",
                baseEnvironment = emptyMap(),
            )
        }

        assertEquals("Yet AI launch mode requires runtime URL with an explicit nonzero port such as http://127.0.0.1:8001", error.message)
    }

    @Test
    fun launchCommandRejectsHttpsUrl() {
        val error = assertFailsWith<IllegalArgumentException> {
            buildEngineLaunchCommand(
                runtimeUrl = "https://127.0.0.1:8123",
                binaryPath = Path.of("/tmp/yet-lsp"),
                sessionToken = "session-secret",
                baseEnvironment = emptyMap(),
            )
        }

        assertEquals("Yet AI launch mode requires runtime URL to use http", error.message)
    }

    @Test
    fun launchModePolicyIsStrict() {
        assertEquals(LaunchMode.AUTO, parseLaunchMode("auto"))
        assertEquals(LaunchMode.CONNECT, parseLaunchMode("connect"))
        assertEquals(LaunchMode.LAUNCH, parseLaunchMode("launch"))
        assertFailsWith<IllegalArgumentException> { parseLaunchMode("remote") }
    }

    @Test
    fun nonExecutableConfiguredPathIsRejectedOnUnix() {
        val file = createTempFile(prefix = "yet-lsp-not-executable")
        try {
            if (!System.getProperty("os.name").lowercase().contains("win")) {
                file.setPosixFilePermissions(emptySet())
                assertFalse(isLaunchableEngineFile(file, "Mac OS X"))
                val error = assertFailsWith<IllegalArgumentException> { findEngineBinary(file) }
                assertEquals("Yet AI engine binary path must point to an executable file", error.message)
            }
        } finally {
            file.deleteIfExists()
        }
    }

    @Test
    fun connectModeIgnoresConfiguredEnginePath() {
        val file = createTempFile(prefix = "yet-lsp-connect-not-executable")
        try {
            if (!System.getProperty("os.name").lowercase().contains("win")) {
                file.setPosixFilePermissions(emptySet())
            }
            val settings = RuntimeSettings("http://127.0.0.1:8123", null, null, LaunchMode.CONNECT, file)

            assertEquals(settings, RuntimeConnectionManager().prepareConnectionSettings(settings))
        } finally {
            file.deleteIfExists()
        }
    }

    @Test
    fun launchModeRejectsNonExecutableConfiguredPath() {
        val file = createTempFile(prefix = "yet-lsp-launch-not-executable")
        try {
            if (!System.getProperty("os.name").lowercase().contains("win")) {
                file.setPosixFilePermissions(emptySet())
                val settings = RuntimeSettings("http://127.0.0.1:8123", null, null, LaunchMode.LAUNCH, file)
                val error = assertFailsWith<IllegalArgumentException> { RuntimeConnectionManager().prepareConnectionSettings(settings) }

                assertEquals("Yet AI engine binary path must point to an executable file", error.message)
            }
        } finally {
            file.deleteIfExists()
        }
    }

    @Test
    fun failureResultPreservesConfiguredSettings() {
        val settings = RuntimeSettings("http://127.0.0.1:8123", null, "session-secret", LaunchMode.CONNECT, Path.of("/tmp/stale-yet-lsp"))
        val result = failedRuntimeConnection(settings, null, "Yet AI local runtime connection failed", IllegalStateException("Bearer session-secret failed"))

        assertEquals(settings, result.settings)
        assertEquals("Yet AI local runtime connection failed: Bearer [redacted] failed", result.error)
    }

    @Test
    fun executableConfiguredPathIsAcceptedOnUnix() {
        val file = createTempFile(prefix = "yet-lsp-executable")
        try {
            if (!System.getProperty("os.name").lowercase().contains("win")) {
                file.setPosixFilePermissions(setOf(java.nio.file.attribute.PosixFilePermission.OWNER_READ, java.nio.file.attribute.PosixFilePermission.OWNER_EXECUTE))
                assertTrue(isLaunchableEngineFile(file, "Mac OS X"))
                assertEquals(file, findEngineBinary(file))
            }
        } finally {
            file.deleteIfExists()
        }
    }

    @Test
    fun windowsExecutableSuffixesAreAccepted() {
        val file = createTempFile(prefix = "yet-lsp", suffix = ".exe")
        try {
            assertTrue(isLaunchableEngineFile(file, "Windows 11"))
        } finally {
            file.deleteIfExists()
        }
    }

    @Test
    fun stopProcessDestroysAliveProcess() {
        val process = ProcessBuilder("sh", "-c", "trap '' TERM; sleep 20").start()
        try {
            assertTrue(process.isAlive)
            assertTrue(stopProcess(process, waitMillis = 100))
            assertFalse(process.isAlive)
        } finally {
            if (process.isAlive) {
                process.destroyForcibly()
            }
        }
    }
}
