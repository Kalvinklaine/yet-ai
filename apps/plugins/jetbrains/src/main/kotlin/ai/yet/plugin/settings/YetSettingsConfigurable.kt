package ai.yet.plugin.settings

import com.intellij.openapi.options.Configurable
import com.intellij.ui.components.JBPasswordField
import com.intellij.ui.components.JBTextField
import com.intellij.util.ui.FormBuilder
import javax.swing.JComponent
import javax.swing.JPanel

class YetSettingsConfigurable : Configurable {
    private var panel: JPanel? = null
    private val runtimeUrlField = JBTextField()
    private val guiDevUrlField = JBTextField()
    private val sessionTokenField = JBPasswordField()

    override fun getDisplayName(): String = "Yet AI"

    override fun createComponent(): JComponent {
        val state = YetSettingsState.getInstance().state
        runtimeUrlField.text = state.runtimeUrl
        guiDevUrlField.text = state.guiDevUrl
        sessionTokenField.text = state.sessionToken
        panel = FormBuilder.createFormBuilder()
            .addLabeledComponent("Local runtime URL", runtimeUrlField)
            .addLabeledComponent("GUI dev URL", guiDevUrlField)
            .addLabeledComponent("Local session token", sessionTokenField)
            .addComponentFillVertically(JPanel(), 0)
            .panel
        return panel as JPanel
    }

    override fun isModified(): Boolean {
        val state = YetSettingsState.getInstance().state
        return runtimeUrlField.text != state.runtimeUrl ||
            guiDevUrlField.text != state.guiDevUrl ||
            String(sessionTokenField.password) != state.sessionToken
    }

    override fun apply() {
        val state = YetSettingsState.getInstance().state
        state.runtimeUrl = runtimeUrlField.text.trim()
        state.guiDevUrl = guiDevUrlField.text.trim()
        state.sessionToken = String(sessionTokenField.password)
    }

    override fun reset() {
        val state = YetSettingsState.getInstance().state
        runtimeUrlField.text = state.runtimeUrl
        guiDevUrlField.text = state.guiDevUrl
        sessionTokenField.text = state.sessionToken
    }

    override fun disposeUIResources() {
        panel = null
    }
}
