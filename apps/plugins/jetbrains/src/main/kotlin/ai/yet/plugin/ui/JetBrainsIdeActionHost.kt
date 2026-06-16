package ai.yet.plugin.ui

import ai.yet.plugin.bridge.ActiveEditorContext
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
import com.intellij.openapi.vfs.VirtualFile
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
    val contextAttachment: ControlledIdeActions.ActiveFileExcerptAttachment? = null,
)

class JetBrainsIdeActionHost(private val project: Project) : IdeActionHost, ApplyWorkspaceEditHost {
    private val applyHost = JetBrainsApplyWorkspaceEditHost(project)

    override fun apply(request: ControlledIdeActions.ApplyWorkspaceEditRequest): CompletableFuture<ApplyWorkspaceEditHostResult> = applyHost.apply(request)

    override fun execute(request: ControlledIdeActions.Request): CompletableFuture<IdeActionHostResult> = when (request) {
        is ControlledIdeActions.Request.GetContextSnapshot -> contextSnapshot()
        is ControlledIdeActions.Request.GetActiveFileExcerpt -> activeFileExcerpt()
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

    private fun activeFileExcerpt(): CompletableFuture<IdeActionHostResult> = runOnUi {
        val editor = FileEditorManager.getInstance(project).selectedTextEditor
            ?: return@runOnUi unavailable("No active editor is available.")
        val virtualFile = FileDocumentManager.getInstance().getFile(editor.document)
            ?: return@runOnUi rejected("Active editor is not a workspace file.")
        val workspaceRelativePath = workspaceRelativePath(project.basePath, virtualFile.path)
            ?: return@runOnUi rejected("Active editor is not a workspace file.")
        val resolved = resolveWorkspaceFile(project.basePath, workspaceRelativePath)
            ?: return@runOnUi rejected("Active editor file is unavailable.")
        if (virtualFile.toNioPath().toRealPath() != resolved.path) {
            return@runOnUi rejected("Active editor file is unavailable.")
        }
        val document = editor.document
        val fullText = document.text
        if (!ControlledIdeActions.isSafeActiveFileExcerptContent(fullText)) {
            return@runOnUi rejected("Active editor content is not safe to attach.")
        }
        val text = fullText.take(ActiveEditorContext.MaxExcerptTextLength)
        val endOffset = text.length.coerceAtMost(document.textLength)
        val range = excerptRange(document, endOffset)
            ?: return@runOnUi rejected("Active editor range is unavailable.")
        val languageId = virtualFile.fileType.name.takeIf { it.isNotEmpty() && it.length <= 64 }
        IdeActionHostResult(
            status = ControlledIdeActions.ResultStatus.Succeeded,
            message = "Active file excerpt ready.",
            contextAttachment = ControlledIdeActions.ActiveFileExcerptAttachment(
                displayPath = resolved.safePath,
                workspaceRelativePath = resolved.safePath,
                languageId = languageId,
                range = range,
                text = text,
                truncated = fullText.length > text.length,
            ),
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

    private fun rejected(message: String) = IdeActionHostResult(ControlledIdeActions.ResultStatus.Rejected, message)

    private fun unavailable(message: String) = IdeActionHostResult(ControlledIdeActions.ResultStatus.Unavailable, message)
}

class JetBrainsApplyWorkspaceEditHost(private val project: Project) : ApplyWorkspaceEditHost {
    override fun apply(request: ControlledIdeActions.ApplyWorkspaceEditRequest): CompletableFuture<ApplyWorkspaceEditHostResult> {
        val future = CompletableFuture<ApplyWorkspaceEditHostResult>()
        ApplicationManager.getApplication().executeOnPooledThread {
            try {
                val resolved = when (val resolution = resolveApplyWorkspaceEditTargets(project.basePath, request.edits)) {
                    is ApplyWorkspaceEditTargetResolution.Accepted -> resolution.files
                    is ApplyWorkspaceEditTargetResolution.Rejected -> {
                        future.complete(rejected(resolution.message))
                        return@executeOnPooledThread
                    }
                    is ApplyWorkspaceEditTargetResolution.Failed -> {
                        future.complete(failed())
                        return@executeOnPooledThread
                    }
                }
                if (resolved.size != 1) {
                    future.complete(rejected("Workspace edit request must target a single file."))
                    return@executeOnPooledThread
                }
                ApplicationManager.getApplication().invokeLater {
                    try {
                        if (project.isDisposed) {
                            future.complete(failed())
                            return@invokeLater
                        }
                        val item = resolved.single()
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
                        if (!canWriteDocument(virtualFile, document)) {
                            future.complete(rejected("Workspace edit target is not writable."))
                            return@invokeLater
                        }
                        val replacements = prepareReplacements(document, item.replacements)
                        if (replacements == null) {
                            future.complete(rejected("Workspace edit range is outside the file."))
                            return@invokeLater
                        }
                        val replacementText = applyPreparedReplacementsToText(document.text, replacements)
                        WriteCommandAction.runWriteCommandAction(project, "Apply Yet AI Workspace Edit", null, Runnable {
                            document.setText(replacementText)
                        })
                        future.complete(ApplyWorkspaceEditHostResult(ControlledIdeActions.ApplyWorkspaceEditStatus.Applied, "Edit request applied.", replacements.size, listOf(item.file.safePath)))
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
data class PreparedTextReplacement(val startOffset: Int, val endOffset: Int, val replacementText: String)

sealed class ApplyWorkspaceEditTargetResolution {
    data class Accepted(val files: List<ResolvedApplyWorkspaceFile>) : ApplyWorkspaceEditTargetResolution()
    data class Rejected(val message: String) : ApplyWorkspaceEditTargetResolution()
    data object Failed : ApplyWorkspaceEditTargetResolution()
}

fun resolveApplyWorkspaceEditTargets(
    basePath: String?,
    edits: List<ControlledIdeActions.ApplyWorkspaceFileEdit>,
): ApplyWorkspaceEditTargetResolution {
    val resolved = mutableListOf<ResolvedApplyWorkspaceFile>()
    val seenResolvedTargets = mutableSetOf<Path>()
    return try {
        for (fileEdit in edits) {
            val file = resolveWorkspaceFile(basePath, fileEdit.workspaceRelativePath)
                ?: return ApplyWorkspaceEditTargetResolution.Rejected("Workspace edit target is unavailable.")
            if (!seenResolvedTargets.add(file.path)) {
                return ApplyWorkspaceEditTargetResolution.Rejected("Workspace edit target is duplicated.")
            }
            resolved.add(ResolvedApplyWorkspaceFile(file, fileEdit.textReplacements))
        }
        ApplyWorkspaceEditTargetResolution.Accepted(resolved)
    } catch (_: Exception) {
        ApplyWorkspaceEditTargetResolution.Failed
    }
}

private fun canWriteDocument(virtualFile: VirtualFile, document: Document): Boolean =
    virtualFile.isWritable && FileDocumentManager.getInstance().requestWriting(document, null)

fun workspaceRelativePath(basePath: String?, filePath: String): String? = try {
    val base = Path.of(basePath ?: return null).toAbsolutePath().normalize().toRealPath()
    val file = Path.of(filePath).toAbsolutePath().normalize().toRealPath()
    if (!file.startsWith(base)) {
        null
    } else {
        base.relativize(file).joinToString("/") { it.toString() }.takeIf(ControlledIdeActions::isStrictSafeWorkspaceRelativePath)
    }
} catch (_: Exception) {
    null
}

fun excerptRange(document: Document, endOffset: Int): ControlledIdeActions.Range? {
    if (endOffset !in 0..document.textLength || document.lineCount <= 0) return null
    val endLine = document.getLineNumber(endOffset)
    val endCharacter = endOffset - document.getLineStartOffset(endLine)
    return ControlledIdeActions.Range(
        ControlledIdeActions.Position(0, 0),
        ControlledIdeActions.Position(endLine, endCharacter),
    )
}

fun prepareReplacements(document: Document, replacements: List<ControlledIdeActions.ApplyWorkspaceTextReplacement>): List<PreparedTextReplacement>? {
    val prepared = replacements.map { replacement ->
        val start = offsetFor(document.lineCount, { line -> document.getLineStartOffset(line) }, { line -> document.getLineEndOffset(line) }, replacement.range.start) ?: return null
        val end = offsetFor(document.lineCount, { line -> document.getLineStartOffset(line) }, { line -> document.getLineEndOffset(line) }, replacement.range.end) ?: return null
        if (end < start) return null
        PreparedTextReplacement(start, end, replacement.replacementText)
    }.sortedBy { it.startOffset }
    for (index in 1 until prepared.size) {
        if (prepared[index].startOffset == prepared[index - 1].startOffset) return null
        if (prepared[index].startOffset < prepared[index - 1].endOffset) return null
    }
    return prepared
}

fun applyPreparedReplacementsToText(text: String, replacements: List<PreparedTextReplacement>): String {
    val builder = StringBuilder(text)
    replacements.asReversed().forEach { replacement ->
        builder.replace(replacement.startOffset, replacement.endOffset, replacement.replacementText)
    }
    return builder.toString()
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
