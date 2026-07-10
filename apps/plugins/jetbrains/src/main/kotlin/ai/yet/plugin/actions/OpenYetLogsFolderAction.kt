package ai.yet.plugin.actions

import ai.yet.plugin.logging.YetLogSink
import com.intellij.ide.BrowserUtil
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.openapi.project.Project
import java.nio.file.Files
import java.nio.file.Path

class OpenYetLogsFolderAction : DumbAwareAction() {
    override fun actionPerformed(event: AnActionEvent) {
        OpenYetLogsFolderActionRunner().open(event.project)
    }
}

internal class OpenYetLogsFolderActionRunner(
    private val logDirectory: () -> Path = { YetLogSink().logDirectory() },
    private val opener: YetLogsFolderOpener = BrowserYetLogsFolderOpener,
    private val scheduler: StatusActionScheduler = IntellijStatusActionScheduler,
    private val presenter: YetDiagnosticsActionPresenter = DialogYetDiagnosticsActionPresenter,
) {
    fun open(project: Project?) {
        scheduler.background {
            val result = runCatching {
                val directory = logDirectory()
                Files.createDirectories(directory)
                opener.open(directory)
                "Opened Yet AI logs folder: $directory"
            }
            scheduler.ui {
                if (project?.isDisposed == true) {
                    return@ui
                }
                result.fold(
                    onSuccess = { presenter.info(project, it) },
                    onFailure = { presenter.error(project, sanitizeDiagnosticsActionError("open Yet AI logs folder", it)) },
                )
            }
        }
    }
}

internal interface YetLogsFolderOpener {
    fun open(directory: Path)
}

internal object BrowserYetLogsFolderOpener : YetLogsFolderOpener {
    override fun open(directory: Path) {
        BrowserUtil.browse(directory.toUri())
    }
}
