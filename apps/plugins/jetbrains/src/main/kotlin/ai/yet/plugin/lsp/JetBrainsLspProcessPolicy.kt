package ai.yet.plugin.lsp

import java.nio.file.Path

private val allowedEnvironmentKeys = setOf("PATH", "Path", "SystemRoot", "WINDIR")
private val secretKeyPattern = Regex("(?i)(token|secret|api[-_]?key|authorization|cookie|password|credential)")
private val bearerHeaderPattern = Regex("(?i)\\bAuthorization\\s*:\\s*Bearer\\s+[^\\s\\r\\n]+")
private val cookieHeaderPattern = Regex("(?i)\\b(?:Cookie|Set-Cookie)\\s*:\\s*[^\\r\\n]+")
private val jwtPattern = Regex("\\b[A-Za-z0-9_-]{16,}\\.[A-Za-z0-9_-]{16,}\\.[A-Za-z0-9_-]{16,}\\b")
private val secretValuePattern = Regex("(?i)\\b(?:access[_-]?token|refresh[_-]?token|session[_-]?token|auth[_-]?token|oauth[_-]?code|code[_-]?verifier|pkce[_-]?verifier|token|secret|api[_-]?key|authorization|cookie|password|credential)[A-Za-z0-9_-]*\\b\\s*[:=]\\s*[^\\s,;)}\\]]+")
private val absolutePathPattern = Regex("(?:[A-Za-z]:\\\\[^\\r\\n,;)}\\]\\s]+(?:\\\\[^\\r\\n,;)}\\]\\s]+)+|/(?:Users|home|private|var/folders|tmp|Volumes)/[^\\r\\n,;)}\\]\\s]+(?:/[^\\r\\n,;)}\\]\\s]+)*)")
private val bridgeMarkerPattern = Regex("(?i)\\b(?:bridge|payload|document body|raw document|request body|response body)\\b")

fun buildJetBrainsLspCommand(binaryPath: Path): List<String> = listOf(binaryPath.toString(), "--lsp-stdio")

fun filterJetBrainsLspEnvironment(source: Map<String, String>): Map<String, String> = buildMap {
    source.forEach { (key, value) ->
        if (key in allowedEnvironmentKeys && !secretKeyPattern.containsMatchIn(key)) {
            put(key, value)
        }
    }
}

fun sanitizeJetBrainsLspDiagnosticText(value: String): String {
    var redacted = value
        .replace(bearerHeaderPattern, "Authorization: Bearer [redacted]")
        .replace(cookieHeaderPattern, "[redacted]")
        .replace(secretValuePattern, "[redacted]")
        .replace(jwtPattern, "[redacted]")
        .replace(absolutePathPattern) { match ->
            val path = match.value
            path.substringAfterLast('/').substringAfterLast('\\')
        }
        .replace(bridgeMarkerPattern, "[redacted]")
    if (redacted.length > 500) {
        redacted = redacted.take(500) + "…"
    }
    return redacted
}
