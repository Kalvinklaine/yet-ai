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

        assertEquals(listOf(Presentation("info", "runtime restarted")), presenter.events)
    }

    @Test
    fun restartReturnedErrorIsPresentedAsError() {
        val scheduler = RecordingStatusActionScheduler()
        val presenter = RecordingRestartActionPresenter()
        val runner = RuntimeRestartActionRunner(
            restartRuntime = { RuntimeConnectionResult(runtimeSettings(), null, "restart failed") },
            scheduler = scheduler,
            presenter = presenter,
        )

        runner.restart(null)
        scheduler.runNextBackground()
        scheduler.runNextUi()

        assertEquals(listOf(Presentation("error", "restart failed")), presenter.events)
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
    fun restartActionRunsRestartOffActionThreadAndShowsFailuresAsErrors() {
        val source = projectFile("src/main/kotlin/ai/yet/plugin/actions/RestartRuntimeAction.kt").toFile().readText()

        assertContains(source, "DumbAwareAction")
        assertContains(source, "RuntimeRestartActionRunner().restart(event.project)")
        assertContains(source, "RuntimeConnectionManager.getInstance().restartRuntime()")
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
