package ai.yet.plugin.actions

import ai.yet.plugin.runtime.LaunchMode
import ai.yet.plugin.runtime.RuntimeConnectionResult
import ai.yet.plugin.runtime.RuntimeSettings
import com.intellij.openapi.project.Project
import java.lang.reflect.Proxy
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class RuntimeActionsTest {
    @Test
    fun statusActionQueuesDiagnosticsAndPresentsSuccessOnUiDispatch() {
        var diagnosticsCalls = 0
        val scheduler = RecordingStatusActionScheduler()
        val presenter = RecordingStatusActionPresenter()
        val runner = RuntimeStatusActionRunner(
            diagnostics = {
                diagnosticsCalls += 1
                "runtime ok"
            },
            scheduler = scheduler,
            presenter = presenter,
        )

        runner.show(null)

        assertEquals(0, diagnosticsCalls)
        assertEquals(1, scheduler.backgroundTasks.size)
        assertTrue(scheduler.uiTasks.isEmpty())
        assertTrue(presenter.events.isEmpty())

        scheduler.runNextBackground()

        assertEquals(1, diagnosticsCalls)
        assertEquals(1, scheduler.uiTasks.size)
        assertTrue(presenter.events.isEmpty())

        scheduler.runNextUi()

        assertEquals(listOf(Presentation("info", "runtime ok")), presenter.events)
    }

    @Test
    fun statusActionFailureIsSanitizedAndPresentedAsError() {
        val scheduler = RecordingStatusActionScheduler()
        val presenter = RecordingStatusActionPresenter()
        val runner = RuntimeStatusActionRunner(
            diagnostics = { error("Authorization: Bearer short-secret and token ${"a".repeat(64)}") },
            scheduler = scheduler,
            presenter = presenter,
        )

        runner.show(null)
        scheduler.runNextBackground()
        scheduler.runNextUi()

        assertEquals(1, presenter.events.size)
        val event = presenter.events.single()
        assertEquals("error", event.kind)
        assertContains(event.message, "Unable to collect Yet AI runtime status")
        assertContains(event.message, "[redacted]")
        assertFalse(event.message.contains("short-secret"), event.message)
        assertFalse(event.message.contains("a".repeat(64)), event.message)
    }

    @Test
    fun restartActionQueuesRestartAndPresentsSuccessAsInfo() {
        var restartCalls = 0
        val scheduler = RecordingStatusActionScheduler()
        val presenter = RecordingRestartActionPresenter()
        val runner = RuntimeRestartActionRunner(
            restartRuntime = {
                restartCalls += 1
                RuntimeConnectionResult(runtimeSettings(), "runtime restarted", null)
            },
            scheduler = scheduler,
            presenter = presenter,
        )

        runner.restart(null)

        assertEquals(0, restartCalls)
        assertEquals(1, scheduler.backgroundTasks.size)
        assertTrue(scheduler.uiTasks.isEmpty())
        assertTrue(presenter.events.isEmpty())

        scheduler.runNextBackground()

        assertEquals(1, restartCalls)
        assertEquals(1, scheduler.uiTasks.size)
        assertTrue(presenter.events.isEmpty())

        scheduler.runNextUi()

        val event = presenter.events.single()
        assertEquals("info", event.kind)
        assertContains(event.message, "runtime restarted")
        assertContains(event.message, "Lifecycle: connected")
    }

    @Test
    fun restartReturnedErrorIsPresentedAsError() {
        val scheduler = RecordingStatusActionScheduler()
        val presenter = RecordingRestartActionPresenter()
        val runner = RuntimeRestartActionRunner(
            restartRuntime = { RuntimeConnectionResult(runtimeSettings(), null, "restart failed") },
            diagnostics = { "Yet AI Runtime Status\nNext action: Yet AI: Show Runtime Status" },
            scheduler = scheduler,
            presenter = presenter,
        )

        runner.restart(null)
        scheduler.runNextBackground()
        scheduler.runNextUi()

        val event = presenter.events.single()
        assertEquals("error", event.kind)
        assertContains(event.message, "restart failed")
        assertContains(event.message, "Yet AI Runtime Status")
        assertContains(event.message, "Next action")
    }

    @Test
    fun restartFailureIncludesDiagnosticsAndRedactsTokenAndPrivatePath() {
        val scheduler = RecordingStatusActionScheduler()
        val presenter = RecordingRestartActionPresenter()
        val token = "restart-runtime-token-that-must-not-leak-1234567890"
        val privatePath = "/Users/alice/Library/Caches/yet-ai/engine/yet-lsp"
        val runner = RuntimeRestartActionRunner(
            restartRuntime = { RuntimeConnectionResult(runtimeSettings(), null, "spawn failed at $privatePath with Authorization: Bearer $token") },
            diagnostics = {
                "Yet AI Runtime Status\n" +
                    "Last error: HTTP 401 token=$token at $privatePath\n" +
                    "Diagnosis: local runtime rejected the session token (HTTP 401 token mismatch)\n" +
                    "Next action: Click Refresh runtime, then use Yet AI: Restart Runtime. This is not a provider API key."
            },
            scheduler = scheduler,
            presenter = presenter,
        )

        runner.restart(null)
        scheduler.runNextBackground()
        scheduler.runNextUi()

        val event = presenter.events.single()
        assertEquals("error", event.kind)
        assertContains(event.message, "Yet AI Runtime Status")
        assertContains(event.message, "HTTP 401 token mismatch")
        assertContains(event.message, "Restart Runtime")
        assertContains(event.message, "[redacted")
        assertFalse(event.message.contains(token), event.message)
        assertFalse(event.message.contains(privatePath), event.message)
        assertFalse(event.message.contains("alice"), event.message)
    }

    @Test
    fun restartUnexpectedExceptionIsSanitizedAndPresentedAsError() {
        val scheduler = RecordingStatusActionScheduler()
        val presenter = RecordingRestartActionPresenter()
        val runner = RuntimeRestartActionRunner(
            restartRuntime = { error("Authorization: Bearer short-secret and token ${"a".repeat(64)}") },
            scheduler = scheduler,
            presenter = presenter,
        )

        runner.restart(null)
        scheduler.runNextBackground()
        scheduler.runNextUi()

        val event = presenter.events.single()
        assertEquals("error", event.kind)
        assertContains(event.message, "Unable to restart Yet AI runtime")
        assertContains(event.message, "[redacted]")
        assertFalse(event.message.contains("short-secret"), event.message)
        assertFalse(event.message.contains("a".repeat(64)), event.message)
    }

    @Test
    fun restartFallbackDiagnosticsExceptionIsSanitizedAndPresentedAsError() {
        val scheduler = RecordingStatusActionScheduler()
        val presenter = RecordingRestartActionPresenter()
        val runner = RuntimeRestartActionRunner(
            restartRuntime = { RuntimeConnectionResult(runtimeSettings(), null, null) },
            diagnostics = { error("Cookie: session=secret; refresh=also-secret") },
            scheduler = scheduler,
            presenter = presenter,
        )

        runner.restart(null)
        scheduler.runNextBackground()
        scheduler.runNextUi()

        val event = presenter.events.single()
        assertEquals("error", event.kind)
        assertContains(event.message, "Unable to restart Yet AI runtime or collect diagnostics")
        assertContains(event.message, "[redacted]")
        assertFalse(event.message.contains("session=secret"), event.message)
        assertFalse(event.message.contains("refresh=also-secret"), event.message)
    }

    @Test
    fun restartSkipsPresentationWhenProjectIsDisposedBeforeUiDispatch() {
        val scheduler = RecordingStatusActionScheduler()
        val presenter = RecordingRestartActionPresenter()
        val runner = RuntimeRestartActionRunner(
            restartRuntime = { RuntimeConnectionResult(runtimeSettings(), "runtime restarted", null) },
            scheduler = scheduler,
            presenter = presenter,
        )

        runner.restart(disposedProject())
        scheduler.runNextBackground()
        scheduler.runNextUi()

        assertTrue(presenter.events.isEmpty())
    }

    @Test
    fun restartFailurePresentationKeepsManualKillGuidanceSanitized() {
        val scheduler = RecordingStatusActionScheduler()
        val presenter = RecordingRestartActionPresenter()
        val runner = RuntimeRestartActionRunner(
            restartRuntime = {
                RuntimeConnectionResult(
                    runtimeSettings(),
                    null,
                    "Yet AI local runtime connection failed after plugin-launched process exited with code 137 Authorization: Bearer ${"a".repeat(64)} /Users/alice/private/yet-lsp",
                )
            },
            diagnostics = {
                "Last process: plugin-launched process exited with code 137; click Refresh runtime or run Yet AI: Restart Runtime to relaunch\n" +
                    "Next action: Click Refresh runtime, then run Yet AI: Restart Runtime. Authorization: Bearer ${"b".repeat(64)} /Users/alice/private/auth.json"
            },
            scheduler = scheduler,
            presenter = presenter,
        )

        runner.restart(null)
        scheduler.runNextBackground()
        scheduler.runNextUi()

        val message = presenter.events.single().message
        assertContains(message, "plugin-launched process exited")
        assertContains(message, "Refresh runtime")
        assertContains(message, "Yet AI: Restart Runtime")
        assertFalse(message.contains("Authorization"), message)
        assertFalse(message.contains("/Users/alice"), message)
        assertFalse(message.contains("${"a".repeat(64)}"), message)
        assertFalse(message.contains("${"b".repeat(64)}"), message)
    }

    @Test
    fun restartFailureIncludesBoundedSanitizedLifecycleResult() {
        val scheduler = RecordingStatusActionScheduler()
        val presenter = RecordingRestartActionPresenter()
        val runner = RuntimeRestartActionRunner(
            restartRuntime = {
                RuntimeConnectionResult(
                    runtimeSettings(),
                    null,
                    "restart failed Authorization: Bearer ${"a".repeat(64)} /Users/alice/private/yet-lsp",
                )
            },
            diagnostics = { "diagnostics ${"x".repeat(5000)} token=${"b".repeat(64)}" },
            scheduler = scheduler,
            presenter = presenter,
        )

        runner.restart(null)
        scheduler.runNextBackground()
        scheduler.runNextUi()

        val message = presenter.events.single().message
        assertContains(message, "Lifecycle: failed")
        assertContains(message, "Diagnosis:")
        assertContains(message, "Next action:")
        assertTrue(message.length <= 4000, message.length.toString())
        assertFalse(message.contains("Authorization"), message)
        assertFalse(message.contains("/Users/alice"), message)
        assertFalse(message.contains("${"a".repeat(64)}"), message)
        assertFalse(message.contains("${"b".repeat(64)}"), message)
    }

    @Test
    fun restartActionRunsRestartOffActionThreadAndShowsFailuresAsErrors() {
        val source = projectFile("src/main/kotlin/ai/yet/plugin/actions/RestartRuntimeAction.kt").toFile().readText() +
            projectFile("src/main/kotlin/ai/yet/plugin/runtime/RuntimeConnectionManager.kt").toFile().readText()

        assertContains(source, "DumbAwareAction")
        assertContains(source, "RuntimeRestartActionRunner().restart(event.project)")
        assertContains(source, "RuntimeConnectionManager.getInstance().restartRuntime()")
        assertContains(source, "stopLaunchedProcess()")
        assertContains(source, "prepareCurrent(publishUpdates = false)")
        assertContains(source, "RuntimeConnectionListener.TOPIC")
        assertContains(source, "runtimeConnectionUpdated(result)")
        assertContains(source, "project?.isDisposed == true")
        assertContains(source, "showErrorDialog")
        assertContains(source, "showInfoMessage")
    }

    @Test
    fun statusActionIsDumbAwareAndUsesBackgroundRunner() {
        val source = projectFile("src/main/kotlin/ai/yet/plugin/actions/ShowRuntimeStatusAction.kt").toFile().readText()

        assertContains(source, "DumbAwareAction")
        assertContains(source, "executeOnPooledThread")
        assertContains(source, "invokeLater")
        assertContains(source, "showErrorDialog")
        assertContains(source, "RuntimeStatusActionRunner().show(event.project)")
    }

    @Test
    fun runtimeActionsRemainRegistered() {
        val pluginXml = projectFile("src/main/resources/META-INF/plugin.xml").toFile().readText()

        assertContains(pluginXml, "id=\"ai.yet.plugin.ShowRuntimeStatus\"")
        assertContains(pluginXml, "class=\"ai.yet.plugin.actions.ShowRuntimeStatusAction\"")
        assertContains(pluginXml, "id=\"ai.yet.plugin.RestartRuntime\"")
        assertContains(pluginXml, "class=\"ai.yet.plugin.actions.RestartRuntimeAction\"")
        assertFalse(pluginXml.contains("ai.yet.plugin.RestartRuntimeAction.disabled"), pluginXml)
    }

    private fun projectFile(relativePath: String): Path = Path.of(System.getProperty("user.dir")).resolve(relativePath)

    private fun runtimeSettings(): RuntimeSettings = RuntimeSettings("http://127.0.0.1:8123", null, null, LaunchMode.CONNECT, null)

    private fun disposedProject(): Project = Proxy.newProxyInstance(
        Project::class.java.classLoader,
        arrayOf(Project::class.java),
    ) { _, method, _ ->
        when (method.name) {
            "isDisposed" -> true
            "getName" -> "Disposed Test Project"
            "toString" -> "Disposed Test Project"
            "hashCode" -> 1
            "equals" -> false
            else -> null
        }
    } as Project
}

private data class Presentation(val kind: String, val message: String)

private class RecordingStatusActionScheduler : StatusActionScheduler {
    val backgroundTasks = mutableListOf<() -> Unit>()
    val uiTasks = mutableListOf<() -> Unit>()

    override fun background(task: () -> Unit) {
        backgroundTasks += task
    }

    override fun ui(task: () -> Unit) {
        uiTasks += task
    }

    fun runNextBackground() {
        backgroundTasks.removeAt(0).invoke()
    }

    fun runNextUi() {
        uiTasks.removeAt(0).invoke()
    }
}

private class RecordingStatusActionPresenter : StatusActionPresenter {
    val events = mutableListOf<Presentation>()

    override fun info(project: Project?, message: String) {
        events += Presentation("info", message)
    }

    override fun error(project: Project?, message: String) {
        events += Presentation("error", message)
    }
}

private class RecordingRestartActionPresenter : RestartActionPresenter {
    val events = mutableListOf<Presentation>()

    override fun info(project: Project?, message: String) {
        events += Presentation("info", message)
    }

    override fun error(project: Project?, message: String) {
        events += Presentation("error", message)
    }
}
