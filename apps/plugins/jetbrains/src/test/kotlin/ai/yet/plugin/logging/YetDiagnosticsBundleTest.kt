package ai.yet.plugin.logging

import ai.yet.plugin.runtime.LaunchMode
import ai.yet.plugin.runtime.RuntimeLifecycle
import ai.yet.plugin.runtime.RuntimeProcessState
import ai.yet.plugin.runtime.RuntimeSettings
import ai.yet.plugin.runtime.expectedEngineLogPath
import ai.yet.plugin.runtime.runtimeLifecycleStatus
import java.nio.file.Files
import kotlin.io.path.createTempDirectory
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class YetDiagnosticsBundleTest {
    @Test
    fun bundleIncludesRuntimeStateLogPathAndRecentTail() {
        val dir = createTempDirectory("yet-diagnostics")
        val sink = YetLogSink(directoryProvider = { dir })
        val engineLogPath = expectedEngineLogPath(dir, 8123)
        sink.append("info", "runtime.health", mapOf("phase" to "success"))
        Files.writeString(engineLogPath, "engine booted\nengine health ok\n")
        val lifecycle = runtimeLifecycleStatus(
            RuntimeSettings("http://127.0.0.1:8123/private?token=runtime-secret", "project-secret", "session-secret", LaunchMode.LAUNCH, null),
            LaunchMode.LAUNCH,
            RuntimeLifecycle.CONNECTED,
            RuntimeProcessState.RUNNING,
            "local runtime is reachable",
            "Continue using Yet AI.",
        )

        val bundle = YetDiagnosticsBundle(sink, pluginVersion = "test-version").build(
            YetDiagnosticsSnapshot(
                launchMode = "launch",
                runtimeUrl = "http://127.0.0.1:8123/private?token=runtime-secret",
                engineBinaryConfigured = false,
                binaryStatus = "bundled plugin runtime binary available",
                launchedByPlugin = true,
                lifecycleStatus = lifecycle,
                lastHealth = "/v1/ping returned 2xx",
                lastError = null,
                lastProcess = null,
                lastRecovery = "none",
                engineLogPath = engineLogPath,
            ),
        )

        assertContains(bundle, "Yet AI Diagnostics Bundle")
        assertContains(bundle, "Plugin version: test-version")
        assertContains(bundle, "Runtime origin: http://127.0.0.1:8123")
        assertContains(bundle, "Lifecycle: connected")
        assertContains(bundle, "Process state: running")
        assertContains(bundle, "Log path:")
        assertContains(bundle, "runtime.health")
        assertContains(bundle, "Engine log path:")
        assertContains(bundle, "Recent engine log tail:")
        assertContains(bundle, "engine health ok")
        assertFalse(bundle.contains("runtime-secret"), bundle)
        assertFalse(bundle.contains("session-secret"), bundle)
    }

    @Test
    fun bundleNotesMissingEngineLogWithoutFailing() {
        val dir = createTempDirectory("yet-diagnostics-missing-engine")
        val sink = YetLogSink(directoryProvider = { dir })
        sink.append("info", "runtime.health", mapOf("phase" to "success"))
        val lifecycle = runtimeLifecycleStatus(
            RuntimeSettings("http://127.0.0.1:8123", null, null, LaunchMode.LAUNCH, null),
            LaunchMode.LAUNCH,
            RuntimeLifecycle.FAILED,
            RuntimeProcessState.RUNNING,
            "runtime did not become reachable",
            "Refresh runtime",
        )

        val bundle = YetDiagnosticsBundle(sink).build(
            YetDiagnosticsSnapshot(
                launchMode = "launch",
                runtimeUrl = "http://127.0.0.1:8123",
                engineBinaryConfigured = false,
                binaryStatus = "bundled plugin runtime binary available",
                launchedByPlugin = true,
                lifecycleStatus = lifecycle,
                lastHealth = null,
                lastError = null,
                lastProcess = null,
                lastRecovery = null,
                engineLogPath = expectedEngineLogPath(dir, 8123),
            ),
        )

        assertContains(bundle, "Engine log path:")
        assertContains(bundle, "Engine log tail: unavailable")
        assertContains(bundle, "runtime.health")
    }

    @Test
    fun bundleReportsExternalEngineLogUnavailableWithoutDerivingPath() {
        val dir = createTempDirectory("yet-diagnostics-external-engine")
        val sink = YetLogSink(directoryProvider = { dir })
        sink.append("info", "runtime.health", mapOf("phase" to "failure"))
        val lifecycle = runtimeLifecycleStatus(
            RuntimeSettings("http://127.0.0.1:8123", null, null, LaunchMode.CONNECT, null),
            LaunchMode.CONNECT,
            RuntimeLifecycle.FAILED,
            RuntimeProcessState.NOT_OWNED,
            "connect mode is waiting for an externally managed local runtime",
            "Start the external runtime",
        )

        val bundle = YetDiagnosticsBundle(sink).build(
            YetDiagnosticsSnapshot(
                launchMode = "connect",
                runtimeUrl = "http://127.0.0.1:8123",
                engineBinaryConfigured = false,
                binaryStatus = "not used in connect mode",
                launchedByPlugin = false,
                lifecycleStatus = lifecycle,
                lastHealth = null,
                lastError = null,
                lastProcess = null,
                lastRecovery = null,
                engineLogPath = null,
            ),
        )

        assertContains(bundle, "Engine log path: unavailable")
        assertContains(bundle, "Engine log tail: unavailable")
        assertFalse(bundle.contains("engine-8123.log"), bundle)
    }

    @Test
    fun bundleRedactsCredentialFilePathsFromHostAndEngineTails() {
        val dir = createTempDirectory("yet-diagnostics-credential-paths")
        val sink = YetLogSink(directoryProvider = { dir })
        val engineLogPath = expectedEngineLogPath(dir, 8123)
        sink.append("warn", "runtime.output", mapOf("line" to "opened /Users/Alice Smith/.config/yet/credentials.json and C:\\Users\\Alice Smith\\credential.json"))
        Files.writeString(engineLogPath, "engine read ../yet/credential.json and /tmp/yet/credentials.json\nengine ok\n")
        val lifecycle = runtimeLifecycleStatus(
            RuntimeSettings("http://127.0.0.1:8123", null, null, LaunchMode.LAUNCH, null),
            LaunchMode.LAUNCH,
            RuntimeLifecycle.CONNECTED,
            RuntimeProcessState.RUNNING,
            "local runtime is reachable",
            "Continue using Yet AI.",
        )

        val bundle = YetDiagnosticsBundle(sink).build(
            YetDiagnosticsSnapshot(
                launchMode = "launch",
                runtimeUrl = "http://127.0.0.1:8123",
                engineBinaryConfigured = false,
                binaryStatus = "bundled plugin runtime binary available",
                launchedByPlugin = true,
                lifecycleStatus = lifecycle,
                lastHealth = "/v1/ping returned 2xx",
                lastError = "credential path /Users/Alice Smith/.config/yet/credential.json",
                lastProcess = null,
                lastRecovery = null,
                engineLogPath = engineLogPath,
            ),
        )

        assertContains(bundle, "runtime.output")
        assertContains(bundle, "engine ok")
        listOf("credential.json", "credentials.json", "Alice Smith", "/tmp/yet", ".config/yet").forEach { privateValue ->
            assertFalse(bundle.contains(privateValue, ignoreCase = true), bundle)
        }
    }

    @Test
    fun bundleRedactsSecretsPathsAndStaysBounded() {
        val dir = createTempDirectory("yet-diagnostics-redaction")
        val sink = YetLogSink(directoryProvider = { dir })
        val engineLogPath = expectedEngineLogPath(dir, 8123)
        sink.append("error", "runtime.health", mapOf("error" to "Authorization: Bearer raw-token-secret /Users/alice/private/file.kt sk-provider-secret"))
        Files.writeString(
            engineLogPath,
            (1..80).joinToString("\n") { index -> "engine line $index Authorization: Bearer raw-token-secret /Users/alice/private/file.kt YET_AI_AUTH_TOKEN=session-token-secret" },
        )
        val lifecycle = runtimeLifecycleStatus(
            RuntimeSettings("http://127.0.0.1:8123", null, null, LaunchMode.CONNECT, null),
            LaunchMode.CONNECT,
            RuntimeLifecycle.AUTH_MISMATCH,
            RuntimeProcessState.FAILED,
            "HTTP 401 token mismatch Authorization: Bearer raw-token-secret /Users/alice/private/file.kt",
            "Refresh runtime",
        )

        val bundle = YetDiagnosticsBundle(sink, maxChars = 800, maxEngineTailBytes = 600).build(
            YetDiagnosticsSnapshot(
                launchMode = "connect",
                runtimeUrl = "http://127.0.0.1:8123/path?code_verifier=oauth-verifier-secret",
                engineBinaryConfigured = true,
                binaryStatus = "configured at /Users/alice/Library/Application Support/yet-ai/yet-lsp",
                launchedByPlugin = false,
                lifecycleStatus = lifecycle,
                lastHealth = "HTTP 401 from /v1/ping",
                lastError = "Cookie: sid=cookie-secret Authorization: Bearer raw-token-secret /Users/alice/private/file.kt",
                lastProcess = "process from /Users/alice/private/yet-lsp exited",
                lastRecovery = "retry used token=retry-token-secret",
                engineLogPath = engineLogPath,
            ),
        )

        assertTrue(bundle.length <= 800)
        listOf("raw-token-secret", "/Users/alice", "provider-secret", "cookie-secret", "oauth-verifier-secret", "retry-token-secret", "session-token-secret", "Authorization", "Bearer").forEach { secret ->
            assertFalse(bundle.contains(secret, ignoreCase = true), bundle)
        }
    }
}
