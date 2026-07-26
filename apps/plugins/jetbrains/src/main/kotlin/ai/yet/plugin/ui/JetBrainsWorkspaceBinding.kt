package ai.yet.plugin.ui

import ai.yet.plugin.bridge.BridgeMessages
import ai.yet.plugin.runtime.RuntimeSettings
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.roots.ProjectRootManager
import java.net.HttpURLConnection
import java.net.URI
import java.nio.charset.StandardCharsets

internal data class LocalWorkspaceRoot(val path: String, val displayName: String?)

internal sealed class WorkspaceBindingResult {
    data class AutoBound(val projectId: String, val displayName: String) : WorkspaceBindingResult()
    data class SelectionRequired(val reason: String) : WorkspaceBindingResult()
}

internal fun interface WorkspaceBindingTransport {
    fun resolve(settings: RuntimeSettings, root: LocalWorkspaceRoot): WorkspaceBindingResult
}

internal object JetBrainsWorkspaceRoots {
    fun collect(project: Project): List<LocalWorkspaceRoot> = ApplicationManager.getApplication().runReadAction<List<LocalWorkspaceRoot>> {
        val label = project.name.takeIf(BridgeMessages::isValidProjectDisplayName)
        ProjectRootManager.getInstance(project).contentRoots
            .asSequence()
            .filter { it.isDirectory && it.fileSystem.protocol.equals("file", ignoreCase = true) }
            .mapNotNull { root -> root.canonicalPath ?: root.path.takeIf { it.isNotBlank() } }
            .distinct()
            .map { LocalWorkspaceRoot(it, label) }
            .toList()
    }
}

internal object EngineWorkspaceBindingTransport : WorkspaceBindingTransport {
    override fun resolve(settings: RuntimeSettings, root: LocalWorkspaceRoot): WorkspaceBindingResult {
        val token = settings.sessionToken ?: return unavailable()
        val endpoint = try {
            val runtime = URI(settings.runtimeUrl)
            val host = runtime.host?.removeSurrounding("[", "]")?.lowercase()
            if (runtime.scheme?.lowercase() !in setOf("http", "https") || host !in setOf("127.0.0.1", "localhost", "::1") || runtime.port !in 1..65535 || runtime.userInfo != null || runtime.query != null || runtime.fragment != null || runtime.path !in setOf("", "/")) return unavailable()
            runtime.resolve("/v1/projects/resolve-local-workspace").toURL()
        } catch (_: Exception) {
            return unavailable()
        }
        return try {
            val body = JsonObject().apply {
                addProperty("root", root.path)
                root.displayName?.let { addProperty("displayName", it) }
            }.toString().toByteArray(StandardCharsets.UTF_8)
            val connection = endpoint.openConnection() as HttpURLConnection
            connection.requestMethod = "POST"
            connection.connectTimeout = 2_000
            connection.readTimeout = 5_000
            connection.doOutput = true
            connection.setRequestProperty("Authorization", "Bearer $token")
            connection.setRequestProperty("X-Yet-AI-Caller", "ide_host")
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setFixedLengthStreamingMode(body.size)
            connection.outputStream.use { it.write(body) }
            if (connection.responseCode !in 200..299) return unavailable()
            val response = connection.inputStream.use { input ->
                input.readNBytes(MaxProjectSummaryBytes + 1).also {
                    if (it.size > MaxProjectSummaryBytes) return unavailable()
                }
            }
            parseProjectSummary(String(response, StandardCharsets.UTF_8)) ?: unavailable()
        } catch (_: Exception) {
            unavailable()
        }
    }

    private fun parseProjectSummary(raw: String): WorkspaceBindingResult.AutoBound? {
        val element = try {
            JsonParser.parseString(raw)
        } catch (_: RuntimeException) {
            return null
        }
        if (!element.isJsonObject) return null
        val summary = element.asJsonObject
        if (summary.keySet() != ProjectSummaryKeys) return null
        val projectId = summary.string("projectId") ?: return null
        val displayName = summary.string("displayName") ?: return null
        if (!BridgeMessages.isValidProjectId(projectId) || !BridgeMessages.isValidProjectDisplayName(displayName)) return null
        if (summary.string("status") != "available") return null
        if (summary.string("revision") == null || summary.string("createdAt") == null) return null
        if (!summary.boolean("rootAvailable") || summary.boolean("cloudRequired") || summary.string("providerAccess") != "direct") return null
        val lastOpenedAt = summary.get("lastOpenedAt")
        if (lastOpenedAt != null && !lastOpenedAt.isJsonNull && (!lastOpenedAt.isJsonPrimitive || !lastOpenedAt.asJsonPrimitive.isString)) return null
        return WorkspaceBindingResult.AutoBound(projectId, displayName)
    }

    private fun JsonObject.string(name: String): String? = get(name)?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isString }?.asString
    private fun JsonObject.boolean(name: String): Boolean {
        return get(name)?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isBoolean }?.asBoolean ?: false
    }
    private fun unavailable() = WorkspaceBindingResult.SelectionRequired("root_unavailable")

    private const val MaxProjectSummaryBytes = 16 * 1024
    private val ProjectSummaryKeys = setOf("projectId", "displayName", "status", "revision", "createdAt", "lastOpenedAt", "rootAvailable", "cloudRequired", "providerAccess")
}

internal object JetBrainsWorkspaceBindingResolver {
    fun resolve(
        roots: List<LocalWorkspaceRoot>,
        settings: RuntimeSettings,
        transport: WorkspaceBindingTransport = EngineWorkspaceBindingTransport,
    ): WorkspaceBindingResult = when (roots.size) {
        0 -> WorkspaceBindingResult.SelectionRequired("no_root")
        1 -> transport.resolve(settings, roots.single())
        else -> WorkspaceBindingResult.SelectionRequired("multiple_roots")
    }
}

internal fun workspaceBindingMessage(requestId: String, result: WorkspaceBindingResult): String? = when (result) {
    is WorkspaceBindingResult.AutoBound -> BridgeMessages.workspaceBindingAutoBound(requestId, result.projectId, result.displayName)
    is WorkspaceBindingResult.SelectionRequired -> BridgeMessages.workspaceBindingSelectionRequired(requestId, result.reason)
}

internal fun canDeliverWorkspaceBinding(
    disposed: Boolean,
    generation: Long,
    currentGeneration: Long,
    requestId: String,
    guiReadyRequestId: String?,
    acceptedHostReadyRequestId: String?,
): Boolean = !disposed && generation == currentGeneration && requestId == guiReadyRequestId && requestId == acceptedHostReadyRequestId
