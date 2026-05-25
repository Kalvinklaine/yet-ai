package ai.yet.plugin.actions

import ai.yet.plugin.runtime.RuntimeConnectionManager
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.openapi.ui.Messages

class ShowRuntimeStatusAction : DumbAwareAction() {
    override fun actionPerformed(event: AnActionEvent) {
        Messages.showInfoMessage(
            event.project,
            RuntimeConnectionManager.getInstance().runtimeDiagnostics(),
            "Yet AI Runtime Status",
        )
    }
}
