package ai.yet.plugin.actions

import com.intellij.openapi.project.Project
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
    fun restartActionRunsRestartOffActionThreadAndShowsFailuresAsErrors() {
        val source = projectFile("src/main/kotlin/ai/yet/plugin/actions/RestartRuntimeAction.kt").toFile().readText()

        assertContains(source, "DumbAwareAction")
        assertContains(source, "executeOnPooledThread")
        assertContains(source, "restartRuntime()")
        assertContains(source, "invokeLater")
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
