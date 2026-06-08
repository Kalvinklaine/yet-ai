package ai.yet.plugin.lsp

import java.net.URI

private const val maxDocumentUriBytes = 512
private const val maxDocumentTextBytes = 256 * 1024
private const val maxTrackedDocumentCount = 32

private fun String.utf8ByteCount(): Int = toByteArray(Charsets.UTF_8).size

private fun isSafeDocumentText(text: String): Boolean = text.all { ch ->
    ch == '\n' || ch == '\r' || ch == '\t' || !ch.isISOControl()
}

fun canOpenJetBrainsLspDocument(uri: URI, text: String, currentCount: Int): Boolean {
    if (currentCount >= maxTrackedDocumentCount) return false
    if (uri.scheme != "file") return false
    if (uri.toString().utf8ByteCount() > maxDocumentUriBytes) return false
    if (text.utf8ByteCount() > maxDocumentTextBytes) return false
    if (!isSafeDocumentText(text)) return false
    return true
}

class JetBrainsLspDocumentPolicy {
    private val openDocuments = mutableMapOf<URI, String>()

    val trackedCount: Int
        get() = openDocuments.size

    fun canOpen(uri: URI, text: String): Boolean = canOpenJetBrainsLspDocument(uri, text, trackedCount)

    fun open(uri: URI, text: String): Boolean {
        if (!canOpen(uri, text)) {
            openDocuments.remove(uri)
            return false
        }
        openDocuments[uri] = text
        return true
    }

    fun close(uri: URI) {
        openDocuments.remove(uri)
    }

    fun clear() {
        openDocuments.clear()
    }

    fun isTracked(uri: URI): Boolean = openDocuments.containsKey(uri)

    fun trackedText(uri: URI): String? = openDocuments[uri]
}
