package ai.yet.plugin.runtime

import java.io.ByteArrayInputStream
import java.io.InputStream
import java.nio.file.Files
import kotlin.io.path.ExperimentalPathApi
import kotlin.io.path.createTempDirectory
import kotlin.io.path.deleteRecursively
import kotlin.io.path.exists
import kotlin.io.path.isDirectory
import kotlin.io.path.isRegularFile
import kotlin.io.path.readText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

@OptIn(ExperimentalPathApi::class)
class BundledGuiResourcesTest {
    @Test
    fun extractionProducesDistDirWithIndexAndAssets() {
        val temp = createTempDirectory(prefix = "yet-gui-extract-")
        try {
            val result = BundledGuiResources.resolveOrExtract(
                fingerprint = "test-fingerprint",
                cacheRoot = temp,
                source = fixtureSource(
                    "yet-ai-gui/index.html" to "<html></html>",
                    "yet-ai-gui/assets/app.js" to "console.log('ok')",
                ),
            )

            val path = assertNotNull(result.path)
            assertNull(result.unavailableReason)
            assertTrue(path.resolve("index.html").isRegularFile(), path.toString())
            assertTrue(path.resolve("assets").isDirectory(), path.toString())
            assertEquals("<html></html>", path.resolve("index.html").readText())
            assertEquals("console.log('ok')", path.resolve("assets/app.js").readText())
        } finally {
            temp.deleteRecursively()
        }
    }

    @Test
    fun missingIndexReturnsUnavailableReason() {
        val temp = createTempDirectory(prefix = "yet-gui-missing-index-")
        try {
            val result = BundledGuiResources.resolveOrExtract(
                fingerprint = "missing-index",
                cacheRoot = temp,
                source = fixtureSource("yet-ai-gui/assets/app.js" to "console.log('ok')"),
            )

            assertNull(result.path)
            assertEquals(
                "Bundled Yet AI GUI resource is missing yet-ai-gui/index.html",
                result.unavailableReason,
            )
            assertFalse(temp.resolve("gui-missing-index").exists())
        } finally {
            temp.deleteRecursively()
        }
    }

    @Test
    fun repeatedCallsReuseValidDirectory() {
        val temp = createTempDirectory(prefix = "yet-gui-reuse-")
        try {
            val source = countingSource(
                "yet-ai-gui/index.html" to "first",
                "yet-ai-gui/assets/app.js" to "asset",
            )
            val first = BundledGuiResources.resolveOrExtract(
                fingerprint = "reuse",
                cacheRoot = temp,
                source = source,
            )
            assertNotNull(first.path)
            val readsAfterFirst = source.openCount

            val second = BundledGuiResources.resolveOrExtract(
                fingerprint = "reuse",
                cacheRoot = temp,
                source = source,
            )

            assertEquals(first.path, second.path)
            assertEquals(readsAfterFirst, source.openCount, "warm cache must not recopy bundled resources")
            assertEquals("first", assertNotNull(second.path).resolve("index.html").readText())
        } finally {
            temp.deleteRecursively()
        }
    }

    @Test
    fun differentFingerprintUsesDifferentDirectory() {
        val temp = createTempDirectory(prefix = "yet-gui-fingerprint-")
        try {
            val source = fixtureSource(
                "yet-ai-gui/index.html" to "<html></html>",
                "yet-ai-gui/assets/app.js" to "console.log('ok')",
            )

            val first = BundledGuiResources.resolveOrExtract("one", temp, source)
            val second = BundledGuiResources.resolveOrExtract("two", temp, source)

            assertNotNull(first.path)
            assertNotNull(second.path)
            assertNotEquals(first.path, second.path)
            assertEquals("gui-one", first.path.fileName.toString())
            assertEquals("gui-two", second.path.fileName.toString())
        } finally {
            temp.deleteRecursively()
        }
    }

    private fun fixtureSource(vararg files: Pair<String, String>): BundledGuiResources.ResourceSource =
        countingSource(*files)

    private fun countingSource(vararg files: Pair<String, String>): CountingSource =
        CountingSource(files.toMap())

    private class CountingSource(private val files: Map<String, String>) : BundledGuiResources.ResourceSource {
        var openCount: Int = 0
            private set

        override fun list(): List<String> = files.keys.toList()

        override fun open(path: String): InputStream? {
            val value = files[path] ?: return null
            openCount += 1
            return ByteArrayInputStream(value.toByteArray())
        }
    }
}
