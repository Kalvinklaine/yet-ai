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
    if (uri.scheme != "file") return false
    if (uri.isOpaque) return false
    if (!uri.authority.isNullOrEmpty()) return false
    if (!uri.query.isNullOrEmpty() || !uri.fragment.isNullOrEmpty()) return false
    if (uri.path.isNullOrBlank()) return false
    if (uri.toString().utf8ByteCount() > maxDocumentUriBytes) return false
    if (text.utf8ByteCount() > maxDocumentTextBytes) return false
    if (!isSafeDocumentText(text)) return false
    if (currentCount >= maxTrackedDocumentCount) return false
    return true
}

class JetBrainsLspDocumentPolicy {
    private val openDocuments = mutableSetOf<URI>()

    val trackedCount: Int
        get() = openDocuments.size

    fun canOpen(uri: URI, text: String): Boolean = canOpenJetBrainsLspDocument(uri, text, trackedCount)

    fun open(uri: URI, text: String): Boolean {
        val alreadyTracked = openDocuments.contains(uri)
        val effectiveCount = if (alreadyTracked) trackedCount - 1 else trackedCount
        if (!canOpenJetBrainsLspDocument(uri, text, effectiveCount)) {
            openDocuments.remove(uri)
            return false
        }
        openDocuments.add(uri)
        return true
    }

    fun close(uri: URI) {
        openDocuments.remove(uri)
    }

    fun clear() {
        openDocuments.clear()
    }

    fun isTracked(uri: URI): Boolean = openDocuments.contains(uri)

}
