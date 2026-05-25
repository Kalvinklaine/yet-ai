package ai.yet.plugin.actions

import ai.yet.plugin.runtime.RuntimeConnectionManager
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.ui.Messages

class ShowRuntimeStatusAction : AnAction() {
    override fun actionPerformed(event: AnActionEvent) {
        Messages.showInfoMessage(
            event.project,
            RuntimeConnectionManager.getInstance().runtimeDiagnostics(),
            "Yet AI Runtime Status",
        )
    }
}
