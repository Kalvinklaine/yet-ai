package ai.yet.plugin.runtime

import java.io.ByteArrayInputStream
import java.io.InputStream
import java.security.MessageDigest
import kotlin.test.Test
import kotlin.test.assertEquals

class ArtifactFreshnessTest {
    @Test
    fun bundledRuntimeReportsMatchWhenPackagedEngineMatchesMetadata() {
        val engine = "engine-bytes".toByteArray()
        val gui = "gui-bytes".toByteArray()
        val metadata = metadata(engineSha = sha256(engine), guiSha = sha256(gui))

        val freshness = ArtifactFreshnessResources.describe(
            RuntimeSettings("http://127.0.0.1:8123", null, null, LaunchMode.LAUNCH, null),
            EffectiveRuntimeOwner.IDE_HOST,
            metadataLoader = loader(mapOf(ArtifactFreshnessResources.METADATA_RESOURCE to metadata.toByteArray())),
            bundledResourceLoader = loader(mapOf("yet-ai-engine/yet-lsp" to engine)),
        )

        assertEquals("abcdef123456", freshness.buildCommit)
        assertEquals("2026-07-12T00:00:00Z", freshness.buildTimestamp)
        assertEquals(sha256(gui).take(12), freshness.packagedGuiFingerprint)
        assertEquals(sha256(engine).take(12), freshness.bundledEngineFingerprint)
        assertEquals("bundled match", freshness.runtimeBinaryFreshness)
    }

    @Test
    fun bundledRuntimeReportsMismatchWhenPackagedEngineDiffersFromMetadata() {
        val expectedEngine = "expected-engine".toByteArray()
        val actualEngine = "actual-engine".toByteArray()
        val metadata = metadata(engineSha = sha256(expectedEngine), guiSha = sha256("gui".toByteArray()))

        val freshness = ArtifactFreshnessResources.describe(
            RuntimeSettings("http://127.0.0.1:8123", null, null, LaunchMode.AUTO, null),
            EffectiveRuntimeOwner.IDE_HOST,
            metadataLoader = loader(mapOf(ArtifactFreshnessResources.METADATA_RESOURCE to metadata.toByteArray())),
            bundledResourceLoader = loader(mapOf("yet-ai-engine/yet-lsp" to actualEngine)),
        )

        assertEquals(sha256(actualEngine).take(12), freshness.bundledEngineFingerprint)
        assertEquals("mismatch", freshness.runtimeBinaryFreshness)
    }

    @Test
    fun connectAndConfiguredModesReportExternalWithoutBundledFreshnessClaim() {
        val engine = "engine-bytes".toByteArray()
        val metadata = metadata(engineSha = sha256(engine), guiSha = sha256("gui".toByteArray()))
        val metadataLoader = loader(mapOf(ArtifactFreshnessResources.METADATA_RESOURCE to metadata.toByteArray()))

        val connect = ArtifactFreshnessResources.describe(
            RuntimeSettings("http://127.0.0.1:8123", null, null, LaunchMode.CONNECT, null),
            EffectiveRuntimeOwner.EXTERNAL,
            metadataLoader = metadataLoader,
            bundledResourceLoader = loader(mapOf("yet-ai-engine/yet-lsp" to engine)),
        )
        val configured = ArtifactFreshnessResources.describe(
            RuntimeSettings("http://127.0.0.1:8123", null, null, LaunchMode.LAUNCH, java.nio.file.Path.of("/tmp/yet-lsp")),
            EffectiveRuntimeOwner.EXTERNAL,
            metadataLoader = metadataLoader,
            bundledResourceLoader = loader(mapOf("yet-ai-engine/yet-lsp" to engine)),
        )

        assertEquals("connect-mode external", connect.runtimeBinaryFreshness)
        assertEquals("unknown", connect.bundledEngineFingerprint)
        assertEquals("configured external", configured.runtimeBinaryFreshness)
        assertEquals("unknown", configured.bundledEngineFingerprint)
    }

    @Test
    fun absentOrMalformedMetadataReportsUnknownSafely() {
        val malformed = "build.commit=not-a-sha\nbuild.timestamp=nope\ngui.sha256=short\nengine.sha256=also-short\n"
        val freshness = ArtifactFreshnessResources.describe(
            RuntimeSettings("http://127.0.0.1:8123", null, null, LaunchMode.LAUNCH, null),
            EffectiveRuntimeOwner.IDE_HOST,
            metadataLoader = loader(mapOf(ArtifactFreshnessResources.METADATA_RESOURCE to malformed.toByteArray())),
            bundledResourceLoader = loader(emptyMap()),
        )

        assertEquals("unknown", freshness.buildCommit)
        assertEquals("unknown", freshness.buildTimestamp)
        assertEquals("unknown", freshness.packagedGuiFingerprint)
        assertEquals("unknown", freshness.bundledEngineFingerprint)
        assertEquals("unavailable", freshness.runtimeBinaryFreshness)
    }

    private fun metadata(engineSha: String, guiSha: String): String = """
build.commit=abcdef1234567890abcdef1234567890abcdef12
build.timestamp=2026-07-12T00:00:00Z
gui.sha256=$guiSha
engine.sha256=$engineSha
""".trimIndent()

    private fun loader(resources: Map<String, ByteArray>): (String) -> InputStream? = { path ->
        resources[path]?.let { ByteArrayInputStream(it) }
    }

    private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
        .digest(bytes)
        .joinToString(separator = "") { byte -> "%02x".format(byte) }
}
