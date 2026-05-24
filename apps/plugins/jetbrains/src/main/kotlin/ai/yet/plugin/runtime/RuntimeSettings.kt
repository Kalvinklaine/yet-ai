package ai.yet.plugin.runtime

import ai.yet.plugin.settings.YetSettingsState
import java.net.URI

class RuntimeSettings(
    val runtimeUrl: String,
    val guiDevUrl: String?,
    val sessionToken: String?,
) {
    companion object {
        fun current(): RuntimeSettings {
            val state = YetSettingsState.getInstance().state
            return RuntimeSettings(
                runtimeUrl = requireLoopbackUrl(state.runtimeUrl, "runtimeUrl"),
                guiDevUrl = state.guiDevUrl.takeIf { it.isNotBlank() }?.let { requireLoopbackUrl(it, "guiDevUrl") },
                sessionToken = state.sessionToken.takeIf { it.isNotBlank() },
            )
        }
    }
}

fun requireLoopbackUrl(value: String, label: String): String {
    val uri = try {
        URI(value.trim())
    } catch (error: IllegalArgumentException) {
        throw IllegalArgumentException("Yet AI $label must be a valid loopback URL")
    }
    val scheme = uri.scheme ?: throw IllegalArgumentException("Yet AI $label must include http or https scheme")
    if (scheme != "http" && scheme != "https") {
        throw IllegalArgumentException("Yet AI $label must use http or https")
    }
    val host = uri.host ?: throw IllegalArgumentException("Yet AI $label must include a host")
    if (host != "127.0.0.1" && host != "localhost" && host != "::1" && host != "[::1]") {
        throw IllegalArgumentException("Yet AI $label must point to a loopback host")
    }
    return uri.toString()
}

fun loopbackOrigin(value: String): String {
    val uri = URI(value)
    val port = if (uri.port >= 0) ":${uri.port}" else ""
    return "${uri.scheme}://${uri.host}$port"
}
