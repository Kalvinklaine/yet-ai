package ai.yet.plugin.lsp

import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class JetBrainsLspProcessPolicyTest {
    @Test
    fun commandUsesLspStdioExactly() {
        assertEquals(listOf("/tmp/yet-lsp", "--lsp-stdio"), buildJetBrainsLspCommand(Path.of("/tmp/yet-lsp")))
    }

    @Test
    fun environmentAllowlistKeepsOnlyOsBasics() {
        val env = filterJetBrainsLspEnvironment(
            mapOf(
                "PATH" to "/bin",
                "Path" to "C:\\Windows\\System32",
                "SystemRoot" to "C:\\Windows",
                "WINDIR" to "C:\\Windows",
                "HOME" to "/Users/alice",
                "YET_AI_AUTH_TOKEN" to "runtime-secret",
                "OPENAI_API_KEY" to "provider-secret",
                "Authorization" to "Bearer provider-secret",
            ),
        )

        assertEquals(mapOf("PATH" to "/bin", "Path" to "C:\\Windows\\System32", "SystemRoot" to "C:\\Windows", "WINDIR" to "C:\\Windows"), env)
    }

    @Test
    fun environmentStripsSecretLikeKeys() {
        val env = filterJetBrainsLspEnvironment(
            mapOf(
                "PATH" to "/bin",
                "MY_TOKEN" to "token",
                "service-secret" to "secret",
                "api-key" to "api-key",
                "cookie" to "cookie",
                "password" to "password",
                "credential" to "credential",
                "Authorization" to "Bearer token",
            ),
        )

        assertEquals(mapOf("PATH" to "/bin"), env)
    }

    @Test
    fun diagnosticsRedactSecretsAndPrivatePaths() {
        val text = sanitizeJetBrainsLspDiagnosticText(
            "Authorization: Bearer bearer-secret Cookie: session=cookie-secret access_token=oauth-secret /Users/alice/private/file.txt raw document body bridge payload sk-test-12345678901234567890.abcdefghijklmnopqrstuv.zyxwvutsrqponmlkjihgfedcba0123456789",
        )

        listOf("bearer-secret", "cookie-secret", "oauth-secret", "/Users/alice/private/file.txt", "alice", "sk-test", "bridge payload", "raw document body").forEach {
            assertFalse(text.contains(it), text)
        }
        assertTrue(text.contains("[redacted]"), text)
        assertTrue(text.contains("file.txt") || text.contains("[redacted]"), text)
    }

    @Test
    fun diagnosticsUseBasenameForAbsolutePathsAndBoundLength() {
        val text = sanitizeJetBrainsLspDiagnosticText("failure at /Users/alice/workspace/private/nested/engine.log with ${"x".repeat(1000)}")

        assertTrue(text.contains("engine.log"), text)
        assertFalse(text.contains("/Users/alice"), text)
        assertTrue(text.length <= 501, text.length.toString())
    }
}
