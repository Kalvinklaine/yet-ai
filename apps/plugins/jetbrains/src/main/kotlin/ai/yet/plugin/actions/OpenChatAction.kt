package ai.yet.plugin.actions

import ai.yet.plugin.ui.YetToolWindowFactory
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.wm.ToolWindowManager

class OpenChatAction : AnAction() {
    override fun actionPerformed(event: AnActionEvent) {
        val project = event.project ?: return
        val toolWindow = ToolWindowManager.getInstance(project).getToolWindow("Yet AI") ?: return
        YetToolWindowFactory.ensureContent(project, toolWindow)
        toolWindow.activate({ YetToolWindowFactory.refreshActiveEditorContext(toolWindow) })
    }
}
