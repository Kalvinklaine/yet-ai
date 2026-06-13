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
                "GITHUB_TOKEN" to "github-token",
                "YET_AI_HTTP_PORT" to "8001",
                "YET_AI_AUTH_TOKEN" to "runtime-token",
                "OPENAI_API_KEY" to "provider-key",
                "ANTHROPIC_API_KEY" to "provider-key",
                "PROVIDER_REFRESH_TOKEN" to "refresh-token",
                "LOCAL_RUNTIME_SESSION_TOKEN" to "session-token",
                "GUI_BOOTSTRAP_PAYLOAD" to "payload",
                "HOST_READY_AUTHORIZATION" to "Bearer token",
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
            "OPENAI_API_KEY=sk-test-secret ANTHROPIC_API_KEY=anthropic-secret YET_AI_AUTH_TOKEN=auth-secret PROVIDER_CLIENT_SECRET=client-secret Authorization: Bearer bearer-secret Cookie: session=cookie-secret access_token=oauth-secret /Users/alice/private/file.txt raw document body sentinel-after-body bridge payload sentinel-after-payload sk-test-12345678901234567890.abcdefghijklmnopqrstuv.zyxwvutsrqponmlkjihgfedcba0123456789",
        )

        listOf("sk-test-secret", "anthropic-secret", "auth-secret", "client-secret", "bearer-secret", "cookie-secret", "oauth-secret", "/Users/alice/private/file.txt", "alice", "sentinel-after-body", "sentinel-after-payload").forEach {
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

    @Test
    fun diagnosticsRedactUrlAndJsonStyleSecretValues() {
        val text = sanitizeJetBrainsLspDiagnosticText(
            "failed url=http://127.0.0.1:8001/?access_token=url-secret&code_verifier=verifier-secret json {\"session_token\":\"json-secret\",\"apiKey\":\"camel-secret\"} C:\\Users\\alice\\AppData\\Local\\auth.json",
        )

        listOf("url-secret", "verifier-secret", "json-secret", "camel-secret", "C:\\Users\\alice").forEach {
            assertFalse(text.contains(it), text)
        }
        assertTrue(text.contains("auth.json") || text.contains("[redacted]"), text)
    }
}
