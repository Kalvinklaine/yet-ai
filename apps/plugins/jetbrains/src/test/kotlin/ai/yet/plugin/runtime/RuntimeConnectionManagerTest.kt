package ai.yet.plugin.runtime

import ai.yet.plugin.logging.YetLogSink
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
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
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
    fun launchCommandPassesEngineLogDirectoryAndDefaultLevel() {
        val command = buildEngineLaunchCommand(
            runtimeUrl = "http://127.0.0.1:8123",
            binaryPath = Path.of("/tmp/yet-lsp"),
            sessionToken = "session-secret",
            baseEnvironment = mapOf("PATH" to "/bin"),
            logDirectory = Path.of("/tmp/yet-logs"),
        )

        assertEquals("/tmp/yet-logs", command.environment["YET_AI_LOG_DIR"])
        assertEquals("info", command.environment["YET_AI_LOG_LEVEL"])
    }

    @Test
    fun launchCommandPreservesExplicitEngineLogLevelOverride() {
        val command = buildEngineLaunchCommand(
            runtimeUrl = "http://127.0.0.1:8123",
            binaryPath = Path.of("/tmp/yet-lsp"),
            sessionToken = "session-secret",
            baseEnvironment = mapOf("YET_AI_LOG_LEVEL" to "debug"),
            logDirectory = Path.of("/tmp/yet-logs"),
        )

        assertEquals("debug", command.environment["YET_AI_LOG_LEVEL"])
    }

    @Test
    fun expectedEngineLogPathUsesRuntimePort() {
        assertEquals(Path.of("/tmp/yet-logs/engine-8123.log"), expectedEngineLogPath(Path.of("/tmp/yet-logs"), parseExplicitRuntimePort("http://127.0.0.1:8123")))
    }

    @Test
    fun launchCommandFiltersSecretEnvironmentAndPreservesSafeBasics() {
        val command = buildEngineLaunchCommand(
            runtimeUrl = "http://127.0.0.1:8123",
            binaryPath = Path.of("/tmp/yet-lsp"),
            sessionToken = "session-secret",
            baseEnvironment = mapOf(
                "PATH" to "/bin:/usr/bin",
                "HOME" to "/Users/alice",
                "Path" to "C:\\Windows\\System32",
                "SystemRoot" to "C:\\Windows",
                "ComSpec" to "C:\\Windows\\System32\\cmd.exe",
                "LC_ALL" to "C.UTF-8",
                "lc_time" to "en_US.UTF-8",
                "DBUS_SESSION_BUS_ADDRESS" to "unix:path=/run/user/1000/bus",
                "XDG_RUNTIME_DIR" to "/run/user/1000",
                "LC_TOKEN" to "locale-token-secret",
                "LC_OPENAI_API_KEY" to "locale-openai-secret",
                "LC_AUTHORIZATION" to "Bearer locale-auth-secret",
                "OPENAI_API_KEY" to "sk-openai-secret",
                "OpenAi_Api_Key" to "mixed-case-openai-secret",
                "ANTHROPIC_API_KEY" to "anthropic-secret",
                "GITHUB_TOKEN" to "github-secret",
                "COOKIE" to "session=cookie-secret",
                "AUTHORIZATION" to "Bearer authorization-secret",
                "PROVIDER_API_KEY" to "provider-secret",
                "YET_AI_AUTH_TOKEN" to "inherited-token-must-not-survive",
                "YET_AI_HTTP_PORT" to "9999",
                "AWS_SECRET_ACCESS_KEY" to "aws-secret",
                "NPM_TOKEN" to "npm-secret",
            ),
        )

        assertEquals("session-secret", command.environment["YET_AI_AUTH_TOKEN"])
        assertEquals("8123", command.environment["YET_AI_HTTP_PORT"])
        assertEquals("/bin:/usr/bin", command.environment["PATH"])
        assertEquals("C:\\Windows\\System32", command.environment["Path"])
        assertEquals("/Users/alice", command.environment["HOME"])
        assertEquals("C:\\Windows", command.environment["SystemRoot"])
        assertEquals("C:\\Windows\\System32\\cmd.exe", command.environment["ComSpec"])
        assertEquals("C.UTF-8", command.environment["LC_ALL"])
        assertEquals("en_US.UTF-8", command.environment["lc_time"])
        assertEquals("unix:path=/run/user/1000/bus", command.environment["DBUS_SESSION_BUS_ADDRESS"])
        assertEquals("/run/user/1000", command.environment["XDG_RUNTIME_DIR"])
        listOf(
            "LC_TOKEN",
            "LC_OPENAI_API_KEY",
            "LC_AUTHORIZATION",
            "OPENAI_API_KEY",
            "OpenAi_Api_Key",
            "ANTHROPIC_API_KEY",
            "GITHUB_TOKEN",
            "COOKIE",
            "AUTHORIZATION",
            "PROVIDER_API_KEY",
            "AWS_SECRET_ACCESS_KEY",
            "NPM_TOKEN",
        ).forEach { key ->
            assertFalse(command.environment.containsKey(key), "launch command must not pass provider/API/auth/cookie/token env $key")
        }
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
    fun connectModeNeverResolvesBundledEngineOrLaunchesProcess() {
        val bundled = RecordingBundledProvider(Path.of("/Users/alice/Library/Caches/yet-ai/engine/cache-yet-lsp"))
        var finderCalls = 0
        var launchCalls = 0
        val settings = RuntimeSettings("http://127.0.0.1:8123", null, null, LaunchMode.CONNECT, Path.of("/tmp/not-launchable-yet-lsp"))
        val manager = RuntimeConnectionManager(
            bundledEngineProvider = bundled,
            engineBinaryFinder = { finderCalls += 1; error("connect mode must not resolve engine binaries") },
            processStarter = { launchCalls += 1; FakeProcess(listOf(true)) },
            tokenGenerator = { "fixed-session-token" },
        )

        assertEquals(settings, manager.prepareConnectionSettings(settings))
        assertEquals(0, bundled.resolveCalls)
        assertEquals(0, finderCalls)
        assertEquals(0, launchCalls)
    }

    @Test
    fun autoModeWithoutConfiguredPathLaunchesBundledEngineAndReturnsGeneratedToken() {
        val bundledPath = Path.of("/Users/alice/Library/Caches/yet-ai/engine/cache-yet-lsp")
        val launched = mutableListOf<EngineLaunchCommand>()
        val manager = RuntimeConnectionManager(
            bundledEngineProvider = RecordingBundledProvider(bundledPath),
            engineBinaryFinder = { error("bundled engine should avoid PATH lookup") },
            processStarter = { command -> launched += command; FakeProcess(listOf(true)) },
            tokenGenerator = { "generated-session-token" },
        )
        val settings = RuntimeSettings("http://127.0.0.1:8123", null, null, LaunchMode.AUTO, null)

        val prepared = manager.prepareConnectionSettings(settings)

        assertEquals("generated-session-token", prepared.sessionToken)
        val command = assertNotNull(launched.singleOrNull())
        assertEquals(bundledPath, command.binaryPath)
        assertEquals("generated-session-token", command.environment["YET_AI_AUTH_TOKEN"])
        assertEquals("8123", command.environment["YET_AI_HTTP_PORT"])
    }

    @Test
    fun pluginLaunchPersistsGeneratedTokenForGuiAndNextSettingsRead() {
        val bundledPath = Path.of("/Users/alice/Library/Caches/yet-ai/engine/cache-yet-lsp")
        val launched = mutableListOf<EngineLaunchCommand>()
        val tokenStore = RecordingRuntimeSessionTokenStore()
        val manager = RuntimeConnectionManager(
            bundledEngineProvider = RecordingBundledProvider(bundledPath),
            engineBinaryFinder = { error("bundled engine should avoid PATH lookup") },
            processStarter = { command -> launched += command; FakeProcess(listOf(true)) },
            tokenGenerator = { "generated-plugin-owned-token" },
            sessionTokenStore = tokenStore,
        )
        val settings = RuntimeSettings("http://127.0.0.1:8123", null, "stale-cached-token", LaunchMode.AUTO, null)

        val prepared = manager.prepareConnectionSettings(settings)

        assertEquals("generated-plugin-owned-token", prepared.sessionToken)
        assertEquals(listOf("generated-plugin-owned-token"), tokenStore.values)
        assertEquals("generated-plugin-owned-token", launched.single().environment["YET_AI_AUTH_TOKEN"])
        manager.dispose()
    }

    @Test
    fun autoModePrefersBundledRuntimeOverPathFallback() {
        val bundledPath = Path.of("/Users/alice/Library/Caches/yet-ai/engine/cache-yet-lsp")
        var finderCalls = 0

        val resolved = resolveEngineBinary(
            configuredPath = null,
            bundled = bundledPath,
            finder = { finderCalls += 1; Path.of("/usr/local/bin/yet-lsp") },
        )

        assertEquals(bundledPath, resolved)
        assertEquals(0, finderCalls)
    }

    @Test
    fun autoModeUsesPathOnlyAsDevPreviewFallbackAfterMissingBundledRuntime() {
        val pathFallback = Path.of("/usr/local/bin/yet-lsp")
        val resolved = resolveEngineBinary(
            configuredPath = null,
            bundled = null,
            finder = { configured ->
                assertEquals(null, configured)
                pathFallback
            },
        )
        val diagnostics = formatRuntimeDiagnostics(
            RuntimeDiagnostics("auto", "http://127.0.0.1:8123", false, "discovered yet-lsp on PATH (dev-preview fallback only)", false, null, null),
        )

        assertEquals(pathFallback, resolved)
        assertTrue(diagnostics.contains("PATH discovery as a dev-preview fallback only"), diagnostics)
        assertTrue(diagnostics.contains("dev-preview fallback only"), diagnostics)
        assertFalse(diagnostics.contains("/usr/local/bin"), diagnostics)
    }

    @Test
    fun configuredBinaryFallbackDiagnosticsAreActionableAndPathFree() {
        val diagnostics = formatRuntimeDiagnostics(
            RuntimeDiagnostics("auto", "http://127.0.0.1:8123", true, "configured absolute binary is missing or not executable", false, null, null),
        )

        assertTrue(diagnostics.contains("configured engine binary is missing or not executable"), diagnostics)
        assertTrue(diagnostics.contains("configure an absolute executable yet-lsp path"), diagnostics)
        assertTrue(diagnostics.contains("PATH discovery is dev-preview-only fallback"), diagnostics)
        assertFalse(diagnostics.contains("/Users/"), diagnostics)
    }

    @Test
    fun launchModeWithoutConfiguredPathLaunchesBundledEngine() {
        val bundledPath = Path.of("/Users/alice/Library/Caches/yet-ai/engine/cache-yet-lsp")
        val launched = mutableListOf<EngineLaunchCommand>()
        val manager = RuntimeConnectionManager(
            bundledEngineProvider = RecordingBundledProvider(bundledPath),
            engineBinaryFinder = { error("launch mode should not require PATH when bundled engine is available") },
            processStarter = { command -> launched += command; FakeProcess(listOf(true)) },
            tokenGenerator = { "launch-session-token" },
        )

        val prepared = manager.prepareConnectionSettings(RuntimeSettings("http://127.0.0.1:8124", null, null, LaunchMode.LAUNCH, null))

        assertEquals("launch-session-token", prepared.sessionToken)
        assertEquals(bundledPath, assertNotNull(launched.singleOrNull()).binaryPath)
    }

    @Test
    fun manualKillOfPluginOwnedRuntimeRelaunchesOnNextPrepareWithFreshToken() {
        val logDir = kotlin.io.path.createTempDirectory("yet-runtime-exit-log")
        val logSink = YetLogSink(directoryProvider = { logDir })
        val bundledPath = Path.of("/Users/alice/Library/Caches/yet-ai/engine/cache-yet-lsp")
        val launched = mutableListOf<EngineLaunchCommand>()
        val firstProcess = FakeManuallyKillableProcess(exitCode = 137)
        val secondProcess = FakeManuallyKillableProcess()
        val manager = RuntimeConnectionManager(
            bundledEngineProvider = RecordingBundledProvider(bundledPath),
            engineBinaryFinder = { error("bundled engine should avoid PATH lookup") },
            processStarter = { command ->
                launched += command
                if (launched.size == 1) firstProcess else secondProcess
            },
            tokenGenerator = { if (launched.isEmpty()) "first-plugin-token" else "second-plugin-token" },
            healthChecker = {},
            logSink = logSink,
        )
        val settings = RuntimeSettings("http://127.0.0.1:8125", null, null, LaunchMode.AUTO, null)

        val first = manager.prepareForTest(settings)
        firstProcess.killManually()
        val diagnosticsAfterKill = manager.runtimeDiagnosticsForTest(settings)
        val second = manager.prepareForTest(settings)
        firstProcess.killManually()

        assertEquals("first-plugin-token", first.settings.sessionToken)
        assertEquals("second-plugin-token", second.settings.sessionToken)
        assertEquals(listOf("first-plugin-token", "second-plugin-token"), launched.map { it.environment.getValue("YET_AI_AUTH_TOKEN") })
        assertTrue(diagnosticsAfterKill.contains("plugin-launched process exited with code 137"), diagnosticsAfterKill)
        assertTrue(diagnosticsAfterKill.contains("Refresh runtime"), diagnosticsAfterKill)
        assertTrue(diagnosticsAfterKill.contains("Yet AI: Restart Runtime"), diagnosticsAfterKill)
        assertFalse(diagnosticsAfterKill.contains("first-plugin-token"), diagnosticsAfterKill)
        assertFalse(diagnosticsAfterKill.contains("Authorization"), diagnosticsAfterKill)
        assertFalse(diagnosticsAfterKill.contains("/Users/alice"), diagnosticsAfterKill)
        val exitLogText = java.nio.file.Files.readString(logSink.logPath())
        assertContains(exitLogText, "runtime.exit")
        assertContains(exitLogText, "code=137")
        listOf("first-plugin-token", "second-plugin-token", "/Users/alice", "Authorization", "Bearer").forEach { privateValue ->
            assertFalse(exitLogText.contains(privateValue, ignoreCase = true), exitLogText)
        }
        manager.dispose()
    }

    @Test
    fun prepareClassifiesRunningPluginProcessThatNeverAnswersPing() {
        val manager = RuntimeConnectionManager(
            bundledEngineProvider = RecordingBundledProvider(Path.of("/Users/alice/Library/Caches/yet-ai/engine/cache-yet-lsp")),
            engineBinaryFinder = { error("bundled engine should avoid PATH lookup") },
            processStarter = { FakeAliveProcess() },
            tokenGenerator = { "nonresponsive-session-token-that-must-not-leak-1234567890" },
            healthChecker = { settings ->
                throw RuntimeHealthCheckException("Yet AI local runtime health check failed at /v1/ping: timed out Authorization: Bearer ${settings.sessionToken} /Users/alice/private/yet-lsp")
            },
        )

        val result = manager.prepareForTest(RuntimeSettings("http://127.0.0.1:8125", null, null, LaunchMode.LAUNCH, null))
        val diagnostics = manager.runtimeDiagnosticsForTest(RuntimeSettings("http://127.0.0.1:8125", null, null, LaunchMode.LAUNCH, null))

        assertEquals(RuntimeLifecycle.FAILED, result.lifecycleStatus.lifecycle)
        assertEquals(RuntimeProcessState.RUNNING, result.lifecycleStatus.processState)
        assertTrue(result.lifecycleStatus.diagnosis.contains("plugin-launched runtime process is running"), result.lifecycleStatus.diagnosis)
        assertTrue(result.lifecycleStatus.nextAction.contains("Refresh runtime"), result.lifecycleStatus.nextAction)
        assertTrue(result.lifecycleStatus.nextAction.contains("Restart Runtime"), result.lifecycleStatus.nextAction)
        assertTrue(result.lifecycleStatus.nextAction.contains("loopback port"), result.lifecycleStatus.nextAction)
        assertTrue(result.lifecycleStatus.nextAction.contains("bundled binary"), result.lifecycleStatus.nextAction)
        assertTrue(diagnostics.contains("Plugin-launched process: running"), diagnostics)
        assertTrue(result.error.orEmpty().contains("did not answer authenticated /v1/ping"), result.error)
        manager.dispose()
        listOf("nonresponsive-session-token", "Authorization", "Bearer", "/Users/alice", "private/yet-lsp").forEach { privateValue ->
            assertFalse(result.error.orEmpty().contains(privateValue, ignoreCase = true), result.error)
            assertFalse(result.lifecycleStatus.toString().contains(privateValue, ignoreCase = true), result.lifecycleStatus.toString())
            assertFalse(diagnostics.contains(privateValue, ignoreCase = true), diagnostics)
        }
    }

    @Test
    fun prepareClassifiesPluginProcessThatExitsDuringHealthAsStopped() {
        val exitingProcess = FakeManuallyKillableProcess(exitCode = 42)
        val manager = RuntimeConnectionManager(
            bundledEngineProvider = RecordingBundledProvider(Path.of("/Users/alice/Library/Caches/yet-ai/engine/cache-yet-lsp")),
            engineBinaryFinder = { error("bundled engine should avoid PATH lookup") },
            processStarter = { exitingProcess },
            tokenGenerator = { "exiting-session-token-that-must-not-leak-1234567890" },
            healthChecker = {
                exitingProcess.killManually()
                throw RuntimeHealthCheckException("Yet AI local runtime health check failed at /v1/ping: connection refused Authorization: Bearer exiting-session-token-that-must-not-leak-1234567890 /Users/alice/private/yet-lsp")
            },
        )

        val result = manager.prepareForTest(RuntimeSettings("http://127.0.0.1:8125", null, null, LaunchMode.LAUNCH, null))
        val diagnostics = manager.runtimeDiagnosticsForTest(RuntimeSettings("http://127.0.0.1:8125", null, null, LaunchMode.LAUNCH, null))

        assertEquals(RuntimeLifecycle.STOPPED, result.lifecycleStatus.lifecycle)
        assertEquals(RuntimeProcessState.EXITED, result.lifecycleStatus.processState)
        assertTrue(result.lifecycleStatus.diagnosis.contains("exited unexpectedly"), result.lifecycleStatus.diagnosis)
        assertTrue(result.lifecycleStatus.nextAction.contains("Refresh runtime"), result.lifecycleStatus.nextAction)
        assertTrue(result.lifecycleStatus.nextAction.contains("Restart Runtime"), result.lifecycleStatus.nextAction)
        assertFalse(result.lifecycleStatus.diagnosis.contains("running but did not answer"), result.lifecycleStatus.diagnosis)
        assertFalse(result.error.orEmpty().contains("running but did not answer"), result.error)
        assertTrue(diagnostics.contains("Plugin-launched process: not running"), diagnostics)
        assertTrue(diagnostics.contains("plugin-launched process exited with code 42"), diagnostics)
        listOf("exiting-session-token", "Authorization", "Bearer", "/Users/alice", "private/yet-lsp").forEach { privateValue ->
            assertFalse(result.error.orEmpty().contains(privateValue, ignoreCase = true), result.error)
            assertFalse(result.lifecycleStatus.toString().contains(privateValue, ignoreCase = true), result.lifecycleStatus.toString())
            assertFalse(diagnostics.contains(privateValue, ignoreCase = true), diagnostics)
        }
    }

    @Test
    fun prepareRetriesPluginOwnedHttp401OnceWithFreshToken() {
        val logDir = kotlin.io.path.createTempDirectory("yet-runtime-401-log")
        val logSink = YetLogSink(directoryProvider = { logDir })
        val bundledPath = Path.of("/Users/alice/Library/Caches/yet-ai/engine/cache-yet-lsp")
        val launched = mutableListOf<EngineLaunchCommand>()
        var healthCalls = 0
        val tokenStore = RecordingRuntimeSessionTokenStore()
        val manager = RuntimeConnectionManager(
            bundledEngineProvider = RecordingBundledProvider(bundledPath),
            engineBinaryFinder = { error("bundled engine should avoid PATH lookup") },
            processStarter = { command -> launched += command; FakeAliveProcess() },
            tokenGenerator = { if (launched.isEmpty()) "first-plugin-token" else "second-plugin-token" },
            healthChecker = { settings ->
                healthCalls += 1
                if (healthCalls == 1) throw RuntimeHealthCheckException("Yet AI local runtime health check failed at /v1/ping: HTTP 401", 401)
                assertEquals("second-plugin-token", settings.sessionToken)
            },
            logSink = logSink,
            sessionTokenStore = tokenStore,
        )

        val result = manager.prepareForTest(RuntimeSettings("http://127.0.0.1:8125", null, "stale-initial-token", LaunchMode.LAUNCH, null))

        assertEquals("second-plugin-token", result.settings.sessionToken)
        assertEquals(null, result.error)
        assertEquals(RuntimeLifecycle.CONNECTED, result.lifecycleStatus.lifecycle)
        assertEquals("ide_host", result.lifecycleStatus.runtimeOwner)
        assertEquals("present", result.lifecycleStatus.tokenState)
        assertEquals(RuntimeProcessState.RUNNING, result.lifecycleStatus.processState)
        assertTrue(result.status.orEmpty().contains("refreshing the runtime session token"), result.status)
        assertFalse(result.lifecycleStatus.diagnosis.contains("token", ignoreCase = true), result.lifecycleStatus.diagnosis)
        assertEquals(2, healthCalls)
        assertEquals(listOf("first-plugin-token", "second-plugin-token"), tokenStore.values)
        assertEquals(listOf("first-plugin-token", "second-plugin-token"), launched.map { it.environment.getValue("YET_AI_AUTH_TOKEN") })
        val logText = java.nio.file.Files.readString(logSink.logPath())
        assertContains(logText, "runtime.401_retry")
        assertContains(logText, "phase=success")
        listOf("first-plugin-token", "second-plugin-token", "stale-initial-token", "/Users/alice", "Authorization", "Bearer").forEach { privateValue ->
            assertFalse(logText.contains(privateValue, ignoreCase = true), logText)
        }
        manager.dispose()
    }

    @Test
    fun refreshSessionTokenRestartsAlivePluginRuntimeAndPersistsFreshToken() {
        val bundledPath = Path.of("/Users/alice/Library/Caches/yet-ai/engine/cache-yet-lsp")
        val launched = mutableListOf<EngineLaunchCommand>()
        val processes = mutableListOf<FakeAliveProcess>()
        val tokenStore = RecordingRuntimeSessionTokenStore()
        val manager = RuntimeConnectionManager(
            bundledEngineProvider = RecordingBundledProvider(bundledPath),
            engineBinaryFinder = { error("bundled engine should avoid PATH lookup") },
            processStarter = { command -> launched += command; FakeAliveProcess().also { processes += it } },
            tokenGenerator = { if (launched.isEmpty()) "old-plugin-token" else "fresh-plugin-token" },
            healthChecker = {},
            sessionTokenStore = tokenStore,
        )
        val settings = RuntimeSettings("http://127.0.0.1:8125", null, "stale-browser-token", LaunchMode.LAUNCH, null)

        val oldConnection = manager.prepareConnectionSettings(settings)
        val freshConnection = manager.prepareConnectionSettings(settings, refreshSessionToken = true)

        assertEquals("old-plugin-token", oldConnection.sessionToken)
        assertEquals("fresh-plugin-token", freshConnection.sessionToken)
        assertEquals(listOf("old-plugin-token", "fresh-plugin-token"), tokenStore.values)
        assertEquals(listOf("old-plugin-token", "fresh-plugin-token"), launched.map { it.environment.getValue("YET_AI_AUTH_TOKEN") })
        assertEquals(2, processes.size)
        assertFalse(processes.first().isAlive)
        assertTrue(processes.last().isAlive)
        manager.dispose()
    }

    @Test
    fun prepareDoesNotRestartConnectModeOnHttp401AndSurfacesGuidance() {
        var launchCalls = 0
        val manager = RuntimeConnectionManager(
            bundledEngineProvider = RecordingBundledProvider(Path.of("/Users/alice/Library/Caches/yet-ai/engine/cache-yet-lsp")),
            engineBinaryFinder = { error("connect mode must not resolve engine binaries") },
            processStarter = { launchCalls += 1; FakeProcess(listOf(true)) },
            tokenGenerator = { "unused-generated-token" },
            healthChecker = { throw RuntimeHealthCheckException("Yet AI local runtime health check failed at /v1/ping: HTTP 401 with token=connect-secret-token", 401) },
        )

        val result = manager.prepareForTest(RuntimeSettings("http://127.0.0.1:8126", null, "connect-secret-token", LaunchMode.CONNECT, null))
        val diagnostics = manager.runtimeDiagnosticsForTest(RuntimeSettings("http://127.0.0.1:8126", null, "connect-secret-token", LaunchMode.CONNECT, null))

        assertEquals(0, launchCalls)
        assertEquals("connect-secret-token", result.settings.sessionToken)
        assertTrue(result.error.orEmpty().contains("HTTP 401"), result.error)
        assertEquals(RuntimeLifecycle.AUTH_MISMATCH, result.lifecycleStatus.lifecycle)
        assertEquals("mismatch", result.lifecycleStatus.tokenState)
        assertEquals("external", result.lifecycleStatus.runtimeOwner)
        assertContains(result.lifecycleStatus.diagnosis, "session token")
        assertFalse(result.error.orEmpty().contains("connect-secret-token"), result.error)
        assertTrue(diagnostics.contains("HTTP 401 token mismatch"), diagnostics)
        assertTrue(diagnostics.contains("make the IDE debug/session token match the external runtime"), diagnostics)
        assertTrue(diagnostics.contains("this is not a provider API key"), diagnostics)
        assertFalse(diagnostics.contains("connect-secret-token"), diagnostics)
    }

    @Test
    fun connectModeDiagnosticsReportExternalEngineLogUnavailable() {
        val logDir = kotlin.io.path.createTempDirectory("yet-runtime-connect-log")
        val logSink = YetLogSink(directoryProvider = { logDir })
        val manager = RuntimeConnectionManager(
            bundledEngineProvider = RecordingBundledProvider(Path.of("/Users/alice/Library/Caches/yet-ai/engine/cache-yet-lsp")),
            engineBinaryFinder = { error("connect mode must not resolve engine binaries") },
            processStarter = { error("connect mode must not launch") },
            tokenGenerator = { "unused-token" },
            healthChecker = { throw RuntimeHealthCheckException("Yet AI local runtime health check failed at /v1/ping: connection refused") },
            logSink = logSink,
        )

        manager.prepareForTest(RuntimeSettings("http://127.0.0.1:8126", null, null, LaunchMode.CONNECT, null))
        val diagnostics = manager.runtimeDiagnosticsForTest(RuntimeSettings("http://127.0.0.1:8126", null, null, LaunchMode.CONNECT, null))

        assertContains(diagnostics, "Runtime owner: external")
        assertContains(diagnostics, "Engine log path: unavailable")
        assertContains(diagnostics, "Engine log tail: unavailable")
        assertFalse(diagnostics.contains("engine-8126.log"), diagnostics)
    }

    @Test
    fun pluginLaunchedRuntimeDiagnosticsIncludeExpectedEngineLogPathAndTail() {
        val logDir = kotlin.io.path.createTempDirectory("yet-runtime-plugin-engine-log")
        val logSink = YetLogSink(directoryProvider = { logDir })
        val engineLogPath = expectedEngineLogPath(logDir, 8128)
        java.nio.file.Files.writeString(engineLogPath, "engine started\nengine ready\n")
        val manager = RuntimeConnectionManager(
            bundledEngineProvider = RecordingBundledProvider(Path.of("/Users/alice/Library/Caches/yet-ai/engine/cache-yet-lsp")),
            engineBinaryFinder = { error("bundled engine should avoid PATH lookup") },
            processStarter = { FakeAliveProcess() },
            tokenGenerator = { "plugin-engine-log-token" },
            healthChecker = {},
            logSink = logSink,
        )

        manager.prepareForTest(RuntimeSettings("http://127.0.0.1:8128", null, null, LaunchMode.LAUNCH, null))
        val diagnostics = manager.runtimeDiagnosticsForTest(RuntimeSettings("http://127.0.0.1:8128", null, null, LaunchMode.LAUNCH, null))

        assertContains(diagnostics, "Runtime owner: ide_host")
        assertContains(diagnostics, "engine-8128.log")
        assertContains(diagnostics, "Recent engine log tail:")
        assertContains(diagnostics, "engine ready")
        manager.dispose()
    }

    @Test
    fun retryFailureStopsPluginOwnedRuntimeAndSurfacesActionableRedactedGuidance() {
        val logDir = kotlin.io.path.createTempDirectory("yet-runtime-retry-log")
        val logSink = YetLogSink(directoryProvider = { logDir })
        val bundledPath = Path.of("/Users/alice/Library/Caches/yet-ai/engine/cache-yet-lsp")
        val processes = mutableListOf<FakeAliveProcess>()
        val manager = RuntimeConnectionManager(
            bundledEngineProvider = RecordingBundledProvider(bundledPath),
            engineBinaryFinder = { error("bundled engine should avoid PATH lookup") },
            processStarter = { FakeAliveProcess().also { processes += it } },
            tokenGenerator = { "retry-secret-token-${processes.size}-${"x".repeat(32)}" },
            healthChecker = { settings ->
                throw RuntimeHealthCheckException("Yet AI local runtime health check failed at /v1/ping: HTTP 401 Authorization: Bearer ${settings.sessionToken} /Users/alice/private/yet-lsp", 401)
            },
            logSink = logSink,
        )

        val result = manager.prepareForTest(RuntimeSettings("http://127.0.0.1:8127", null, "initial-secret-token", LaunchMode.LAUNCH, null))
        val error = result.error.orEmpty()

        assertEquals(2, processes.size)
        assertTrue(processes.all { !it.isAlive }, "retry failure must not leave plugin-owned yet-lsp alive")
        assertContains(error, "HTTP 401")
        assertContains(error, "Stale external yet-lsp")
        assertContains(error, "change the Runtime URL port")
        assertContains(error, "connect mode with a matching local runtime token")
        assertEquals(RuntimeLifecycle.STOPPED, result.lifecycleStatus.lifecycle)
        assertEquals(RuntimeProcessState.STOPPED, result.lifecycleStatus.processState)
        assertEquals("absent", result.lifecycleStatus.tokenState)
        assertContains(result.lifecycleStatus.diagnosis, "stopped")
        assertFalse(result.lifecycleStatus.diagnosis.contains("running", ignoreCase = true), result.lifecycleStatus.diagnosis)
        assertTrue(result.lifecycleStatus.nextAction.contains("Restart Runtime"), result.lifecycleStatus.nextAction)
        assertFalse(error.contains("retry-secret-token"), error)
        assertFalse(error.contains("Authorization"), error)
        assertFalse(error.contains("/Users/alice"), error)
        val retryLogText = java.nio.file.Files.readString(logSink.logPath())
        assertContains(retryLogText, "runtime.401_retry")
        assertContains(retryLogText, "phase=failure")
        listOf("retry-secret-token", "initial-secret-token", "/Users/alice", "Authorization", "Bearer").forEach { privateValue ->
            assertFalse(retryLogText.contains(privateValue, ignoreCase = true), retryLogText)
        }
    }

    @Test
    fun lifecycleTextPreservesRuntimeTokenAndProviderApiKeyWordingWithoutValues() {
        val status = runtimeLifecycleStatus(
            RuntimeSettings("http://127.0.0.1:8127", null, "runtime-secret-token-value-1234567890", LaunchMode.CONNECT, null),
            LaunchMode.CONNECT,
            RuntimeLifecycle.AUTH_MISMATCH,
            RuntimeProcessState.FAILED,
            "runtime session token mismatch; provider API key is unrelated: sk-provider-secret-1234567890 Authorization: Bearer runtime-secret-token-value-1234567890 /Users/alice/private/yet-lsp",
            "Make the runtime session token match; do not paste a provider API key here.",
        )

        assertContains(status.diagnosis, "runtime session token mismatch")
        assertContains(status.diagnosis, "provider API key is unrelated")
        assertContains(status.nextAction, "runtime session token")
        assertContains(status.nextAction, "provider API key")
        listOf("runtime-secret-token-value", "sk-provider-secret", "Authorization", "Bearer", "/Users/alice").forEach { privateValue ->
            assertFalse(status.toString().contains(privateValue, ignoreCase = true), status.toString())
        }
    }

    @Test
    fun autoModeWithoutConfiguredBundledOrPathFallsBackToConnectOnly() {
        var launchCalls = 0
        val manager = RuntimeConnectionManager(
            bundledEngineProvider = RecordingBundledProvider(null),
            engineBinaryFinder = { configured -> assertEquals(null, configured); null },
            processStarter = { launchCalls += 1; FakeProcess(listOf(true)) },
            tokenGenerator = { "unused-token" },
        )
        val settings = RuntimeSettings("http://127.0.0.1:8123", null, null, LaunchMode.AUTO, null)

        assertEquals(settings, manager.prepareConnectionSettings(settings))
        assertEquals(0, launchCalls)
    }

    @Test
    fun autoModeSurfacesBundledExtractionFailureInsteadOfFallingBackToPathOrConnect() {
        var finderCalls = 0
        var launchCalls = 0
        val privatePath = "/Users/alice/Library/Application Support/yet-ai/engine/abcdef-yet-lsp"
        val token = "generated-session-token-that-must-not-leak-1234567890"
        val manager = RuntimeConnectionManager(
            bundledEngineProvider = ThrowingBundledProvider("extract failed at $privatePath with token=$token"),
            engineBinaryFinder = { finderCalls += 1; Path.of("/tmp/path-yet-lsp") },
            processStarter = { launchCalls += 1; FakeProcess(listOf(true)) },
            tokenGenerator = { token },
        )

        val error = assertFailsWith<IllegalStateException> {
            manager.prepareConnectionSettings(RuntimeSettings("http://127.0.0.1:8123", null, null, LaunchMode.AUTO, null))
        }

        val message = error.message.orEmpty()
        assertTrue(message.contains("Bundled Yet AI engine extraction failed"), message)
        listOf(privatePath, "alice", "Application Support", token).forEach { privateValue ->
            assertFalse(message.contains(privateValue), message)
        }
        assertTrue(message.contains("[redacted"), message)
        assertEquals(0, finderCalls)
        assertEquals(0, launchCalls)
    }

    @Test
    fun launchModeSurfacesBundledExtractionFailureInsteadOfFallingBackToPath() {
        var finderCalls = 0
        val manager = RuntimeConnectionManager(
            bundledEngineProvider = ThrowingBundledProvider("cache write failed at /Users/alice/Library/Application Support/yet-ai/engine/abcdef-yet-lsp"),
            engineBinaryFinder = { finderCalls += 1; Path.of("/tmp/path-yet-lsp") },
            processStarter = { FakeProcess(listOf(true)) },
            tokenGenerator = { "unused-token" },
        )

        val error = assertFailsWith<IllegalStateException> {
            manager.prepareConnectionSettings(RuntimeSettings("http://127.0.0.1:8123", null, null, LaunchMode.LAUNCH, null))
        }

        val message = error.message.orEmpty()
        assertTrue(message.contains("Bundled Yet AI engine extraction failed"), message)
        assertFalse(message.contains("/Users/alice"), message)
        assertEquals(0, finderCalls)
    }

    @Test
    fun launchUsesBinaryPathAsExecutableWithoutLspStdioArgument() {
        val commands = mutableListOf<List<String>>()
        val command = buildEngineLaunchCommand(
            runtimeUrl = "http://127.0.0.1:8123",
            binaryPath = Path.of("/tmp/yet-lsp"),
            sessionToken = "session-secret",
            baseEnvironment = emptyMap(),
        )
        val process = ProcessBuilder(command.binaryPath.toString())
        commands += process.command()

        assertEquals(listOf("/tmp/yet-lsp"), commands.single())
        assertFalse(commands.single().contains("--lsp-stdio"))
    }

    @Test
    fun launchFailureSanitizesTokenAndBundledCachePath() {
        val bundledPath = Path.of("/Users/alice/Library/Caches/yet-ai/engine/cache-yet-lsp")
        val manager = RuntimeConnectionManager(
            bundledEngineProvider = RecordingBundledProvider(bundledPath),
            engineBinaryFinder = { error("bundled engine should avoid PATH lookup") },
            processStarter = { error("spawn failed for $bundledPath with token=fixed-session-token") },
            tokenGenerator = { "fixed-session-token" },
        )

        val error = assertFailsWith<IllegalStateException> {
            manager.prepareConnectionSettings(RuntimeSettings("http://127.0.0.1:8123", null, null, LaunchMode.AUTO, null))
        }

        val message = error.message.orEmpty()
        listOf("fixed-session-token", "alice", "Library/Caches", bundledPath.toString()).forEach { privateValue ->
            assertFalse(message.contains(privateValue), message)
        }
        assertTrue(message.contains("[redacted"), message)
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
        assertTrue(diagnostics.contains("Auto mode prefers the bundled runtime"), diagnostics)
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
            RuntimeDiagnostics("auto", "http://127.0.0.1:8123", false, "no bundled, configured, or PATH binary; connect-only fallback", false, null, null),
        )

        assertTrue(connect.contains("Connect mode expects an already running loopback Yet AI runtime"), connect)
        assertTrue(connect.contains("Last health: HTTP 401"), connect)
        assertTrue(launch.contains("Launch mode uses the bundled runtime"), launch)
        assertTrue(launch.contains("configured binary is not executable"), launch)
        assertTrue(auto.contains("Auto mode prefers the bundled runtime"), auto)
        assertTrue(auto.contains("connect-only fallback"), auto)
    }

    @Test
    fun diagnosticsFor401MentionTokenMismatchWithoutTokenValue() {
        val token = "runtime-session-token-that-must-not-leak-1234567890"
        val diagnostics = formatRuntimeDiagnostics(
            RuntimeDiagnostics(
                "connect",
                "http://127.0.0.1:8123",
                false,
                "not used in connect mode",
                false,
                "HTTP 401 from /v1/ping with Bearer $token",
                "Yet AI local runtime connection failed: HTTP 401 token=$token",
            ),
        )

        assertTrue(diagnostics.contains("HTTP 401 token mismatch"), diagnostics)
        assertTrue(diagnostics.contains("session token"), diagnostics)
        assertTrue(diagnostics.contains("not a provider API key"), diagnostics)
        assertFalse(diagnostics.contains(token), diagnostics)
    }

    @Test
    fun diagnosticsForMissingBinaryMentionAutoLaunchNextAction() {
        val diagnostics = formatRuntimeDiagnostics(
            RuntimeDiagnostics("auto", "http://127.0.0.1:8123", false, "no bundled, configured, or PATH binary; connect-only fallback", false, null, null),
        )

        assertTrue(diagnostics.contains("no launchable bundled, configured, or PATH engine binary was found"), diagnostics)
        assertTrue(diagnostics.contains("Keep Launch mode auto/launch"), diagnostics)
        assertTrue(diagnostics.contains("leave Engine binary path empty when the bundled runtime is available"), diagnostics)
    }

    @Test
    fun diagnosticsForInvalidLaunchUrlMentionExplicitHttpNonzeroPort() {
        val diagnostics = formatRuntimeDiagnostics(
            RuntimeDiagnostics(
                "launch",
                "https://127.0.0.1",
                false,
                "bundled plugin binary available",
                false,
                null,
                "Yet AI launch mode requires runtime URL with an explicit nonzero port such as http://127.0.0.1:8001",
            ),
        )

        assertTrue(diagnostics.contains("launch URL is invalid"), diagnostics)
        assertTrue(diagnostics.contains("http loopback URL with an explicit nonzero port"), diagnostics)
        assertTrue(diagnostics.contains("https is not supported"), diagnostics)
    }

    @Test
    fun diagnosticsForPingFailureMentionRefreshRestartStatusNextActions() {
        val diagnostics = formatRuntimeDiagnostics(
            RuntimeDiagnostics(
                "auto",
                "http://127.0.0.1:8123",
                false,
                "bundled plugin binary available",
                true,
                null,
                "Yet AI local runtime health check failed at /v1/ping: connection refused",
                process = "process exited with code 1",
            ),
        )

        assertTrue(diagnostics.contains("/v1/ping"), diagnostics)
        assertTrue(diagnostics.contains("Click Refresh runtime"), diagnostics)
        assertTrue(diagnostics.contains("Yet AI: Restart Runtime"), diagnostics)
        assertTrue(diagnostics.contains("Yet AI: Show Runtime Status"), diagnostics)
    }

    @Test
    fun lifecycleStatusClassifiesConnectedAuthInvalidPortConflictAndPingFailure() {
        val connected = runtimeLifecycleStatusFromDiagnostics(
            RuntimeDiagnostics("launch", "http://127.0.0.1:8123", false, "bundled plugin runtime binary available", true, "/v1/ping returned 2xx", null),
        )
        val authMismatch = runtimeLifecycleStatusFromDiagnostics(
            RuntimeDiagnostics("connect", "http://127.0.0.1:8123", false, "not used in connect mode", false, "HTTP 401", "Yet AI local runtime connection failed: HTTP 401"),
        )
        val invalidSettings = runtimeLifecycleStatusFromDiagnostics(
            RuntimeDiagnostics("launch", "https://127.0.0.1", true, "configured absolute binary is missing or not executable", false, null, "requires runtime URL with an explicit nonzero port"),
        )
        val portConflict = runtimeLifecycleStatusFromDiagnostics(
            RuntimeDiagnostics("auto", "http://127.0.0.1:8123", false, "bundled plugin runtime binary available", true, null, "address already in use at /Users/alice/private/yet-lsp Authorization: Bearer ${"a".repeat(64)}"),
        )
        val pingFailure = runtimeLifecycleStatusFromDiagnostics(
            RuntimeDiagnostics("auto", "http://127.0.0.1:8123", false, "bundled plugin runtime binary available", true, null, "Yet AI local runtime health check failed at /v1/ping: connection refused"),
        )

        assertEquals(RuntimeLifecycle.CONNECTED, connected.lifecycle)
        assertEquals(RuntimeLifecycle.AUTH_MISMATCH, authMismatch.lifecycle)
        assertEquals(RuntimeLifecycle.INVALID_SETTINGS, invalidSettings.lifecycle)
        assertEquals(RuntimeLifecycle.FAILED, portConflict.lifecycle)
        assertEquals(RuntimeLifecycle.FAILED, pingFailure.lifecycle)
        listOf(connected, authMismatch, invalidSettings, portConflict, pingFailure).forEach { status ->
            val combined = status.diagnosis + status.nextAction
            assertFalse(combined.contains("/Users/alice"), combined)
            assertFalse(combined.contains("Authorization"), combined)
            assertFalse(combined.contains("Bearer"), combined)
            if (status == authMismatch) return@forEach
            assertFalse(combined.contains("token", ignoreCase = true), combined)
            assertFalse(combined.contains("api key", ignoreCase = true) && !combined.contains("not a provider API key", ignoreCase = true), combined)
        }
    }

    @Test
    fun lifecyclePayloadDoesNotExposeRawConfiguredPathAuthCookieProviderKeyOrSessionToken() {
        val secret = "runtime-session-token-that-must-not-leak-1234567890"
        val status = runtimeLifecycleStatus(
            RuntimeSettings("http://127.0.0.1:8123", null, secret, LaunchMode.LAUNCH, Path.of("/Users/alice/private/yet-lsp")),
            LaunchMode.LAUNCH,
            RuntimeLifecycle.FAILED,
            RuntimeProcessState.FAILED,
            "Authorization: Bearer $secret Cookie: sid=secret provider API key at /Users/alice/private/yet-lsp",
            "Restart runtime without token $secret or private path /Users/alice/private/yet-lsp",
        )
        val combined = status.toString()

        listOf(secret, "Authorization", "Bearer", "Cookie", "provider API key", "/Users/alice", "alice", "private/yet-lsp", "private path").forEach { privateValue ->
            assertFalse(combined.contains(privateValue, ignoreCase = true), combined)
        }
    }

    @Test
    fun diagnosticsDescribeModeGuidanceAndBinaryStatus() {
        val diagnostics = formatRuntimeDiagnostics(
            RuntimeDiagnostics(
                launchMode = "launch",
                runtimeUrl = "http://127.0.0.1:8123",
                engineBinaryConfigured = true,
                binaryStatus = "configured absolute binary is executable",
                launchedByPlugin = true,
                health = "/v1/ping returned 2xx",
                error = null,
            ),
        )

        assertTrue(diagnostics.contains("Engine binary path configured: yes"), diagnostics)
        assertTrue(diagnostics.contains("Binary status: configured absolute binary is executable"), diagnostics)
        assertTrue(diagnostics.contains("Plugin-launched process: running"), diagnostics)
        assertTrue(diagnostics.contains("Last health: /v1/ping returned 2xx"), diagnostics)
        assertTrue(diagnostics.contains("Launch mode uses the bundled runtime"), diagnostics)
        assertTrue(diagnostics.contains("Restart:"), diagnostics)
    }

    @Test
    fun engineBinaryStatusDistinguishesBundledConfiguredPathAndMissing() {
        val launchBundled = RuntimeSettings("http://127.0.0.1:8123", null, null, LaunchMode.LAUNCH, null)
        val autoMissing = RuntimeSettings("http://127.0.0.1:8123", null, null, LaunchMode.AUTO, null)

        assertEquals("bundled plugin runtime binary available (preferred installable path)", describeEngineBinaryStatus(launchBundled, bundledAvailability = "available"))
        assertEquals("no configured path and no bundled plugin binary available", describeEngineBinaryStatus(launchBundled, bundledAvailability = "missing"))
        assertEquals("no bundled, configured, or PATH binary; connect-only fallback", describeEngineBinaryStatus(autoMissing, bundledAvailability = "missing"))
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
    fun redactsCredentialJsonAndCredentialsJsonNamesAndPaths() {
        val cases = listOf(
            "credential.json",
            "credentials.json",
            "./credential.json",
            "../credentials.json",
            ".config/yet/credential.json",
            "..\\yet\\credentials.json",
            "/Users/Alice Smith/.config/yet/credential.json",
            "/tmp/yet/credentials.json",
            "C:\\Users\\Alice Smith\\AppData\\Roaming\\yet\\credential.json",
            "D:\\tmp\\yet\\credentials.json",
        )

        cases.forEach { marker ->
            val redacted = redactLogText("credential file $marker", "")
            assertFalse(redacted.contains(marker), redacted)
            assertFalse(redacted.contains("credential.json"), redacted)
            assertFalse(redacted.contains("credentials.json"), redacted)
            assertFalse(redacted.contains("Alice Smith"), redacted)
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

private class RecordingBundledProvider(private val path: Path?) : BundledEngineProvider {
    var resolveCalls = 0
        private set

    override fun resolveOrNull(): Path? {
        resolveCalls += 1
        return path
    }
}

private class ThrowingBundledProvider(private val message: String) : BundledEngineProvider {
    override fun resolveOrNull(): Path? {
        throw IllegalStateException(message)
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

private class RecordingRuntimeSessionTokenStore : RuntimeSessionTokenStore {
    val values = mutableListOf<String>()

    override fun set(value: String) {
        values += value
    }
}

private class FakeManuallyKillableProcess(private val exitCode: Int = 0) : Process() {
    @Volatile
    private var alive = true

    override fun getOutputStream(): OutputStream = ByteArrayOutputStream()
    override fun getInputStream(): InputStream = ByteArrayInputStream(ByteArray(0))
    override fun getErrorStream(): InputStream = ByteArrayInputStream(ByteArray(0))

    fun killManually() {
        alive = false
    }

    override fun waitFor(): Int {
        while (alive) {
            Thread.sleep(10)
        }
        return exitCode
    }

    override fun waitFor(timeout: Long, unit: TimeUnit): Boolean {
        alive = false
        return true
    }

    override fun exitValue(): Int {
        if (alive) throw IllegalThreadStateException("process is alive")
        return exitCode
    }

    override fun destroy() {
        alive = false
    }

    override fun destroyForcibly(): Process {
        alive = false
        return this
    }

    override fun isAlive(): Boolean = alive
}

private class FakeAliveProcess : Process() {
    private var alive = true

    override fun getOutputStream(): OutputStream = ByteArrayOutputStream()
    override fun getInputStream(): InputStream = ByteArrayInputStream(ByteArray(0))
    override fun getErrorStream(): InputStream = ByteArrayInputStream(ByteArray(0))

    override fun waitFor(): Int {
        while (alive) {
            Thread.sleep(25)
        }
        return 0
    }

    override fun waitFor(timeout: Long, unit: TimeUnit): Boolean {
        alive = false
        return true
    }

    override fun exitValue(): Int {
        if (alive) throw IllegalThreadStateException("process is alive")
        return 0
    }

    override fun destroy() {
        alive = false
    }

    override fun destroyForcibly(): Process {
        alive = false
        return this
    }

    override fun isAlive(): Boolean = alive
}
