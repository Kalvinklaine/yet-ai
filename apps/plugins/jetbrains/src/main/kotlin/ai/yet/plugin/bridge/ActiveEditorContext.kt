package ai.yet.plugin.bridge

object ActiveEditorContext {
    private const val MaxRelativePathLength = 512
    private const val MaxDisplayPathLength = 256
    private const val MaxLanguageIdLength = 64
    private const val MaxSelectionPosition = 1_000_000
    private const val MaxSelectionTextLength = 8_000
    private val languagePattern = Regex("^[A-Za-z0-9_.+-]+$")
    private val secretLikePattern = Regex(
        "(?i)(api[_-]?key|secret|token|password|passwd|authorization|bearer|sk-[a-z0-9]|session[_-]?id|cookie)"
    )

    data class Snapshot(
        val file: FileContext?,
        val selection: SelectionContext?,
    )

    data class FileContext(
        val displayPath: String?,
        val workspaceRelativePath: String?,
        val languageId: String?,
    )

    data class SelectionContext(
        val startLine: Int?,
        val startCharacter: Int?,
        val endLine: Int?,
        val endCharacter: Int?,
        val text: String?,
    )

    fun snapshot(
        displayPath: String? = null,
        workspaceRelativePath: String? = null,
        languageId: String? = null,
        selectionStartLine: Int? = null,
        selectionStartCharacter: Int? = null,
        selectionEndLine: Int? = null,
        selectionEndCharacter: Int? = null,
        selectionText: String? = null,
    ): Snapshot? {
        val safeFile = shapeFile(displayPath, workspaceRelativePath, languageId)
        val safeSelection = shapeSelection(
            selectionStartLine,
            selectionStartCharacter,
            selectionEndLine,
            selectionEndCharacter,
            selectionText,
        )
        if (safeFile == null && safeSelection == null) {
            return null
        }
        return Snapshot(safeFile, safeSelection)
    }

    private fun shapeFile(displayPath: String?, workspaceRelativePath: String?, languageId: String?): FileContext? {
        val safeWorkspaceRelativePath = workspaceRelativePath?.let { safeRelativePath(it, MaxRelativePathLength) }
        val safeDisplayPath = displayPath?.let(::safeDisplayPath)
        val safeLanguageId = languageId?.takeIf(::isSafeLanguageId)
        if (safeDisplayPath == null && safeWorkspaceRelativePath == null && safeLanguageId == null) {
            return null
        }
        return FileContext(safeDisplayPath, safeWorkspaceRelativePath, safeLanguageId)
    }

    private fun shapeSelection(
        startLine: Int?,
        startCharacter: Int?,
        endLine: Int?,
        endCharacter: Int?,
        text: String?,
    ): SelectionContext? {
        val hasCompleteSafeRange = listOf(startLine, startCharacter, endLine, endCharacter).all { isSafePosition(it) }
        val safeText = text?.let(::safeSelectionText)
        if (!hasCompleteSafeRange && safeText == null) {
            return null
        }
        return SelectionContext(
            startLine = startLine.takeIf { hasCompleteSafeRange },
            startCharacter = startCharacter.takeIf { hasCompleteSafeRange },
            endLine = endLine.takeIf { hasCompleteSafeRange },
            endCharacter = endCharacter.takeIf { hasCompleteSafeRange },
            text = safeText,
        )
    }

    private fun safeDisplayPath(value: String): String? {
        val direct = safeRelativePath(value, MaxDisplayPathLength)
        if (direct != null) {
            return direct
        }
        if (!value.startsWith('/') || value.any { it.isISOControl() } || value.contains('\\') || value.contains(':')) {
            return null
        }
        val basename = value.substringAfterLast('/').takeIf { it != value } ?: return null
        return safeRelativePath(basename, MaxDisplayPathLength)
    }

    private fun safeRelativePath(value: String, maxLength: Int): String? {
        if (value.isEmpty() || value.length > maxLength) {
            return null
        }
        if (value.startsWith('/') || value.startsWith('~')) {
            return null
        }
        if (value.any { it.isISOControl() } || value.contains('\\') || value.contains(':')) {
            return null
        }
        if (value.split('/').any { it == "." || it == ".." || it.isEmpty() }) {
            return null
        }
        return value
    }

    private fun isSafeLanguageId(value: String): Boolean =
        value.isNotEmpty() && value.length <= MaxLanguageIdLength && languagePattern.matches(value)

    private fun isSafePosition(value: Int?): Boolean =
        value != null && value in 0..MaxSelectionPosition

    private fun safeSelectionText(value: String): String? {
        if (value.isEmpty()) {
            return null
        }
        if (isBinaryLike(value) || secretLikePattern.containsMatchIn(value)) {
            return null
        }
        return value.take(MaxSelectionTextLength)
    }

    private fun isBinaryLike(value: String): Boolean {
        if (value.any { it == '\u0000' }) {
            return true
        }
        val controls = value.count { it.isISOControl() && it != '\n' && it != '\r' && it != '\t' }
        return controls > 0
    }
}
