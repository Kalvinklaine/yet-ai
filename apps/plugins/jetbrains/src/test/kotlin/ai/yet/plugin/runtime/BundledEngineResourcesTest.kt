package ai.yet.plugin.runtime

import java.io.ByteArrayInputStream
import java.io.InputStream
import java.nio.file.Files
import java.nio.file.LinkOption.NOFOLLOW_LINKS
import java.nio.file.Path
import java.nio.file.attribute.PosixFilePermission
import java.security.MessageDigest
import kotlin.io.path.ExperimentalPathApi
import kotlin.io.path.createTempDirectory
import kotlin.io.path.deleteRecursively
import kotlin.io.path.exists
import kotlin.io.path.getPosixFilePermissions
import kotlin.io.path.isRegularFile
import kotlin.io.path.readBytes
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

@OptIn(ExperimentalPathApi::class)
class BundledEngineResourcesTest {
    @Test
    fun extractionProducesNonEmptyFile() {
        val temp = createTempDirectory(prefix = "yet-bundled-extract-")
        try {
            val bytes = "binary-payload".toByteArray()
            val target = BundledEngineResources.resolveOrExtract(
                cacheDir = temp,
                osName = "Linux",
                resourceLoader = { ByteArrayInputStream(bytes) },
                cacheDirCreator = { Files.createDirectories(it) },
                permissionApplier = { it.markLaunchable() },
            )
            assertNotNull(target)
            assertTrue(target.isRegularFile(), target.toString())
            assertEquals(bytes.size, target.readBytes().size)
            assertEquals(bytes.toList(), target.readBytes().toList())
        } finally {
            temp.deleteRecursively()
        }
    }

    @Test
    fun extractionRepairsTamperedContentHashCacheFile() {
        val temp = createTempDirectory(prefix = "yet-bundled-cache-")
        try {
            val bytes = "deterministic-payload".toByteArray()
            val first = BundledEngineResources.resolveOrExtract(
                cacheDir = temp,
                osName = "Linux",
                resourceLoader = { ByteArrayInputStream(bytes) },
                cacheDirCreator = { Files.createDirectories(it) },
                permissionApplier = { it.markLaunchable() },
            )
            assertNotNull(first)
            assertTrue(first.exists())
            val hash = sha256(bytes)
            assertTrue(
                first.fileName.toString().startsWith("$hash-"),
                "cache file name should be content-hash prefixed, got ${first.fileName}",
            )

            // Second call: cache is warm but the file has been tampered with.
            // The helper must verify bytes, repair the cache, and re-apply
            // launch permissions instead of trusting the hash-named path.
            val mutated = "mutated-contents".toByteArray()
            Files.write(first, mutated)
            var permissionApplications = 0
            val second = BundledEngineResources.resolveOrExtract(
                cacheDir = temp,
                osName = "Linux",
                resourceLoader = { ByteArrayInputStream(bytes) },
                cacheDirCreator = { Files.createDirectories(it) },
                permissionApplier = { permissionApplications += 1; it.markLaunchable() },
            )
            assertEquals(first, second)
            assertNotNull(second)
            assertEquals(bytes.toList(), second.readBytes().toList(), "tampered cached file must be repaired")
            assertEquals(1, permissionApplications, "repaired cache must have launch permissions re-applied")
        } finally {
            temp.deleteRecursively()
        }
    }

    @Test
    fun extractionRepairsSymlinkedContentHashCacheEntry() {
        val temp = createTempDirectory(prefix = "yet-bundled-cache-symlink-")
        try {
            val bytes = "symlink-repair-payload".toByteArray()
            val hash = sha256(bytes)
            val target = temp.resolve("$hash-${BundledEngineResources.bundledResourceName("Linux")}")
            val symlinkDestination = temp.resolve("attacker-controlled-engine")
            Files.write(symlinkDestination, bytes)
            try {
                Files.createSymbolicLink(target, symlinkDestination.fileName)
            } catch (_: Exception) {
                return
            }

            val repaired = BundledEngineResources.resolveOrExtract(
                cacheDir = temp,
                osName = "Linux",
                resourceLoader = { ByteArrayInputStream(bytes) },
                cacheDirCreator = { Files.createDirectories(it) },
                permissionApplier = { it.markLaunchable() },
            )

            assertEquals(target, repaired)
            assertNotNull(repaired)
            assertFalse(Files.isSymbolicLink(repaired), "hash-named cache entry must be repaired to a real file")
            assertTrue(Files.isRegularFile(repaired, NOFOLLOW_LINKS), repaired.toString())
            assertEquals(bytes.toList(), repaired.readBytes().toList())
            assertTrue(isLaunchableEngineFile(repaired, "Linux"), "repaired cache entry must be launchable")
        } finally {
            temp.deleteRecursively()
        }
    }

    @Test
    fun extractionAppliesExecutablePermissionsOnUnix() {
        val temp = createTempDirectory(prefix = "yet-bundled-perms-")
        try {
            val bytes = "unix-binary".toByteArray()
            val target = BundledEngineResources.resolveOrExtract(
                cacheDir = temp,
                osName = "Mac OS X",
                resourceLoader = { ByteArrayInputStream(bytes) },
                cacheDirCreator = { Files.createDirectories(it) },
                permissionApplier = { BundledEngineResources.applyExecutablePermissions(it, "Mac OS X") },
            )
            assertNotNull(target)
            val perms = target.getPosixFilePermissions()
            assertTrue(PosixFilePermission.OWNER_EXECUTE in perms, "owner execute missing: $perms")
            assertTrue(PosixFilePermission.GROUP_EXECUTE in perms, "group execute missing: $perms")
            assertTrue(PosixFilePermission.OTHERS_EXECUTE in perms, "others execute missing: $perms")
        } finally {
            temp.deleteRecursively()
        }
    }

    @Test
    fun extractionReturnsNonNullOnWindows() {
        val temp = createTempDirectory(prefix = "yet-bundled-win-")
        try {
            val bytes = "windows-binary".toByteArray()
            val target = BundledEngineResources.resolveOrExtract(
                cacheDir = temp,
                osName = "Windows 11",
                resourceLoader = { ByteArrayInputStream(bytes) },
                cacheDirCreator = { Files.createDirectories(it) },
                permissionApplier = { BundledEngineResources.applyExecutablePermissions(it, "Windows 11") },
            )
            assertNotNull(target)
            assertTrue(target.fileName.toString().endsWith(".exe"))
        } finally {
            temp.deleteRecursively()
        }
    }

    @Test
    fun applyExecutablePermissionsIsNoOpOnWindows() {
        val temp = createTempDirectory(prefix = "yet-bundled-win-perm-")
        try {
            val file = Files.createTempFile(temp, "yet-win-", ".exe")
            val before = runCatching { file.getPosixFilePermissions() }.getOrNull()
            BundledEngineResources.applyExecutablePermissions(file, "Windows 11")
            val after = runCatching { file.getPosixFilePermissions() }.getOrNull()
            if (before != null && after != null) {
                assertEquals(before, after, "Windows should never chmod the binary")
            }
        } finally {
            temp.deleteRecursively()
        }
    }

    @Test
    fun extractionReturnsNullWhenBundleResourceMissing() {
        val temp = createTempDirectory(prefix = "yet-bundled-missing-")
        try {
            val target = BundledEngineResources.resolveOrExtract(
                cacheDir = temp,
                osName = "Linux",
                resourceLoader = { null },
                cacheDirCreator = { error("should not create dir when bundle is missing") },
                permissionApplier = { error("should not chmod when bundle is missing") },
            )
            assertNull(target)
            assertFalse(Files.exists(temp.resolve("should-not-exist")))
        } finally {
            temp.deleteRecursively()
        }
    }


    @Test
    fun bundledResourceLookupStripsLeadingSlashForClassLoaderAccess() {
        val requested = mutableListOf<String>()
        val payload = "bundled-lsp".toByteArray()
        val loader = object : ClassLoader() {
            override fun getResourceAsStream(name: String?): InputStream? {
                requested += name.orEmpty()
                return if (name == "yet-ai-engine/yet-lsp") ByteArrayInputStream(payload) else null
            }
        }

        assertTrue(BundledEngineResources.isBundled(loader, "Linux"))
        assertEquals(listOf("yet-ai-engine/yet-lsp"), requested)

        requested.clear()
        val temp = createTempDirectory(prefix = "yet-bundled-normalized-")
        try {
            val target = BundledEngineResources.resolveOrExtract(
                classLoader = loader,
                cacheDir = temp,
                osName = "Linux",
                resourceLoader = { name ->
                    requested += name
                    if (name == "yet-ai-engine/yet-lsp") ByteArrayInputStream(payload) else null
                },
                cacheDirCreator = { Files.createDirectories(it) },
                permissionApplier = { it.markLaunchable() },
            )
            assertNotNull(target)
            assertTrue(requested.all { it == "yet-ai-engine/yet-lsp" }, "resource access must be normalized: $requested")
        } finally {
            temp.deleteRecursively()
        }
    }

    @Test
    fun isBundledReturnsFalseWhenResourceMissing() {
        val absent = BundledEngineResources.isBundled(
            classLoader = object : ClassLoader() {
                override fun getResourceAsStream(name: String?): InputStream? = null
            },
            osName = "Linux",
        )
        assertFalse(absent, "absent bundle should report false")
    }

    @Test
    fun describeAvailabilityReportsSanitizedStatus() {
        val absent = BundledEngineResources.describeAvailability(
            classLoader = object : ClassLoader() {
                override fun getResourceAsStream(name: String?): InputStream? = null
            },
            osName = "Linux",
        )
        assertEquals("not bundled", absent)
        val privatePath = "/Users/alice/Library/Application Support/yet-ai/engine/abcdef-yet-lsp"
        assertFalse(absent.contains(privatePath))
    }

    @Test
    fun bundledResourcePathUsesExeSuffixOnWindows() {
        assertEquals("/yet-ai-engine/yet-lsp.exe", BundledEngineResources.bundledResourcePath("Windows 11"))
        assertEquals("/yet-ai-engine/yet-lsp", BundledEngineResources.bundledResourcePath("Linux"))
        assertEquals("/yet-ai-engine/yet-lsp", BundledEngineResources.bundledResourcePath("Mac OS X"))
    }

    @Test
    fun bundledResourceNameMatchesBinaryBaseName() {
        assertEquals("yet-lsp.exe", BundledEngineResources.bundledResourceName("Windows 11"))
        assertEquals("yet-lsp", BundledEngineResources.bundledResourceName("Linux"))
    }

    @Test
    fun resolveEngineBinaryPrefersConfiguredPathEvenWhenBundlePresent() {
        val configured = createLaunchableTempFile(prefix = "yet-resolve-configured-")
        try {
            val resolved = resolveEngineBinary(
                configuredPath = configured,
                bundled = Path.of("/nonexistent/bundled/yet-lsp"),
            )
            assertEquals(configured, resolved)
        } finally {
            Files.deleteIfExists(configured)
        }
    }

    @Test
    fun resolveEngineBinaryFallsBackToBundledWhenNoConfiguredPath() {
        val bundled = createLaunchableTempFile(prefix = "yet-resolve-bundled-")
        try {
            val resolved = resolveEngineBinary(
                configuredPath = null,
                bundled = bundled,
            )
            assertEquals(bundled, resolved)
        } finally {
            Files.deleteIfExists(bundled)
        }
    }

    @Test
    fun resolveEngineBinaryReturnsNullWhenNothingAvailable() {
        val resolved = resolveEngineBinary(
            configuredPath = null,
            bundled = null,
        )
        assertNull(resolved)
    }

    @Test
    fun resolveEngineBinaryRejectsNonLaunchableConfiguredPath() {
        val notLaunchable = Files.createTempFile("yet-resolve-bad-", "")
        try {
            if (!System.getProperty("os.name").lowercase().contains("win")) {
                notLaunchable.toFile().setExecutable(false, false)
                notLaunchable.toFile().setReadable(false, false)
            }
            val error = assertFailsWith<IllegalArgumentException> {
                resolveEngineBinary(
                    configuredPath = notLaunchable,
                    bundled = Path.of("/ignored/bundled"),
                )
            }
            assertEquals("Yet AI engine binary path must point to an executable file", error.message)
        } finally {
            notLaunchable.toFile().setExecutable(true, false)
            notLaunchable.toFile().setReadable(true, false)
            Files.deleteIfExists(notLaunchable)
        }
    }

    @Test
    fun describeEngineBinaryStatusReportsBundledAvailabilityWithoutLeakingPath() {
        val settings = RuntimeSettings("http://127.0.0.1:8123", null, null, LaunchMode.AUTO, null)
        val privatePath = "/Users/alice/Library/Application Support/yet-ai/engine/abcdef-yet-lsp"

        val cases = mapOf(
            "available" to "bundled plugin runtime binary available (preferred installable path)",
            "not bundled" to "no bundled, configured, or PATH binary; connect-only fallback",
        )

        for ((availability, expected) in cases) {
            val status = describeEngineBinaryStatus(settings, bundledAvailability = availability)
            assertEquals(expected, status, "unexpected status for availability=$availability")
            assertFalse(privatePath in status, "diagnostics must not leak the on-disk path: $status")
        }
    }

    @Test
    fun describeEngineBinaryStatusConnectModeStaysSanitized() {
        val settings = RuntimeSettings("http://127.0.0.1:8123", null, null, LaunchMode.CONNECT, null)
        val privatePath = "/Users/alice/Library/Application Support/yet-ai/engine/abcdef-yet-lsp"

        val status = describeEngineBinaryStatus(settings, bundledAvailability = "available")
        assertEquals("not used in connect mode", status)
        assertFalse(privatePath in status)
    }

    @Test
    fun describeEngineBinaryStatusLaunchModeReportsMissingAndNotExecutable() {
        val missing = describeEngineBinaryStatus(
            RuntimeSettings("http://127.0.0.1:8123", null, null, LaunchMode.LAUNCH, null),
            bundledAvailability = "not bundled",
        )
        assertEquals("no configured path and no bundled plugin binary available", missing)

        val bundled = describeEngineBinaryStatus(
            RuntimeSettings("http://127.0.0.1:8123", null, null, LaunchMode.LAUNCH, null),
            bundledAvailability = "available",
        )
        assertEquals("bundled plugin runtime binary available (preferred installable path)", bundled)
        assertFalse(bundled.contains("configured path missing"), bundled)

        val configured = createLaunchableTempFile(prefix = "yet-status-launch-")
        try {
            val ok = describeEngineBinaryStatus(
                RuntimeSettings("http://127.0.0.1:8123", null, null, LaunchMode.LAUNCH, configured),
                bundledAvailability = "not bundled",
            )
            assertEquals("configured absolute binary is executable", ok)
        } finally {
            Files.deleteIfExists(configured)
        }
    }

    @Test
    fun describeEngineBinaryStatusAutoModePrefersConfiguredOverBundled() {
        val configured = createLaunchableTempFile(prefix = "yet-status-auto-")
        try {
            val status = describeEngineBinaryStatus(
                RuntimeSettings("http://127.0.0.1:8123", null, null, LaunchMode.AUTO, configured),
                bundledAvailability = "available",
            )
            assertEquals("configured absolute binary is executable", status)
        } finally {
            Files.deleteIfExists(configured)
        }
    }

    private fun createLaunchableTempFile(prefix: String): Path {
        val file = Files.createTempFile(prefix, "")
        if (!System.getProperty("os.name").lowercase().contains("win")) {
            file.toFile().setExecutable(true, false)
            file.toFile().setReadable(true, false)
        }
        return file
    }

    private fun Path.markLaunchable() {
        if (!System.getProperty("os.name").lowercase().contains("win")) {
            toFile().setExecutable(true, false)
            toFile().setReadable(true, false)
        }
    }

    private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
        .digest(bytes)
        .joinToString("") { byte -> "%02x".format(byte) }
}
