package ai.yet.plugin.ui

import kotlin.io.path.createDirectory
import kotlin.io.path.createTempDirectory
import kotlin.io.path.writeBytes
import kotlin.io.path.writeText
import kotlin.test.Test
import kotlin.test.assertEquals
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
    fun rejectsTraversalAndUnsafeInputs() {
        val root = createTempDirectory()
        root.resolve("safe.txt").writeText("safe")

        assertNull(resolveWorkspaceFile(root.toString(), "../safe.txt"))
        assertNull(resolveWorkspaceFile(root.toString(), "/safe.txt"))
        assertNull(resolveWorkspaceFile(null, "safe.txt"))
    }
}
