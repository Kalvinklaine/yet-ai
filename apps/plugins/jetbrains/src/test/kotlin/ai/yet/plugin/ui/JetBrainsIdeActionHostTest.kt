package ai.yet.plugin.ui

import ai.yet.plugin.bridge.ControlledIdeActions
import com.intellij.openapi.editor.impl.DocumentImpl
import kotlin.io.path.createDirectory
import kotlin.io.path.createSymbolicLinkPointingTo
import kotlin.io.path.createTempDirectory
import kotlin.io.path.writeBytes
import kotlin.io.path.writeText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class JetBrainsIdeActionHostTest {
    @Test
    fun resolvesSafeWorkspaceFile() {
        val root = createTempDirectory()
        root.resolve("src").createDirectory()
        root.resolve("src/Main.kt").writeText("fun main() {}\n")

        val resolved = assertNotNull(resolveWorkspaceFile(root.toString(), "src/Main.kt"))
        assertEquals("src/Main.kt", resolved.safePath)
    }

    @Test
    fun rejectsMissingDirectoryOversizedAndBinaryFiles() {
        val root = createTempDirectory()
        root.resolve("src").createDirectory()
        root.resolve("src/big.txt").writeBytes(ByteArray(2 * 1024 * 1024 + 1) { 'a'.code.toByte() })
        root.resolve("src/bin.txt").writeBytes(byteArrayOf(1, 2, 0, 3))

        assertNull(resolveWorkspaceFile(root.toString(), "src/missing.txt"))
        assertNull(resolveWorkspaceFile(root.toString(), "src"))
        assertNull(resolveWorkspaceFile(root.toString(), "src/big.txt"))
        assertNull(resolveWorkspaceFile(root.toString(), "src/bin.txt"))
    }


    @Test
    fun rejectsSymlinkThatPointsOutsideWorkspace() {
        val root = createTempDirectory()
        val outside = createTempDirectory()
        outside.resolve("secret.txt").writeText("secret")
        val link = root.resolve("linked.txt")
        try {
            link.createSymbolicLinkPointingTo(outside.resolve("secret.txt"))
        } catch (_: Exception) {
            return
        }

        assertNull(resolveWorkspaceFile(root.toString(), "linked.txt"))
    }

    @Test
    fun preparesNonOverlappingReplacementsInDocumentOrder() {
        val document = DocumentImpl("alpha beta gamma\nsecond line\n")
        val replacements = prepareReplacements(
            document,
            listOf(
                replacement(0, 11, 0, 16, "delta"),
                replacement(0, 0, 0, 5, "ALPHA"),
            ),
        )

        assertNotNull(replacements)
        assertEquals(listOf(0, 11), replacements.map { it.startOffset })
        assertEquals(listOf("ALPHA", "delta"), replacements.map { it.replacementText })
    }

    @Test
    fun rejectsOutOfBoundsAndOverlappingReplacements() {
        val document = DocumentImpl("alpha beta\n")

        assertNull(prepareReplacements(document, listOf(replacement(2, 0, 2, 1, "bad"))))
        assertNull(
            prepareReplacements(
                document,
                listOf(
                    replacement(0, 0, 0, 6, "one"),
                    replacement(0, 5, 0, 10, "two"),
                ),
            ),
        )
    }

    @Test
    fun rejectsMultipleZeroLengthInsertionsAtSameOffset() {
        val document = DocumentImpl("alpha beta\n")

        assertNull(
            prepareReplacements(
                document,
                listOf(
                    replacement(0, 5, 0, 5, " one"),
                    replacement(0, 5, 0, 5, " two"),
                ),
            ),
        )
    }

    @Test
    fun computesReplacementTextWithoutMutatingDocumentBeforeWrite() {
        val originalText = "alpha beta gamma\n"
        val replacements = prepareReplacements(
            DocumentImpl(originalText),
            listOf(
                replacement(0, 0, 0, 5, "ALPHA"),
                replacement(0, 11, 0, 16, "GAMMA"),
            ),
        )

        assertNotNull(replacements)
        val replaced = applyPreparedReplacementsToText(originalText, replacements)

        assertEquals("ALPHA beta GAMMA\n", replaced)
        assertEquals("alpha beta gamma\n", originalText)
    }

    @Test
    fun rejectsDuplicateResolvedTargetsThroughSymlinkBeforeApply() {
        val root = createTempDirectory()
        root.resolve("src").createDirectory()
        val target = root.resolve("src/Main.kt")
        target.writeText("fun main() {}\n")
        val link = root.resolve("Alias.kt")
        try {
            link.createSymbolicLinkPointingTo(target)
        } catch (_: Exception) {
            return
        }

        val resolution = resolveApplyWorkspaceEditTargets(
            root.toString(),
            listOf(
                fileEdit("src/Main.kt", replacement(0, 0, 0, 3, "val")),
                fileEdit("Alias.kt", replacement(0, 4, 0, 8, "alias")),
            ),
        )

        assertIs<ApplyWorkspaceEditTargetResolution.Rejected>(resolution)
        assertEquals("Workspace edit target is duplicated.", resolution.message)
        assertEquals("fun main() {}\n", target.toFile().readText())
    }

    @Test
    fun acceptsDistinctResolvedTargetsForLaterSingleFileMvpRejection() {
        val root = createTempDirectory()
        root.resolve("src").createDirectory()
        root.resolve("src/Main.kt").writeText("fun main() {}\n")
        root.resolve("src/Second.kt").writeText("fun second() {}\n")

        val resolution = resolveApplyWorkspaceEditTargets(
            root.toString(),
            listOf(
                fileEdit("src/Main.kt", replacement(0, 0, 0, 3, "val")),
                fileEdit("src/Second.kt", replacement(0, 0, 0, 3, "val")),
            ),
        )

        val accepted = assertIs<ApplyWorkspaceEditTargetResolution.Accepted>(resolution)
        assertEquals(listOf("src/Main.kt", "src/Second.kt"), accepted.files.map { it.file.safePath })
    }

    @Test
    fun rejectsTraversalAndUnsafeInputs() {
        val root = createTempDirectory()
        root.resolve("safe.txt").writeText("safe")

        assertNull(resolveWorkspaceFile(root.toString(), "../safe.txt"))
        assertNull(resolveWorkspaceFile(root.toString(), "/safe.txt"))
        assertNull(resolveWorkspaceFile(null, "safe.txt"))
    }
}

private fun fileEdit(path: String, vararg replacements: ControlledIdeActions.ApplyWorkspaceTextReplacement): ControlledIdeActions.ApplyWorkspaceFileEdit =
    ControlledIdeActions.ApplyWorkspaceFileEdit(path, replacements.toList())

private fun replacement(startLine: Int, startCharacter: Int, endLine: Int, endCharacter: Int, text: String): ControlledIdeActions.ApplyWorkspaceTextReplacement =
    ControlledIdeActions.ApplyWorkspaceTextReplacement(
        ControlledIdeActions.Range(
            ControlledIdeActions.Position(startLine, startCharacter),
            ControlledIdeActions.Position(endLine, endCharacter),
        ),
        text,
    )
