package ai.yet.plugin.ui

import ai.yet.plugin.bridge.ControlledIdeActions
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.editor.ScrollType
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.OpenFileDescriptor
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.CompletableFuture

interface IdeActionHost {
    fun execute(request: ControlledIdeActions.Request): CompletableFuture<IdeActionHostResult>
}

data class IdeActionHostResult(
    val status: ControlledIdeActions.ResultStatus,
    val message: String,
    val workspaceRelativePath: String? = null,
    val range: ControlledIdeActions.Range? = null,
    val hasActiveEditor: Boolean = false,
    val workspaceFolderCount: Int = 0,
)

class JetBrainsIdeActionHost(private val project: Project) : IdeActionHost {
    override fun execute(request: ControlledIdeActions.Request): CompletableFuture<IdeActionHostResult> = when (request) {
        is ControlledIdeActions.Request.GetContextSnapshot -> contextSnapshot()
        is ControlledIdeActions.Request.OpenWorkspaceFile -> resolveOnPool(request.workspaceRelativePath) { resolved ->
            runOnUi {
                val virtualFile = LocalFileSystem.getInstance().refreshAndFindFileByNioFile(resolved.path)
                    ?: return@runOnUi failed("Workspace file is unavailable.")
                FileEditorManager.getInstance(project).openTextEditor(OpenFileDescriptor(project, virtualFile), true)
                IdeActionHostResult(ControlledIdeActions.ResultStatus.Succeeded, "Workspace file opened.", workspaceRelativePath = resolved.safePath)
            }
        }
        is ControlledIdeActions.Request.RevealWorkspaceRange -> resolveOnPool(request.workspaceRelativePath) { resolved ->
            runOnUi {
                val virtualFile = LocalFileSystem.getInstance().refreshAndFindFileByNioFile(resolved.path)
                    ?: return@runOnUi failed("Workspace file is unavailable.")
                val document = FileDocumentManager.getInstance().getDocument(virtualFile)
                    ?: return@runOnUi failed("Workspace file is not text.")
                val startOffset = offsetFor(document.lineCount, { line -> document.getLineStartOffset(line) }, { line -> document.getLineEndOffset(line) }, request.range.start)
                    ?: return@runOnUi failed("Workspace range is outside the file.")
                val endOffset = offsetFor(document.lineCount, { line -> document.getLineStartOffset(line) }, { line -> document.getLineEndOffset(line) }, request.range.end)
                    ?: return@runOnUi failed("Workspace range is outside the file.")
                if (endOffset < startOffset) return@runOnUi failed("Workspace range is outside the file.")
                val editor = FileEditorManager.getInstance(project).openTextEditor(OpenFileDescriptor(project, virtualFile, startOffset), true)
                    ?: return@runOnUi failed("Workspace file could not be opened.")
                editor.caretModel.moveToOffset(startOffset)
                editor.selectionModel.removeSelection()
                if (endOffset > startOffset) editor.selectionModel.setSelection(startOffset, endOffset)
                editor.scrollingModel.scrollToCaret(ScrollType.CENTER)
                IdeActionHostResult(ControlledIdeActions.ResultStatus.Succeeded, "Workspace range revealed.", workspaceRelativePath = resolved.safePath, range = request.range)
            }
        }
    }

    private fun contextSnapshot(): CompletableFuture<IdeActionHostResult> = runOnUi {
        IdeActionHostResult(
            status = ControlledIdeActions.ResultStatus.Succeeded,
            message = "IDE context snapshot captured.",
            hasActiveEditor = FileEditorManager.getInstance(project).selectedTextEditor != null,
            workspaceFolderCount = if (project.basePath != null) 1 else 0,
        )
    }

    private fun resolveOnPool(workspaceRelativePath: String, next: (ResolvedWorkspaceFile) -> CompletableFuture<IdeActionHostResult>): CompletableFuture<IdeActionHostResult> {
        val future = CompletableFuture<IdeActionHostResult>()
        ApplicationManager.getApplication().executeOnPooledThread {
            try {
                val resolved = resolveWorkspaceFile(project.basePath, workspaceRelativePath)
                if (resolved == null) future.complete(failed("Workspace file is unavailable.")) else next(resolved).whenComplete { result, error ->
                    if (error != null) future.complete(failed("IDE action failed.")) else future.complete(result)
                }
            } catch (_: Exception) {
                future.complete(failed("IDE action failed."))
            }
        }
        return future
    }

    private fun <T> runOnUi(block: () -> T): CompletableFuture<T> {
        val future = CompletableFuture<T>()
        ApplicationManager.getApplication().invokeLater {
            try {
                if (project.isDisposed) future.completeExceptionally(IllegalStateException("Project disposed")) else future.complete(block())
            } catch (error: Exception) {
                future.completeExceptionally(error)
            }
        }
        return future
    }

    private fun failed(message: String) = IdeActionHostResult(ControlledIdeActions.ResultStatus.Failed, message)
}

data class ResolvedWorkspaceFile(val path: Path, val safePath: String)

private const val MaxIdeActionFileBytes = 2L * 1024L * 1024L

fun resolveWorkspaceFile(basePath: String?, workspaceRelativePath: String): ResolvedWorkspaceFile? {
    if (basePath == null || !ControlledIdeActions.isStrictSafeWorkspaceRelativePath(workspaceRelativePath)) return null
    val base = Path.of(basePath).toAbsolutePath().normalize()
    val baseReal = try {
        base.toRealPath()
    } catch (_: Exception) {
        return null
    }
    val candidate = base.resolve(workspaceRelativePath).normalize()
    if (!Files.exists(candidate) || Files.isDirectory(candidate)) return null
    val candidateReal = try {
        candidate.toRealPath()
    } catch (_: Exception) {
        return null
    }
    if (!candidateReal.startsWith(baseReal)) return null
    if (!Files.isRegularFile(candidateReal) || Files.isDirectory(candidateReal)) return null
    if (Files.size(candidateReal) > MaxIdeActionFileBytes) return null
    if (isBinaryLike(candidateReal)) return null
    val safePath = baseReal.relativize(candidateReal).joinToString("/") { it.toString() }
    return if (ControlledIdeActions.isStrictSafeWorkspaceRelativePath(safePath)) ResolvedWorkspaceFile(candidateReal, safePath) else null
}

private fun isBinaryLike(path: Path): Boolean {
    val bytes = Files.newInputStream(path).use { input -> input.readNBytes(4096) }
    if (bytes.any { it.toInt() == 0 }) return true
    return false
}

private fun offsetFor(lineCount: Int, lineStart: (Int) -> Int, lineEnd: (Int) -> Int, position: ControlledIdeActions.Position): Int? {
    if (position.line !in 0 until lineCount) return null
    val start = lineStart(position.line)
    val end = lineEnd(position.line)
    val offset = start + position.character
    return if (offset in start..end) offset else null
}
