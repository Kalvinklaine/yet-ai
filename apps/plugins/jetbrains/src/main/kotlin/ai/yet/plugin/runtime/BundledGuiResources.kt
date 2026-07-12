package ai.yet.plugin.runtime

import com.intellij.openapi.application.PathManager
import java.io.InputStream
import java.net.JarURLConnection
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption.ATOMIC_MOVE
import java.nio.file.StandardCopyOption.REPLACE_EXISTING
import kotlin.io.path.ExperimentalPathApi
import kotlin.io.path.deleteRecursively

object BundledGuiResources {
    const val RESOURCE_ROOT: String = "yet-ai-gui"
    const val CACHE_DIR_NAME: String = "yet-ai/gui"

    data class ExtractionResult(val path: Path?, val unavailableReason: String?) {
        val isAvailable: Boolean get() = path != null
    }

    interface ResourceSource {
        fun list(): List<String>
        fun open(path: String): InputStream?
    }

    fun resolveOrExtract(
        fingerprint: String,
        cacheRoot: Path = defaultCacheRoot(),
        source: ResourceSource = ClasspathResourceSource(BundledGuiResources::class.java.classLoader),
    ): ExtractionResult {
        val entries = source.list()
            .map { it.removePrefix("/") }
            .filter { it.isNotBlank() && !it.endsWith("/") }
            .distinct()
            .sorted()
        if ("$RESOURCE_ROOT/index.html" !in entries) {
            return ExtractionResult(null, "Bundled Yet AI GUI resource is missing $RESOURCE_ROOT/index.html")
        }

        val target = cacheRoot.resolve("gui-${safeFingerprint(fingerprint)}")
        if (isValidDistDir(target)) {
            return ExtractionResult(target, null)
        }

        Files.createDirectories(cacheRoot)
        val temp = Files.createTempDirectory(cacheRoot, "gui-${safeFingerprint(fingerprint)}.")
        try {
            for (entry in entries) {
                if (!entry.startsWith("$RESOURCE_ROOT/")) continue
                val relative = entry.removePrefix("$RESOURCE_ROOT/")
                if (!isSafeRelativePath(relative)) continue
                val destination = temp.resolve(relative).normalize()
                if (!destination.startsWith(temp)) continue
                Files.createDirectories(destination.parent)
                val stream = source.open(entry)
                    ?: return ExtractionResult(null, "Bundled Yet AI GUI resource is listed but unreadable: $entry")
                stream.use { input ->
                    Files.copy(input, destination, REPLACE_EXISTING)
                }
            }
            if (!isValidDistDir(temp)) {
                return ExtractionResult(null, "Bundled Yet AI GUI resources did not produce index.html and assets/")
            }
            replaceDirectory(temp, target)
            return ExtractionResult(target, null)
        } finally {
            if (Files.exists(temp)) {
                runCatching { temp.deleteRecursivelyCompat() }
            }
        }
    }

    fun defaultCacheRoot(): Path = Path.of(systemPath(), CACHE_DIR_NAME)

    private fun isValidDistDir(path: Path): Boolean =
        Files.isRegularFile(path.resolve("index.html")) && Files.isDirectory(path.resolve("assets"))

    private fun safeFingerprint(fingerprint: String): String {
        val safe = fingerprint.map { char -> if (char.isLetterOrDigit() || char == '-' || char == '_') char else '-' }
            .joinToString("")
            .trim('-')
        return safe.ifBlank { "unknown" }
    }

    private fun isSafeRelativePath(path: String): Boolean =
        path.isNotBlank() &&
            !path.startsWith("/") &&
            path.split('/').none { it.isBlank() || it == "." || it == ".." }

    private fun replaceDirectory(source: Path, target: Path) {
        if (Files.exists(target)) {
            target.deleteRecursivelyCompat()
        }
        try {
            Files.move(source, target, ATOMIC_MOVE)
        } catch (_: Exception) {
            Files.move(source, target, REPLACE_EXISTING)
        }
    }

    @OptIn(ExperimentalPathApi::class)
    private fun Path.deleteRecursivelyCompat() {
        deleteRecursively()
    }

    private fun systemPath(): String = try {
        PathManager.getSystemPath()
    } catch (_: Throwable) {
        System.getProperty("user.home") ?: "."
    }

    class ClasspathResourceSource(
        private val classLoader: ClassLoader,
        private val root: String = RESOURCE_ROOT,
    ) : ResourceSource {
        override fun list(): List<String> {
            val url = classLoader.getResource(root) ?: return emptyList()
            return when (url.protocol) {
                "file" -> listFileResources(Path.of(url.toURI()))
                "jar" -> listJarResources(url.openConnection() as JarURLConnection)
                else -> emptyList()
            }
        }

        override fun open(path: String): InputStream? = classLoader.getResourceAsStream(path.removePrefix("/"))

        private fun listFileResources(rootPath: Path): List<String> {
            if (!Files.isDirectory(rootPath)) return emptyList()
            return Files.walk(rootPath).use { stream ->
                stream.filter { Files.isRegularFile(it) }
                    .map { path -> "$root/${rootPath.relativize(path).joinToString("/")}" }
                    .toList()
            }
        }

        private fun listJarResources(connection: JarURLConnection): List<String> {
            val prefix = connection.entryName.trimEnd('/') + "/"
            return connection.jarFile.use { jar ->
                jar.entries().asSequence()
                    .map { it.name }
                    .filter { it.startsWith(prefix) && !it.endsWith("/") }
                    .toList()
            }
        }
    }
}
