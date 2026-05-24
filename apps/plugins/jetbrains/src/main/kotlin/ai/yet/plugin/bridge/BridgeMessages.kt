package ai.yet.plugin.bridge

import ai.yet.plugin.identity.ProductIdentity
import ai.yet.plugin.runtime.RuntimeSettings
import com.google.gson.JsonObject
import com.google.gson.JsonParser

object BridgeMessages {
    private const val MaxRequestIdLength = 128

    data class GuiReady(val requestId: String?)

    fun parseGuiReady(raw: String): GuiReady? {
        val element = try {
            JsonParser.parseString(raw)
        } catch (_: RuntimeException) {
            return null
        }
        if (!element.isJsonObject) {
            return null
        }
        val record = element.asJsonObject
        if (record.stringValue("version") != ProductIdentity.bridgeVersion) {
            return null
        }
        if (record.stringValue("type") != "gui.ready") {
            return null
        }
        val requestId = when {
            !record.has("requestId") -> null
            record.get("requestId").isJsonPrimitive && record.get("requestId").asJsonPrimitive.isString -> {
                record.get("requestId").asString.takeIf(::isValidRequestId) ?: return null
            }
            else -> return null
        }
        if (record.has("payload") && !record.get("payload").isJsonObject) {
            return null
        }
        return GuiReady(requestId)
    }

    fun hostReady(settings: RuntimeSettings, requestId: String?): String {
        val message = JsonObject().apply {
            addProperty("version", ProductIdentity.bridgeVersion)
            addProperty("type", "host.ready")
            requestId?.let { addProperty("requestId", it) }
            add("payload", JsonObject().apply {
                addProperty("productId", ProductIdentity.productId)
                addProperty("displayName", ProductIdentity.pluginName)
                addProperty("runtimeUrl", settings.runtimeUrl)
                settings.sessionToken?.let { addProperty("sessionToken", it) }
                addProperty("cloudRequired", false)
            })
        }
        return message.toString()
    }

    fun openedFromCommand(): String = JsonObject().apply {
        addProperty("version", ProductIdentity.bridgeVersion)
        addProperty("type", "host.openedFromCommand")
        add("payload", JsonObject())
    }.toString()

    fun escapeScriptJson(value: String): String = value
        .replace("<", "\\u003c")
        .replace("\u2028", "\\u2028")
        .replace("\u2029", "\\u2029")

    private fun isValidRequestId(value: String): Boolean =
        value.isNotEmpty() && value.length <= MaxRequestIdLength && value.none { it.isISOControl() }

    private fun JsonObject.stringValue(name: String): String? {
        val element = get(name) ?: return null
        if (!element.isJsonPrimitive || !element.asJsonPrimitive.isString) {
            return null
        }
        return element.asString
    }
}
