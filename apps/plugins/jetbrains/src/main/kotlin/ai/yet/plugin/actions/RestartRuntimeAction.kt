package ai.yet.plugin.actions

import ai.yet.plugin.runtime.RuntimeConnectionManager
import ai.yet.plugin.runtime.RuntimeConnectionResult
import ai.yet.plugin.runtime.redactLogText
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages

class RestartRuntimeAction : DumbAwareAction() {
    override fun actionPerformed(event: AnActionEvent) {
        RuntimeRestartActionRunner().restart(event.project)
    }
}

internal class RuntimeRestartActionRunner(
    private val restartRuntime: () -> RuntimeConnectionResult = { RuntimeConnectionManager.getInstance().restartRuntime() },
    private val diagnostics: () -> String = { RuntimeConnectionManager.getInstance().runtimeDiagnostics() },
    private val scheduler: StatusActionScheduler = IntellijStatusActionScheduler,
    private val presenter: RestartActionPresenter = DialogRestartActionPresenter,
) {
    fun restart(project: Project?) {
        scheduler.background {
            val result = runCatching { restartRuntime() }
                .fold(
                    onSuccess = { toRestartPresentation(it) },
                    onFailure = { RestartPresentation(false, sanitizeRestartError(it)) },
                )
            scheduler.ui {
                if (project?.isDisposed == true) {
                    return@ui
                }
                if (result.success) {
                    presenter.info(project, result.message)
                } else {
                    presenter.error(project, result.message)
                }
            }
        }
    }

    private fun toRestartPresentation(result: RuntimeConnectionResult): RestartPresentation {
        val message = result.status ?: result.error ?: runCatching { diagnostics() }.getOrElse { error ->
            return RestartPresentation(false, sanitizeRestartDiagnosticsError(error))
        }
        return RestartPresentation(result.error == null, message)
    }
}

internal interface RestartActionPresenter {
    fun info(project: Project?, message: String)
    fun error(project: Project?, message: String)
}

internal object DialogRestartActionPresenter : RestartActionPresenter {
    override fun info(project: Project?, message: String) {
        Messages.showInfoMessage(project, message, "Yet AI Runtime Restart")
    }

    override fun error(project: Project?, message: String) {
        Messages.showErrorDialog(project, message, "Yet AI Runtime Restart Failed")
    }
}

private data class RestartPresentation(val success: Boolean, val message: String)

private fun sanitizeRestartError(error: Throwable): String {
    val detail = error.message?.takeIf { it.isNotBlank() } ?: error::class.java.simpleName
    return "Unable to restart Yet AI runtime: ${redactLogText(detail, "")}"
}

private fun sanitizeRestartDiagnosticsError(error: Throwable): String {
    val detail = error.message?.takeIf { it.isNotBlank() } ?: error::class.java.simpleName
    return "Unable to restart Yet AI runtime or collect diagnostics: ${redactLogText(detail, "")}"
}
