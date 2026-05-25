package ai.yet.plugin.actions

import ai.yet.plugin.runtime.RuntimeConnectionManager
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.ui.Messages

class RestartRuntimeAction : AnAction() {
    override fun actionPerformed(event: AnActionEvent) {
        val manager = RuntimeConnectionManager.getInstance()
        val result = manager.restartRuntime()
        val message = result.status ?: result.error ?: manager.runtimeDiagnostics()
        Messages.showInfoMessage(event.project, message, "Yet AI Runtime Restart")
    }
}
