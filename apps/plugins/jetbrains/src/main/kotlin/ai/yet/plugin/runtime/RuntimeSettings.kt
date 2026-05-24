package ai.yet.plugin.runtime

import ai.yet.plugin.settings.SessionTokenStore
import ai.yet.plugin.settings.YetSettingsState
import java.net.URI
import java.nio.file.Path

enum class LaunchMode {
    AUTO,
    CONNECT,
    LAUNCH,
}

class RuntimeSettings(
    val runtimeUrl: String,
    val guiDevUrl: String?,
    val sessionToken: String?,
    val launchMode: LaunchMode = LaunchMode.AUTO,
    val engineBinaryPath: Path? = null,
) {
    fun copyWithSessionToken(token: String): RuntimeSettings = RuntimeSettings(
        runtimeUrl = runtimeUrl,
        guiDevUrl = guiDevUrl,
        sessionToken = token,
        launchMode = launchMode,
        engineBinaryPath = engineBinaryPath,
    )

    companion object {
        fun current(): RuntimeSettings {
            val state = YetSettingsState.getInstance().state
            return RuntimeSettings(
                runtimeUrl = requireLoopbackUrl(state.runtimeUrl, "runtimeUrl"),
                guiDevUrl = state.guiDevUrl.takeIf { it.isNotBlank() }?.let { requireLoopbackUrl(it, "guiDevUrl") },
                sessionToken = SessionTokenStore.getInstance().get().takeIf { it.isNotBlank() },
                launchMode = parseLaunchMode(state.launchMode),
                engineBinaryPath = state.engineBinaryPath.takeIf { it.isNotBlank() }?.let { requireAbsolutePath(it, "engineBinaryPath") },
            )
        }

        fun safeFallback(): RuntimeSettings = RuntimeSettings(
            runtimeUrl = "http://127.0.0.1:8001",
            guiDevUrl = null,
            sessionToken = null,
        )
    }
}

fun parseLaunchMode(value: String): LaunchMode = when (value.trim().lowercase()) {
    "auto" -> LaunchMode.AUTO
    "connect" -> LaunchMode.CONNECT
    "launch" -> LaunchMode.LAUNCH
    else -> throw IllegalArgumentException("Yet AI launchMode must be auto, connect, or launch")
}

fun requireAbsolutePath(value: String, label: String): Path {
    val path = Path.of(value.trim())
    if (!path.isAbsolute) {
        throw IllegalArgumentException("Yet AI $label must be an absolute path")
    }
    return path
}

fun requireLoopbackUrl(value: String, label: String): String {
    val uri = parseLoopbackUrl(value, label)
    return uri.toString()
}

fun loopbackOrigin(value: String): String {
    val uri = parseLoopbackUrl(value, "origin")
    val host = when (uri.host.removeSurrounding("[", "]")) {
        "::1" -> "[::1]"
        else -> uri.host
    }
    val port = if (uri.port >= 0) ":${uri.port}" else ""
    return "${uri.scheme}://$host$port"
}

private fun parseLoopbackUrl(value: String, label: String): URI {
    val uri = try {
        URI(value.trim())
    } catch (_: Exception) {
        throw IllegalArgumentException("Yet AI $label must be a valid loopback URL")
    }
    if (!uri.isAbsolute) {
        throw IllegalArgumentException("Yet AI $label must be an absolute loopback URL")
    }
    val scheme = uri.scheme?.lowercase() ?: throw IllegalArgumentException("Yet AI $label must include http or https scheme")
    if (scheme != "http" && scheme != "https") {
        throw IllegalArgumentException("Yet AI $label must use http or https")
    }
    if (uri.rawUserInfo != null) {
        throw IllegalArgumentException("Yet AI $label must not include user info")
    }
    val host = uri.host?.removeSurrounding("[", "]") ?: throw IllegalArgumentException("Yet AI $label must include a host")
    if (host != "127.0.0.1" && host != "localhost" && host != "::1") {
        throw IllegalArgumentException("Yet AI $label must point to a loopback host")
    }
    return uri
}
