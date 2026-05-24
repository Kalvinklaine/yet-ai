package ai.yet.plugin.bridge

import ai.yet.plugin.identity.ProductIdentity
import ai.yet.plugin.runtime.RuntimeSettings

object BridgeMessages {
    fun isGuiReady(raw: String): Boolean {
        val normalized = raw.trim()
        return normalized.contains("\"version\":\"${ProductIdentity.bridgeVersion}\"") &&
            normalized.contains("\"type\":\"gui.ready\"")
    }

    fun requestId(raw: String): String? {
        val match = Regex("\"requestId\"\\s*:\\s*\"([^\"]+)\"").find(raw) ?: return null
        return match.groupValues[1].takeIf { it.isNotBlank() }
    }

    fun hostReady(settings: RuntimeSettings, requestId: String?): String {
        val requestIdJson = requestId?.let { ",\"requestId\":\"${escapeJson(it)}\"" } ?: ""
        val sessionTokenJson = settings.sessionToken?.let { ",\"sessionToken\":\"${escapeJson(it)}\"" } ?: ""
        return "{\"version\":\"${ProductIdentity.bridgeVersion}\",\"type\":\"host.ready\"$requestIdJson,\"payload\":{\"productId\":\"${ProductIdentity.productId}\",\"displayName\":\"${ProductIdentity.pluginName}\",\"runtimeUrl\":\"${escapeJson(settings.runtimeUrl)}\"$sessionTokenJson,\"cloudRequired\":false}}"
    }

    fun openedFromCommand(): String = "{\"version\":\"${ProductIdentity.bridgeVersion}\",\"type\":\"host.openedFromCommand\",\"payload\":{}}"

    fun escapeScriptJson(value: String): String = value
        .replace("<", "\\u003c")
        .replace("\u2028", "\\u2028")
        .replace("\u2029", "\\u2029")

    private fun escapeJson(value: String): String = buildString {
        for (character in value) {
            when (character) {
                '\\' -> append("\\\\")
                '"' -> append("\\\"")
                '\b' -> append("\\b")
                '\u000C' -> append("\\f")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                else -> append(character)
            }
        }
    }
}
