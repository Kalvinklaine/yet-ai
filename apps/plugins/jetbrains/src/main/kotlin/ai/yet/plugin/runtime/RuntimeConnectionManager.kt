package ai.yet.plugin.runtime

import ai.yet.plugin.identity.ProductIdentity
import com.intellij.openapi.Disposable
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.diagnostic.Logger
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
class RuntimeConnectionManager : Disposable {
    private val logger = Logger.getInstance(RuntimeConnectionManager::class.java)
    private var launchedProcess: Process? = null
    private var launchedConnection: RuntimeSettings? = null

    @Synchronized
    fun prepare(): RuntimeConnectionResult {
        val settings = try {
            RuntimeSettings.current()
        } catch (error: Exception) {
            return RuntimeConnectionResult(
                RuntimeSettings.safeFallback(),
                null,
                sanitizedRuntimeError("Yet AI runtime settings are invalid", error),
            )
        }
        val connection = try {
            prepareConnectionSettings(settings)
        } catch (error: Exception) {
            return failedRuntimeConnection(settings, null, "Yet AI local runtime launch failed", error)
        }
        return try {
            checkHealth(connection)
            RuntimeConnectionResult(connection, "Connected to Yet AI local runtime at ${connection.runtimeUrl}.", null)
        } catch (error: Exception) {
            failedRuntimeConnection(settings, connection, "Yet AI local runtime connection failed", error)
        }
    }

    @Synchronized
    fun prepareConnectionSettings(settings: RuntimeSettings): RuntimeSettings {
        val binaryPath = when (settings.launchMode) {
            LaunchMode.CONNECT -> null
            LaunchMode.LAUNCH -> findEngineBinary(settings.engineBinaryPath)
                ?: throw IllegalArgumentException("Yet AI engine binary path must point to ${ProductIdentity.engineBinaryName} when launch mode is enabled")
            LaunchMode.AUTO -> findEngineBinary(settings.engineBinaryPath)
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
        val existing = launchedProcess
        val existingConnection = launchedConnection
        if (existing != null && existing.isAlive && existingConnection?.runtimeUrl == settings.runtimeUrl) {
            return existingConnection
        }
        stopLaunchedProcess()
        val token = generateSessionToken()
        val command = buildEngineLaunchCommand(settings.runtimeUrl, binaryPath, token)
        val process = ProcessBuilder(command.binaryPath.toString())
            .redirectInput(ProcessBuilder.Redirect.PIPE)
            .apply { environment().putAll(command.environment) }
            .start()
        launchedProcess = process
        launchedConnection = settings.copyWithSessionToken(token)
        attachLogs(process, token)
        logger.info("Started Yet AI local runtime")
        thread(name = "Yet AI runtime watcher", isDaemon = true) {
            val code = process.waitFor()
            logger.info("Yet AI local runtime exited with code $code")
            synchronized(this@RuntimeConnectionManager) {
                if (launchedProcess == process) {
                    launchedProcess = null
                    launchedConnection = null
                }
            }
        }
        return launchedConnection ?: settings.copyWithSessionToken(token)
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
        stopProcess(process)
    }

    override fun dispose() {
        stopLaunchedProcess()
    }

    companion object {
        fun getInstance(): RuntimeConnectionManager = service()
    }
}

fun failedRuntimeConnection(
    settings: RuntimeSettings,
    attemptedSettings: RuntimeSettings?,
    prefix: String,
    error: Exception,
): RuntimeConnectionResult = RuntimeConnectionResult(
    attemptedSettings ?: settings,
    null,
    sanitizedRuntimeError(prefix, error, attemptedSettings?.sessionToken ?: settings.sessionToken),
)

data class RuntimeConnectionResult(
    val settings: RuntimeSettings,
    val status: String?,
    val error: String?,
)

data class EngineLaunchCommand(
    val binaryPath: Path,
    val environment: Map<String, String>,
)

fun buildEngineLaunchCommand(
    runtimeUrl: String,
    binaryPath: Path,
    sessionToken: String,
    baseEnvironment: Map<String, String> = System.getenv(),
): EngineLaunchCommand {
    val env = baseEnvironment.toMutableMap()
    env["YET_AI_AUTH_TOKEN"] = sessionToken
    env["YET_AI_HTTP_PORT"] = parseExplicitRuntimePort(runtimeUrl).toString()
    return EngineLaunchCommand(binaryPath, env)
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
    throw IllegalStateException("Yet AI local runtime health check failed at /v1/ping: $lastError")
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
        .replace(Regex("(?i)\\b(?:Authorization|Cookie|Set-Cookie)\\s*:\\s*[^\\r\\n]+"), "[redacted]")
        .replace(Regex("(?i)([\"'])(?:[A-Za-z0-9_-]*(?:access[_-]?token|refresh[_-]?token|session[_-]?token|auth[_-]?token|token|api[_-]?key|authorization|bearer|cookie|client[_-]?secret|code[_-]?verifier|pkce[_-]?verifier|verifier)[A-Za-z0-9_-]*)\\1\\s*:\\s*([\"'])(?:\\\\.|(?!\\2).)*\\2"), "[redacted]")
        .replace(Regex("(?i)\\bBearer\\s+[^\\s\"']+"), "Bearer [redacted]")
        .replace(Regex("\\b[A-Za-z0-9_-]{16,}\\.[A-Za-z0-9_-]{16,}\\.[A-Za-z0-9_-]{16,}\\b"), "[redacted]")
        .replace(Regex("\\bsk-[A-Za-z0-9_-]{8,}\\b"), "[redacted]")
        .replace(Regex("(?i)(?:^|[\\s,{(])(?:[A-Za-z0-9_-]*(?:access[_-]?token|refresh[_-]?token|session[_-]?token|auth[_-]?token|token|api[_-]?key|authorization|bearer|cookie|client[_-]?secret|code[_-]?verifier|pkce[_-]?verifier|verifier)[A-Za-z0-9_-]*)\\s*[:=]\\s*[^\\s,)}\\]]+"), "[redacted]")
        .replace(Regex("(?i)(?:[A-Za-z]:)?(?:[/\\\\][^\\s,;:)}\\]]*)*(?:[/\\\\](?:\\.codex[/\\\\])?auth\\.json)"), "[redacted]")
        .replace(Regex("\\b[A-Za-z0-9_-]{48,}\\b"), "[redacted]")
    return if (redacted.length > 500) redacted.take(500) + "…" else redacted
}
