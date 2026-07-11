package ai.yet.plugin.runtime

import ai.yet.plugin.identity.ProductIdentity
import ai.yet.plugin.logging.YetDiagnosticsBundle
import ai.yet.plugin.logging.YetDiagnosticsSnapshot
import ai.yet.plugin.logging.YetLogSink
import ai.yet.plugin.settings.SessionTokenStore
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
    private val sessionTokenStore: RuntimeSessionTokenStore = PasswordSafeRuntimeSessionTokenStore(),
    private val logSink: YetLogSink = YetLogSink(),
) : Disposable {
    private val logger = Logger.getInstance(RuntimeConnectionManager::class.java)
    private var launchedProcess: Process? = null
    private var launchedConnection: RuntimeSettings? = null
    private var lastHealthResult: String? = null
    private var lastConnectionError: String? = null
    private var lastProcessExit: String? = null
    private var lastRecoveryResult: String? = null
    private var lastLaunchedByPluginDuringHealth = false
    private var lastPreparedRuntimeUrl: String? = null
    private var lastEffectiveRuntimeOwner: EffectiveRuntimeOwner = EffectiveRuntimeOwner.EXTERNAL
    private var lastEffectiveProcessState: RuntimeProcessState = RuntimeProcessState.NOT_OWNED
    private var latestRuntimeConnectionResult: RuntimeConnectionResult? = null

    @Synchronized
    fun prepare(): RuntimeConnectionResult {
        return prepareCurrent(publishUpdates = true)
    }

    @Synchronized
    private fun prepareCurrent(publishUpdates: Boolean): RuntimeConnectionResult {
        logSink.append("info", "runtime.prepare", mapOf("phase" to "start"))
        val settings = try {
            RuntimeSettings.current()
        } catch (error: Exception) {
            lastHealthResult = null
            lastConnectionError = sanitizedRuntimeError("Yet AI runtime settings are invalid", error)
            val result = RuntimeConnectionResult(
                RuntimeSettings.safeFallback(),
                null,
                lastConnectionError,
                runtimeLifecycleStatus(
                    RuntimeSettings.safeFallback(),
                    LaunchMode.CONNECT,
                    RuntimeLifecycle.INVALID_SETTINGS,
                    RuntimeProcessState.NOT_OWNED,
                    "local runtime settings are invalid",
                    "Open settings and use an http loopback runtime URL with a supported launch mode.",
                ),
            )
            logSink.append("error", "runtime.prepare", mapOf("phase" to "failure", "error" to lastConnectionError))
            rememberLatestRuntimeConnectionResult(result)
            if (publishUpdates) publishRuntimeConnectionUpdate(result)
            return result
        }
        val previousConnection = launchedConnection
        val result = prepareResolvedSettings(settings)
        rememberLatestRuntimeConnectionResult(result)
        logSink.append("info", "runtime.prepare", mapOf("phase" to if (result.error == null) "success" else "failure", "launchMode" to settings.launchMode.name.lowercase(), "lifecycle" to result.lifecycleStatus.lifecycle.wireName, "error" to result.error))
        if (publishUpdates && (result.error != null || result.settings != previousConnection)) publishRuntimeConnectionUpdate(result)
        return result
    }

    @Synchronized
    internal fun prepareForTest(settings: RuntimeSettings): RuntimeConnectionResult {
        val result = prepareResolvedSettings(settings)
        rememberLatestRuntimeConnectionResult(result)
        return result
    }

    @Synchronized
    private fun prepareResolvedSettings(settings: RuntimeSettings): RuntimeConnectionResult {
        reconcileExitedLaunchedProcess()
        var connection = try {
            prepareConnectionSettings(settings)
        } catch (error: Exception) {
            val result = failedRuntimeConnection(settings, null, "Yet AI local runtime launch failed", error)
            lastHealthResult = null
            lastConnectionError = result.error
            rememberCurrentRuntime(result.settings, EffectiveRuntimeOwner.EXTERNAL, result.lifecycleStatus.processState)
            logSink.append("error", "runtime.launch", mapOf("phase" to "failure", "launchMode" to settings.launchMode.name.lowercase(), "error" to result.error))
            return result
        }
        val runtimeOwner = effectiveRuntimeOwnerFor(connection)
        return try {
            logSink.append("info", "runtime.health", runtimeCorrelationFields(connection, settings.launchMode, runtimeOwner) + mapOf("phase" to "start"))
            lastLaunchedByPluginDuringHealth = runtimeOwner == EffectiveRuntimeOwner.IDE_HOST
            healthChecker(connection)
            lastHealthResult = "/v1/ping returned 2xx"
            lastConnectionError = null
            val processState = currentProcessState(runtimeOwner)
            rememberCurrentRuntime(connection, runtimeOwner, processState)
            logSink.append("info", "runtime.health", runtimeCorrelationFields(connection, settings.launchMode, runtimeOwner) + mapOf("phase" to "success"))
            lastLaunchedByPluginDuringHealth = false
            RuntimeConnectionResult(
                connection,
                "Connected to Yet AI local runtime at ${connection.runtimeUrl}.",
                null,
                runtimeLifecycleStatus(
                    connection,
                    settings.launchMode,
                    RuntimeLifecycle.CONNECTED,
                    processState,
                    "local runtime is reachable",
                    "Continue using Yet AI.",
                    effectiveRuntimeOwner = runtimeOwner,
                ),
            )
        } catch (error: Exception) {
            reconcileExitedLaunchedProcess()
            logSink.append("warn", "runtime.health", runtimeCorrelationFields(connection, settings.launchMode, runtimeOwner) + mapOf("phase" to "failure", "error" to error.message))
            if (isHttp401(error) && shouldRetryPluginOwnedRuntime(settings, connection)) {
                logger.info("Yet AI plugin-launched runtime returned HTTP 401 during health check; restarting once with a fresh session token")
                lastRecoveryResult = "HTTP 401 recovery started for plugin-owned runtime"
                logSink.append("warn", "runtime.401_retry", runtimeCorrelationFields(connection, settings.launchMode, EffectiveRuntimeOwner.IDE_HOST) + mapOf("phase" to "start"))
                stopLaunchedProcess()
                connection = try {
                    prepareConnectionSettings(settings, refreshSessionToken = true)
                } catch (launchError: Exception) {
                    val recoveryProcessState = "plugin-launched runtime relaunch failed during HTTP 401 recovery; click Refresh runtime or run Yet AI: Restart Runtime to relaunch"
                    val result = failedRuntimeConnection(
                        settings,
                        connection,
                        "Yet AI local runtime relaunch failed during session recovery",
                        launchError,
                        processExit = recoveryProcessState,
                        effectiveRuntimeOwner = EffectiveRuntimeOwner.IDE_HOST,
                        recoveryRelaunchFailure = true,
                    )
                    lastHealthResult = "HTTP 401 from /v1/ping; plugin-owned restart failed"
                    lastConnectionError = result.error
                    lastProcessExit = recoveryProcessState
                    lastRecoveryResult = "HTTP 401 recovery launch failed"
                    rememberCurrentRuntime(result.settings, EffectiveRuntimeOwner.IDE_HOST, result.lifecycleStatus.processState)
                    logSink.append("error", "runtime.401_retry", runtimeCorrelationFields(connection, settings.launchMode, EffectiveRuntimeOwner.IDE_HOST) + mapOf("phase" to "failure", "error" to result.error, "process" to recoveryProcessState))
                    lastLaunchedByPluginDuringHealth = false
                    return result
                }
                return try {
                    logSink.append("info", "runtime.health", runtimeCorrelationFields(connection, settings.launchMode, EffectiveRuntimeOwner.IDE_HOST) + mapOf("phase" to "start", "recovery" to "401_retry"))
                    lastLaunchedByPluginDuringHealth = launchedConnection == connection
                    healthChecker(connection)
                    lastHealthResult = "/v1/ping returned 2xx after HTTP 401 recovery"
                    lastConnectionError = null
                    lastRecoveryResult = "HTTP 401 recovery succeeded"
                    val processState = currentProcessState(EffectiveRuntimeOwner.IDE_HOST)
                    rememberCurrentRuntime(connection, EffectiveRuntimeOwner.IDE_HOST, processState)
                    logSink.append("info", "runtime.401_retry", runtimeCorrelationFields(connection, settings.launchMode, EffectiveRuntimeOwner.IDE_HOST) + mapOf("phase" to "success"))
                    lastLaunchedByPluginDuringHealth = false
                    RuntimeConnectionResult(
                        connection,
                        "Connected to Yet AI local runtime at ${connection.runtimeUrl} after refreshing the runtime session token.",
                        null,
                        runtimeLifecycleStatus(
                            connection,
                            settings.launchMode,
                            RuntimeLifecycle.CONNECTED,
                            processState,
                            "local runtime is reachable after refreshing session credentials",
                            "Continue using Yet AI.",
                            effectiveRuntimeOwner = EffectiveRuntimeOwner.IDE_HOST,
                        ),
                    )
                } catch (retryError: Exception) {
                    reconcileExitedLaunchedProcess()
                    val processStateAfterFailure = lastProcessExit ?: "plugin-launched process stopped after HTTP 401 recovery failure; click Refresh runtime or run Yet AI: Restart Runtime to relaunch"
                    stopLaunchedProcess()
                    val result = failedRuntimeConnection(settings, connection, "Yet AI local runtime connection failed after HTTP 401 recovery", retryError, false, processStateAfterFailure)
                    lastHealthResult = "HTTP 401 recovery attempted once for plugin-owned runtime"
                    lastConnectionError = result.error
                    lastProcessExit = processStateAfterFailure
                    lastRecoveryResult = "HTTP 401 recovery failed"
                    rememberCurrentRuntime(result.settings, EffectiveRuntimeOwner.IDE_HOST, result.lifecycleStatus.processState)
                    logSink.append("error", "runtime.401_retry", runtimeCorrelationFields(connection, settings.launchMode, EffectiveRuntimeOwner.IDE_HOST) + mapOf("phase" to "failure", "error" to result.error, "process" to processStateAfterFailure))
                    lastLaunchedByPluginDuringHealth = false
                    return result
                }
            }
            val result = failedRuntimeConnection(settings, connection, "Yet AI local runtime connection failed", error, lastLaunchedByPluginDuringHealth, currentProcessExit(runtimeOwner), runtimeOwner)
            lastHealthResult = if (isHttp401(error)) "HTTP 401 from /v1/ping" else null
            lastConnectionError = result.error
            rememberCurrentRuntime(result.settings, runtimeOwner, result.lifecycleStatus.processState)
            lastLaunchedByPluginDuringHealth = false
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
        logSink.append("info", "runtime.restart", mapOf("phase" to "requested"))
        stopLaunchedProcess()
        val result = prepareCurrent(publishUpdates = false)
        logSink.append("info", "runtime.restart", mapOf("phase" to if (result.error == null) "success" else "failure", "lifecycle" to result.lifecycleStatus.lifecycle.wireName, "error" to result.error))
        publishRuntimeConnectionUpdate(result)
        return result
    }

    fun runtimeDiagnostics(): String {
        reconcileExitedLaunchedProcess()
        val state = YetSettingsState.getInstance().state
        val rawRuntimeUrl = state.runtimeUrl
        val rawLaunchMode = state.launchMode
        val rawEngineBinaryPath = state.engineBinaryPath
        val settings = try {
            RuntimeSettings.current()
        } catch (error: Exception) {
            val diagnostics = RuntimeDiagnostics(
                launchMode = sanitizedLaunchModeForDiagnostics(rawLaunchMode),
                runtimeUrl = sanitizeRuntimeUrlForDiagnostics(rawRuntimeUrl),
                engineBinaryConfigured = rawEngineBinaryPath.isNotBlank(),
                binaryStatus = "settings invalid: ${redactLogText(error.message ?: error::class.java.simpleName, "")}",
                launchedByPlugin = false,
                health = null,
                error = sanitizedRuntimeError("Yet AI runtime settings are invalid", error),
                process = null,
            )
            return diagnosticsBundle().build(diagnosticsSnapshot(diagnostics))
        }
        val diagnostics = runtimeDiagnosticsFor(settings)
        return diagnosticsBundle().build(diagnosticsSnapshot(diagnostics))
    }

    @Synchronized
    internal fun runtimeDiagnosticsForTest(settings: RuntimeSettings): String {
        reconcileExitedLaunchedProcess()
        val diagnostics = runtimeDiagnosticsFor(settings)
        return diagnosticsBundle().build(diagnosticsSnapshot(diagnostics))
    }

    @Synchronized
    fun prepareConnectionSettings(settings: RuntimeSettings, refreshSessionToken: Boolean = false): RuntimeSettings {
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
            launchOrReuse(settings, requireNotNull(binaryPath), refreshSessionToken)
        } else {
            settings
        }
    }

    @Synchronized
    private fun launchOrReuse(settings: RuntimeSettings, binaryPath: Path, refreshSessionToken: Boolean): RuntimeSettings {
        reconcileExitedLaunchedProcess()
        val existing = launchedProcess
        val existingConnection = launchedConnection
        if (!refreshSessionToken && existing != null && existing.isAlive && existingConnection?.runtimeUrl == settings.runtimeUrl) {
            logSink.append("info", "runtime.connection.reuse", runtimeCorrelationFields(existingConnection, settings.launchMode))
            return existingConnection
        }
        logSink.append("info", "runtime.connection.relaunch", runtimeCorrelationFields(settings, settings.launchMode) + mapOf("refreshSessionToken" to refreshSessionToken))
        stopLaunchedProcess()
        val token = tokenGenerator()
        logSink.append("info", "runtime.token.generated", runtimeCorrelationFields(settings.copyWithSessionToken(token), settings.launchMode))
        val command = buildEngineLaunchCommand(settings.runtimeUrl, binaryPath, token, logDirectory = logSink.logDirectory())
        logSink.append("info", "runtime.launch", mapOf("phase" to "start", "launchMode" to settings.launchMode.name.lowercase(), "runtime" to sanitizeRuntimeUrlForDiagnostics(settings.runtimeUrl), "binary" to binaryPath.fileName.toString(), "refreshSessionToken" to refreshSessionToken))
        val process = try {
            processStarter(command)
        } catch (error: Exception) {
            logSink.append("error", "runtime.launch", mapOf("phase" to "failure", "error" to sanitizedRuntimeError("Yet AI local runtime process start failed", error, token)))
            throw IllegalStateException(sanitizedRuntimeError("Yet AI local runtime process start failed", error, token))
        }
        val connection = settings.copyWithSessionToken(token)
        try {
            sessionTokenStore.set(token)
            logSink.append("info", "runtime.token.persisted", runtimeCorrelationFields(connection, settings.launchMode, EffectiveRuntimeOwner.IDE_HOST) + mapOf("result" to "success"))
        } catch (error: Exception) {
            stopProcess(process)
            logSink.append("error", "runtime.token.persisted", runtimeCorrelationFields(connection, settings.launchMode, EffectiveRuntimeOwner.IDE_HOST) + mapOf("result" to "failure", "error" to sanitizedRuntimeError("Yet AI local runtime session token store update failed", error, token)))
            logSink.append("error", "runtime.launch", mapOf("phase" to "failure", "error" to sanitizedRuntimeError("Yet AI local runtime session token store update failed", error, token)))
            throw IllegalStateException(sanitizedRuntimeError("Yet AI local runtime session token store update failed", error, token))
        }
        launchedProcess = process
        launchedConnection = connection
        attachLogs(process, token)
        logger.info("Started Yet AI local runtime")
        logSink.append("info", "runtime.launch", mapOf("phase" to "success", "runtime" to sanitizeRuntimeUrlForDiagnostics(connection.runtimeUrl)))
        thread(name = "Yet AI runtime watcher", isDaemon = true) {
            val code = process.waitFor()
            logger.info("Yet AI local runtime exited with code $code")
            synchronized(this@RuntimeConnectionManager) {
                if (launchedProcess == process) {
                    lastProcessExit = pluginLaunchedProcessExitMessage(code)
                    logSink.append("warn", "runtime.exit", mapOf("code" to code, "process" to lastProcessExit))
                    launchedProcess = null
                    launchedConnection = null
                    lastEffectiveProcessState = RuntimeProcessState.EXITED
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
        logSink.append("warn", "runtime.exit", mapOf("code" to code, "process" to lastProcessExit))
        launchedProcess = null
        launchedConnection = null
        lastHealthResult = null
        lastEffectiveProcessState = RuntimeProcessState.EXITED
    }

    private fun attachLogs(process: Process, token: String) {
        listOf(process.inputStream, process.errorStream).forEach { stream ->
            thread(name = "Yet AI runtime log", isDaemon = true) {
                BufferedReader(InputStreamReader(stream)).useLines { lines ->
                    lines.forEach { line ->
                        if (line.isNotBlank()) {
                            logger.info("Yet AI runtime: ${redactLogText(line, token)}")
                            logSink.append("info", "runtime.output", mapOf("line" to redactLogText(line, token)))
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
        lastPreparedRuntimeUrl = null
        lastEffectiveRuntimeOwner = EffectiveRuntimeOwner.EXTERNAL
        lastEffectiveProcessState = RuntimeProcessState.NOT_OWNED
        stopProcess(process)
    }

    private fun diagnosticsBundle(): YetDiagnosticsBundle = YetDiagnosticsBundle(logSink)

    private fun diagnosticsSnapshot(diagnostics: RuntimeDiagnostics): YetDiagnosticsSnapshot = YetDiagnosticsSnapshot(
        launchMode = diagnostics.launchMode,
        runtimeUrl = diagnostics.runtimeUrl,
        engineBinaryConfigured = diagnostics.engineBinaryConfigured,
        binaryStatus = diagnostics.binaryStatus,
        launchedByPlugin = diagnostics.launchedByPlugin,
        lifecycleStatus = diagnosticsLifecycleStatus(diagnostics),
        lastHealth = diagnostics.health,
        lastError = diagnostics.error,
        lastProcess = diagnostics.process,
        lastRecovery = lastRecoveryResult,
        engineLogPath = engineLogPathForDiagnostics(diagnostics),
    )

    private fun diagnosticsLifecycleStatus(diagnostics: RuntimeDiagnostics): RuntimeLifecycleStatus {
        val status = runtimeLifecycleStatusFromDiagnostics(diagnostics)
        val latestStatus = latestRuntimeConnectionResult?.takeIf { latestRuntimeConnectionMatchesDiagnostics(it, diagnostics) }?.lifecycleStatus ?: return status
        return status.copy(tokenState = latestStatus.tokenState)
    }

    private fun latestRuntimeConnectionMatchesDiagnostics(result: RuntimeConnectionResult, diagnostics: RuntimeDiagnostics): Boolean {
        return sanitizeRuntimeUrlForDiagnostics(result.settings.runtimeUrl) == diagnostics.runtimeUrl &&
            result.lifecycleStatus.launchMode == diagnostics.launchMode &&
            result.lifecycleStatus.runtimeOwner == runtimeLifecycleStatusFromDiagnostics(diagnostics).runtimeOwner
    }

    private fun engineLogPathForDiagnostics(diagnostics: RuntimeDiagnostics): Path? {
        if (!diagnostics.pluginManagedRuntime) return null
        return runCatching {
            expectedEngineLogPath(logSink.logDirectory(), parseExplicitRuntimePort(diagnostics.runtimeUrl))
        }.getOrNull()
    }

    private fun runtimeDiagnosticsFor(settings: RuntimeSettings): RuntimeDiagnostics {
        val owner = effectiveDiagnosticsOwnerFor(settings)
        return RuntimeDiagnostics(
            launchMode = settings.launchMode.name.lowercase(),
            runtimeUrl = sanitizeRuntimeUrlForDiagnostics(settings.runtimeUrl),
            engineBinaryConfigured = settings.engineBinaryPath != null,
            binaryStatus = if (owner == EffectiveRuntimeOwner.IDE_HOST && lastConnectionError != null) "plugin-managed runtime process was launched" else describeEngineBinaryStatus(settings),
            launchedByPlugin = owner == EffectiveRuntimeOwner.IDE_HOST && currentDiagnosticsProcessState(owner) == RuntimeProcessState.RUNNING,
            health = lastHealthResult,
            error = lastConnectionError,
            process = currentProcessExit(owner),
        )
    }

    @Synchronized
    private fun effectiveRuntimeOwnerFor(connection: RuntimeSettings): EffectiveRuntimeOwner {
        val process = launchedProcess
        return if (process?.isAlive == true && launchedConnection == connection) EffectiveRuntimeOwner.IDE_HOST else EffectiveRuntimeOwner.EXTERNAL
    }

    private fun effectiveDiagnosticsOwnerFor(settings: RuntimeSettings): EffectiveRuntimeOwner {
        if (settings.launchMode == LaunchMode.CONNECT) return EffectiveRuntimeOwner.EXTERNAL
        val sanitizedRuntimeUrl = sanitizeRuntimeUrlForDiagnostics(settings.runtimeUrl)
        if (lastPreparedRuntimeUrl != sanitizedRuntimeUrl) return EffectiveRuntimeOwner.EXTERNAL
        if (lastEffectiveRuntimeOwner != EffectiveRuntimeOwner.IDE_HOST) return EffectiveRuntimeOwner.EXTERNAL
        val process = launchedProcess
        val liveCurrentPluginProcess = process?.isAlive == true && launchedConnection?.runtimeUrl == settings.runtimeUrl
        val terminalCurrentPluginProcess = lastEffectiveProcessState == RuntimeProcessState.EXITED ||
            lastEffectiveProcessState == RuntimeProcessState.STOPPED ||
            lastEffectiveProcessState == RuntimeProcessState.FAILED
        return if (liveCurrentPluginProcess || terminalCurrentPluginProcess) EffectiveRuntimeOwner.IDE_HOST else EffectiveRuntimeOwner.EXTERNAL
    }

    private fun rememberCurrentRuntime(connection: RuntimeSettings, owner: EffectiveRuntimeOwner, processState: RuntimeProcessState) {
        lastPreparedRuntimeUrl = sanitizeRuntimeUrlForDiagnostics(connection.runtimeUrl)
        lastEffectiveRuntimeOwner = owner
        lastEffectiveProcessState = processState
    }

    private fun rememberLatestRuntimeConnectionResult(result: RuntimeConnectionResult) {
        latestRuntimeConnectionResult = result
    }

    @Synchronized
    private fun currentProcessState(owner: EffectiveRuntimeOwner): RuntimeProcessState = when {
        owner != EffectiveRuntimeOwner.IDE_HOST -> RuntimeProcessState.NOT_OWNED
        launchedProcess?.isAlive == true -> RuntimeProcessState.RUNNING
        lastProcessExit != null -> RuntimeProcessState.EXITED
        else -> RuntimeProcessState.NOT_OWNED
    }

    private fun currentDiagnosticsProcessState(owner: EffectiveRuntimeOwner): RuntimeProcessState = when {
        owner != EffectiveRuntimeOwner.IDE_HOST -> RuntimeProcessState.NOT_OWNED
        launchedProcess?.isAlive == true -> RuntimeProcessState.RUNNING
        lastProcessExit != null -> RuntimeProcessState.EXITED
        else -> lastEffectiveProcessState
    }

    private fun currentProcessExit(owner: EffectiveRuntimeOwner): String? = if (owner == EffectiveRuntimeOwner.IDE_HOST) lastProcessExit else null

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

internal fun runtimeCorrelationFields(
    settings: RuntimeSettings,
    launchMode: LaunchMode = settings.launchMode,
    effectiveRuntimeOwner: EffectiveRuntimeOwner = effectiveRuntimeOwnerFromLaunchMode(launchMode),
): Map<String, Any?> = mapOf(
    "runtime" to sanitizeRuntimeUrlForDiagnostics(settings.runtimeUrl),
    "runtimeOwner" to effectiveRuntimeOwner.logOwner,
    "launchMode" to launchMode.name.lowercase(),
    "tokenState" to if (settings.sessionToken == null) "absent" else "present",
)

internal fun runtimeOwnerForLogs(launchMode: LaunchMode): String = effectiveRuntimeOwnerFromLaunchMode(launchMode).logOwner

internal fun effectiveRuntimeOwnerFromLaunchMode(launchMode: LaunchMode): EffectiveRuntimeOwner = if (launchMode == LaunchMode.CONNECT) EffectiveRuntimeOwner.EXTERNAL else EffectiveRuntimeOwner.IDE_HOST

internal fun effectiveRuntimeOwnerFromLifecycleOwner(runtimeOwner: String): EffectiveRuntimeOwner = if (runtimeOwner == EffectiveRuntimeOwner.IDE_HOST.lifecycleOwner) EffectiveRuntimeOwner.IDE_HOST else EffectiveRuntimeOwner.EXTERNAL

private fun pluginLaunchedProcessExitMessage(code: Int?): String {
    val codeText = code?.toString() ?: "unknown"
    return "plugin-launched process exited with code $codeText; click Refresh runtime or run Yet AI: Restart Runtime to relaunch"
}

interface RuntimeSessionTokenStore {
    fun set(value: String)
}

private class PasswordSafeRuntimeSessionTokenStore : RuntimeSessionTokenStore {
    override fun set(value: String) {
        val application = ApplicationManager.getApplication() ?: return
        application.getService(SessionTokenStore::class.java).set(value)
    }
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
    launchedByPluginDuringHealth: Boolean = false,
    processExit: String? = null,
    effectiveRuntimeOwner: EffectiveRuntimeOwner = if (attemptedSettings != null) EffectiveRuntimeOwner.IDE_HOST else EffectiveRuntimeOwner.EXTERNAL,
    recoveryRelaunchFailure: Boolean = false,
): RuntimeConnectionResult {
    val token = attemptedSettings?.sessionToken ?: settings.sessionToken
    val sanitized = sanitizedRuntimeError(prefix, error, token)
    val guidance = if (isHttp401(error) && !recoveryRelaunchFailure) {
        " Stale external yet-lsp, loopback port reuse, or debug/session token mismatch can cause HTTP 401. Stop the existing process, change the Runtime URL port, or use connect mode with a matching local runtime token."
    } else {
        ""
    }
    val resultSettings = attemptedSettings ?: settings
    val processGuidance = if (attemptedSettings != null && processExit == null && launchedByPluginDuringHealth && !isHttp401(error)) {
        " Plugin-launched runtime process is running but did not answer authenticated /v1/ping. Click Refresh runtime, then run Yet AI: Restart Runtime; if it repeats, check the loopback port and bundled binary diagnostics."
    } else {
        ""
    }
    val recoveryGuidance = if (recoveryRelaunchFailure) {
        " Plugin-owned runtime relaunch failed during HTTP 401 recovery. Click Refresh runtime or run Yet AI: Restart Runtime; if it repeats, check the engine binary path and engine logs."
    } else {
        ""
    }
    val errorText = sanitized + processGuidance + recoveryGuidance + guidance
    val diagnostics = RuntimeDiagnostics(
        launchMode = settings.launchMode.name.lowercase(),
        runtimeUrl = sanitizeRuntimeUrlForDiagnostics(resultSettings.runtimeUrl),
        engineBinaryConfigured = settings.engineBinaryPath != null,
        binaryStatus = if (effectiveRuntimeOwner == EffectiveRuntimeOwner.IDE_HOST) "plugin-managed runtime process was launched" else describeEngineBinaryStatus(settings),
        launchedByPlugin = effectiveRuntimeOwner == EffectiveRuntimeOwner.IDE_HOST && attemptedSettings != null && processExit == null && (launchedByPluginDuringHealth || error !is RuntimeHealthCheckException),
        health = if (isHttp401(error)) "HTTP 401 from /v1/ping" else null,
        error = errorText,
        process = processExit,
    )
    val preciseStatus = runtimeLifecycleStatusFromDiagnostics(diagnostics)
    return RuntimeConnectionResult(
        resultSettings,
        null,
        errorText,
        preciseStatus,
    )
}

data class RuntimeConnectionResult(
    val settings: RuntimeSettings,
    val status: String?,
    val error: String?,
    val lifecycleStatus: RuntimeLifecycleStatus = runtimeLifecycleStatus(settings, settings.launchMode, if (error == null) RuntimeLifecycle.CONNECTED else RuntimeLifecycle.FAILED, RuntimeProcessState.UNKNOWN, status ?: error ?: "runtime status is unknown", "Open Yet AI runtime status for details."),
)

enum class RuntimeLifecycle(val wireName: String) {
    CONNECTED("connected"),
    AUTH_MISMATCH("auth_mismatch"),
    INVALID_SETTINGS("invalid_settings"),
    FAILED("failed"),
    RESTARTING("restarting"),
    STOPPED("stopped"),
}

enum class RuntimeProcessState(val wireName: String) {
    UNKNOWN("unknown"),
    NOT_OWNED("not_owned"),
    RUNNING("running"),
    EXITED("exited"),
    STOPPED("stopped"),
    FAILED("failed"),
}

enum class EffectiveRuntimeOwner(val lifecycleOwner: String, val logOwner: String) {
    IDE_HOST("ide_host", "plugin-managed"),
    EXTERNAL("external", "external/connect"),
}

data class RuntimeLifecycleStatus(
    val lifecycle: RuntimeLifecycle,
    val runtimeOwner: String,
    val launchMode: String,
    val tokenState: String,
    val processState: RuntimeProcessState,
    val diagnosis: String,
    val nextAction: String,
)

fun runtimeLifecycleStatus(
    settings: RuntimeSettings,
    launchMode: LaunchMode,
    lifecycle: RuntimeLifecycle,
    processState: RuntimeProcessState,
    diagnosis: String,
    nextAction: String,
    effectiveRuntimeOwner: EffectiveRuntimeOwner = effectiveRuntimeOwnerFromLaunchMode(launchMode),
): RuntimeLifecycleStatus = RuntimeLifecycleStatus(
    lifecycle = lifecycle,
    runtimeOwner = effectiveRuntimeOwner.lifecycleOwner,
    launchMode = launchMode.name.lowercase(),
    tokenState = tokenState(settings, lifecycle),
    processState = processState,
    diagnosis = safeLifecycleText(diagnosis),
    nextAction = safeLifecycleText(nextAction),
)

fun runtimeLifecycleStatusFromDiagnostics(diagnostics: RuntimeDiagnostics): RuntimeLifecycleStatus {
    val invalidLaunchMode = parseLaunchModeOrNull(diagnostics.launchMode) == null
    val launchMode = parseLaunchModeForDiagnostics(diagnostics.launchMode)
    val diagnosis = runtimeDiagnosis(diagnostics)
    val lifecycle = when {
        invalidLaunchMode -> RuntimeLifecycle.INVALID_SETTINGS
        diagnostics.process?.contains("exited", ignoreCase = true) == true -> RuntimeLifecycle.STOPPED
        diagnostics.process?.contains("stopped", ignoreCase = true) == true -> RuntimeLifecycle.STOPPED
        diagnosis.contains("token mismatch") -> RuntimeLifecycle.AUTH_MISMATCH
        diagnostics.health?.contains("2xx") == true -> RuntimeLifecycle.CONNECTED
        diagnosis.contains("launch URL") || diagnosis.contains("engine binary") || diagnosis.contains("no launchable") -> RuntimeLifecycle.INVALID_SETTINGS
        diagnostics.error != null -> RuntimeLifecycle.FAILED
        diagnosis.contains("waiting for a plugin-launched runtime process") -> RuntimeLifecycle.FAILED
        else -> RuntimeLifecycle.FAILED
    }
    val processState = when {
        diagnostics.process?.contains("exited", ignoreCase = true) == true -> RuntimeProcessState.EXITED
        diagnostics.process?.contains("stopped", ignoreCase = true) == true -> RuntimeProcessState.STOPPED
        diagnostics.launchedByPlugin -> RuntimeProcessState.RUNNING
        diagnostics.error != null -> RuntimeProcessState.FAILED
        diagnosis.contains("waiting for a plugin-launched runtime process") -> RuntimeProcessState.RUNNING
        else -> RuntimeProcessState.NOT_OWNED
    }
    val settings = RuntimeSettings(diagnostics.runtimeUrl, null, null, launchMode = launchMode)
    return runtimeLifecycleStatus(
        settings,
        launchMode,
        lifecycle,
        processState,
        diagnosis,
        runtimeNextAction(diagnostics, diagnosis),
        effectiveRuntimeOwner = if (diagnostics.pluginManagedRuntime) EffectiveRuntimeOwner.IDE_HOST else EffectiveRuntimeOwner.EXTERNAL,
    )
}

private fun parseLaunchModeForDiagnostics(value: String): LaunchMode = parseLaunchModeOrNull(value) ?: LaunchMode.AUTO

private fun parseLaunchModeOrNull(value: String): LaunchMode? = runCatching { parseLaunchMode(value) }.getOrNull()

private fun sanitizedLaunchModeForDiagnostics(value: String): String = redactLogText(value.trim().ifBlank { "not configured" }, "")

private fun tokenState(settings: RuntimeSettings, lifecycle: RuntimeLifecycle): String = when (lifecycle) {
    RuntimeLifecycle.AUTH_MISMATCH -> "mismatch"
    RuntimeLifecycle.INVALID_SETTINGS -> "unknown"
    else -> if (settings.sessionToken == null) "absent" else "present"
}

private fun lifecycleDiagnosis(lifecycle: RuntimeLifecycle): String = when (lifecycle) {
    RuntimeLifecycle.CONNECTED -> "local runtime is reachable"
    RuntimeLifecycle.AUTH_MISMATCH -> "runtime rejected the current local credentials"
    RuntimeLifecycle.INVALID_SETTINGS -> "local runtime settings are invalid"
    RuntimeLifecycle.RESTARTING -> "runtime restart is in progress"
    RuntimeLifecycle.STOPPED -> "plugin managed runtime is stopped"
    RuntimeLifecycle.FAILED -> "runtime did not become reachable"
}

private fun lifecycleNextAction(lifecycle: RuntimeLifecycle): String = when (lifecycle) {
    RuntimeLifecycle.CONNECTED -> "Continue using Yet AI."
    RuntimeLifecycle.AUTH_MISMATCH -> "Update the local runtime connection or restart the IDE-owned runtime."
    RuntimeLifecycle.INVALID_SETTINGS -> "Open settings and use an http loopback runtime URL with a supported launch mode."
    RuntimeLifecycle.RESTARTING -> "Wait for the restart to finish."
    RuntimeLifecycle.STOPPED -> "Refresh runtime or run Yet AI Restart Runtime."
    RuntimeLifecycle.FAILED -> "Refresh runtime or open Yet AI runtime status."
}

private fun safeLifecycleText(value: String): String = redactLogText(value, "")
    .replace(Regex("(?i)authorization"), "credentials")
    .replace(Regex("(?i)bearer"), "credentials")
    .replace(Regex("(?i)secret"), "credentials")
    .replace(Regex("(?i)private[_-]?path"), "local path")
    .replace(Regex("(?i)private\\s+path"), "local path")
    .take(1000)

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
) {
    val pluginManagedRuntime: Boolean
        get() = launchedByPlugin || process?.contains("plugin-launched", ignoreCase = true) == true
}

fun formatRuntimeDiagnostics(diagnostics: RuntimeDiagnostics): String {
    val mode = sanitizedLaunchModeForDiagnostics(diagnostics.launchMode).lowercase()
    val invalidLaunchMode = parseLaunchModeOrNull(diagnostics.launchMode) == null
    val guidance = if (invalidLaunchMode) {
        "Configured launch mode is invalid. Supported values are auto, connect, or launch."
    } else {
        when (mode) {
            "connect" -> "Connect mode expects an already running loopback Yet AI runtime. Verify the URL, port, and debug token match the runtime process."
            "launch" -> "Launch mode uses the bundled runtime when Engine binary path is empty, or an executable absolute ${ProductIdentity.engineBinaryName} path when configured, plus an http runtime URL with an explicit nonzero port."
            else -> "Auto mode prefers the bundled runtime for installable/dev-preview artifacts, uses a configured absolute ${ProductIdentity.engineBinaryName} path when set, and treats PATH discovery as a dev-preview fallback only; otherwise it connects to the configured loopback URL."
        }
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
    if (parseLaunchModeOrNull(diagnostics.launchMode) == null) {
        return "local runtime settings are invalid: unsupported launch mode; supported values are auto, connect, or launch"
    }
    val combined = listOfNotNull(diagnostics.binaryStatus, diagnostics.health, diagnostics.process, diagnostics.error).joinToString("\n").lowercase()
    val url = diagnostics.runtimeUrl.lowercase()
    return when {
        diagnostics.launchMode.lowercase() == "connect" && diagnostics.error == null && diagnostics.health == null ->
            "connect mode is waiting for an externally managed local runtime"
        diagnostics.process?.contains("stopped", ignoreCase = true) == true ->
            "plugin-launched runtime process stopped after recovery failure"
        diagnostics.process?.contains("exited", ignoreCase = true) == true ->
            "plugin-launched runtime process exited unexpectedly"
        diagnostics.pluginManagedRuntime && (combined.contains("relaunch failed during session recovery") || combined.contains("plugin-owned runtime relaunch failed during http 401 recovery")) ->
            "plugin-owned runtime relaunch failed during HTTP 401 recovery"
        combined.contains("http 401") ->
            "local runtime rejected the session token (HTTP 401 token mismatch)"
        diagnostics.binaryStatus.contains("not executable", ignoreCase = true) ->
            "configured engine binary is missing or not executable"
        diagnostics.binaryStatus.contains("no configured path", ignoreCase = true) || diagnostics.binaryStatus.contains("no configured or discovered binary", ignoreCase = true) || diagnostics.binaryStatus.contains("no bundled, configured, or PATH binary", ignoreCase = true) ->
            "no launchable bundled, configured, or PATH engine binary was found"
        url.startsWith("https://") || combined.contains("requires runtime url to use http") || combined.contains("explicit nonzero port") || Regex("^http://[^:]+$").containsMatchIn(url) ->
            "launch URL is invalid for plugin-managed runtime launch"
        combined.contains("address already in use") || combined.contains("address in use") || combined.contains("port already in use") || combined.contains("eaddrinuse") ->
            "loopback port is already in use by another process"
        diagnostics.launchedByPlugin && (combined.contains("/v1/ping") || combined.contains("health check failed") || combined.contains("failed to connect") || combined.contains("connection refused") || combined.contains("timed out") || combined.contains("no response")) ->
            "plugin-launched runtime process is running but did not answer authenticated /v1/ping"
        combined.contains("/v1/ping") || combined.contains("health check failed") || combined.contains("failed to connect") || combined.contains("connection refused") ->
            "runtime process did not answer authenticated /v1/ping"
        diagnostics.error != null ->
            "runtime failure detected; details are sanitized above"
        else -> "no runtime failure recorded"
    }
}

private fun runtimeNextAction(diagnostics: RuntimeDiagnostics, diagnosis: String): String = when {
    parseLaunchModeOrNull(diagnostics.launchMode) == null ->
        "Open settings and choose a supported Launch mode: auto, connect, or launch."
    diagnosis.contains("token mismatch") && diagnostics.pluginManagedRuntime ->
        "Click Refresh runtime, then use Yet AI: Restart Runtime or change the Runtime URL port. In connect mode, make the IDE debug/session token match the external runtime; this is not a provider API key."
    diagnosis.contains("token mismatch") && diagnostics.launchMode.lowercase() == "connect" ->
        "Start or update the external loopback runtime, make the IDE debug/session token match the external runtime, then click Refresh runtime or Show Runtime Status; this is not a provider API key."
    diagnosis.contains("token mismatch") ->
        "Start or update the external runtime, verify the URL/port/debug session token match, then click Refresh runtime or Show Runtime Status; this is not a provider API key."
    diagnosis.contains("engine binary") ->
        "Keep Launch mode auto/launch and leave Engine binary path empty when the bundled runtime is available; otherwise reinstall the matching artifact or configure an absolute executable ${ProductIdentity.engineBinaryName} path. PATH discovery is dev-preview-only fallback, not the installable expectation."
    diagnosis.contains("launch URL") ->
        "Set Runtime URL to an http loopback URL with an explicit nonzero port, for example http://127.0.0.1:8001; https is not supported for plugin launch mode."
    diagnosis.contains("port") ->
        "Use Yet AI: Restart Runtime, stop the other local process, or change the loopback Runtime URL port."
    diagnosis.contains("relaunch failed") ->
        "Click Refresh runtime or run Yet AI: Restart Runtime. If it still fails, check the engine binary path and engine logs in Yet AI: Show Runtime Status."
    diagnosis.contains("/v1/ping") || diagnosis.contains("exited") ->
        "Click Refresh runtime, then run Yet AI: Restart Runtime. If it still fails, open Yet AI: Show Runtime Status and check the loopback port and bundled binary diagnostics."
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
            path == null && bundled -> "bundled plugin runtime binary available (preferred installable path)"
            path == null -> "no configured path and no bundled plugin binary available"
            isLaunchableEngineFile(path) -> "configured absolute binary is executable"
            else -> "configured absolute binary is missing or not executable"
        }
    }
    LaunchMode.AUTO -> {
        val path = settings.engineBinaryPath
        val bundled = (bundledAvailability ?: BundledEngineResources.describeAvailability()) == "available"
        when {
            path != null && isLaunchableEngineFile(path) -> "configured absolute binary is executable"
            path != null -> "configured absolute binary is missing or not executable"
            bundled -> "bundled plugin runtime binary available (preferred installable path)"
            findEngineBinary(null) != null -> "discovered ${ProductIdentity.engineBinaryName} on PATH (dev-preview fallback only)"
            else -> "no bundled, configured, or PATH binary; connect-only fallback"
        }
    }
}

fun buildEngineLaunchCommand(
    runtimeUrl: String,
    binaryPath: Path,
    sessionToken: String,
    baseEnvironment: Map<String, String> = System.getenv(),
    logDirectory: Path? = null,
): EngineLaunchCommand {
    val env = sanitizedEngineLaunchEnvironment(baseEnvironment).toMutableMap()
    val port = parseExplicitRuntimePort(runtimeUrl)
    env["YET_AI_AUTH_TOKEN"] = sessionToken
    env["YET_AI_HTTP_PORT"] = port.toString()
    logDirectory?.let { env["YET_AI_LOG_DIR"] = it.toString() }
    env.putIfAbsent("YET_AI_LOG_LEVEL", "info")
    return EngineLaunchCommand(binaryPath, env)
}

fun expectedEngineLogPath(logDirectory: Path, runtimePort: Int): Path = logDirectory.resolve("engine-" + runtimePort + ".log")

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
    "DBUS_SESSION_BUS_ADDRESS",
    "XDG_RUNTIME_DIR",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "YET_AI_LOG_LEVEL",
)

private val safeSecretNamedEngineLaunchEnvironmentNames = setOf(
    "DBUS_SESSION_BUS_ADDRESS",
    "XDG_RUNTIME_DIR",
)

private val safeEngineLaunchEnvironmentNamesCanonical = safeEngineLaunchEnvironmentNames.map { it.uppercase() }.toSet()

private val safeEngineLaunchLocaleNames = setOf(
    "LC_ALL",
    "LC_CTYPE",
    "LC_COLLATE",
    "LC_MESSAGES",
    "LC_MONETARY",
    "LC_NUMERIC",
    "LC_TIME",
    "LC_ADDRESS",
    "LC_IDENTIFICATION",
    "LC_MEASUREMENT",
    "LC_NAME",
    "LC_PAPER",
    "LC_TELEPHONE",
)

private val unsafeEngineLaunchEnvironmentName = Regex(
    "(?i)(^|[_-])(?:access[_-]?token|refresh[_-]?token|session[_-]?token|auth[_-]?token|token|api[_-]?key|authorization|bearer|cookie|client[_-]?secret|secret|provider)(?:$|[_-])",
)

fun sanitizedEngineLaunchEnvironment(baseEnvironment: Map<String, String>): Map<String, String> =
    baseEnvironment.filterKeys { name ->
        val canonical = name.uppercase()
        if (unsafeEngineLaunchEnvironmentName.containsMatchIn(name) && canonical !in safeSecretNamedEngineLaunchEnvironmentNames) {
            false
        } else {
            canonical in safeEngineLaunchEnvironmentNamesCanonical || canonical in safeEngineLaunchLocaleNames
        }
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
        .replace(Regex("(?i)(?:^|[\\s,{(])(?!tokenState\\s*[:=]\\s*(?:present|absent|unknown|mismatch|invalid|not_required)\\b)(?:[A-Za-z0-9_-]*(?:access[_-]?token|refresh[_-]?token|session[_-]?token|auth[_-]?token|token|api[_-]?key|authorization|bearer|cookie|client[_-]?secret|code[_-]?verifier|pkce[_-]?verifier|verifier)[A-Za-z0-9_-]*)\\s*[:=]\\s*[^\\s,)}\\]]+"), "[redacted]")
        .replace(Regex("(?i)(^|[\\s\"'`=:(,{])(?:\\.?\\.?[/\\\\])?(?:(?:[^/\\\\\\r\\n,;)}\\]\\s]+|[^/\\\\\\r\\n,;)}\\]]+ [^/\\\\\\r\\n,;)}\\]]*)[/\\\\])*(?:\\.codex[/\\\\])?(?:auth|credential|credentials)\\.json(?=$|[\\s\"'`,;:)}\\]])")) { match ->
            match.groupValues[1] + "[redacted]"
        }
        .replace(Regex("(?i)(?:[A-Za-z]:)?(?:[/\\\\][^\\r\\n,;)}\\]]*)*(?:[/\\\\](?:\\.codex[/\\\\])?(?:auth|credential|credentials)\\.json)"), "[redacted]")
        .replace(Regex("(?:[A-Za-z]:\\\\[^\\r\\n,;)}\\]\\s]+(?:\\\\[^\\r\\n,;)}\\]\\s]+)+|/(?:Users|home|var/folders|tmp|private|Volumes)/[^\\r\\n,;)}\\]\\s]+(?:/[^\\r\\n,;)}\\]\\s]+)*)"), "[redacted path]")
        .replace(Regex("\\b[A-Za-z0-9_-]{48,}\\b"), "[redacted]")
    return if (redacted.length > 500) redacted.take(500) + "…" else redacted
}
