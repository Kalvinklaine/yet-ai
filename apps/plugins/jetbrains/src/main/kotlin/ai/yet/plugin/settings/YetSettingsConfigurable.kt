package ai.yet.plugin.settings

import com.intellij.openapi.options.Configurable
import com.intellij.ui.components.JBCheckBox
import com.intellij.ui.components.JBPasswordField
import com.intellij.ui.components.JBTextField
import com.intellij.util.ui.FormBuilder
import javax.swing.JComponent
import javax.swing.JPanel

class YetSettingsConfigurable : Configurable {
    private var panel: JPanel? = null
    private val runtimeUrlField = JBTextField()
    private val guiDevUrlField = JBTextField()
    private val launchModeField = JBTextField()
    private val engineBinaryPathField = JBTextField()
    private val sessionTokenField = JBPasswordField()
    private val lspEnabledCheckBox = JBCheckBox("Enable read-only LSP MVP")

    override fun getDisplayName(): String = "Yet AI"

    override fun createComponent(): JComponent {
        val state = YetSettingsState.getInstance().state
        runtimeUrlField.text = state.runtimeUrl
        guiDevUrlField.text = state.guiDevUrl
        launchModeField.text = state.launchMode
        engineBinaryPathField.text = state.engineBinaryPath
        sessionTokenField.text = SessionTokenStore.getInstance().get()
        lspEnabledCheckBox.isSelected = state.lspEnabled
        panel = FormBuilder.createFormBuilder()
            .addLabeledComponent("Local runtime URL", runtimeUrlField)
            .addLabeledComponent("GUI dev URL", guiDevUrlField)
            .addLabeledComponent("Launch mode", launchModeField)
            .addLabeledComponent("Engine binary path", engineBinaryPathField)
            .addLabeledComponent("Debug connection token", sessionTokenField)
            .addComponent(lspEnabledCheckBox)
            .addComponent(com.intellij.ui.components.JBLabel("Experimental, local-only, and off by default. No provider calls, no edits, and no production completion claim."))
            .addComponentFillVertically(JPanel(), 0)
            .panel
        return panel as JPanel
    }

    override fun isModified(): Boolean {
        val state = YetSettingsState.getInstance().state
        return runtimeUrlField.text != state.runtimeUrl ||
            guiDevUrlField.text != state.guiDevUrl ||
            launchModeField.text != state.launchMode ||
            engineBinaryPathField.text != state.engineBinaryPath ||
            String(sessionTokenField.password) != SessionTokenStore.getInstance().get() ||
            lspEnabledCheckBox.isSelected != state.lspEnabled
    }

    override fun apply() {
        val state = YetSettingsState.getInstance().state
        state.runtimeUrl = runtimeUrlField.text.trim()
        state.guiDevUrl = guiDevUrlField.text.trim()
        state.launchMode = launchModeField.text.trim().ifBlank { "auto" }
        state.engineBinaryPath = engineBinaryPathField.text.trim()
        SessionTokenStore.getInstance().set(String(sessionTokenField.password))
        state.lspEnabled = lspEnabledCheckBox.isSelected
    }

    override fun reset() {
        val state = YetSettingsState.getInstance().state
        runtimeUrlField.text = state.runtimeUrl
        guiDevUrlField.text = state.guiDevUrl
        launchModeField.text = state.launchMode
        engineBinaryPathField.text = state.engineBinaryPath
        sessionTokenField.text = SessionTokenStore.getInstance().get()
        lspEnabledCheckBox.isSelected = state.lspEnabled
    }

    override fun disposeUIResources() {
        panel = null
    }
}
