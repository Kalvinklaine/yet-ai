package ai.yet.plugin.runtime

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.nio.file.Path
import java.util.concurrent.TimeUnit
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
    fun redactsExactRuntimeSessionTokenInLogs() {
        val token = "short-runtime-token"
        val redacted = redactLogText("runtime printed short-runtime-token", token)

        assertFalse(redacted.contains(token), redacted)
        assertTrue(redacted.contains("[redacted]"))
    }

    @Test
    fun redactsExactRuntimeSessionTokenInRuntimeErrors() {
        val settings = RuntimeSettings("http://127.0.0.1:8123", null, "short-runtime-token", LaunchMode.CONNECT, null)
        val result = failedRuntimeConnection(settings, null, "Yet AI local runtime connection failed", IllegalStateException("health failed with short-runtime-token"))

        assertFalse(result.error.orEmpty().contains("short-runtime-token"), result.error)
        assertTrue(result.error.orEmpty().contains("[redacted]"))
    }

    @Test
    fun redactsBearerHeaders() {
        val redacted = redactLogText("Authorization: Bearer bearer-secret-value", "")

        assertFalse(redacted.contains("bearer-secret-value"), redacted)
        assertTrue(redacted.contains("[redacted]"))
    }

    @Test
    fun diagnosticsStripUrlSecretsAndRedactErrors() {
        val diagnostics = formatRuntimeDiagnostics(
            RuntimeDiagnostics(
                launchMode = "connect",
                runtimeUrl = sanitizeRuntimeUrlForDiagnostics("http://user:password@127.0.0.1:8123/runtime?access_token=url-secret#token-fragment"),
                engineBinaryConfigured = false,
                binaryStatus = "not used in connect mode",
                launchedByPlugin = false,
                health = null,
                error = "Authorization: Bearer runtime-secret",
            ),
        )

        assertTrue(diagnostics.contains("Launch mode: connect"), diagnostics)
        assertTrue(diagnostics.contains("Runtime URL: http://127.0.0.1:8123"), diagnostics)
        listOf("user", "password", "url-secret", "token-fragment", "runtime-secret", "Authorization").forEach { secret ->
            assertFalse(diagnostics.contains(secret), diagnostics)
        }
        assertTrue(diagnostics.contains("[redacted]"), diagnostics)
    }

    @Test
    fun diagnosticsRuntimeUrlShowsOnlyOrigin() {
        val cases = mapOf(
            "http://127.0.0.1:8123/runtime?access_token=url-secret#token-fragment" to "http://127.0.0.1:8123",
            "http://user:password@localhost:8123/private/auth.json?api_key=url-secret#refresh_token=fragment-secret" to "http://localhost:8123",
            "https://[::1]:8443/Users/alice/.codex/auth.json?token=query-secret#secret-fragment" to "https://[::1]:8443",
        )

        cases.forEach { (input, expected) ->
            val sanitized = sanitizeRuntimeUrlForDiagnostics(input)

            assertEquals(expected, sanitized)
            listOf("runtime", "user", "password", "auth.json", ".codex", "alice", "url-secret", "query-secret", "fragment-secret", "secret-fragment").forEach { privateValue ->
                assertFalse(sanitized.contains(privateValue), sanitized)
            }
        }
    }

    @Test
    fun diagnosticsRedactPrivatePathsFragmentsAndModeSpecificFailures() {
        val privatePath = "/Users/alice/Library/Application Support/yet-ai/runtime/yet-lsp"
        val diagnostics = formatRuntimeDiagnostics(
            RuntimeDiagnostics(
                launchMode = "auto",
                runtimeUrl = sanitizeRuntimeUrlForDiagnostics("http://127.0.0.1:8123/runtime?api_key=query-secret#access_token=fragment-secret"),
                engineBinaryConfigured = true,
                binaryStatus = "configured binary failed at $privatePath with OPENAI_API_KEY=provider-secret",
                launchedByPlugin = false,
                health = "HTTP 401 from /v1/ping?token=health-secret#refresh_token=fragment-refresh",
                error = "Process failed at $privatePath with Cookie: session=cookie-secret",
            ),
        )

        assertTrue(diagnostics.contains("Launch mode: auto"), diagnostics)
        assertTrue(diagnostics.contains("Auto mode launches"), diagnostics)
        listOf("alice", "Application Support", privatePath, "query-secret", "fragment-secret", "provider-secret", "health-secret", "fragment-refresh", "cookie-secret", "Cookie").forEach { secret ->
            assertFalse(diagnostics.contains(secret), diagnostics)
        }
        assertTrue(diagnostics.contains("[redacted"), diagnostics)
    }

    @Test
    fun diagnosticsGuidanceDistinguishesConnectLaunchAndAutoModes() {
        val connect = formatRuntimeDiagnostics(
            RuntimeDiagnostics("connect", "http://127.0.0.1:8123", false, "not used in connect mode", false, "HTTP 401", null),
        )
        val launch = formatRuntimeDiagnostics(
            RuntimeDiagnostics("launch", "http://127.0.0.1:8123", true, "configured binary is not executable", false, null, "spawn failed"),
        )
        val auto = formatRuntimeDiagnostics(
            RuntimeDiagnostics("auto", "http://127.0.0.1:8123", false, "no configured or discovered binary; connect-only fallback", false, null, null),
        )

        assertTrue(connect.contains("Connect mode expects an already running loopback Yet AI runtime"), connect)
        assertTrue(connect.contains("Last health: HTTP 401"), connect)
        assertTrue(launch.contains("Launch mode requires an executable"), launch)
        assertTrue(launch.contains("configured binary is not executable"), launch)
        assertTrue(auto.contains("Auto mode launches"), auto)
        assertTrue(auto.contains("connect-only fallback"), auto)
    }

    @Test
    fun diagnosticsDescribeModeGuidanceAndBinaryStatus() {
        val diagnostics = formatRuntimeDiagnostics(
            RuntimeDiagnostics(
                launchMode = "launch",
                runtimeUrl = "http://127.0.0.1:8123",
                engineBinaryConfigured = true,
                binaryStatus = "configured binary is executable",
                launchedByPlugin = true,
                health = "/v1/ping returned 2xx",
                error = null,
            ),
        )

        assertTrue(diagnostics.contains("Engine binary path configured: yes"), diagnostics)
        assertTrue(diagnostics.contains("Binary status: configured binary is executable"), diagnostics)
        assertTrue(diagnostics.contains("Plugin-launched process: running"), diagnostics)
        assertTrue(diagnostics.contains("Last health: /v1/ping returned 2xx"), diagnostics)
        assertTrue(diagnostics.contains("Launch mode requires an executable"), diagnostics)
        assertTrue(diagnostics.contains("Restart:"), diagnostics)
    }

    @Test
    fun engineBinaryStatusSkipsBinaryInConnectMode() {
        val settings = RuntimeSettings("http://127.0.0.1:8123", null, null, LaunchMode.CONNECT, Path.of("/missing/not-used"))

        assertEquals("not used in connect mode", describeEngineBinaryStatus(settings))
    }

    @Test
    fun redactsEnvStyleApiKeysAndTokens() {
        val cases = mapOf(
            "OPENAI_API_KEY=sk-test-openai-secret" to "sk-test-openai-secret",
            "ANTHROPIC_API_KEY=anthropic-secret-value" to "anthropic-secret-value",
            "GITHUB_TOKEN=github-secret-value" to "github-secret-value",
            "YET_AI_AUTH_TOKEN=yet-secret-value" to "yet-secret-value",
            "OAUTH_REFRESH_TOKEN=refresh-secret-value" to "refresh-secret-value",
            "PROVIDER_CLIENT_SECRET=client-secret-value" to "client-secret-value",
        )

        cases.forEach { (input, secret) ->
            val redacted = redactLogText(input, "")
            assertFalse(redacted.contains(secret), redacted)
            assertTrue(redacted.contains("[redacted]"), redacted)
        }
    }

    @Test
    fun redactsUrlQuerySecretParameters() {
        val cases = mapOf(
            "https://example.invalid/callback?api_key=short-secret" to "short-secret",
            "https://example.invalid/callback?ok=1&access_token=access-secret" to "access-secret",
            "https://example.invalid/callback?refresh_token=refresh-secret" to "refresh-secret",
            "https://example.invalid/callback;code_verifier=verifier-secret" to "verifier-secret",
            "https://example.invalid/callback?Api_Key=mixed-secret" to "mixed-secret",
        )

        cases.forEach { (input, secret) ->
            val redacted = redactLogText(input, "")
            assertFalse(redacted.contains(secret), redacted)
            assertTrue(redacted.contains("[redacted]"), redacted)
        }
    }

    @Test
    fun redactsJsonSecretFields() {
        val redacted = redactLogText("""{"access_token":"json-access","clientSecret":"json-client","api_key":"json-api"}""", "")

        listOf("json-access", "json-client", "json-api").forEach { secret ->
            assertFalse(redacted.contains(secret), redacted)
        }
        assertTrue(redacted.contains("[redacted]"))
    }

    @Test
    fun redactsCookieAndSetCookieHeaders() {
        val redacted = redactLogText("Cookie: session=session-secret; refresh=refresh-secret\nSet-Cookie: auth=auth-secret; Path=/; HttpOnly", "")

        listOf("session-secret", "refresh-secret", "auth-secret", "HttpOnly").forEach { secret ->
            assertFalse(redacted.contains(secret), redacted)
        }
        assertTrue(redacted.contains("[redacted]"))
    }

    @Test
    fun redactsCookieLikeKeyValueLines() {
        val cases = listOf(
            "cookie=session=secret; refresh=also-secret",
            "cookie: session=secret; refresh=also-secret",
            "set_cookie=sid=secret; refresh=also-secret",
            "set_cookie: sid=secret; refresh=also-secret",
            "set-cookie=sid=secret; Path=/; HttpOnly; refresh=also-secret",
            "set-cookie: sid=secret; Path=/; HttpOnly",
            "setCookie=sid=secret; refresh=also-secret",
            "setCookie: sid=secret; refresh=also-secret",
            "Cookie=session=secret; Refresh=also-secret",
            "SetCookie: sid=secret; Path=/; HttpOnly",
        )

        cases.forEach { input ->
            val redacted = redactLogText(input, "")
            assertTrue(redacted.contains("[redacted]"), redacted)
            listOf("session=secret", "refresh=also-secret", "sid=secret", "Path=/", "HttpOnly", "Refresh=also-secret").forEach { secret ->
                assertFalse(redacted.contains(secret), redacted)
            }
        }
    }

    @Test
    fun redactsJwtAndLongOpaqueTokens() {
        val jwt = "aaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbb.cccccccccccccccc"
        val opaque = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
        val redacted = redactLogText("jwt $jwt opaque $opaque", "")

        assertFalse(redacted.contains(jwt), redacted)
        assertFalse(redacted.contains(opaque), redacted)
        assertTrue(redacted.contains("[redacted]"))
    }

    @Test
    fun redactsFullCredentialFilePaths() {
        val unixPath = "/Users/alice/.codex/auth.json"
        val windowsPath = "C:\\Users\\Alice\\.codex\\auth.json"
        val redacted = redactLogText("files $unixPath and $windowsPath", "")

        listOf(unixPath, windowsPath, "alice", "Alice", ".codex", "auth.json").forEach { secret ->
            assertFalse(redacted.contains(secret), redacted)
        }
        assertTrue(redacted.contains("[redacted]"))
    }

    @Test
    fun redactsCredentialFilePathsWithSpaces() {
        val cases = listOf(
            "/Users/Alice Smith/.codex/auth.json",
            "C:\\Users\\Alice Smith\\.codex\\auth.json",
            "/Users/Alice Smith/auth.json",
            "C:\\Users\\Alice Smith\\auth.json",
        )

        cases.forEach { path ->
            val redacted = redactLogText("credential path $path", "")
            listOf("Alice Smith", ".codex", "auth.json").forEach { secret ->
                assertFalse(redacted.contains(secret), redacted)
            }
            assertTrue(redacted.contains("[redacted]"), redacted)
        }
    }

    @Test
    fun redactsBareAndRelativeCredentialMarkers() {
        val cases = listOf(
            "auth.json",
            ".codex/auth.json",
            ".codex\\auth.json",
            "./.codex/auth.json",
            "../.codex/auth.json",
        )

        cases.forEach { marker ->
            val redacted = redactLogText("credential file $marker", "")
            assertFalse(redacted.contains(marker), redacted)
            assertFalse(redacted.contains(".codex"), redacted)
            assertFalse(redacted.contains("auth.json"), redacted)
            assertTrue(redacted.contains("[redacted]"), redacted)
        }
    }

    @Test
    fun truncatesVeryLongSanitizedLogs() {
        val redacted = redactLogText("message ".repeat(100), "")

        assertEquals(501, redacted.length)
        assertTrue(redacted.endsWith("…"))
    }

    @Test
    fun stopProcessDestroysAliveProcess() {
        val process = FakeProcess(destroyWaitResults = listOf(true))

        assertTrue(process.isAlive)
        assertTrue(stopProcess(process, waitMillis = 100))
        assertFalse(process.isAlive)
        assertEquals(1, process.destroyCalls)
        assertEquals(0, process.destroyForciblyCalls)
    }

    @Test
    fun stopProcessEscalatesWhenDestroyDoesNotExit() {
        val process = FakeProcess(destroyWaitResults = listOf(false, true))

        assertTrue(stopProcess(process, waitMillis = 100))
        assertFalse(process.isAlive)
        assertEquals(1, process.destroyCalls)
        assertEquals(1, process.destroyForciblyCalls)
    }
}

private class FakeProcess(private val destroyWaitResults: List<Boolean>) : Process() {
    var destroyCalls = 0
        private set
    var destroyForciblyCalls = 0
        private set
    private var alive = true
    private var waitCalls = 0

    override fun getOutputStream(): OutputStream = ByteArrayOutputStream()

    override fun getInputStream(): InputStream = ByteArrayInputStream(ByteArray(0))

    override fun getErrorStream(): InputStream = ByteArrayInputStream(ByteArray(0))

    override fun waitFor(): Int {
        alive = false
        return 0
    }

    override fun waitFor(timeout: Long, unit: TimeUnit): Boolean {
        val result = destroyWaitResults.getOrElse(waitCalls) { true }
        waitCalls += 1
        if (result) {
            alive = false
        }
        return result
    }

    override fun exitValue(): Int {
        if (alive) {
            throw IllegalThreadStateException("process is alive")
        }
        return 0
    }

    override fun destroy() {
        destroyCalls += 1
    }

    override fun destroyForcibly(): Process {
        destroyForciblyCalls += 1
        return this
    }

    override fun isAlive(): Boolean = alive
}
