package ai.yet.plugin.actions

import ai.yet.plugin.runtime.RuntimeConnectionManager
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.openapi.ui.Messages

class RestartRuntimeAction : DumbAwareAction() {
    override fun actionPerformed(event: AnActionEvent) {
        val project = event.project
        ApplicationManager.getApplication().executeOnPooledThread {
            val manager = RuntimeConnectionManager.getInstance()
            val result = manager.restartRuntime()
            val message = result.status ?: result.error ?: manager.runtimeDiagnostics()
            ApplicationManager.getApplication().invokeLater {
                if (result.error == null) {
                    Messages.showInfoMessage(project, message, "Yet AI Runtime Restart")
                } else {
                    Messages.showErrorDialog(project, message, "Yet AI Runtime Restart Failed")
                }
            }
        }
    }
}
