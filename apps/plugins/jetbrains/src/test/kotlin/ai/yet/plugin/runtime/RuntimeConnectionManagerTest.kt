package ai.yet.plugin.runtime

import java.nio.file.Path
import kotlin.io.path.createTempDirectory
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
    fun runtimeLogRedactionCoversCommonSecrets() {
        val exactToken = "runtime-session-token"
        val longOpaque = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
        val jwt = "aaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbb.cccccccccccccccc"
        val input = """
            token runtime-session-token
            Authorization: Bearer bearer-secret-value
            provider sk-abcdefghijklmnopqrstuvwxyz
            api_key=url-secret access_token=access-secret refresh_token=refresh-secret client_secret=client-secret session_token=session-secret cookie=cookie-secret set-cookie=set-cookie-secret code_verifier=verifier-secret pkce_verifier=pkce-secret verifier=plain-secret
            {"access_token":"json-access","refresh_token":"json-refresh","api_key":"json-api","authorization":"json-auth","client_secret":"json-client","session_token":"json-session","cookie":"json-cookie","set-cookie":"json-set-cookie","code_verifier":"json-verifier","pkce_verifier":"json-pkce","verifier":"json-plain"}
            jwt $jwt opaque $longOpaque file /Users/example/.codex/auth.json auth.json
        """.trimIndent()

        val redacted = redactLogText(input, exactToken)

        listOf(
            exactToken,
            "bearer-secret-value",
            "sk-abcdefghijklmnopqrstuvwxyz",
            "url-secret",
            "access-secret",
            "refresh-secret",
            "client-secret",
            "session-secret",
            "cookie-secret",
            "set-cookie-secret",
            "verifier-secret",
            "pkce-secret",
            "plain-secret",
            "json-access",
            "json-refresh",
            "json-api",
            "json-auth",
            "json-client",
            "json-session",
            "json-cookie",
            "json-set-cookie",
            "json-verifier",
            "json-pkce",
            "json-plain",
            jwt,
            longOpaque,
            ".codex/auth.json",
            "auth.json",
        ).forEach { secret -> assertFalse(redacted.contains(secret), "Leaked $secret in $redacted") }
        assertTrue(redacted.contains("[redacted]"))
        assertTrue(redacted.length <= 501)
    }

    @Test
    fun stopProcessDestroysAliveProcess() {
        val process = stubbornProcess() ?: return
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

    private fun stubbornProcess(): Process? {
        val os = System.getProperty("os.name").lowercase()
        return if (os.contains("win")) {
            val script = createTempDirectory(prefix = "yet-stop-process").resolve("sleep.cmd")
            java.nio.file.Files.writeString(script, "@echo off\r\nping -n 20 127.0.0.1 > nul\r\n")
            ProcessBuilder("cmd", "/c", script.toString()).start()
        } else {
            val shell = listOf("/bin/sh", "/usr/bin/sh").firstOrNull { java.nio.file.Files.isExecutable(Path.of(it)) } ?: return null
            ProcessBuilder(shell, "-c", "trap '' TERM; sleep 20").start()
        }
    }
}
