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

enum class RuntimeBinaryProvenanceKind {
    BUNDLED,
    CONFIGURED_EXTERNAL,
    PATH_FALLBACK,
    CONNECT_EXTERNAL,
    UNAVAILABLE,
    UNKNOWN,
}

data class RuntimeBinaryProvenance(
    val kind: RuntimeBinaryProvenanceKind,
    internal val binaryPath: java.nio.file.Path? = null,
) {
    companion object {
        val CONNECT_EXTERNAL = RuntimeBinaryProvenance(RuntimeBinaryProvenanceKind.CONNECT_EXTERNAL)
        val CONFIGURED_EXTERNAL = RuntimeBinaryProvenance(RuntimeBinaryProvenanceKind.CONFIGURED_EXTERNAL)
        val UNAVAILABLE = RuntimeBinaryProvenance(RuntimeBinaryProvenanceKind.UNAVAILABLE)
        val UNKNOWN = RuntimeBinaryProvenance(RuntimeBinaryProvenanceKind.UNKNOWN)

        fun bundled(binaryPath: java.nio.file.Path): RuntimeBinaryProvenance = RuntimeBinaryProvenance(RuntimeBinaryProvenanceKind.BUNDLED, binaryPath)
        fun configuredExternal(binaryPath: java.nio.file.Path): RuntimeBinaryProvenance = RuntimeBinaryProvenance(RuntimeBinaryProvenanceKind.CONFIGURED_EXTERNAL, binaryPath)
        fun pathFallback(binaryPath: java.nio.file.Path): RuntimeBinaryProvenance = RuntimeBinaryProvenance(RuntimeBinaryProvenanceKind.PATH_FALLBACK, binaryPath)
    }
}

internal object ArtifactFreshnessResources {
    const val METADATA_RESOURCE: String = "yet-ai-artifact/build.properties"

    fun describe(
        provenance: RuntimeBinaryProvenance,
        classLoader: ClassLoader = ArtifactFreshnessResources::class.java.classLoader,
        osName: String = System.getProperty("os.name"),
        metadataLoader: (String) -> InputStream? = { path -> classLoader.getResourceAsStream(path) },
        bundledResourceLoader: (String) -> InputStream? = { path -> classLoader.getResourceAsStream(path) },
    ): ArtifactFreshness {
        val metadata = metadata(metadataLoader)
        when (provenance.kind) {
            RuntimeBinaryProvenanceKind.CONNECT_EXTERNAL -> return metadata.toFreshness("connect-mode external", null)
            RuntimeBinaryProvenanceKind.CONFIGURED_EXTERNAL -> return metadata.toFreshness("configured external", null)
            RuntimeBinaryProvenanceKind.PATH_FALLBACK -> return metadata.toFreshness("path fallback external", null)
            RuntimeBinaryProvenanceKind.UNAVAILABLE -> return metadata.toFreshness("unavailable", null)
            RuntimeBinaryProvenanceKind.UNKNOWN -> return metadata.toFreshness("unknown", null)
            RuntimeBinaryProvenanceKind.BUNDLED -> Unit
        }
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
