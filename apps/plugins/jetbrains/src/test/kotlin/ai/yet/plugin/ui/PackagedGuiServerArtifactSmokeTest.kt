package ai.yet.plugin.ui

import ai.yet.plugin.runtime.RuntimeSettings
import java.net.HttpURLConnection
import java.net.URI
import java.security.MessageDigest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class PackagedGuiServerArtifactSmokeTest {
    @Test
    fun currentPackagedGuiAssetsResolveThroughProductionPanelRoutes() {
        val classBytes = requireNotNull(PackagedGuiServer::class.java.getResourceAsStream("/ai/yet/plugin/ui/PackagedGuiServer.class"))
            .use { it.readBytes() }
        val indexBytes = requireNotNull(PackagedGuiServer::class.java.getResourceAsStream("/yet-ai-gui/index.html"))
            .use { it.readBytes() }
        val expectedClassSha = System.getProperty("yetAi.packagedSmokeClassSha256")
        val expectedIndexSha = System.getProperty("yetAi.packagedSmokeIndexSha256")
        assertEquals(expectedClassSha == null, expectedIndexSha == null)
        if (expectedClassSha != null && expectedIndexSha != null) {
            assertEquals(expectedClassSha, sha256(classBytes))
            assertEquals(expectedIndexSha, sha256(indexBytes))
        }

        val server = PackagedGuiServer()
        try {
            val gui = requireNotNull(server.start())
            val panel = server.registerPanel(RuntimeSettings("http://127.0.0.1:8765", null, null))
            val hostedUrl = gui.forPanel(panel).indexUrl
            val hosted = request(hostedUrl)
            assertEquals(200, hosted.status)
            assertTrue(hosted.body.isNotEmpty())
            assertEquals("text/html; charset=utf-8", hosted.contentType)
            assertEquals("no-store", hosted.cacheControl)

            val references = Regex("""(?:src|href)=(?:"|')(\./assets/[^"']+\.(?:js|css)(?:[?#][^"']*)?)(?:"|')""")
                .findAll(hosted.body.toString(Charsets.UTF_8))
                .map { it.groupValues[1] }
                .distinct()
                .toList()
            assertTrue(references.any { assetExtension(it) == "js" })
            assertTrue(references.any { assetExtension(it) == "css" })

            references.forEach { reference ->
                val response = request(URI(hostedUrl).resolve(reference).toString())
                assertEquals(200, response.status)
                assertTrue(response.body.isNotEmpty())
                assertEquals(expectedMimeType(reference), response.contentType)
                assertEquals("no-store", response.cacheControl)
            }

            assertEquals(404, request("${gui.origin}${panel.proxyBaseUrl}/").status)
            assertEquals(404, request("${gui.origin}${panel.proxyBaseUrl}/index.html").status)
            assertEquals(405, request(hostedUrl, "HEAD").status)
        } finally {
            server.dispose()
        }
    }
}

private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
    .digest(bytes)
    .joinToString("") { "%02x".format(it) }

private data class ArtifactSmokeResponse(
    val status: Int,
    val body: ByteArray,
    val contentType: String?,
    val cacheControl: String?,
)

private fun assetExtension(reference: String): String = reference.substringBefore('#').substringBefore('?').substringAfterLast('.')

private fun expectedMimeType(reference: String): String = when (assetExtension(reference)) {
    "js" -> "application/javascript; charset=utf-8"
    "css" -> "text/css; charset=utf-8"
    else -> error("unsupported asset")
}

private fun request(url: String, method: String = "GET"): ArtifactSmokeResponse {
    val connection = URI(url).toURL().openConnection() as HttpURLConnection
    return try {
        connection.requestMethod = method
        connection.connectTimeout = 2_000
        connection.readTimeout = 2_000
        val status = connection.responseCode
        val stream = if (status >= 400) connection.errorStream else connection.inputStream
        ArtifactSmokeResponse(
            status = status,
            body = stream?.use { it.readBytes() } ?: ByteArray(0),
            contentType = connection.getHeaderField("Content-Type"),
            cacheControl = connection.getHeaderField("Cache-Control"),
        )
    } finally {
        connection.disconnect()
    }
}
