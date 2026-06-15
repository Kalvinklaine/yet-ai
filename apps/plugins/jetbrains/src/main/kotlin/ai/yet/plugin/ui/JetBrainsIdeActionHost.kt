package ai.yet.plugin.ui

import ai.yet.plugin.bridge.ControlledIdeActions
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.editor.ScrollType
import com.intellij.openapi.editor.Document
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

interface ApplyWorkspaceEditHost {
    fun apply(request: ControlledIdeActions.ApplyWorkspaceEditRequest): CompletableFuture<ApplyWorkspaceEditHostResult>
}

data class ApplyWorkspaceEditHostResult(
    val status: ControlledIdeActions.ApplyWorkspaceEditStatus,
    val message: String,
    val appliedEditCount: Int = 0,
    val affectedFiles: List<String> = emptyList(),
)

data class IdeActionHostResult(
    val status: ControlledIdeActions.ResultStatus,
    val message: String,
    val workspaceRelativePath: String? = null,
    val range: ControlledIdeActions.Range? = null,
    val hasActiveEditor: Boolean = false,
    val workspaceFolderCount: Int = 0,
)

class JetBrainsIdeActionHost(private val project: Project) : IdeActionHost, ApplyWorkspaceEditHost {
    private val applyHost = JetBrainsApplyWorkspaceEditHost(project)

    override fun apply(request: ControlledIdeActions.ApplyWorkspaceEditRequest): CompletableFuture<ApplyWorkspaceEditHostResult> = applyHost.apply(request)

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

class JetBrainsApplyWorkspaceEditHost(private val project: Project) : ApplyWorkspaceEditHost {
    override fun apply(request: ControlledIdeActions.ApplyWorkspaceEditRequest): CompletableFuture<ApplyWorkspaceEditHostResult> {
        val future = CompletableFuture<ApplyWorkspaceEditHostResult>()
        ApplicationManager.getApplication().executeOnPooledThread {
            try {
                val resolved = mutableListOf<ResolvedApplyWorkspaceFile>()
                for (fileEdit in request.edits) {
                    val file = resolveWorkspaceFile(project.basePath, fileEdit.workspaceRelativePath)
                    if (file == null) {
                        future.complete(rejected("Workspace edit target is unavailable."))
                        return@executeOnPooledThread
                    }
                    resolved.add(ResolvedApplyWorkspaceFile(file, fileEdit.textReplacements))
                }
                ApplicationManager.getApplication().invokeLater {
                    try {
                        if (project.isDisposed) {
                            future.complete(failed())
                            return@invokeLater
                        }
                        val prepared = mutableListOf<PreparedApplyWorkspaceFile>()
                        for (item in resolved) {
                            val virtualFile = LocalFileSystem.getInstance().refreshAndFindFileByNioFile(item.file.path)
                            if (virtualFile == null) {
                                future.complete(rejected("Workspace edit target is unavailable."))
                                return@invokeLater
                            }
                            val document = FileDocumentManager.getInstance().getDocument(virtualFile)
                            if (document == null) {
                                future.complete(rejected("Workspace edit target is not text."))
                                return@invokeLater
                            }
                            val replacements = prepareReplacements(document, item.replacements)
                            if (replacements == null) {
                                future.complete(rejected("Workspace edit range is outside the file."))
                                return@invokeLater
                            }
                            prepared.add(PreparedApplyWorkspaceFile(document, item.file.safePath, replacements))
                        }
                        WriteCommandAction.runWriteCommandAction(project, "Apply Yet AI Workspace Edit", null, Runnable {
                            prepared.forEach { file ->
                                file.replacements.asReversed().forEach { replacement ->
                                    file.document.replaceString(replacement.startOffset, replacement.endOffset, replacement.replacementText)
                                }
                            }
                        })
                        val count = prepared.sumOf { it.replacements.size }
                        val files = prepared.map { it.safePath }
                        future.complete(ApplyWorkspaceEditHostResult(ControlledIdeActions.ApplyWorkspaceEditStatus.Applied, "Edit request applied.", count, files))
                    } catch (_: Exception) {
                        future.complete(failed())
                    }
                }
            } catch (_: Exception) {
                future.complete(failed())
            }
        }
        return future
    }

    private fun rejected(message: String) = ApplyWorkspaceEditHostResult(ControlledIdeActions.ApplyWorkspaceEditStatus.Rejected, message)

    private fun failed() = ApplyWorkspaceEditHostResult(ControlledIdeActions.ApplyWorkspaceEditStatus.Failed, "Edit request failed.")
}

data class ResolvedApplyWorkspaceFile(val file: ResolvedWorkspaceFile, val replacements: List<ControlledIdeActions.ApplyWorkspaceTextReplacement>)
data class PreparedApplyWorkspaceFile(val document: Document, val safePath: String, val replacements: List<PreparedTextReplacement>)
data class PreparedTextReplacement(val startOffset: Int, val endOffset: Int, val replacementText: String)

fun prepareReplacements(document: Document, replacements: List<ControlledIdeActions.ApplyWorkspaceTextReplacement>): List<PreparedTextReplacement>? {
    val prepared = replacements.map { replacement ->
        val start = offsetFor(document.lineCount, { line -> document.getLineStartOffset(line) }, { line -> document.getLineEndOffset(line) }, replacement.range.start) ?: return null
        val end = offsetFor(document.lineCount, { line -> document.getLineStartOffset(line) }, { line -> document.getLineEndOffset(line) }, replacement.range.end) ?: return null
        if (end < start) return null
        PreparedTextReplacement(start, end, replacement.replacementText)
    }.sortedBy { it.startOffset }
    for (index in 1 until prepared.size) {
        if (prepared[index].startOffset < prepared[index - 1].endOffset) return null
    }
    return prepared
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
