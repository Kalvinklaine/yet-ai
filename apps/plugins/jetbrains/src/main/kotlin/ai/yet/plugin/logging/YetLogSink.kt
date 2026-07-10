package ai.yet.plugin.logging

import ai.yet.plugin.identity.ProductIdentity
import ai.yet.plugin.runtime.redactLogText
import com.intellij.openapi.application.PathManager
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardOpenOption
import java.time.Clock
import java.time.Instant
import java.time.format.DateTimeFormatter

class YetLogSink(
    private val directoryProvider: () -> Path = { Path.of(PathManager.getLogPath(), ProductIdentity.productId) },
    private val clock: Clock = Clock.systemUTC(),
    private val maxBytes: Long = 128 * 1024,
    private val maxLineLength: Int = 1200,
) {
    private val lock = Any()

    fun logPath(): Path = directoryProvider().resolve("yet-ai.log")

    fun append(level: String, event: String, metadata: Map<String, Any?> = emptyMap()) {
        val line = formatLine(level, event, metadata)
        synchronized(lock) {
            val path = logPath()
            Files.createDirectories(path.parent)
            rotateIfNeeded(path, line.toByteArray(StandardCharsets.UTF_8).size.toLong())
            Files.writeString(
                path,
                line,
                StandardCharsets.UTF_8,
                StandardOpenOption.CREATE,
                StandardOpenOption.APPEND,
            )
            trimIfNeeded(path)
        }
    }

    fun tail(maxBytes: Long = 16 * 1024): String {
        synchronized(lock) {
            val path = logPath()
            if (!Files.exists(path)) return ""
            val bytes = Files.readAllBytes(path)
            val start = (bytes.size - maxBytes.coerceAtLeast(0)).coerceAtLeast(0).toInt()
            return redactLogText(String(bytes.copyOfRange(start, bytes.size), StandardCharsets.UTF_8), "")
        }
    }

    private fun formatLine(level: String, event: String, metadata: Map<String, Any?>): String {
        val timestamp = DateTimeFormatter.ISO_INSTANT.format(Instant.now(clock))
        val safeLevel = sanitizeToken(level.ifBlank { "info" }.lowercase())
        val safeEvent = sanitizeToken(event.ifBlank { "event" })
        val metadataText = metadata.entries
            .sortedBy { it.key }
            .joinToString(" ") { (key, value) -> "${sanitizeToken(key)}=${sanitizeValue(value)}" }
        val raw = listOf(timestamp, safeLevel, safeEvent, metadataText).filter { it.isNotBlank() }.joinToString(" ")
        val sanitized = redactLogText(raw.replace(Regex("[\r\n]+"), " "), "")
        return sanitized.take(maxLineLength) + "\n"
    }

    private fun sanitizeToken(value: String): String = value.replace(Regex("[^A-Za-z0-9_.-]"), "_").take(80)

    private fun sanitizeValue(value: Any?): String {
        val raw = when (value) {
            null -> "null"
            is Throwable -> value.message ?: value::class.java.simpleName
            else -> value.toString()
        }
        return redactLogText(raw.replace(Regex("[\r\n]+"), " "), "")
            .replace(" ", "_")
            .take(500)
    }

    private fun rotateIfNeeded(path: Path, incomingBytes: Long) {
        if (!Files.exists(path)) return
        val size = Files.size(path)
        if (size + incomingBytes <= maxBytes) return
        val keepBytes = (maxBytes / 2).coerceAtLeast(0)
        if (keepBytes == 0L) {
            Files.writeString(path, "", StandardCharsets.UTF_8, StandardOpenOption.TRUNCATE_EXISTING)
            return
        }
        val bytes = Files.readAllBytes(path)
        val start = (bytes.size - keepBytes).coerceAtLeast(0).toInt()
        Files.write(path, bytes.copyOfRange(start, bytes.size), StandardOpenOption.TRUNCATE_EXISTING, StandardOpenOption.CREATE)
    }

    private fun trimIfNeeded(path: Path) {
        if (!Files.exists(path) || Files.size(path) <= maxBytes) return
        val bytes = Files.readAllBytes(path)
        val start = (bytes.size - maxBytes).coerceAtLeast(0).toInt()
        Files.write(path, bytes.copyOfRange(start, bytes.size), StandardOpenOption.TRUNCATE_EXISTING, StandardOpenOption.CREATE)
    }
}
