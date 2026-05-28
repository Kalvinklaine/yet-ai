package ai.yet.plugin.bridge

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class ActiveEditorContextTest {
    @Test
    fun projectRelativeSafeFileIsKept() {
        val snapshot = ActiveEditorContext.snapshot(
            workspaceRelativePath = "src/main/App.kt",
            displayPath = "src/main/App.kt",
            languageId = "kotlin",
        )

        assertNotNull(snapshot)
        assertEquals("src/main/App.kt", snapshot.file?.workspaceRelativePath)
        assertEquals("src/main/App.kt", snapshot.file?.displayPath)
        assertEquals("kotlin", snapshot.file?.languageId)
    }

    @Test
    fun outsideProjectCandidateKeepsBasenameOnly() {
        val snapshot = ActiveEditorContext.snapshot(displayPath = "/Users/person/private/Notes.kt")

        assertNotNull(snapshot)
        assertEquals("Notes.kt", snapshot.file?.displayPath)
        assertNull(snapshot.file?.workspaceRelativePath)
    }

    @Test
    fun unsafePathsAreOmitted() {
        assertNull(ActiveEditorContext.snapshot(workspaceRelativePath = "/abs/File.kt")?.file?.workspaceRelativePath)

        val values = listOf(
            "~/File.kt",
            "../File.kt",
            "src/./File.kt",
            "src/../File.kt",
            "C:/File.kt",
            "src\\File.kt",
            "src/line\nbreak.kt",
            "a".repeat(513),
        )

        values.forEach { value ->
            val snapshot = ActiveEditorContext.snapshot(workspaceRelativePath = value, displayPath = value)
            assertNull(snapshot)
        }
    }

    @Test
    fun languageIdValidationKeepsOnlySafeValues() {
        assertEquals("kotlin.jvm-1", ActiveEditorContext.snapshot(languageId = "kotlin.jvm-1")?.file?.languageId)
        assertNull(ActiveEditorContext.snapshot(languageId = ""))
        assertNull(ActiveEditorContext.snapshot(languageId = "bad language"))
        assertNull(ActiveEditorContext.snapshot(languageId = "bad/language"))
        assertNull(ActiveEditorContext.snapshot(languageId = "a".repeat(65)))
    }

    @Test
    fun selectionRangeAndTextAreBounded() {
        val text = "a".repeat(8_010)
        val snapshot = ActiveEditorContext.snapshot(
            selectionStartLine = 1,
            selectionStartCharacter = 2,
            selectionEndLine = 3,
            selectionEndCharacter = 4,
            selectionText = text,
        )

        assertNotNull(snapshot)
        assertEquals(1, snapshot.selection?.startLine)
        assertEquals(2, snapshot.selection?.startCharacter)
        assertEquals(3, snapshot.selection?.endLine)
        assertEquals(4, snapshot.selection?.endCharacter)
        assertEquals(8_000, snapshot.selection?.text?.length)
    }

    @Test
    fun invalidSelectionRangeCanStillKeepSafeText() {
        val snapshot = ActiveEditorContext.snapshot(
            selectionStartLine = -1,
            selectionStartCharacter = 2,
            selectionEndLine = 3,
            selectionEndCharacter = 4,
            selectionText = "safe text",
        )

        assertNotNull(snapshot)
        assertNull(snapshot.selection?.startLine)
        assertEquals("safe text", snapshot.selection?.text)
    }

    @Test
    fun secretLikeOrBinarySelectionTextIsOmitted() {
        val secretLike = ActiveEditorContext.snapshot(selectionText = "token placeholder")
        val binaryLike = ActiveEditorContext.snapshot(selectionText = "safe\u0000text")

        assertNull(secretLike)
        assertNull(binaryLike)
    }

    @Test
    fun returnsNullWhenNothingSafeOrUsefulExists() {
        val snapshot = ActiveEditorContext.snapshot(
            displayPath = "/",
            workspaceRelativePath = "../bad.kt",
            languageId = "bad language",
            selectionStartLine = 1_000_001,
            selectionText = "",
        )

        assertNull(snapshot)
    }
}
