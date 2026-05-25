package ai.yet.plugin.actions

import java.io.File
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertFalse

class RuntimeActionsTest {
    @Test
    fun restartActionRunsRestartOffActionThreadAndShowsFailuresAsErrors() {
        val source = File("src/main/kotlin/ai/yet/plugin/actions/RestartRuntimeAction.kt").readText()

        assertContains(source, "DumbAwareAction")
        assertContains(source, "executeOnPooledThread")
        assertContains(source, "restartRuntime()")
        assertContains(source, "invokeLater")
        assertContains(source, "showErrorDialog")
        assertContains(source, "showInfoMessage")
    }

    @Test
    fun statusActionIsDumbAware() {
        val source = File("src/main/kotlin/ai/yet/plugin/actions/ShowRuntimeStatusAction.kt").readText()

        assertContains(source, "DumbAwareAction")
    }

    @Test
    fun runtimeActionsRemainRegistered() {
        val pluginXml = File("src/main/resources/META-INF/plugin.xml").readText()

        assertContains(pluginXml, "id=\"ai.yet.plugin.ShowRuntimeStatus\"")
        assertContains(pluginXml, "class=\"ai.yet.plugin.actions.ShowRuntimeStatusAction\"")
        assertContains(pluginXml, "id=\"ai.yet.plugin.RestartRuntime\"")
        assertContains(pluginXml, "class=\"ai.yet.plugin.actions.RestartRuntimeAction\"")
        assertFalse(pluginXml.contains("ai.yet.plugin.RestartRuntimeAction.disabled"), pluginXml)
    }
}
