package ai.yet.plugin.actions

import ai.yet.plugin.runtime.RuntimeConnectionManager
import ai.yet.plugin.runtime.redactLogText
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages
import java.awt.datatransfer.StringSelection

class CopyYetDiagnosticsAction : DumbAwareAction() {
    override fun actionPerformed(event: AnActionEvent) {
        CopyYetDiagnosticsActionRunner().copy(event.project)
    }
}

internal class CopyYetDiagnosticsActionRunner(
    private val diagnostics: () -> String = { RuntimeConnectionManager.getInstance().runtimeDiagnostics() },
    private val clipboard: YetDiagnosticsClipboard = IntellijYetDiagnosticsClipboard,
    private val scheduler: StatusActionScheduler = IntellijStatusActionScheduler,
    private val presenter: YetDiagnosticsActionPresenter = DialogYetDiagnosticsActionPresenter,
) {
    fun copy(project: Project?) {
        scheduler.background {
            val result = runCatching {
                val bundle = redactLogText(diagnostics(), "")
                clipboard.copy(bundle)
                "Copied Yet AI diagnostics to clipboard (${bundle.length} chars)."
            }
            scheduler.ui {
                if (project?.isDisposed == true) {
                    return@ui
                }
                result.fold(
                    onSuccess = { presenter.info(project, it) },
                    onFailure = { presenter.error(project, sanitizeDiagnosticsActionError("copy Yet AI diagnostics", it)) },
                )
            }
        }
    }
}

internal interface YetDiagnosticsClipboard {
    fun copy(value: String)
}

internal object IntellijYetDiagnosticsClipboard : YetDiagnosticsClipboard {
    override fun copy(value: String) {
        CopyPasteManager.getInstance().setContents(StringSelection(value))
    }
}

internal interface YetDiagnosticsActionPresenter {
    fun info(project: Project?, message: String)
    fun error(project: Project?, message: String)
}

internal object DialogYetDiagnosticsActionPresenter : YetDiagnosticsActionPresenter {
    override fun info(project: Project?, message: String) {
        Messages.showInfoMessage(project, message, "Yet AI Diagnostics")
    }

    override fun error(project: Project?, message: String) {
        Messages.showErrorDialog(project, message, "Yet AI Diagnostics Failed")
    }
}

internal fun sanitizeDiagnosticsActionError(action: String, error: Throwable): String {
    val detail = error.message?.takeIf { it.isNotBlank() } ?: error::class.java.simpleName
    return "Unable to $action: ${redactLogText(detail, "")}"
}
