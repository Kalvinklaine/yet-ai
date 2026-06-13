package ai.yet.plugin.lsp

import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.isRegularFile
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertFalse

class JetBrainsLspBlockedDecisionTest {
    @Test
    fun readmeFinalizesNativeClientBlockedDecision() {
        val readme = projectFile("README.md").readText()

        assertContains(readme, "native IntelliJ LSP client integration is deferred")
        assertContains(readme, "T-15 blocked decision")
        assertContains(readme, "does not add `com.intellij.platform.lsp.api` imports")
        assertContains(readme, "do not implement JetBrains LSP until the minimum JetBrains platform version/dependency contract is raised intentionally")
        assertContains(readme, "no native IntelliJ LSP client, provider calls, edits, or production completion claim")
    }

    @Test
    fun mainSourcesDoNotImportNativeIntellijLspApi() {
        val source = readMainKotlinSources()

        listOf(
            "com.intellij.platform.lsp",
            "com.intellij.platform.lsp.api",
            "LspServerDescriptor",
            "LspServerSupportProvider",
            "LspServerManager",
        ).forEach { forbidden ->
            assertFalse(source.contains(forbidden), forbidden)
        }
    }

    @Test
    fun pluginDescriptorDoesNotRegisterNativeLspClient() {
        val pluginXml = projectFile("src/main/resources/META-INF/plugin.xml").readText()

        assertFalse(pluginXml.contains("com.intellij.platform.lsp"), pluginXml)
        assertFalse(pluginXml.contains("lspServerSupportProvider"), pluginXml)
        assertFalse(pluginXml.contains("LspServerDescriptor"), pluginXml)
        assertContains(pluginXml, "ai.yet.plugin.lsp.JetBrainsLspLifecycleService")
    }

    @Test
    fun gradleBuildKeepsCommunityBaselineWithoutLspDependency() {
        val build = projectFile("build.gradle.kts").readText()

        assertContains(build, "intellijIdeaCommunity(\"2024.3.7\")")
        assertContains(build, "bundledPlugin(\"com.intellij.java\")")
        assertFalse(build.contains("com.intellij.platform.lsp"), build)
        assertFalse(build.contains("lsp.api"), build)
        assertFalse(build.contains("ultimate"), build.lowercase())
    }

    @Test
    fun docsDoNotClaimProductionJetBrainsLspSupport() {
        val readme = projectFile("README.md").readText().lowercase()

        listOf(
            "jetbrains lsp production support",
            "production jetbrains lsp support",
            "production-ready jetbrains lsp",
            "jetbrains production completions",
            "provider-backed jetbrains completions on keystrokes",
        ).forEach { forbidden ->
            assertFalse(readme.contains(forbidden), forbidden)
        }
    }

    private fun readMainKotlinSources(): String = Files.walk(projectFile("src/main/kotlin")).use { paths ->
        paths
            .filter { it.isRegularFile() && it.toString().endsWith(".kt") }
            .map { it.readText() }
            .toList()
            .joinToString("\n")
    }

    private fun projectFile(relativePath: String): Path = Path.of(System.getProperty("user.dir")).resolve(relativePath)

    private fun Path.readText(): String = Files.readString(this)
}
