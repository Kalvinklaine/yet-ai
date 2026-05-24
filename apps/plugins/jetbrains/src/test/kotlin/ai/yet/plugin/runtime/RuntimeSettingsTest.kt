package ai.yet.plugin.runtime

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class RuntimeSettingsTest {
    @Test
    fun loopbackUrlsAccepted() {
        assertEquals("http://127.0.0.1:8001", requireLoopbackUrl(" http://127.0.0.1:8001 ", "runtimeUrl"))
        assertEquals("https://localhost:3000/path", requireLoopbackUrl("https://localhost:3000/path", "guiDevUrl"))
        assertEquals("http://[::1]:5173", requireLoopbackUrl("http://[::1]:5173", "guiDevUrl"))
    }

    @Test
    fun unsafeUrlsRejected() {
        listOf(
            "http://example.com:8001",
            "ftp://127.0.0.1:8001",
            "http://user:pass@127.0.0.1:8001",
            "http:///missing-host",
            "not a url",
            "/relative",
        ).forEach { value ->
            assertFailsWith<IllegalArgumentException> { requireLoopbackUrl(value, "runtimeUrl") }
        }
    }

    @Test
    fun ipv6OriginFormattedWithBrackets() {
        assertEquals("http://[::1]:5173", loopbackOrigin("http://[::1]:5173/path"))
    }
}
