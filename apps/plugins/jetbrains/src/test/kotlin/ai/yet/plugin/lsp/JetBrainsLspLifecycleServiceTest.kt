package ai.yet.plugin.lsp

import ai.yet.plugin.settings.YetSettingsState
import java.io.ByteArrayInputStream
import java.nio.file.Path
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class JetBrainsLspLifecycleServiceTest {
    @Test
    fun lspSettingDefaultsToDisabled() {
        assertFalse(YetSettingsState.State().lspEnabled)
    }

    @Test
    fun disabledSettingDoesNotSpawn() {
        val starts = AtomicInteger(0)
        val service = JetBrainsLspLifecycleService(
            processFactory = JetBrainsLspProcessFactory { _, _ -> starts.incrementAndGet(); error("should not start") },
            binaryResolver = { Path.of("/tmp/yet-lsp") },
            settingsProvider = { false },
            environmentProvider = { error("unused") },
            diagnosticsSink = {},
            stopProcessFn = { error("unused") },
        )

        assertFalse(service.startIfEnabled())
        assertEquals(0, starts.get())
    }

    @Test
    fun enabledSettingSpawnsOnceWithExpectedCommandAndEnv() {
        val starts = AtomicInteger(0)
        var observedCommand: List<String>? = null
        var observedEnv: Map<String, String>? = null
        val process = RecordingProcess()
        val service = JetBrainsLspLifecycleService(
            processFactory = JetBrainsLspProcessFactory { command, env ->
                starts.incrementAndGet()
                observedCommand = command
                observedEnv = env
                process
            },
            binaryResolver = { Path.of("/tmp/yet-lsp") },
            settingsProvider = { true },
            environmentProvider = { mapOf("PATH" to "/bin", "YET_AI_AUTH_TOKEN" to "secret", "OPENAI_API_KEY" to "provider", "SystemRoot" to "C:\\Windows") },
            diagnosticsSink = {},
            stopProcessFn = { it.destroy(); true },
        )

        assertTrue(service.startIfEnabled())
        assertTrue(service.startIfEnabled())
        assertEquals(1, starts.get())
        assertEquals(listOf("/tmp/yet-lsp", "--lsp-stdio"), observedCommand?.map { it.replace('\\', '/') }, observedCommand.toString())
        assertTrue(observedEnv?.containsKey("PATH") == true, observedEnv.toString())
        assertFalse(observedEnv?.containsKey("YET_AI_AUTH_TOKEN") == true, observedEnv.toString())
        assertFalse(observedEnv?.containsKey("OPENAI_API_KEY") == true, observedEnv.toString())
        assertFalse(observedEnv?.containsKey("Authorization") == true, observedEnv.toString())
        assertTrue(observedEnv?.containsKey("SystemRoot") == true, observedEnv.toString())
        assertFalse(process.destroyed)
        service.dispose()
    }

    @Test
    fun missingBinaryDiagnosticIsSanitizedAndDoesNotSpawn() {
        var starts = 0
        var diagnostic = ""
        val service = JetBrainsLspLifecycleService(
            processFactory = JetBrainsLspProcessFactory { _, _ -> starts += 1; error("should not start") },
            binaryResolver = { null },
            settingsProvider = { true },
            environmentProvider = { error("unused") },
            diagnosticsSink = { diagnostic = it },
            stopProcessFn = { error("unused") },
        )

        assertFalse(service.startIfEnabled())
        assertEquals(0, starts)
        assertTrue(diagnostic.contains("JetBrains LSP unavailable"), diagnostic)
        assertFalse(diagnostic.contains("YET_AI_AUTH_TOKEN"), diagnostic)
        assertFalse(diagnostic.contains("OPENAI_API_KEY"), diagnostic)
        assertTrue(diagnostic.length <= 501, diagnostic)
    }

    @Test
    fun startFailureIsSanitizedAndBounded() {
        var diagnostic = ""
        val service = JetBrainsLspLifecycleService(
            processFactory = JetBrainsLspProcessFactory { _, _ -> throw IllegalStateException("missing token=secret /Users/alice/private/file.txt raw document body bridge payload " + "x".repeat(1000)) },
            binaryResolver = { Path.of("/tmp/yet-lsp") },
            settingsProvider = { true },
            environmentProvider = { emptyMap() },
            diagnosticsSink = { diagnostic = it },
            stopProcessFn = { true },
        )

        assertFalse(service.startIfEnabled())
        assertFalse(diagnostic.contains("secret"), diagnostic)
        assertFalse(diagnostic.contains("/Users/alice"), diagnostic)
        assertFalse(diagnostic.contains("bridge payload"), diagnostic)
        assertTrue(diagnostic.length <= 501, "${diagnostic.length}: $diagnostic")
    }

    @Test
    fun processOutputDiagnosticsAreSanitizedAndBounded() {
        val diagnostics = mutableListOf<String>()
        val process = RecordingProcess(
            stdout = "stdout Authorization: Bearer session-secret /Users/alice/private/stdout.log\n",
            stderr = "stderr OPENAI_API_KEY=provider-secret raw document body secret-body ${"x".repeat(1000)}\n",
        )
        val service = JetBrainsLspLifecycleService(
            processFactory = JetBrainsLspProcessFactory { _, _ -> process },
            binaryResolver = { Path.of("/tmp/yet-lsp") },
            settingsProvider = { true },
            environmentProvider = { emptyMap() },
            diagnosticsSink = { diagnostics += it },
            stopProcessFn = { it.destroy(); true },
        )

        assertTrue(service.startIfEnabled())
        val deadline = System.currentTimeMillis() + 1_000
        while (diagnostics.size < 2 && System.currentTimeMillis() < deadline) {
            Thread.sleep(10)
        }
        service.dispose()
        assertEquals(2, diagnostics.size, diagnostics.toString())
        val joined = diagnostics.joinToString("\n")
        listOf("session-secret", "/Users/alice", "provider-secret", "secret-body").forEach {
            assertFalse(joined.contains(it), joined)
        }
        assertTrue(diagnostics.all { it.length <= 501 }, joined)
    }

    @Test
    fun stopAndDisposeDestroyProcess() {
        val process = RecordingProcess()
        var stopCalls = 0
        val service = JetBrainsLspLifecycleService(
            processFactory = JetBrainsLspProcessFactory { _, _ -> process },
            binaryResolver = { Path.of("/tmp/yet-lsp") },
            settingsProvider = { true },
            environmentProvider = { emptyMap() },
            diagnosticsSink = {},
            stopProcessFn = { stopCalls += 1; it.destroy(); true },
        )

        assertTrue(service.startIfEnabled())
        service.stop()
        service.dispose()
        assertTrue(stopCalls >= 1)
        assertTrue(process.destroyed)
    }

    private class RecordingProcess(
        stdout: String = "",
        stderr: String = "",
    ) : Process() {
        var destroyed = false
        private val stdoutBytes = ByteArrayInputStream(stdout.toByteArray())
        private val stderrBytes = ByteArrayInputStream(stderr.toByteArray())
        override fun destroy() { destroyed = true }
        override fun destroyForcibly(): Process { destroyed = true; return this }
        override fun exitValue(): Int {
            if (!destroyed) throw IllegalThreadStateException("process is still running")
            return 0
        }
        override fun isAlive(): Boolean = !destroyed
        override fun waitFor(): Int {
            while (!destroyed) Thread.sleep(10)
            return 0
        }
        override fun waitFor(timeout: Long, unit: java.util.concurrent.TimeUnit): Boolean = destroyed
        override fun getInputStream() = stdoutBytes
        override fun getErrorStream() = stderrBytes
        override fun getOutputStream() = java.io.ByteArrayOutputStream()
    }
}
