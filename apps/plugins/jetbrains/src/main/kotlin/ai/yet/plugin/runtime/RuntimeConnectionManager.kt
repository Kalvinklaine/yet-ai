package ai.yet.plugin.runtime

import ai.yet.plugin.identity.ProductIdentity
import ai.yet.plugin.settings.YetSettingsState
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.util.messages.Topic
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.nio.file.Files
import java.nio.file.Path
import java.security.SecureRandom
import java.util.Base64
import kotlin.concurrent.thread

@Service(Service.Level.APP)
class RuntimeConnectionManager(
    private val bundledEngineProvider: BundledEngineProvider = DefaultBundledEngineProvider(),
    private val engineBinaryFinder: (Path?) -> Path? = ::findEngineBinary,
    private val processStarter: (EngineLaunchCommand) -> Process = ::startEngineProcess,
    private val tokenGenerator: () -> String = ::generateSessionToken,
    private val healthChecker: (RuntimeSettings) -> Unit = ::checkHealth,
) : Disposable {
    private val logger = Logger.getInstance(RuntimeConnectionManager::class.java)
    private var launchedProcess: Process? = null
    private var launchedConnection: RuntimeSettings? = null
    private var lastHealthResult: String? = null
    private var lastConnectionError: String? = null
    private var lastProcessExit: String? = null

    @Synchronized
    fun prepare(): RuntimeConnectionResult {
        return prepareCurrent(publishUpdates = true)
    }

    @Synchronized
    private fun prepareCurrent(publishUpdates: Boolean): RuntimeConnectionResult {
        val settings = try {
            RuntimeSettings.current()
        } catch (error: Exception) {
            lastHealthResult = null
            lastConnectionError = sanitizedRuntimeError("Yet AI runtime settings are invalid", error)
            val result = RuntimeConnectionResult(
                RuntimeSettings.safeFallback(),
                null,
                lastConnectionError,
            )
            if (publishUpdates) publishRuntimeConnectionUpdate(result)
            return result
        }
        val previousConnection = launchedConnection
        val result = prepareResolvedSettings(settings)
        if (publishUpdates && (result.error != null || result.settings != previousConnection)) publishRuntimeConnectionUpdate(result)
        return result
    }

    @Synchronized
    internal fun prepareForTest(settings: RuntimeSettings): RuntimeConnectionResult = prepareResolvedSettings(settings)

    @Synchronized
    private fun prepareResolvedSettings(settings: RuntimeSettings): RuntimeConnectionResult {
        reconcileExitedLaunchedProcess()
        var connection = try {
            prepareConnectionSettings(settings)
        } catch (error: Exception) {
            val result = failedRuntimeConnection(settings, null, "Yet AI local runtime launch failed", error)
            lastHealthResult = null
            lastConnectionError = result.error
            return result
        }
        return try {
            healthChecker(connection)
            lastHealthResult = "/v1/ping returned 2xx"
            lastConnectionError = null
            RuntimeConnectionResult(connection, "Connected to Yet AI local runtime at ${connection.runtimeUrl}.", null)
        } catch (error: Exception) {
            if (isHttp401(error) && shouldRetryPluginOwnedRuntime(settings, connection)) {
                logger.info("Yet AI plugin-launched runtime returned HTTP 401 during health check; restarting once with a fresh session token")
                stopLaunchedProcess()
                connection = try {
                    prepareConnectionSettings(settings)
                } catch (launchError: Exception) {
                    val result = failedRuntimeConnection(settings, null, "Yet AI local runtime launch failed after HTTP 401 recovery", launchError)
                    lastHealthResult = "HTTP 401 from /v1/ping; plugin-owned restart failed"
                    lastConnectionError = result.error
                    return result
                }
                return try {
                    healthChecker(connection)
                    lastHealthResult = "/v1/ping returned 2xx after HTTP 401 recovery"
                    lastConnectionError = null
                    RuntimeConnectionResult(connection, "Connected to Yet AI local runtime at ${connection.runtimeUrl} after refreshing the runtime session token.", null)
                } catch (retryError: Exception) {
                    val result = failedRuntimeConnection(settings, connection, "Yet AI local runtime connection failed after HTTP 401 recovery", retryError)
                    stopLaunchedProcess()
                    lastHealthResult = "HTTP 401 recovery attempted once for plugin-owned runtime"
                    lastConnectionError = result.error
                    return result
                }
            }
            val result = failedRuntimeConnection(settings, connection, "Yet AI local runtime connection failed", error)
            lastHealthResult = if (isHttp401(error)) "HTTP 401 from /v1/ping" else null
            lastConnectionError = result.error
            result
        }
    }

    @Synchronized
    private fun shouldRetryPluginOwnedRuntime(settings: RuntimeSettings, connection: RuntimeSettings): Boolean {
        val process = launchedProcess
        return process?.isAlive == true &&
            launchedConnection == connection &&
            (settings.launchMode == LaunchMode.LAUNCH || settings.launchMode == LaunchMode.AUTO)
    }

    @Synchronized
    fun restartRuntime(): RuntimeConnectionResult {
        stopLaunchedProcess()
        val result = prepareCurrent(publishUpdates = false)
        publishRuntimeConnectionUpdate(result)
        return result
    }

    @Synchronized
    fun runtimeDiagnostics(): String {
        reconcileExitedLaunchedProcess()
        val state = YetSettingsState.getInstance().state
        val rawRuntimeUrl = state.runtimeUrl
        val rawLaunchMode = state.launchMode
        val rawEngineBinaryPath = state.engineBinaryPath
        val settings = try {
            RuntimeSettings.current()
        } catch (error: Exception) {
            return formatRuntimeDiagnostics(
                RuntimeDiagnostics(
                    launchMode = rawLaunchMode.trim().ifBlank { "auto" },
                    runtimeUrl = sanitizeRuntimeUrlForDiagnostics(rawRuntimeUrl),
                    engineBinaryConfigured = rawEngineBinaryPath.isNotBlank(),
                    binaryStatus = "settings invalid: ${redactLogText(error.message ?: error::class.java.simpleName, "")}",
                    launchedByPlugin = launchedProcess?.isAlive == true,
                    health = null,
                    error = sanitizedRuntimeError("Yet AI runtime settings are invalid", error),
                    process = lastProcessExit,
                ),
            )
        }
        return formatRuntimeDiagnostics(
            RuntimeDiagnostics(
                launchMode = settings.launchMode.name.lowercase(),
                runtimeUrl = sanitizeRuntimeUrlForDiagnostics(settings.runtimeUrl),
                engineBinaryConfigured = settings.engineBinaryPath != null,
                binaryStatus = describeEngineBinaryStatus(settings),
                launchedByPlugin = launchedProcess?.isAlive == true,
                health = lastHealthResult,
                error = lastConnectionError,
                process = lastProcessExit,
            ),
        )
    }

    @Synchronized
    internal fun runtimeDiagnosticsForTest(settings: RuntimeSettings): String {
        reconcileExitedLaunchedProcess()
        return formatRuntimeDiagnostics(
            RuntimeDiagnostics(
                launchMode = settings.launchMode.name.lowercase(),
                runtimeUrl = sanitizeRuntimeUrlForDiagnostics(settings.runtimeUrl),
                engineBinaryConfigured = settings.engineBinaryPath != null,
                binaryStatus = describeEngineBinaryStatus(settings),
                launchedByPlugin = launchedProcess?.isAlive == true,
                health = lastHealthResult,
                error = lastConnectionError,
                process = lastProcessExit,
            ),
        )
    }

    @Synchronized
    fun prepareConnectionSettings(settings: RuntimeSettings): RuntimeSettings {
        val binaryPath = when (settings.launchMode) {
            LaunchMode.CONNECT -> null
            LaunchMode.LAUNCH -> {
                val configured = settings.engineBinaryPath
                if (configured != null) {
                    engineBinaryFinder(configured)
                } else {
                    val bundled = resolveBundledEngineOrThrow(bundledEngineProvider)
                    if (bundled != null) {
                        bundled
                    } else {
                        engineBinaryFinder(null)
                            ?: throw IllegalArgumentException("Yet AI engine binary path must point to ${ProductIdentity.engineBinaryName} when launch mode is enabled")
                    }
                }
            }
            LaunchMode.AUTO -> resolveEngineBinary(settings.engineBinaryPath, resolveBundledEngineOrThrow(bundledEngineProvider), engineBinaryFinder)
        }
        val shouldLaunch = settings.launchMode == LaunchMode.LAUNCH ||
            (settings.launchMode == LaunchMode.AUTO && binaryPath != null)
        return if (shouldLaunch) {
            launchOrReuse(settings, requireNotNull(binaryPath))
        } else {
            settings
        }
    }

    @Synchronized
    private fun launchOrReuse(settings: RuntimeSettings, binaryPath: Path): RuntimeSettings {
        reconcileExitedLaunchedProcess()
        val existing = launchedProcess
        val existingConnection = launchedConnection
        if (existing != null && existing.isAlive && existingConnection?.runtimeUrl == settings.runtimeUrl) {
            return existingConnection
        }
        stopLaunchedProcess()
        val token = tokenGenerator()
        val command = buildEngineLaunchCommand(settings.runtimeUrl, binaryPath, token)
        val process = try {
            processStarter(command)
        } catch (error: Exception) {
            throw IllegalStateException(sanitizedRuntimeError("Yet AI local runtime process start failed", error, token))
        }
        launchedProcess = process
        launchedConnection = settings.copyWithSessionToken(token)
        attachLogs(process, token)
        logger.info("Started Yet AI local runtime")
        thread(name = "Yet AI runtime watcher", isDaemon = true) {
            val code = process.waitFor()
            logger.info("Yet AI local runtime exited with code $code")
            synchronized(this@RuntimeConnectionManager) {
                if (launchedProcess == process) {
                    lastProcessExit = pluginLaunchedProcessExitMessage(code)
                    launchedProcess = null
                    launchedConnection = null
                }
            }
        }
        return launchedConnection ?: settings.copyWithSessionToken(token)
    }

    @Synchronized
    private fun reconcileExitedLaunchedProcess() {
        val process = launchedProcess ?: return
        if (process.isAlive) return
        val code = runCatching { process.exitValue() }.getOrNull()
        lastProcessExit = pluginLaunchedProcessExitMessage(code)
        launchedProcess = null
        launchedConnection = null
        lastHealthResult = null
    }

    private fun attachLogs(process: Process, token: String) {
        listOf(process.inputStream, process.errorStream).forEach { stream ->
            thread(name = "Yet AI runtime log", isDaemon = true) {
                BufferedReader(InputStreamReader(stream)).useLines { lines ->
                    lines.forEach { line ->
                        if (line.isNotBlank()) {
                            logger.info("Yet AI runtime: ${redactLogText(line, token)}")
                        }
                    }
                }
            }
        }
    }

    @Synchronized
    private fun stopLaunchedProcess() {
        val process = launchedProcess ?: return
        launchedProcess = null
        launchedConnection = null
        lastHealthResult = null
        lastProcessExit = null
        stopProcess(process)
    }

    override fun dispose() {
        stopLaunchedProcess()
    }

    companion object {
        fun getInstance(): RuntimeConnectionManager = service()
    }

    private fun publishRuntimeConnectionUpdate(result: RuntimeConnectionResult) {
        ApplicationManager.getApplication().messageBus.syncPublisher(RuntimeConnectionListener.TOPIC).runtimeConnectionUpdated(result)
    }
}

private fun pluginLaunchedProcessExitMessage(code: Int?): String {
    val codeText = code?.toString() ?: "unknown"
    return "plugin-launched process exited with code $codeText; click Refresh runtime or run Yet AI: Restart Runtime to relaunch"
}

interface RuntimeConnectionListener {
    fun runtimeConnectionUpdated(result: RuntimeConnectionResult)

    companion object {
        val TOPIC: Topic<RuntimeConnectionListener> = Topic.create("Yet AI runtime connection updates", RuntimeConnectionListener::class.java)
    }
}

class RuntimeHealthCheckException(message: String, val statusCode: Int? = null, cause: Throwable? = null) : IllegalStateException(message, cause)

private fun isHttp401(error: Exception): Boolean = error is RuntimeHealthCheckException && error.statusCode == 401 ||
    error.message?.contains("HTTP 401", ignoreCase = true) == true

fun failedRuntimeConnection(
    settings: RuntimeSettings,
    attemptedSettings: RuntimeSettings?,
    prefix: String,
    error: Exception,
): RuntimeConnectionResult {
    val token = attemptedSettings?.sessionToken ?: settings.sessionToken
    val sanitized = sanitizedRuntimeError(prefix, error, token)
    val guidance = if (isHttp401(error)) {
        " Stale external yet-lsp, loopback port reuse, or debug/session token mismatch can cause HTTP 401. Stop the existing process, change the Runtime URL port, or use connect mode with a matching local runtime token."
    } else {
        ""
    }
    return RuntimeConnectionResult(
        attemptedSettings ?: settings,
        null,
        sanitized + guidance,
    )
}

data class RuntimeConnectionResult(
    val settings: RuntimeSettings,
    val status: String?,
    val error: String?,
)

data class EngineLaunchCommand(
    val binaryPath: Path,
    val environment: Map<String, String>,
)

fun startEngineProcess(command: EngineLaunchCommand): Process = ProcessBuilder(command.binaryPath.toString())
    .redirectInput(ProcessBuilder.Redirect.PIPE)
    .apply {
        environment().clear()
        environment().putAll(command.environment)
    }
    .start()

data class RuntimeDiagnostics(
    val launchMode: String,
    val runtimeUrl: String,
    val engineBinaryConfigured: Boolean,
    val binaryStatus: String,
    val launchedByPlugin: Boolean,
    val health: String?,
    val error: String?,
    val process: String? = null,
)

fun formatRuntimeDiagnostics(diagnostics: RuntimeDiagnostics): String {
    val mode = diagnostics.launchMode.lowercase()
    val guidance = when (mode) {
        "connect" -> "Connect mode expects an already running loopback Yet AI runtime. Verify the URL, port, and debug token match the runtime process."
        "launch" -> "Launch mode requires an executable ${ProductIdentity.engineBinaryName} path and an http runtime URL with an explicit nonzero port."
        else -> "Auto mode launches ${ProductIdentity.engineBinaryName} when a binary is configured or discoverable on PATH; otherwise it connects to the configured loopback URL."
    }
    val diagnosis = runtimeDiagnosis(diagnostics)
    val nextAction = runtimeNextAction(diagnostics, diagnosis)
    return listOf(
        "Yet AI Runtime Status",
        "Launch mode: $mode",
        "Runtime URL: ${diagnostics.runtimeUrl}",
        "Engine binary path configured: ${if (diagnostics.engineBinaryConfigured) "yes" else "no"}",
        "Binary status: ${redactLogText(diagnostics.binaryStatus, "")}",
        "Plugin-launched process: ${if (diagnostics.launchedByPlugin) "running" else "not running"}",
        "Last health: ${diagnostics.health?.let { redactLogText(it, "") } ?: "not checked yet"}",
        "Last process: ${diagnostics.process?.let { redactLogText(it, "") } ?: "no plugin-launched exit recorded"}",
        "Last error: ${diagnostics.error?.let { redactLogText(it, "") } ?: "none"}",
        "Diagnosis: $diagnosis",
        "Next action: $nextAction",
        "Guidance: $guidance",
        "Restart: Yet AI: Restart Runtime stops only a process launched by this plugin, then prepares the current settings again.",
    ).joinToString("\n")
}

private fun runtimeDiagnosis(diagnostics: RuntimeDiagnostics): String {
    val combined = listOfNotNull(diagnostics.binaryStatus, diagnostics.health, diagnostics.process, diagnostics.error).joinToString("\n").lowercase()
    val url = diagnostics.runtimeUrl.lowercase()
    return when {
        diagnostics.launchMode.lowercase() == "connect" && diagnostics.error == null && diagnostics.health == null ->
            "connect mode is waiting for an externally managed local runtime"
        diagnostics.binaryStatus.contains("not executable", ignoreCase = true) ->
            "configured engine binary is missing or not executable"
        diagnostics.binaryStatus.contains("no configured path", ignoreCase = true) || diagnostics.binaryStatus.contains("no configured or discovered binary", ignoreCase = true) ->
            "no launchable bundled, configured, or PATH engine binary was found"
        url.startsWith("https://") || combined.contains("requires runtime url to use http") || combined.contains("explicit nonzero port") || Regex("^http://[^:]+$").containsMatchIn(url) ->
            "launch URL is invalid for plugin-managed runtime launch"
        combined.contains("http 401") ->
            "local runtime rejected the session token (HTTP 401 token mismatch)"
        combined.contains("address already in use") || combined.contains("address in use") || combined.contains("port already in use") || combined.contains("eaddrinuse") ->
            "loopback port is already in use by another process"
        combined.contains("/v1/ping") || combined.contains("health check failed") || combined.contains("failed to connect") || combined.contains("connection refused") ->
            "runtime process did not answer authenticated /v1/ping"
        diagnostics.process?.contains("exited", ignoreCase = true) == true ->
            "plugin-launched runtime process exited unexpectedly"
        diagnostics.error != null ->
            "runtime failure detected; details are sanitized above"
        else -> "no runtime failure recorded"
    }
}

private fun runtimeNextAction(diagnostics: RuntimeDiagnostics, diagnosis: String): String = when {
    diagnosis.contains("token mismatch") ->
        "Click Refresh runtime, then use Yet AI: Restart Runtime. In connect mode, make the IDE debug/session token match the external runtime; this is not a provider API key."
    diagnosis.contains("engine binary") ->
        "Keep Launch mode auto/launch and leave Engine binary path empty when the bundled runtime is available; otherwise reinstall the matching artifact or configure an absolute executable ${ProductIdentity.engineBinaryName} path."
    diagnosis.contains("launch URL") ->
        "Set Runtime URL to an http loopback URL with an explicit nonzero port, for example http://127.0.0.1:8001; https is not supported for plugin launch mode."
    diagnosis.contains("port") ->
        "Use Yet AI: Restart Runtime, stop the other local process, or change the loopback Runtime URL port."
    diagnosis.contains("/v1/ping") || diagnosis.contains("exited") ->
        "Click Refresh runtime, then run Yet AI: Restart Runtime. If it still fails, open Yet AI: Show Runtime Status and check for port conflict or binary diagnostics."
    diagnostics.launchMode.lowercase() == "connect" ->
        "Start the external loopback runtime yourself, verify the URL/port/token, then click Refresh runtime or Show Runtime Status."
    else -> "Click Refresh runtime or run Yet AI: Restart Runtime, then open Yet AI: Show Runtime Status if the GUI still reports runtime unavailable."
}

fun sanitizeRuntimeUrlForDiagnostics(value: String): String {
    val uri = try {
        URI(value.trim())
    } catch (_: Exception) {
        return redactLogText(value.trim().ifBlank { "not configured" }, "")
    }
    val scheme = uri.scheme ?: return redactLogText(value.trim(), "")
    val host = uri.host?.let { if (it == "::1") "[::1]" else it } ?: "unknown-host"
    val port = if (uri.port >= 0) ":${uri.port}" else ""
    return "$scheme://$host$port"
}

fun describeEngineBinaryStatus(
    settings: RuntimeSettings,
    bundledAvailability: String? = null,
): String = when (settings.launchMode) {
    LaunchMode.CONNECT -> "not used in connect mode"
    LaunchMode.LAUNCH -> {
        val path = settings.engineBinaryPath
        val bundled = (bundledAvailability ?: BundledEngineResources.describeAvailability()) == "available"
        when {
            path == null && bundled -> "bundled plugin binary available"
            path == null -> "no configured path and no bundled plugin binary available"
            isLaunchableEngineFile(path) -> "configured binary is executable"
            else -> "configured binary is not executable"
        }
    }
    LaunchMode.AUTO -> {
        val path = settings.engineBinaryPath
        val bundled = (bundledAvailability ?: BundledEngineResources.describeAvailability()) == "available"
        when {
            path != null && isLaunchableEngineFile(path) -> "configured binary is executable"
            path != null -> "configured binary is not executable"
            bundled -> "bundled plugin binary available"
            findEngineBinary(null) != null -> "discovered ${ProductIdentity.engineBinaryName} on PATH"
            else -> "no configured or discovered binary; connect-only fallback"
        }
    }
}

fun buildEngineLaunchCommand(
    runtimeUrl: String,
    binaryPath: Path,
    sessionToken: String,
    baseEnvironment: Map<String, String> = System.getenv(),
): EngineLaunchCommand {
    val env = sanitizedEngineLaunchEnvironment(baseEnvironment).toMutableMap()
    env["YET_AI_AUTH_TOKEN"] = sessionToken
    env["YET_AI_HTTP_PORT"] = parseExplicitRuntimePort(runtimeUrl).toString()
    return EngineLaunchCommand(binaryPath, env)
}

private val safeEngineLaunchEnvironmentNames = setOf(
    "PATH",
    "HOME",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "SystemRoot",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
)

fun sanitizedEngineLaunchEnvironment(baseEnvironment: Map<String, String>): Map<String, String> =
    baseEnvironment.filterKeys { name ->
        name in safeEngineLaunchEnvironmentNames || name.startsWith("LC_")
    }

fun parseRuntimePort(runtimeUrl: String): Int {
    val uri = URI(runtimeUrl)
    if (uri.port >= 0) {
        return uri.port
    }
    return if (uri.scheme == "https") 443 else 80
}

fun parseExplicitRuntimePort(runtimeUrl: String): Int {
    val uri = URI(runtimeUrl)
    if (uri.scheme?.lowercase() != "http") {
        throw IllegalArgumentException("Yet AI launch mode requires runtime URL to use http")
    }
    if (uri.port <= 0) {
        throw IllegalArgumentException("Yet AI launch mode requires runtime URL with an explicit nonzero port such as http://127.0.0.1:8001")
    }
    return uri.port
}

/**
 * Strategy for resolving the bundled engine binary shipped inside the plugin
 * JAR. Implementations must return `null` when no bundle is present so the
 * discovery chain can fall through to PATH lookup. If a bundle is present but
 * cannot be resolved/extracted, implementations must throw so callers surface a
 * launch failure instead of silently falling back to PATH/connect.
 */
interface BundledEngineProvider {
    fun resolveOrNull(): Path?
}

private class DefaultBundledEngineProvider : BundledEngineProvider {
    override fun resolveOrNull(): Path? {
        if (!BundledEngineResources.isBundled()) {
            return null
        }
        return BundledEngineResources.resolveOrExtract()
    }
}

private fun resolveBundledEngineOrThrow(provider: BundledEngineProvider): Path? = try {
    provider.resolveOrNull()
} catch (error: Exception) {
    throw IllegalStateException(sanitizedRuntimeError("Bundled Yet AI engine extraction failed", error))
}

/**
 * Discovery order: configured absolute path (must be launchable, else throws),
 * then the bundled plugin engine resource (if the JAR ships one), then PATH.
 * In `auto` mode a missing configured path is not an error: discovery simply
 * continues with bundled, then PATH, then connect-only fallback. An explicit
 * configured path that is not launchable always throws so the user sees the
 * failure rather than a silent fallback.
 */
fun resolveEngineBinary(
    configuredPath: Path?,
    bundled: Path? = BundledEngineResources.resolveOrExtract(),
    finder: (Path?) -> Path? = ::findEngineBinary,
): Path? {
    if (configuredPath != null) {
        return finder(configuredPath)
    }
    if (bundled != null) {
        return bundled
    }
    return finder(null)
}

fun findEngineBinary(configuredPath: Path?): Path? {
    if (configuredPath != null) {
        if (!isLaunchableEngineFile(configuredPath)) {
            throw IllegalArgumentException("Yet AI engine binary path must point to an executable file")
        }
        return configuredPath
    }
    val suffixes = if (System.getProperty("os.name").lowercase().contains("win")) listOf(".exe", ".cmd", ".bat", "") else listOf("")
    val pathEnv = System.getenv("PATH").orEmpty().split(File.pathSeparator).filter { it.isNotBlank() }
    for (directory in pathEnv) {
        for (suffix in suffixes) {
            val candidate = Path.of(directory, ProductIdentity.engineBinaryName + suffix)
            if (isLaunchableEngineFile(candidate)) {
                return candidate
            }
        }
    }
    return null
}

fun checkHealth(settings: RuntimeSettings) {
    val pingUrl = URL(URI(settings.runtimeUrl).resolve("/v1/ping").toString())
    var lastError = "no response"
    repeat(20) {
        var connection: HttpURLConnection? = null
        try {
            connection = pingUrl.openConnection() as HttpURLConnection
            connection.requestMethod = "GET"
            connection.connectTimeout = 250
            connection.readTimeout = 250
            settings.sessionToken?.let { connection.setRequestProperty("Authorization", "Bearer $it") }
            if (connection.responseCode in 200..299) {
                return
            }
            lastError = "HTTP ${connection.responseCode}"
        } catch (error: Exception) {
            lastError = error.message ?: "unknown health check error"
        } finally {
            connection?.disconnect()
        }
        Thread.sleep(250)
    }
    val statusCode = Regex("HTTP\\s+(\\d{3})", RegexOption.IGNORE_CASE).find(lastError)?.groupValues?.get(1)?.toIntOrNull()
    throw RuntimeHealthCheckException("Yet AI local runtime health check failed at /v1/ping: $lastError", statusCode)
}

fun stopProcess(process: Process, waitMillis: Long = 1500): Boolean {
    if (!process.isAlive) {
        return true
    }
    process.destroy()
    if (process.waitFor(waitMillis, java.util.concurrent.TimeUnit.MILLISECONDS)) {
        return true
    }
    process.destroyForcibly()
    return process.waitFor(waitMillis, java.util.concurrent.TimeUnit.MILLISECONDS)
}

fun isLaunchableEngineFile(path: Path, osName: String = System.getProperty("os.name")): Boolean {
    if (!Files.isRegularFile(path)) {
        return false
    }
    if (osName.lowercase().contains("win")) {
        val name = path.fileName.toString().lowercase()
        return name.endsWith(".exe") || name.endsWith(".cmd") || name.endsWith(".bat") || Files.isExecutable(path)
    }
    return Files.isExecutable(path)
}

fun sanitizedRuntimeError(prefix: String, error: Exception, exactToken: String? = null): String {
    val detail = error.message?.takeIf { it.isNotBlank() } ?: error::class.java.simpleName
    return prefix + ": " + redactRuntimeError(detail, exactToken)
}

private fun redactRuntimeError(value: String, exactToken: String?): String = redactSensitiveText(value, exactToken)

private fun generateSessionToken(): String {
    val bytes = ByteArray(32)
    SecureRandom().nextBytes(bytes)
    return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
}

fun redactLogText(value: String, token: String): String = redactSensitiveText(value, token)

private fun redactSensitiveText(value: String, exactToken: String?): String {
    var redacted = value
    if (!exactToken.isNullOrBlank()) {
        redacted = redacted.replace(exactToken, "[redacted]")
    }
    redacted = redacted
        .replace(Regex("(?i)(^|[\\r\\n])([^\\r\\n]*\\b(?:cookie|set[-_]?cookie|setCookie)\\s*[:=]\\s*)[^\\r\\n]*")) { match ->
            match.groupValues[1] + match.groupValues[2] + "[redacted]"
        }
        .replace(Regex("(?i)\\b(?:Authorization|Cookie|Set-Cookie)\\s*:\\s*[^\\r\\n]+"), "[redacted]")
        .replace(Regex("(?i)([\"'])(?:[A-Za-z0-9_-]*(?:access[_-]?token|refresh[_-]?token|session[_-]?token|auth[_-]?token|token|api[_-]?key|authorization|bearer|cookie|client[_-]?secret|code[_-]?verifier|pkce[_-]?verifier|verifier)[A-Za-z0-9_-]*)\\1\\s*:\\s*([\"'])(?:\\\\.|(?!\\2).)*\\2"), "[redacted]")
        .replace(Regex("(?i)\\bBearer\\s+[^\\s\"']+"), "Bearer [redacted]")
        .replace(Regex("\\b[A-Za-z0-9_-]{16,}\\.[A-Za-z0-9_-]{16,}\\.[A-Za-z0-9_-]{16,}\\b"), "[redacted]")
        .replace(Regex("\\bsk-[A-Za-z0-9_-]{8,}\\b"), "[redacted]")
        .replace(Regex("(?i)([?&;#])([A-Za-z0-9_-]*(?:access[_-]?token|refresh[_-]?token|session[_-]?token|auth[_-]?token|token|api[_-]?key|authorization|bearer|cookie|client[_-]?secret|oauth[_-]?code|code[_-]?verifier|pkce[_-]?verifier|verifier)[A-Za-z0-9_-]*)=([^\\s&#;]+)")) { match ->
            match.groupValues[1] + match.groupValues[2] + "=[redacted]"
        }
        .replace(Regex("(?i)(?:^|[\\s,{(])(?:[A-Za-z0-9_-]*(?:access[_-]?token|refresh[_-]?token|session[_-]?token|auth[_-]?token|token|api[_-]?key|authorization|bearer|cookie|client[_-]?secret|code[_-]?verifier|pkce[_-]?verifier|verifier)[A-Za-z0-9_-]*)\\s*[:=]\\s*[^\\s,)}\\]]+"), "[redacted]")
        .replace(Regex("(?i)(^|[\\s\"'`=:(,{])(?:\\.\\.?[/\\\\])?\\.codex[/\\\\]auth\\.json(?=$|[\\s\"'`,;:)}\\]])")) { match ->
            match.groupValues[1] + "[redacted]"
        }
        .replace(Regex("(?i)(^|[\\s\"'`=:(,{])auth\\.json(?=$|[\\s\"'`,;:)}\\]])")) { match ->
            match.groupValues[1] + "[redacted]"
        }
        .replace(Regex("(?i)(?:[A-Za-z]:)?(?:[/\\\\][^\\r\\n,;)}\\]]*)*(?:[/\\\\](?:\\.codex[/\\\\])?auth\\.json)"), "[redacted]")
        .replace(Regex("(?:[A-Za-z]:\\\\[^\\r\\n,;)}\\]\\s]+(?:\\\\[^\\r\\n,;)}\\]\\s]+)+|/(?:Users|home|var/folders|tmp|private|Volumes)/[^\\r\\n,;)}\\]\\s]+(?:/[^\\r\\n,;)}\\]\\s]+)*)"), "[redacted path]")
        .replace(Regex("\\b[A-Za-z0-9_-]{48,}\\b"), "[redacted]")
    return if (redacted.length > 500) redacted.take(500) + "…" else redacted
}
