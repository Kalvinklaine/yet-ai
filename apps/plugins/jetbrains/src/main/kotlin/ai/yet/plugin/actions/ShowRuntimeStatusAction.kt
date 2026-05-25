package ai.yet.plugin.actions

import ai.yet.plugin.runtime.RuntimeConnectionManager
import ai.yet.plugin.runtime.redactLogText
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages

class ShowRuntimeStatusAction : DumbAwareAction() {
    override fun actionPerformed(event: AnActionEvent) {
        RuntimeStatusActionRunner().show(event.project)
    }
}

class RuntimeStatusActionRunner(
    private val diagnostics: () -> String = { RuntimeConnectionManager.getInstance().runtimeDiagnostics() },
    private val scheduler: StatusActionScheduler = IntellijStatusActionScheduler,
    private val presenter: StatusActionPresenter = DialogStatusActionPresenter,
) {
    fun show(project: Project?) {
        scheduler.background {
            val result = runCatching { diagnostics() }
            scheduler.ui {
                if (project?.isDisposed == true) {
                    return@ui
                }
                result.fold(
                    onSuccess = { presenter.info(project, it) },
                    onFailure = { presenter.error(project, sanitizeStatusError(it)) },
                )
            }
        }
    }
}

interface StatusActionScheduler {
    fun background(task: () -> Unit)
    fun ui(task: () -> Unit)
}

interface StatusActionPresenter {
    fun info(project: Project?, message: String)
    fun error(project: Project?, message: String)
}

object IntellijStatusActionScheduler : StatusActionScheduler {
    override fun background(task: () -> Unit) {
        ApplicationManager.getApplication().executeOnPooledThread(task)
    }

    override fun ui(task: () -> Unit) {
        ApplicationManager.getApplication().invokeLater(task)
    }
}

object DialogStatusActionPresenter : StatusActionPresenter {
    override fun info(project: Project?, message: String) {
        Messages.showInfoMessage(project, message, "Yet AI Runtime Status")
    }

    override fun error(project: Project?, message: String) {
        Messages.showErrorDialog(project, message, "Yet AI Runtime Status Failed")
    }
}

fun sanitizeStatusError(error: Throwable): String {
    val detail = error.message?.takeIf { it.isNotBlank() } ?: error::class.java.simpleName
    return "Unable to collect Yet AI runtime status: ${redactLogText(detail, "")}"
}
