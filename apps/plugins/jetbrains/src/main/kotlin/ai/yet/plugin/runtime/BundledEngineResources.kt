package ai.yet.plugin.runtime

import ai.yet.plugin.identity.ProductIdentity
import com.intellij.openapi.application.PathManager
import java.io.InputStream
import java.nio.file.Files
import java.nio.file.LinkOption.NOFOLLOW_LINKS
import java.nio.file.Path
import java.nio.file.StandardCopyOption.ATOMIC_MOVE
import java.nio.file.StandardCopyOption
import java.nio.file.attribute.PosixFilePermission
import java.security.MessageDigest

/**
 * Helpers that locate the bundled `yet-lsp` (or `yet-lsp.exe`) shipped inside the
 * JetBrains plugin JAR, extract it to a deterministic on-disk cache directory
 * owned by the IDE/product, and report whether the bundled binary is present.
 *
 * The cache path is intentionally derived from the resource content hash so a
 * plugin update that ships a different binary transparently re-extracts. The
 * directory is placed under `PathManager.getSystemPath()` (`~/.config/...` or
 * the JetBrains equivalent for the host IDE) so it is product-local, follows
 * the IDE's cache conventions, and never leaks into the user's working tree.
 *
 * All side effects (classpath access, file writes, permission changes) are
 * routed through injectable functions so unit tests can drive the helper
 * without touching real plugin state.
 */
object BundledEngineResources {
    const val CACHE_DIR_NAME: String = "yet-ai/engine"

    /** Absolute resource path inside the plugin JAR (leading slash, classpath style). */
    fun bundledResourcePath(osName: String = System.getProperty("os.name")): String {
        val name = if (osName.lowercase().contains("win")) "${ProductIdentity.engineBinaryName}.exe" else ProductIdentity.engineBinaryName
        return "/yet-ai-engine/$name"
    }

    fun bundledResourceName(osName: String = System.getProperty("os.name")): String {
        val path = bundledResourcePath(osName)
        return path.substring(path.lastIndexOf('/') + 1)
    }

    /** True if the plugin JAR currently ships a bundled engine resource. */
    fun isBundled(
        classLoader: ClassLoader = BundledEngineResources::class.java.classLoader,
        osName: String = System.getProperty("os.name"),
    ): Boolean = loadStream(classLoader, bundledResourcePath(osName)) != null

    /**
     * Resolve a launchable on-disk path to the bundled engine resource, extracting
     * it to the cache directory the first time it is needed. Returns `null` if the
     * plugin JAR does not ship a bundled resource (so callers can fall back to PATH).
     *
     * Throws [IllegalStateException] when the resource is present but extraction
     * fails or the resulting file is not launchable; callers surface a clear error
     * rather than silently degrading.
     */
    fun resolveOrExtract(
        classLoader: ClassLoader = BundledEngineResources::class.java.classLoader,
        cacheDir: Path = defaultCacheDir(),
        osName: String = System.getProperty("os.name"),
        resourceLoader: (String) -> InputStream? = { path -> classLoader.getResourceAsStream(path) },
        cacheDirCreator: (Path) -> Path = { dir -> Files.createDirectories(dir) },
        permissionApplier: (Path) -> Unit = { path -> applyExecutablePermissions(path, osName) },
    ): Path? {
        val resourcePath = bundledResourcePath(osName)
        val resourceName = resourcePath.removePrefix("/")
        val stream = resourceLoader(resourceName) ?: return null
        val (tempResource, hash, resourceSize) = copyResourceToTemporaryCacheFile(stream, cacheDir, cacheDirCreator)
        val target = cacheFile(cacheDir, hash, osName)
        try {
            val cacheValid = isRegularCacheEntry(target) && runCatching {
                Files.size(target) == resourceSize && sha256(target) == hash
            }.getOrDefault(false)
            if (!cacheValid) {
                cacheDirCreator(cacheDir)
                writeBundledFileSafely(tempResource, target)
                permissionApplier(target)
            } else if (!isLaunchableEngineFile(target, osName)) {
                // Existing cache file lost its executable bit (e.g. extracted on
                // Windows and copied to a non-FAT cache). Re-apply best effort.
                permissionApplier(target)
            }
        } finally {
            Files.deleteIfExists(tempResource)
        }
        if (!isLaunchableEngineFile(target, osName)) {
            throw IllegalStateException("Bundled Yet AI engine resource is not launchable after extraction")
        }
        return target
    }

    /**
     * Diagnostics-friendly description that avoids exposing the on-disk cache path
     * or any user/host-specific fragments. Reports only `available` or `not bundled`.
     */
    fun describeAvailability(
        classLoader: ClassLoader = BundledEngineResources::class.java.classLoader,
        osName: String = System.getProperty("os.name"),
    ): String = if (isBundled(classLoader, osName)) "available" else "not bundled"

    fun defaultCacheDir(): Path = Path.of(systemPath(), "yet-ai", "engine")

    /**
     * Indirection so production code uses JetBrains `PathManager` and tests
     * (which may run outside a fully bootstrapped IDE) do not crash when the
     * IntelliJ test framework is not on the classpath.
     */
    private fun systemPath(): String = try {
        PathManager.getSystemPath()
    } catch (_: Throwable) {
        System.getProperty("user.home") ?: "."
    }

    private fun cacheFile(cacheDir: Path, contentHash: String, osName: String): Path {
        val name = bundledResourceName(osName)
        return cacheDir.resolve("$contentHash-$name")
    }

    private fun loadStream(classLoader: ClassLoader, resourcePath: String): InputStream? =
        classLoader.getResourceAsStream(resourcePath.removePrefix("/"))

    private data class CachedResourceCopy(val path: Path, val sha256: String, val size: Long)

    private fun copyResourceToTemporaryCacheFile(
        stream: InputStream,
        cacheDir: Path,
        cacheDirCreator: (Path) -> Path,
    ): CachedResourceCopy {
        cacheDirCreator(cacheDir)
        val temp = Files.createTempFile(cacheDir, "bundled-resource.", ".tmp")
        val digest = MessageDigest.getInstance("SHA-256")
        var size = 0L
        stream.use { input ->
            Files.newOutputStream(temp).use { output ->
                val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    output.write(buffer, 0, read)
                    digest.update(buffer, 0, read)
                    size += read
                }
            }
        }
        return CachedResourceCopy(temp, digest.digest().toHex(), size)
    }

    private fun sha256(path: Path): String {
        val digest = MessageDigest.getInstance("SHA-256")
        Files.newInputStream(path).use { input ->
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().toHex()
    }

    private fun ByteArray.toHex(): String = joinToString(separator = "") { byte -> "%02x".format(byte) }

    private fun isRegularCacheEntry(path: Path): Boolean =
        Files.exists(path, NOFOLLOW_LINKS) &&
            !Files.isSymbolicLink(path) &&
            Files.isRegularFile(path, NOFOLLOW_LINKS)

    private fun writeBundledFileSafely(source: Path, target: Path) {
        val temp = Files.createTempFile(target.parent, "${target.fileName}.", ".tmp")
        try {
            Files.copy(source, temp, StandardCopyOption.REPLACE_EXISTING)
            try {
                Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING, ATOMIC_MOVE)
            } catch (_: Exception) {
                Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING)
            }
        } finally {
            Files.deleteIfExists(temp)
        }
    }

    internal fun applyExecutablePermissions(path: Path, osName: String) {
        if (osName.lowercase().contains("win")) return
        try {
            val perms = Files.getPosixFilePermissions(path).toMutableSet()
            perms.add(PosixFilePermission.OWNER_READ)
            perms.add(PosixFilePermission.OWNER_EXECUTE)
            perms.add(PosixFilePermission.GROUP_READ)
            perms.add(PosixFilePermission.GROUP_EXECUTE)
            perms.add(PosixFilePermission.OTHERS_READ)
            perms.add(PosixFilePermission.OTHERS_EXECUTE)
            Files.setPosixFilePermissions(path, perms)
        } catch (_: Exception) {
            // Non-POSIX filesystems (e.g. Windows mounted FAT) cannot chmod; rely
            // on the existing executable heuristic that accepts .exe/.cmd/.bat.
        }
    }
}
