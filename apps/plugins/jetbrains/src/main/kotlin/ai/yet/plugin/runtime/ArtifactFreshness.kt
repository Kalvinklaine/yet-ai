package ai.yet.plugin.runtime

import java.io.InputStream
import java.security.MessageDigest
import java.time.Instant
import java.util.Properties

data class ArtifactFreshness(
    val buildCommit: String = UNKNOWN,
    val buildTimestamp: String = UNKNOWN,
    val packagedGuiFingerprint: String = UNKNOWN,
    val bundledEngineFingerprint: String = UNKNOWN,
    val runtimeBinaryFreshness: String = "unknown",
) {
    companion object {
        const val UNKNOWN = "unknown"

        fun unknown(runtimeBinaryFreshness: String = "unknown"): ArtifactFreshness = ArtifactFreshness(
            runtimeBinaryFreshness = runtimeBinaryFreshness,
        )
    }
}

internal object ArtifactFreshnessResources {
    const val METADATA_RESOURCE: String = "yet-ai-artifact/build.properties"

    fun describe(
        settings: RuntimeSettings,
        owner: EffectiveRuntimeOwner,
        classLoader: ClassLoader = ArtifactFreshnessResources::class.java.classLoader,
        osName: String = System.getProperty("os.name"),
        metadataLoader: (String) -> InputStream? = { path -> classLoader.getResourceAsStream(path) },
        bundledResourceLoader: (String) -> InputStream? = { path -> classLoader.getResourceAsStream(path) },
    ): ArtifactFreshness {
        if (settings.launchMode == LaunchMode.CONNECT) {
            return metadata(metadataLoader).toFreshness("connect-mode external", null)
        }
        if (settings.engineBinaryPath != null) {
            return metadata(metadataLoader).toFreshness("configured external", null)
        }
        if (owner != EffectiveRuntimeOwner.IDE_HOST) {
            return metadata(metadataLoader).toFreshness("unavailable", null)
        }
        val metadata = metadata(metadataLoader)
        val actualBundled = bundledResourceSha256(osName, bundledResourceLoader)
        val expectedBundled = metadata.bundledEngineSha256
        val classification = when {
            actualBundled == null -> "unavailable"
            expectedBundled == null -> "unknown"
            actualBundled.equals(expectedBundled, ignoreCase = true) -> "bundled match"
            else -> "mismatch"
        }
        return metadata.toFreshness(classification, actualBundled)
    }

    private fun metadata(loader: (String) -> InputStream?): BuildArtifactMetadata {
        val stream = runCatching { loader(METADATA_RESOURCE) }.getOrNull() ?: return BuildArtifactMetadata()
        return runCatching {
            val properties = Properties()
            stream.use { properties.load(it) }
            BuildArtifactMetadata(
                commit = safeCommit(properties.getProperty("build.commit")),
                timestamp = safeTimestamp(properties.getProperty("build.timestamp")),
                packagedGuiSha256 = safeSha256(properties.getProperty("gui.sha256")),
                bundledEngineSha256 = safeSha256(properties.getProperty("engine.sha256")),
            )
        }.getOrElse { BuildArtifactMetadata() }
    }

    private fun bundledResourceSha256(osName: String, loader: (String) -> InputStream?): String? {
        val resourceName = BundledEngineResources.bundledResourcePath(osName).removePrefix("/")
        val stream = runCatching { loader(resourceName) }.getOrNull() ?: return null
        return runCatching { sha256(stream) }.getOrNull()
    }

    private fun BuildArtifactMetadata.toFreshness(classification: String, actualBundledSha256: String?): ArtifactFreshness = ArtifactFreshness(
        buildCommit = commit?.take(12) ?: ArtifactFreshness.UNKNOWN,
        buildTimestamp = timestamp ?: ArtifactFreshness.UNKNOWN,
        packagedGuiFingerprint = packagedGuiSha256?.let(::shortFingerprint) ?: ArtifactFreshness.UNKNOWN,
        bundledEngineFingerprint = actualBundledSha256?.let(::shortFingerprint) ?: ArtifactFreshness.UNKNOWN,
        runtimeBinaryFreshness = classification,
    )

    private fun safeCommit(value: String?): String? {
        val trimmed = value?.trim().orEmpty()
        return trimmed.takeIf { Regex("^[a-fA-F0-9]{7,40}$").matches(it) }?.lowercase()
    }

    private fun safeTimestamp(value: String?): String? {
        val trimmed = value?.trim().orEmpty()
        return runCatching { Instant.parse(trimmed).toString() }.getOrNull()
    }

    private fun safeSha256(value: String?): String? {
        val trimmed = value?.trim().orEmpty()
        return trimmed.takeIf { Regex("^[a-fA-F0-9]{64}$").matches(it) }?.lowercase()
    }

    private fun shortFingerprint(value: String): String = value.take(12)

    private fun sha256(stream: InputStream): String {
        val digest = MessageDigest.getInstance("SHA-256")
        stream.use { input ->
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString(separator = "") { byte -> "%02x".format(byte) }
    }

    private data class BuildArtifactMetadata(
        val commit: String? = null,
        val timestamp: String? = null,
        val packagedGuiSha256: String? = null,
        val bundledEngineSha256: String? = null,
    )
}
