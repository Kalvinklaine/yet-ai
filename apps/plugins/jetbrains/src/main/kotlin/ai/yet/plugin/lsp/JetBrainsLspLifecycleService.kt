package ai.yet.plugin.lsp

import ai.yet.plugin.identity.ProductIdentity
import ai.yet.plugin.runtime.BundledEngineResources
import ai.yet.plugin.runtime.findEngineBinary
import ai.yet.plugin.runtime.stopProcess
import ai.yet.plugin.settings.YetSettingsState
import com.intellij.openapi.Disposable
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.diagnostic.Logger
import java.io.BufferedReader
import java.io.InputStreamReader
import java.nio.file.Path
import kotlin.concurrent.thread

fun interface JetBrainsLspProcessFactory {
    fun start(command: List<String>, environment: Map<String, String>): Process
}

@Service(Service.Level.PROJECT)
class JetBrainsLspLifecycleService(
    private val processFactory: JetBrainsLspProcessFactory = JetBrainsLspProcessFactory { command, environment ->
        ProcessBuilder(command)
            .redirectInput(ProcessBuilder.Redirect.PIPE)
            .redirectOutput(ProcessBuilder.Redirect.PIPE)
            .redirectError(ProcessBuilder.Redirect.PIPE)
            .apply {
                this.environment().clear()
                this.environment().putAll(environment)
            }
            .start()
    },
    private val binaryResolver: () -> Path? = { BundledEngineResources.resolveOrExtract() ?: findEngineBinary(YetSettingsState.getInstance().state.engineBinaryPath.takeIf { it.isNotBlank() }?.let(Path::of)) },
    private val settingsProvider: () -> Boolean = { YetSettingsState.getInstance().state.lspEnabled },
    private val environmentProvider: () -> Map<String, String> = { filterJetBrainsLspEnvironment(System.getenv()) },
    private val diagnosticsSink: (String) -> Unit = { message -> Logger.getInstance(JetBrainsLspLifecycleService::class.java).info(message) },
    private val stopProcessFn: (Process) -> Boolean = ::stopProcess,
) : Disposable {
    private val logger = Logger.getInstance(JetBrainsLspLifecycleService::class.java)
    private var process: Process? = null

    @Synchronized
    fun startIfEnabled(): Boolean {
        if (!settingsProvider()) return false
        if (process?.isAlive == true) return true
        val binaryPath = binaryResolver() ?: run {
            diagnosticsSink("JetBrains LSP unavailable: ${sanitizeJetBrainsLspDiagnosticText("no executable ${ProductIdentity.engineBinaryName} binary found")}")
            return false
        }
        val child = try {
            processFactory.start(buildJetBrainsLspCommand(binaryPath), filterJetBrainsLspEnvironment(environmentProvider()))
        } catch (error: Exception) {
            diagnosticsSink("JetBrains LSP launch failed: ${sanitizeJetBrainsLspDiagnosticText(error.message ?: error::class.java.simpleName)}")
            return false
        }
        process = child
        attachLogs(child)
        logger.info("Started JetBrains LSP lifecycle shell")
        thread(name = "Yet AI JetBrains LSP watcher", isDaemon = true) {
            val code = child.waitFor()
            synchronized(this) {
                if (process == child) process = null
            }
            logger.info("JetBrains LSP exited with code $code")
        }
        return true
    }

    @Synchronized
    fun stop() {
        val child = process ?: return
        process = null
        stopProcessFn(child)
    }

    private fun attachLogs(process: Process) {
        listOf(process.inputStream, process.errorStream).forEach { stream ->
            thread(name = "Yet AI JetBrains LSP log", isDaemon = true) {
                BufferedReader(InputStreamReader(stream)).useLines { lines ->
                    lines.forEach { line ->
                        if (line.isNotBlank()) diagnosticsSink("JetBrains LSP: ${sanitizeJetBrainsLspDiagnosticText(line)}")
                    }
                }
            }
        }
    }

    override fun dispose() {
        stop()
    }

    companion object {
        fun getInstance(): JetBrainsLspLifecycleService = service()
    }
}
