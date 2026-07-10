package ai.yet.plugin.logging

import ai.yet.plugin.runtime.LaunchMode
import ai.yet.plugin.runtime.RuntimeLifecycle
import ai.yet.plugin.runtime.RuntimeProcessState
import ai.yet.plugin.runtime.RuntimeSettings
import ai.yet.plugin.runtime.runtimeLifecycleStatus
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
        sink.append("info", "runtime.health", mapOf("phase" to "success"))
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
            ),
        )

        assertContains(bundle, "Yet AI Diagnostics Bundle")
        assertContains(bundle, "Plugin version: test-version")
        assertContains(bundle, "Runtime origin: http://127.0.0.1:8123")
        assertContains(bundle, "Lifecycle: connected")
        assertContains(bundle, "Process state: running")
        assertContains(bundle, "Log path:")
        assertContains(bundle, "runtime.health")
        assertFalse(bundle.contains("runtime-secret"), bundle)
        assertFalse(bundle.contains("session-secret"), bundle)
    }

    @Test
    fun bundleRedactsSecretsPathsAndStaysBounded() {
        val dir = createTempDirectory("yet-diagnostics-redaction")
        val sink = YetLogSink(directoryProvider = { dir })
        sink.append("error", "runtime.health", mapOf("error" to "Authorization: Bearer raw-token-secret /Users/alice/private/file.kt sk-provider-secret"))
        val lifecycle = runtimeLifecycleStatus(
            RuntimeSettings("http://127.0.0.1:8123", null, null, LaunchMode.CONNECT, null),
            LaunchMode.CONNECT,
            RuntimeLifecycle.AUTH_MISMATCH,
            RuntimeProcessState.FAILED,
            "HTTP 401 token mismatch Authorization: Bearer raw-token-secret /Users/alice/private/file.kt",
            "Refresh runtime",
        )

        val bundle = YetDiagnosticsBundle(sink, maxChars = 800).build(
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
            ),
        )

        assertTrue(bundle.length <= 800)
        listOf("raw-token-secret", "/Users/alice", "provider-secret", "cookie-secret", "oauth-verifier-secret", "retry-token-secret", "Authorization", "Bearer").forEach { secret ->
            assertFalse(bundle.contains(secret, ignoreCase = true), bundle)
        }
    }
}
