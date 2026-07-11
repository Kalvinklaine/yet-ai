package ai.yet.plugin.logging

import ai.yet.plugin.identity.ProductIdentity
import ai.yet.plugin.runtime.ArtifactFreshness
import ai.yet.plugin.runtime.RuntimeLifecycleStatus
import ai.yet.plugin.runtime.redactLogText
import java.net.URI
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path

class YetDiagnosticsBundle(
    private val logSink: YetLogSink,
    private val pluginVersion: String = "0.1.0",
    private val maxChars: Int = 24 * 1024,
    private val maxEngineTailBytes: Long = 16 * 1024,
) {
    fun build(snapshot: YetDiagnosticsSnapshot): String {
        logSink.append("info", "diagnostics.requested", mapOf("launchMode" to snapshot.launchMode, "lifecycle" to snapshot.lifecycleStatus.lifecycle.wireName))
        val lines = mutableListOf<String>()
        lines += "Yet AI Diagnostics Bundle"
        lines += "Product: ${ProductIdentity.pluginName}"
        lines += "Plugin ID: ${ProductIdentity.pluginId}"
        lines += "Plugin version: $pluginVersion"
        lines += "Bridge version: ${ProductIdentity.bridgeVersion}"
        lines += "Build commit: ${snapshot.artifactFreshness.buildCommit}"
        lines += "Build timestamp: ${snapshot.artifactFreshness.buildTimestamp}"
        lines += "Packaged GUI fingerprint: ${snapshot.artifactFreshness.packagedGuiFingerprint}"
        lines += "Bundled engine fingerprint: ${snapshot.artifactFreshness.bundledEngineFingerprint}"
        lines += "Runtime binary freshness: ${snapshot.artifactFreshness.runtimeBinaryFreshness}"
        lines += "Launch mode: ${snapshot.launchMode}"
        lines += "Runtime origin: ${runtimeOrigin(snapshot.runtimeUrl)}"
        lines += "Lifecycle: ${snapshot.lifecycleStatus.lifecycle.wireName}"
        lines += "Runtime owner: ${snapshot.lifecycleStatus.runtimeOwner}"
        lines += "Token state: ${snapshot.lifecycleStatus.tokenState}"
        lines += "Process state: ${snapshot.lifecycleStatus.processState.wireName}"
        lines += "Diagnosis: ${snapshot.lifecycleStatus.diagnosis}"
        lines += "Next action: ${snapshot.lifecycleStatus.nextAction}"
        lines += "Launched by plugin: ${if (snapshot.launchedByPlugin) "yes" else "no"}"
        lines += "Plugin-launched process: ${if (snapshot.launchedByPlugin) "running" else "not running"}"
        lines += "Engine binary configured: ${if (snapshot.engineBinaryConfigured) "yes" else "no"}"
        lines += "Binary status: ${snapshot.binaryStatus}"
        lines += "Last health: ${snapshot.lastHealth ?: "not checked yet"}"
        lines += "Last process: ${snapshot.lastProcess ?: "no plugin-launched exit recorded"}"
        lines += "Last recovery: ${snapshot.lastRecovery ?: "none"}"
        lines += "Last error: ${snapshot.lastError ?: "none"}"
        lines += "Log path: ${logSink.logPath()}"
        lines += "Recent log tail:"
        lines += logSink.tail()
        lines += "Engine log path: ${snapshot.engineLogPath?.fileName ?: "unavailable"}"
        val engineTail = snapshot.engineLogPath?.let { engineLogTail(it) }
        if (engineTail.isNullOrBlank()) {
            lines += "Engine log tail: unavailable"
        } else {
            lines += "Recent engine log tail:"
            lines += engineTail
        }
        return lines.joinToString("\n") { redactLogText(it, "") }.take(maxChars)
    }

    private fun engineLogTail(path: Path): String? {
        if (!Files.exists(path)) return null
        return runCatching {
            val bytes = Files.readAllBytes(path)
            val start = (bytes.size - maxEngineTailBytes.coerceAtLeast(0)).coerceAtLeast(0).toInt()
            redactLogText(String(bytes.copyOfRange(start, bytes.size), StandardCharsets.UTF_8), "")
        }.getOrNull()
    }

    private fun runtimeOrigin(value: String): String {
        return runCatching {
            val uri = URI(value)
            val scheme = uri.scheme ?: "http"
            val host = uri.host ?: "loopback"
            val port = if (uri.port >= 0) ":${uri.port}" else ""
            "$scheme://$host$port"
        }.getOrElse { "invalid runtime URL" }
    }
}

data class YetDiagnosticsSnapshot(
    val launchMode: String,
    val runtimeUrl: String,
    val engineBinaryConfigured: Boolean,
    val binaryStatus: String,
    val launchedByPlugin: Boolean,
    val lifecycleStatus: RuntimeLifecycleStatus,
    val lastHealth: String?,
    val lastError: String?,
    val lastProcess: String?,
    val lastRecovery: String?,
    val engineLogPath: Path? = null,
    val artifactFreshness: ArtifactFreshness = ArtifactFreshness.unknown(),
)
