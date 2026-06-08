package ai.yet.plugin.settings

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage

@State(name = "YetAiSettings", storages = [Storage("yet-ai.xml")])
@Service(Service.Level.APP)
class YetSettingsState : PersistentStateComponent<YetSettingsState.State> {
    data class State(
        var runtimeUrl: String = "http://127.0.0.1:8001",
        var guiDevUrl: String = "",
        var launchMode: String = "auto",
        var engineBinaryPath: String = "",
        var lspEnabled: Boolean = false,
    )

    private var state = State()

    override fun getState(): State = state

    override fun loadState(state: State) {
        this.state = state
    }

    companion object {
        fun getInstance(): YetSettingsState = ApplicationManager.getApplication().getService(YetSettingsState::class.java)
    }
}
