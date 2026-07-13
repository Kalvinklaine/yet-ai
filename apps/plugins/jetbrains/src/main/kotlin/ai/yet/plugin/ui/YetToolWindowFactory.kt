package ai.yet.plugin.ui

import ai.yet.plugin.bridge.BridgeMessages
import ai.yet.plugin.bridge.ActiveEditorContext
import ai.yet.plugin.bridge.ControlledFileRead
import ai.yet.plugin.bridge.ControlledIdeActions
import ai.yet.plugin.identity.ProductIdentity
import ai.yet.plugin.logging.YetLogSink
import ai.yet.plugin.logging.YetProxyAuthDiagnosticsStore
import ai.yet.plugin.runtime.EffectiveRuntimeOwner
import ai.yet.plugin.runtime.LaunchMode
import ai.yet.plugin.runtime.RuntimeConnectionManager
import ai.yet.plugin.runtime.RuntimeConnectionListener
import ai.yet.plugin.runtime.RuntimeConnectionResult
import ai.yet.plugin.runtime.RuntimeLifecycle
import ai.yet.plugin.runtime.RuntimeLifecycleStatus
import ai.yet.plugin.runtime.RuntimeProcessState
import ai.yet.plugin.runtime.RuntimeSettings
import ai.yet.plugin.runtime.loopbackOrigin
import ai.yet.plugin.runtime.effectiveRuntimeOwnerFromLifecycleOwner
import ai.yet.plugin.runtime.runtimeCorrelationFields
import ai.yet.plugin.runtime.redactLogText
import ai.yet.plugin.runtime.runtimeLifecycleStatus
import ai.yet.plugin.runtime.sanitizeRuntimeUrlForDiagnostics
import com.google.gson.JsonParser
import com.google.gson.JsonPrimitive
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.editor.event.CaretEvent
import com.intellij.openapi.editor.event.CaretListener
import com.intellij.openapi.editor.event.SelectionEvent
import com.intellij.openapi.editor.event.SelectionListener
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.FileEditorManagerEvent
import com.intellij.openapi.fileEditor.FileEditorManagerListener
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.openapi.wm.ex.ToolWindowManagerListener
import com.intellij.util.Alarm
import com.intellij.ui.content.Content
import com.intellij.ui.content.ContentFactory
import com.intellij.ui.jcef.JBCefApp
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefJSQuery
import java.awt.BorderLayout
import java.net.URI
import javax.swing.JLabel
import javax.swing.JPanel

class WrapperScriptDelivery {
    fun hostMessage(message: String): String = """
        (() => {
          const message = $message;
          if (typeof window.__yetAiSendHostMessageToFrame === "function") {
            window.__yetAiSendHostMessageToFrame(message);
            return;
          }
          const maxPendingHostMessages = 32;
          window.__yetAiPendingHostMessages = Array.isArray(window.__yetAiPendingHostMessages) ? window.__yetAiPendingHostMessages.slice(-maxPendingHostMessages) : [];
          window.__yetAiPendingHostMessages.push(message);
          while (window.__yetAiPendingHostMessages.length > maxPendingHostMessages) window.__yetAiPendingHostMessages.shift();
        })();
    """.trimIndent()

    fun diagnostic(error: String): String {
        val escaped = BridgeMessages.escapeScriptJson(JsonPrimitive(error).toString())
        return """
            (() => {
              const message = $escaped;
              if (typeof window.__yetAiSetRuntimeDiagnostic === "function") {
                window.__yetAiSetRuntimeDiagnostic(message);
                return;
              }
              const maxPendingDiagnostics = 16;
              window.__yetAiPendingDiagnostics = Array.isArray(window.__yetAiPendingDiagnostics) ? window.__yetAiPendingDiagnostics.slice(-maxPendingDiagnostics) : [];
              window.__yetAiPendingDiagnostics.push(message);
              while (window.__yetAiPendingDiagnostics.length > maxPendingDiagnostics) window.__yetAiPendingDiagnostics.shift();
            })();
        """.trimIndent()
    }

    fun shellRuntimeCopy(statusHtml: String, fallbackHtml: String, showStatus: Boolean, showFallback: Boolean): String {
        val escapedStatus = BridgeMessages.escapeScriptJson(JsonPrimitive(statusHtml).toString())
        val escapedFallback = BridgeMessages.escapeScriptJson(JsonPrimitive(fallbackHtml).toString())
        return """
            (() => {
              const payload = { statusHtml: $escapedStatus, fallbackHtml: $escapedFallback, showStatus: $showStatus, showFallback: $showFallback };
              if (typeof window.__yetAiSetShellRuntimeCopy === "function") {
                window.__yetAiSetShellRuntimeCopy(payload);
                return;
              }
              window.__yetAiPendingShellRuntimeCopy = payload;
            })();
        """.trimIndent()
    }
}

class YetToolWindowFactory : ToolWindowFactory {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        ensureContent(project, toolWindow)
    }

    companion object {
        fun ensureContent(project: Project, toolWindow: ToolWindow) {
            val contentManager = toolWindow.contentManager
            if (!shouldCreateYetToolWindowContent(contentManager.contentCount)) {
                refreshActiveEditorContext(toolWindow)
                return
            }

            val contentFactory = ContentFactory.getInstance()
            val component = if (JBCefApp.isSupported()) {
                YetBrowserPanel(project)
            } else {
                JPanel(BorderLayout()).apply {
                    add(JLabel("Yet AI requires JCEF support to host the GUI shell."), BorderLayout.CENTER)
                }
            }
            val content = contentFactory.createContent(component, null, true)
            content.isCloseable = false
            if (component is Disposable) {
                Disposer.register(content, component)
            }
            contentManager.addContent(content)
            registerActivationRefresh(project, content)
            if (component is YetBrowserPanel) {
                registerLiveContextRefresh(project, content, component)
            }
            refreshActiveEditorContext(toolWindow)
        }

        fun refreshActiveEditorContext(toolWindow: ToolWindow) {
            for (content in toolWindow.contentManager.contents) {
                (content.component as? YetBrowserPanel)?.refreshActiveEditorContext()
            }
        }

        private fun registerActivationRefresh(project: Project, content: Content) {
            project.messageBus.connect(content).subscribe(
                ToolWindowManagerListener.TOPIC,
                object : ToolWindowManagerListener {
                    override fun toolWindowShown(toolWindow: ToolWindow) {
                        if (toolWindow.id == "Yet AI") {
                            refreshActiveEditorContext(toolWindow)
                        }
                    }
                },
            )
        }

        private fun registerLiveContextRefresh(project: Project, content: Content, panel: YetBrowserPanel) {
            project.messageBus.connect(content).subscribe(
                FileEditorManagerListener.FILE_EDITOR_MANAGER,
                object : FileEditorManagerListener {
                    override fun selectionChanged(event: FileEditorManagerEvent) {
                        panel.scheduleActiveEditorContextRefresh()
                    }
                },
            )
            val multicaster = EditorFactory.getInstance().eventMulticaster
            multicaster.addSelectionListener(
                object : SelectionListener {
                    override fun selectionChanged(event: SelectionEvent) {
                        panel.scheduleActiveEditorContextRefresh()
                    }
                },
                content,
            )
            multicaster.addCaretListener(
                object : CaretListener {
                    override fun caretPositionChanged(event: CaretEvent) {
                        panel.scheduleActiveEditorContextRefresh()
                    }
                },
                content,
            )
        }
    }
}

internal fun shouldCreateYetToolWindowContent(contentCount: Int): Boolean = contentCount == 0

internal fun canHandleApplyWorkspaceEdit(disposed: Boolean, runtimePrepared: Boolean, guiReadyRequestId: String?, acceptedHostReadyRequestId: String?): Boolean {
    val requestId = guiReadyRequestId ?: return false
    return !disposed && runtimePrepared && acceptedHostReadyRequestId == requestId
}

internal fun canHandleControlledAgentEdit(disposed: Boolean, runtimePrepared: Boolean, guiReadyRequestId: String?, acceptedHostReadyRequestId: String?): Boolean =
    canHandleApplyWorkspaceEdit(disposed, runtimePrepared, guiReadyRequestId, acceptedHostReadyRequestId)

internal fun handleControlledAgentEditWithReadiness(raw: String, ready: Boolean, send: (String) -> Unit, logStatus: (String) -> Unit = {}): Boolean {
    if (!ControlledIdeActions.isControlledAgentEditRequestType(raw)) return false
    val handled = JetBrainsControlledAgentEditBridge.handleControlledAgentEditRequest(raw, send, logStatus)
    if (handled && !ready) {
        logStatus("Yet AI returned terminal controlled edit result before GUI bridge readiness")
    }
    return handled
}

internal fun pendingRuntimeConnection(settings: RuntimeSettings): RuntimeConnectionResult = RuntimeConnectionResult(
    settings,
    "Connecting to Yet AI local runtime...",
    null,
    runtimeLifecycleStatus(
        settings,
        settings.launchMode,
        RuntimeLifecycle.RESTARTING,
        pendingRuntimeProcessState(settings.launchMode),
        "local runtime prepare is pending",
        "Wait for Yet AI runtime prepare to finish.",
        effectiveRuntimeOwner = pendingRuntimeOwner(settings.launchMode),
    ),
)

internal fun pendingRuntimeOwner(launchMode: LaunchMode): EffectiveRuntimeOwner = when (launchMode) {
    LaunchMode.LAUNCH -> EffectiveRuntimeOwner.IDE_HOST
    LaunchMode.AUTO,
    LaunchMode.CONNECT,
    -> EffectiveRuntimeOwner.EXTERNAL
}

internal fun pendingRuntimeProcessState(launchMode: LaunchMode): RuntimeProcessState = when (pendingRuntimeOwner(launchMode)) {
    EffectiveRuntimeOwner.IDE_HOST -> RuntimeProcessState.UNKNOWN
    EffectiveRuntimeOwner.EXTERNAL -> RuntimeProcessState.NOT_OWNED
}

class YetBrowserPanel(private val project: Project) : JPanel(BorderLayout()), Disposable {
    private val logger = Logger.getInstance(YetBrowserPanel::class.java)
    private val logSink = YetLogSink()
    private val browser = JBCefBrowser()
    private val query = JBCefJSQuery.create(browser as JBCefBrowser)
    private val delivery = WrapperScriptDelivery()
    private var packagedGuiServer: PackagedGuiServer? = null
    private var packagedGuiPanel: PackagedGuiPanel? = null
    private var packagedGui: PackagedGui? = null
    private val contextRefreshAlarm = Alarm(Alarm.ThreadToUse.SWING_THREAD, this)
    @Volatile
    private var latestConnection = pendingRuntimeConnection(RuntimeSettings.safeFallback())
    @Volatile
    private var runtimePrepared = false
    @Volatile
    private var guiReadyRequestId: String? = null
    @Volatile
    private var acceptedHostReadyRequestId: String? = null
    @Volatile
    private var pendingHostReadyReason: String? = null
    @Volatile
    private var disposed = false

    init {
        add(browser.component, BorderLayout.CENTER)
        query.addHandler { raw ->
            if (isGuiUnloadedBridgeMessage(raw)) {
                guiReadyRequestId = null
                acceptedHostReadyRequestId = null
                pendingHostReadyReason = null
                return@addHandler null
            }
            if (BridgeMessages.parseGuiRuntimeRefresh(raw) != null) {
                logger.info("Yet AI received GUI runtime refresh request")
                pendingHostReadyReason = "manual_refresh"
                refreshRuntimeFromGui()
                return@addHandler null
            }
            val ideActionHandled = JetBrainsIdeActionBridge.handleReadOnlyIdeActionRequest(raw, ::sendToGui, JetBrainsIdeActionHost(project)) { logger.info(it) }
            if (ideActionHandled) return@addHandler null
            val applyEditHandled = handleApplyWorkspaceEditRequest(raw)
            if (applyEditHandled) return@addHandler null
            val controlledEditHandled = handleControlledAgentEditRequest(raw)
            if (controlledEditHandled) return@addHandler null
            val fileReadHandled = JetBrainsControlledFileReadBridge.handleControlledFileReadRequest(raw, ::sendToGui) { logger.info(it) }
            if (fileReadHandled) return@addHandler null
            val guiReady = BridgeMessages.parseGuiReady(raw)
            if (guiReady == null) {
                logger.info("Yet AI rejected invalid GUI bridge message")
                return@addHandler null
            }
            logger.info("Yet AI received gui.ready")
            logSink.append("info", "bridge.gui_ready", hostBridgeCorrelationFields(latestConnection.settings, latestConnection.lifecycleStatus, "initial"))
            val requestId = guiReady.requestId
            guiReadyRequestId = requestId
            acceptedHostReadyRequestId = null
            pendingHostReadyReason = "initial"
            val latestError = latestConnection.error
            sendRuntimeStatus(latestConnection.lifecycleStatus)
            if (latestError != null) {
                sendDiagnostic(latestError)
            } else if (runtimePrepared) {
                deliverReadyMessages(latestConnection.settings, requestId)
            } else {
                logger.info("Yet AI deferred host.ready until runtime prepare completes")
            }
            null
        }
        val initialSettings = initialSettings()
        latestConnection = pendingRuntimeConnection(initialSettings)
        if (initialSettings.guiDevUrl != null) {
            YetProxyAuthDiagnosticsStore.directTokenBridge()
        }
        val packagedGui = if (initialSettings.guiDevUrl == null) PackagedGuiServer.getInstance().let { server ->
            packagedGuiServer = server
            server.start()?.let { gui ->
                val panel = server.registerPanel(initialSettings)
                packagedGuiPanel = panel
                gui.forPanel(panel).also { packagedGui = it }
            }
        } else null
        val postIntellij = query.inject("JSON.stringify(message)", "function(error) { console.log('Yet AI bridge send failed'); }", "function(response) {}")
        browser.loadHTML(renderHtml(latestConnection, postIntellij, packagedGui))
        ApplicationManager.getApplication().messageBus.connect(this).subscribe(
            RuntimeConnectionListener.TOPIC,
            object : RuntimeConnectionListener {
                override fun runtimeConnectionUpdated(result: RuntimeConnectionResult) {
                    ApplicationManager.getApplication().invokeLater {
                        if (!disposed) {
                            handleRuntimeConnection(result)
                        }
                    }
                }
            },
        )
        ApplicationManager.getApplication().executeOnPooledThread {
            val connection = RuntimeConnectionManager.getInstance().prepare()
            ApplicationManager.getApplication().invokeLater {
                if (!disposed) {
                    handleRuntimeConnection(connection)
                }
            }
        }
    }

    private fun handleApplyWorkspaceEditRequest(raw: String): Boolean {
        if (!ControlledIdeActions.isApplyWorkspaceEditRequestType(raw)) return false
        if (!canHandleApplyWorkspaceEdit()) {
            val safeRequestId = ControlledIdeActions.safeApplyWorkspaceEditRequestIdFromRaw(raw)
            if (safeRequestId != null) {
                logger.info("Yet AI rejected apply workspace edit request before GUI bridge readiness")
            }
            return safeRequestId != null
        }
        return JetBrainsApplyWorkspaceEditBridge.handleApplyWorkspaceEditRequest(raw, ::sendToGui, JetBrainsIdeActionHost(project), DialogApplyWorkspaceEditConfirmer(project)) { logger.info(it) }
    }

    private fun handleControlledAgentEditRequest(raw: String): Boolean {
        return handleControlledAgentEditWithReadiness(raw, canHandleControlledAgentEdit(), ::sendToGui) { logger.info(it) }
    }

    private fun canHandleApplyWorkspaceEdit(): Boolean = canHandleApplyWorkspaceEdit(
        disposed = disposed,
        runtimePrepared = runtimePrepared,
        guiReadyRequestId = guiReadyRequestId,
        acceptedHostReadyRequestId = acceptedHostReadyRequestId,
    )

    private fun canHandleControlledAgentEdit(): Boolean = canHandleControlledAgentEdit(
        disposed = disposed,
        runtimePrepared = runtimePrepared,
        guiReadyRequestId = guiReadyRequestId,
        acceptedHostReadyRequestId = acceptedHostReadyRequestId,
    )

    private fun handleRuntimeConnection(connection: RuntimeConnectionResult) {
        latestConnection = connection
        runtimePrepared = connection.error == null
        packagedGuiPanel?.let { panel -> packagedGuiServer?.updatePanel(panel.id, connection.settings) }
        updateShellRuntimeCopy(connection)
        sendRuntimeStatus(connection.lifecycleStatus)
        if (connection.error == null) {
            if (pendingHostReadyReason == null && guiReadyRequestId != null) pendingHostReadyReason = runtimeUpdateReadyReason(connection)
            guiReadyRequestId?.let { requestId -> deliverReadyMessages(connection.settings, requestId) }
        } else {
            sendDiagnostic(connection.error)
        }
    }

    private fun updateShellRuntimeCopy(connection: RuntimeConnectionResult) {
        if (disposed) return
        browser.cefBrowser.executeJavaScript(shellRuntimeCopyScript(connection, packagedGui, delivery), browser.cefBrowser.url, 0)
    }

    private fun refreshRuntimeFromGui() {
        ApplicationManager.getApplication().executeOnPooledThread {
            val connection = RuntimeConnectionManager.getInstance().prepare()
            ApplicationManager.getApplication().invokeLater {
                if (!disposed) {
                    handleRuntimeConnection(connection)
                }
            }
        }
    }

    private fun deliverReadyMessages(settings: RuntimeSettings, requestId: String?) {
        val delivered = JetBrainsReadyMessageDelivery.deliver(
            settings = settings,
            requestId = requestId,
            runtimeProxyBaseUrl = packagedGuiPanel?.proxyBaseUrl,
            send = ::sendToGui,
            contextSupplier = { ActiveEditorContextCollector.snapshot(project) },
            logContextStatus = { logger.info(it) },
        )
        acceptedHostReadyRequestId = requestId.takeIf { delivered && !disposed }
        if (delivered && !disposed) {
            emitHostReadyObservability(
                settings = settings,
                lifecycleStatus = latestConnection.lifecycleStatus,
                reason = pendingHostReadyReason ?: "runtime_update",
                appendLog = { level, event, metadata -> logSink.append(level, event, metadata) },
                warn = { logger.warn(it) },
            )
            pendingHostReadyReason = null
        }
    }

    fun refreshActiveEditorContext() {
        val requestId = guiReadyRequestId ?: return
        JetBrainsContextSnapshotDelivery.deliver(
            requestId = requestId,
            send = ::sendToGui,
            contextSupplier = { ActiveEditorContextCollector.snapshot(project) },
            logContextStatus = { logger.info(it) },
        )
    }

    fun scheduleActiveEditorContextRefresh() {
        if (guiReadyRequestId == null || disposed) return
        contextRefreshAlarm.cancelAllRequests()
        contextRefreshAlarm.addRequest({ refreshActiveEditorContext() }, 200)
    }

    private fun sendToGui(message: String) {
        if (disposed) return
        browser.cefBrowser.executeJavaScript(delivery.hostMessage(message), browser.cefBrowser.url, 0)
    }

    private fun sendDiagnostic(error: String) {
        if (disposed) return
        browser.cefBrowser.executeJavaScript(delivery.diagnostic(error), browser.cefBrowser.url, 0)
    }

    private fun sendRuntimeStatus(status: RuntimeLifecycleStatus) {
        sendToGui(BridgeMessages.runtimeStatus(status))
    }

    override fun dispose() {
        disposed = true
        contextRefreshAlarm.cancelAllRequests()
        packagedGuiPanel?.let { panel -> packagedGuiServer?.unregisterPanel(panel.id) }
        packagedGuiPanel = null
        packagedGui = null
        packagedGuiServer = null
        query.dispose()
        browser.dispose()
    }

    private fun initialSettings(): RuntimeSettings = try {
        RuntimeSettings.current()
    } catch (_: Exception) {
        RuntimeSettings.safeFallback()
    }
}

internal fun hostBridgeCorrelationFields(settings: RuntimeSettings, lifecycleStatus: RuntimeLifecycleStatus, reason: String): Map<String, Any?> = runtimeCorrelationFields(settings, settings.launchMode, effectiveRuntimeOwnerFromLifecycleOwner(lifecycleStatus.runtimeOwner)) + mapOf(
    "launchMode" to lifecycleStatus.launchMode,
    "tokenState" to lifecycleStatus.tokenState,
    "reason" to reason,
    "sessionTokenDelivered" to if (settings.sessionToken == null) "absent" else "present",
)

internal fun emitHostReadyObservability(
    settings: RuntimeSettings,
    lifecycleStatus: RuntimeLifecycleStatus,
    reason: String,
    appendLog: (String, String, Map<String, Any?>) -> Unit,
    warn: (String) -> Unit = {},
) {
    val fields = hostBridgeCorrelationFields(settings, lifecycleStatus, reason)
    if (fields["runtimeOwner"] == "plugin-managed" && fields["sessionTokenDelivered"] == "absent") {
        warn("Yet AI delivered plugin-managed host.ready without a session token")
        appendLog("warn", "bridge.host_ready.missing_session_token", fields)
    }
    appendLog("info", "bridge.host_ready.delivered", fields)
}

internal fun runtimeUpdateReadyReason(connection: RuntimeConnectionResult): String = if (connection.status?.contains("refreshing the runtime session token", ignoreCase = true) == true) "401_recovery" else "runtime_update"

interface ApplyWorkspaceEditConfirmer {
    fun confirm(summary: String, affectedFiles: List<String>): Boolean
}

class DialogApplyWorkspaceEditConfirmer(private val project: Project) : ApplyWorkspaceEditConfirmer {
    override fun confirm(summary: String, affectedFiles: List<String>): Boolean {
        val fileList = affectedFiles.take(4).joinToString("\n")
        val detail = if (fileList.isEmpty()) summary else "$summary\n\nFiles:\n$fileList"
        return Messages.showYesNoDialog(project, detail, "Apply Yet AI Workspace Edit?", Messages.getQuestionIcon()) == Messages.YES
    }
}

object JetBrainsControlledFileReadBridge {
    fun handleControlledFileReadRequest(raw: String, send: (String) -> Unit, logStatus: (String) -> Unit = {}): Boolean {
        if (!ControlledFileRead.isRequestType(raw)) return false
        val request = ControlledFileRead.parse(raw)
        if (request == null) {
            val safeRequestId = ControlledFileRead.safeRequestIdFromRaw(raw) ?: return false
            logStatus("Yet AI rejected invalid controlled file read request")
            send(ControlledFileRead.rejectedResult(safeRequestId))
            return true
        }
        logStatus("Yet AI disabled JetBrains controlled file read request")
        send(ControlledFileRead.unsupportedResult(request))
        return true
    }
}

object JetBrainsControlledAgentEditBridge {
    fun handleControlledAgentEditRequest(raw: String, send: (String) -> Unit, logStatus: (String) -> Unit = {}): Boolean {
        if (!ControlledIdeActions.isControlledAgentEditRequestType(raw)) return false
        val request = ControlledIdeActions.parseControlledAgentEdit(raw)
        if (request == null) {
            val safeRequestId = ControlledIdeActions.safeControlledAgentEditRequestIdFromRaw(raw) ?: return false
            logStatus("Yet AI rejected invalid controlled edit request")
            send(ControlledIdeActions.controlledAgentEditRejectedResult(safeRequestId))
            return true
        }
        logStatus("Yet AI disabled JetBrains controlled edit request")
        send(ControlledIdeActions.controlledAgentEditUnsupportedResult(request))
        return true
    }
}

object JetBrainsApplyWorkspaceEditBridge {
    fun handleApplyWorkspaceEditRequest(
        raw: String,
        send: (String) -> Unit,
        host: ApplyWorkspaceEditHost,
        confirmer: ApplyWorkspaceEditConfirmer,
        logStatus: (String) -> Unit = {},
    ): Boolean {
        val request = ControlledIdeActions.parseApplyWorkspaceEdit(raw)
        if (request == null) {
            val safeRequestId = ControlledIdeActions.safeApplyWorkspaceEditRequestIdFromRaw(raw) ?: return false
            logStatus("Yet AI rejected invalid apply workspace edit request")
            send(ControlledIdeActions.applyWorkspaceEditResult(safeRequestId, ControlledIdeActions.ApplyWorkspaceEditStatus.Rejected, "Edit request was rejected by policy."))
            return true
        }
        val affectedFiles = request.edits.map { it.workspaceRelativePath }
        if (!confirmer.confirm(request.summary, affectedFiles)) {
            send(ControlledIdeActions.applyWorkspaceEditResult(request.requestId, ControlledIdeActions.ApplyWorkspaceEditStatus.Denied, "Edit request denied.", 0, affectedFiles))
            return true
        }
        host.apply(request).whenComplete { hostResult, error ->
            val result = if (error != null || hostResult == null) {
                ApplyWorkspaceEditHostResult(ControlledIdeActions.ApplyWorkspaceEditStatus.Failed, "Edit request failed.")
            } else {
                hostResult
            }
            send(
                ControlledIdeActions.applyWorkspaceEditResult(
                    requestId = request.requestId,
                    status = result.status,
                    message = result.message,
                    appliedEditCount = result.appliedEditCount,
                    affectedFiles = result.affectedFiles,
                ),
            )
        }
        return true
    }
}

object JetBrainsIdeActionBridge {
    fun handleReadOnlyIdeActionRequest(raw: String, send: (String) -> Unit, host: IdeActionHost, logStatus: (String) -> Unit = {}): Boolean {
        val request = ControlledIdeActions.parse(raw)
        if (request == null) {
            val safeRequestId = ControlledIdeActions.safeRequestIdFromRaw(raw) ?: return false
            logStatus("Yet AI rejected invalid IDE action request")
            send(
                ControlledIdeActions.ideActionResult(
                    requestId = safeRequestId,
                    status = ControlledIdeActions.ResultStatus.Rejected,
                    message = "IDE action request was rejected by policy.",
                ),
            )
            return true
        }

        logStatus("Yet AI received read-only IDE action request")
        send(
            ControlledIdeActions.ideActionProgress(
                requestId = request.requestId,
                phase = "checkingPolicy",
                status = ControlledIdeActions.ProgressStatus.InProgress,
                summary = "Checking IDE action policy.",
                action = request.action,
                workspaceRelativePath = workspaceRelativePath(request),
            ),
        )
        send(
            ControlledIdeActions.ideActionProgress(
                requestId = request.requestId,
                phase = "running",
                status = ControlledIdeActions.ProgressStatus.InProgress,
                summary = "Running IDE action.",
                action = request.action,
                workspaceRelativePath = workspaceRelativePath(request),
            ),
        )
        host.execute(request).whenComplete { hostResult, error ->
            val result = if (error != null || hostResult == null) {
                IdeActionHostResult(ControlledIdeActions.ResultStatus.Failed, "IDE action failed.")
            } else {
                hostResult
            }
            val progressStatus = when (result.status) {
                ControlledIdeActions.ResultStatus.Succeeded -> ControlledIdeActions.ProgressStatus.Succeeded
                ControlledIdeActions.ResultStatus.Rejected -> ControlledIdeActions.ProgressStatus.Rejected
                ControlledIdeActions.ResultStatus.Unavailable -> ControlledIdeActions.ProgressStatus.Unavailable
                ControlledIdeActions.ResultStatus.Failed -> ControlledIdeActions.ProgressStatus.Failed
            }
            send(
                ControlledIdeActions.ideActionProgress(
                    requestId = request.requestId,
                    phase = "completed",
                    status = progressStatus,
                    summary = result.message,
                    action = request.action,
                    workspaceRelativePath = result.workspaceRelativePath ?: workspaceRelativePath(request),
                ),
            )
            send(
                ControlledIdeActions.ideActionResult(
                    requestId = request.requestId,
                    status = result.status,
                    message = result.message,
                    action = request.action,
                    workspaceRelativePath = result.workspaceRelativePath ?: workspaceRelativePath(request),
                    range = result.range ?: (request as? ControlledIdeActions.Request.RevealWorkspaceRange)?.range,
                    includeContextMetadata = request is ControlledIdeActions.Request.GetContextSnapshot,
                    hasActiveEditor = result.hasActiveEditor,
                    workspaceFolderCount = result.workspaceFolderCount,
                    contextAttachment = result.contextAttachment,
                ),
            )
        }
        return true
    }

    private fun workspaceRelativePath(request: ControlledIdeActions.Request): String? = when (request) {
        is ControlledIdeActions.Request.OpenWorkspaceFile -> request.workspaceRelativePath
        is ControlledIdeActions.Request.RevealWorkspaceRange -> request.workspaceRelativePath
        is ControlledIdeActions.Request.GetContextSnapshot -> null
        is ControlledIdeActions.Request.GetActiveFileExcerpt -> null
    }
}

object JetBrainsReadyMessageDelivery {
    fun deliver(
        settings: RuntimeSettings,
        requestId: String?,
        runtimeProxyBaseUrl: String? = null,
        send: (String) -> Unit,
        contextSupplier: () -> ActiveEditorContext.Snapshot?,
        logContextStatus: (String) -> Unit,
    ): Boolean {
        if (!isValidRuntimeUrl(settings.runtimeUrl) || !isValidRuntimeProxyBaseUrl(runtimeProxyBaseUrl)) {
            logContextStatus("Yet AI rejected invalid runtime URL for GUI bridge ready batch")
            return false
        }
        send(BridgeMessages.hostReady(settings, requestId, runtimeProxyBaseUrl))
        send(BridgeMessages.openedFromCommand())
        val snapshot = try {
            contextSupplier()
        } catch (_: Exception) {
            logContextStatus("Yet AI active editor context collection failed")
            null
        }
        if (snapshot != null) {
            send(BridgeMessages.contextSnapshot(snapshot, requestId))
        }
        return true
    }

    private fun isValidRuntimeProxyBaseUrl(value: String?): Boolean = value == null || Regex("^/panel/[A-Za-z0-9][A-Za-z0-9_-]{0,127}$").matches(value)

    private fun isValidRuntimeUrl(value: String): Boolean {
        if (value.isBlank()) return false
        val uri = try {
            URI(value)
        } catch (_: Exception) {
            return false
        }
        val scheme = uri.scheme?.lowercase() ?: return false
        val host = uri.host?.removeSurrounding("[", "]")?.lowercase() ?: return false
        val path = uri.rawPath ?: ""
        return uri.isAbsolute &&
            (scheme == "http" || scheme == "https") &&
            (host == "127.0.0.1" || host == "localhost" || host == "::1") &&
            uri.rawUserInfo == null &&
            uri.port in 1..65535 &&
            uri.rawQuery == null &&
            uri.rawFragment == null &&
            (path.isEmpty() || path == "/")
    }
}

object JetBrainsContextSnapshotDelivery {
    fun deliver(
        requestId: String?,
        send: (String) -> Unit,
        contextSupplier: () -> ActiveEditorContext.Snapshot?,
        logContextStatus: (String) -> Unit,
    ) {
        val snapshot = try {
            contextSupplier()
        } catch (_: Exception) {
            logContextStatus("Yet AI active editor context refresh failed")
            null
        }
        if (snapshot != null) {
            send(BridgeMessages.contextSnapshot(snapshot, requestId))
        }
    }
}

object ActiveEditorContextCollector {
    fun snapshot(project: Project): ActiveEditorContext.Snapshot? = ApplicationManager.getApplication().runReadAction<ActiveEditorContext.Snapshot?> {
        val editor = FileEditorManager.getInstance(project).selectedTextEditor ?: return@runReadAction null
        val virtualFile = FileDocumentManager.getInstance().getFile(editor.document)
        val workspaceRelativePath = virtualFile?.let { workspaceRelativePath(project.basePath, it.path) }
        val displayPath = workspaceRelativePath ?: virtualFile?.path
        val languageId = virtualFile?.fileType?.name
        val selection = editor.selectionModel
        val hasSelection = selection.hasSelection()
        val startOffset = selection.selectionStart.takeIf { hasSelection }
        val endOffset = selection.selectionEnd.takeIf { hasSelection }
        val startLine = startOffset?.let { editor.document.getLineNumber(it) }
        val endLine = endOffset?.let { editor.document.getLineNumber(it) }
        val startCharacter = startOffset?.let { it - editor.document.getLineStartOffset(editor.document.getLineNumber(it)) }
        val endCharacter = endOffset?.let { it - editor.document.getLineStartOffset(editor.document.getLineNumber(it)) }
        ActiveEditorContext.snapshot(
            displayPath = displayPath,
            workspaceRelativePath = workspaceRelativePath,
            languageId = languageId,
            selectionStartLine = startLine,
            selectionStartCharacter = startCharacter,
            selectionEndLine = endLine,
            selectionEndCharacter = endCharacter,
            selectionText = selection.selectedText.takeIf { hasSelection },
        )
    }

}

internal fun engineServedWebUiRootUrl(runtimeUrl: String): String? = try {
    "${loopbackOrigin(runtimeUrl)}/"
} catch (_: Exception) {
    null
}

internal fun isPluginManagedRuntime(connection: RuntimeConnectionResult): Boolean = connection.lifecycleStatus.runtimeOwner == EffectiveRuntimeOwner.IDE_HOST.lifecycleOwner

internal fun shellRuntimeCopyScript(connection: RuntimeConnectionResult, packagedGui: PackagedGui?, delivery: WrapperScriptDelivery = WrapperScriptDelivery()): String =
    delivery.shellRuntimeCopy(
        shellStatusCopy(connection, packagedGui),
        shellFallbackCopy(connection, packagedGui),
        showStatus = shouldShowShellRuntimeFallback(connection),
        showFallback = shouldShowShellRuntimeFallback(connection),
    )

internal fun shouldShowShellRuntimeFallback(connection: RuntimeConnectionResult): Boolean {
    val status = connection.lifecycleStatus
    return connection.error != null ||
        status.lifecycle != RuntimeLifecycle.CONNECTED ||
        (isPluginManagedRuntime(connection) && status.processState != RuntimeProcessState.RUNNING) ||
        (!isPluginManagedRuntime(connection) && status.processState != RuntimeProcessState.NOT_OWNED)
}

private fun sanitizeRuntimeStatusForShell(value: String?): String? {
    if (value == null) return null
    val sanitizedUrls = Regex("https?://[^\\s<>\"']+").replace(value) { match ->
        val url = match.value.trimEnd('.', ',', ';', ')')
        val suffix = match.value.removePrefix(url)
        sanitizeRuntimeUrlForDiagnostics(url) + suffix
    }
    return redactLogText(sanitizedUrls, "")
}

private fun shellStatusCopy(connection: RuntimeConnectionResult, packagedGui: PackagedGui?): String {
    val settings = connection.settings
    val engineRoot = engineServedWebUiRootUrl(settings.runtimeUrl)
    val status = html(sanitizeRuntimeStatusForShell(connection.status) ?: "Connecting to Yet AI local runtime...")
    return when {
        settings.guiDevUrl != null -> "Development GUI iframe: <code>${html(settings.guiDevUrl)}</code>. Runtime: <code>${html(engineRoot ?: sanitizeRuntimeUrlForShell(settings.runtimeUrl))}</code>. $status"
        packagedGui != null && isPluginManagedRuntime(connection) && engineRoot != null -> "Installed plugin packaged panel: <code>${html(packagedGui.indexUrl)}</code>. Engine-served Web UI: <code>${html(engineRoot)}</code>. $status"
        packagedGui != null -> "Installed plugin packaged panel: <code>${html(packagedGui.indexUrl)}</code>. External/connect runtime: <code>${html(engineRoot ?: sanitizeRuntimeUrlForShell(settings.runtimeUrl))}</code>. The plugin cannot guarantee that this runtime serves the Web UI. $status"
        isPluginManagedRuntime(connection) && engineRoot != null -> "Packaged Yet AI panel is unavailable. Engine-served Web UI should be available at <code>${html(engineRoot)}</code>. $status"
        else -> "Packaged Yet AI panel is unavailable. External/connect runtime: <code>${html(engineRoot ?: sanitizeRuntimeUrlForShell(settings.runtimeUrl))}</code>. The plugin cannot guarantee that this runtime serves the Web UI. $status"
    }
}

private fun shellFallbackCopy(connection: RuntimeConnectionResult, packagedGui: PackagedGui?): String {
    val settings = connection.settings
    val engineRoot = engineServedWebUiRootUrl(settings.runtimeUrl)
    return when {
        settings.guiDevUrl != null -> "Development GUI did not finish loading from <code>${html(settings.guiDevUrl)}</code>. Check that the loopback dev server is running, then click Refresh runtime."
        packagedGui != null && isPluginManagedRuntime(connection) && engineRoot != null -> "Packaged Yet AI GUI did not finish loading from the installed plugin panel. Open the engine-served Web UI at <code>${html(engineRoot)}</code>, reinstall the latest ZIP, or rebuild with <code>npm run prepare:jetbrains-preview</code>."
        packagedGui != null -> "Packaged Yet AI GUI did not finish loading from the installed plugin panel. This is an external/connect runtime, so the plugin cannot guarantee a Web UI at <code>${html(engineRoot ?: sanitizeRuntimeUrlForShell(settings.runtimeUrl))}</code>. Check the runtime owner or switch to plugin launch mode."
        isPluginManagedRuntime(connection) && engineRoot != null -> "Packaged Yet AI panel is missing or blank. Open the engine-served Web UI at <code>${html(engineRoot)}</code>, rebuild the GUI, then reinstall the plugin ZIP."
        else -> "Packaged Yet AI panel is missing or blank. This is an external/connect runtime, so the plugin cannot guarantee a Web UI at <code>${html(engineRoot ?: sanitizeRuntimeUrlForShell(settings.runtimeUrl))}</code>. Check runtime settings or switch to plugin launch mode."
    }
}

private fun sanitizeRuntimeUrlForShell(runtimeUrl: String): String = engineServedWebUiRootUrl(runtimeUrl) ?: "unavailable"

fun renderHtml(connection: RuntimeConnectionResult, postIntellij: String, packagedGui: PackagedGui?): String {
    val settings = connection.settings
    val frame = buildGuiFrame(settings.guiDevUrl, packagedGui)
    val frameOrigin = buildFrameOrigin(settings.guiDevUrl, packagedGui)
    val status = sanitizeRuntimeStatusForShell(connection.status)?.let { "<p>${html(it)}</p>" } ?: ""
    val error = connection.error?.let { "<p><strong>Runtime error:</strong> ${html(sanitizeRuntimeStatusForShell(it) ?: "Runtime failure detected; details are sanitized above")}</p>" } ?: ""
    val shellStatusCopy = shellStatusCopy(connection, packagedGui)
    val shellFallbackCopy = shellFallbackCopy(connection, packagedGui)
    val placeholder = if (settings.guiDevUrl == null && packagedGui == null) {
        "<main><h1>Yet AI</h1>$status$error<p>$shellStatusCopy</p><p>Run <code>cd apps/gui && npm run build</code> before <code>cd apps/plugins/jetbrains && gradle build --console=plain</code> to package the GUI, or set the GUI dev URL to a loopback Vite server during development.</p></main>"
    } else {
        ""
    }
    val diagnostics = "<div id=\"yet-ai-shell-status\" role=\"status\">$shellStatusCopy</div><div id=\"yet-ai-shell-fallback\" role=\"alert\" hidden>$shellFallbackCopy</div>"
    return """
        <!DOCTYPE html>
        <html lang="en">
        <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Yet AI</title>
        <style>
        body { margin: 0; font-family: sans-serif; }
        main { padding: 24px; }
        iframe { width: 100vw; height: 100vh; border: 0; }
        #yet-ai-shell-status, #yet-ai-shell-fallback { position: fixed; left: 12px; bottom: 12px; z-index: 1; max-width: 80vw; padding: 8px 10px; border-radius: 8px; background: #111827; color: #f9fafb; font-size: 12px; }
        #yet-ai-shell-fallback { top: 24px; bottom: auto; background: #7f1d1d; }
        #yet-ai-shell-fallback[hidden], #yet-ai-shell-status[hidden] { display: none; }
        </style>
        </head>
        <body>
        $placeholder$diagnostics$frame
        <script>
        const bridgeVersion = "${ProductIdentity.bridgeVersion}";
        const frame = document.querySelector("iframe");
        const frameTargetOrigin = $frameOrigin;
        const shellStatus = document.getElementById("yet-ai-shell-status");
        const shellFallback = document.getElementById("yet-ai-shell-fallback");
        let frameLoaded = false;
        let frameReady = false;
        let frameGeneration = 0;
        let currentFrameWindow = frame?.contentWindow;
        let currentGuiReadyRequestId;
        let guiReadySequence = 0;
        let currentGuiReadySequence = 0;
        let acceptedHostReadyRequestId;
        let hostReadyAcceptedForCurrentFrame = false;
        let currentFrameNonce;
        let frameNonceChallengeAttempts = 0;
        let readinessFallbackTimerId;
        let readinessFallbackGeneration = 0;
        const maxPendingHostMessages = 32;
        const maxPendingDiagnostics = 16;
        const boundedArray = (value, maxSize) => Array.isArray(value) ? value.slice(-maxSize) : [];
        const pushBounded = (queue, message, maxSize) => {
          queue.push(message);
          while (queue.length > maxSize) queue.shift();
        };
        const pendingHostMessages = boundedArray(window.__yetAiPendingHostMessages, maxPendingHostMessages);
        const pendingDiagnostics = boundedArray(window.__yetAiPendingDiagnostics, maxPendingDiagnostics);
        window.__yetAiPendingHostMessages = pendingHostMessages;
        window.__yetAiPendingDiagnostics = pendingDiagnostics;
        let latestShellRuntimeCopyPayload;
        const applyShellRuntimeCopy = (payload) => {
          if (typeof payload !== "object" || payload === null || Array.isArray(payload) || typeof payload.statusHtml !== "string" || typeof payload.fallbackHtml !== "string") return;
          latestShellRuntimeCopyPayload = payload;
          const showStatus = payload.showStatus === true;
          const showFallback = payload.showFallback === true;
          if (shellStatus) {
            shellStatus.innerHTML = payload.statusHtml;
            shellStatus.hidden = frameReady ? !showStatus : false;
          }
          if (shellFallback) {
            shellFallback.innerHTML = payload.fallbackHtml;
            shellFallback.hidden = frameReady ? !showFallback : shellFallback.hidden && !showFallback;
          }
        };
        window.__yetAiSetShellRuntimeCopy = (payload) => {
          window.__yetAiPendingShellRuntimeCopy = undefined;
          applyShellRuntimeCopy(payload);
        };
        if (window.__yetAiPendingShellRuntimeCopy !== undefined) {
          window.__yetAiSetShellRuntimeCopy(window.__yetAiPendingShellRuntimeCopy);
        }
        const showDiagnostic = (message) => {
          if (shellStatus && typeof message === "string") {
            shellStatus.hidden = false;
            shellStatus.textContent = `Runtime error: ${'$'}{message}`;
          }
        };
        window.__yetAiSetRuntimeDiagnostic = (message) => {
          if (!frameReady) {
            pushBounded(pendingDiagnostics, message, maxPendingDiagnostics);
            return;
          }
          showDiagnostic(message);
        };
        const markFrameLoaded = () => {
          frameLoaded = true;
          console.log("Yet AI iframe loaded; waiting for validated gui.ready");
        };
        const showReadinessFallback = (message) => {
          if (shellStatus) {
            shellStatus.hidden = false;
            shellStatus.textContent = message;
          }
          if (shellFallback) shellFallback.hidden = false;
          console.log("Yet AI GUI readiness fallback shown");
        };
        const hideShellAfterReady = () => {
          if (shellStatus) shellStatus.hidden = true;
          if (shellFallback) shellFallback.hidden = true;
        };
        const clearReadinessFallbackTimer = () => {
          if (readinessFallbackTimerId !== undefined) {
            window.clearTimeout(readinessFallbackTimerId);
            readinessFallbackTimerId = undefined;
          }
        };
        const armReadinessFallbackTimer = (generation) => {
          clearReadinessFallbackTimer();
          if (!shellFallback || !frame) return;
          readinessFallbackGeneration = generation;
          readinessFallbackTimerId = window.setTimeout(() => {
            readinessFallbackTimerId = undefined;
            if (frameReady || readinessFallbackGeneration !== generation || frameGeneration !== generation) return;
            const readinessMessage = frameLoaded
              ? "Packaged Yet AI GUI loaded but did not send a validated ready signal. See the fallback panel above for the engine-served Web UI URL and repair steps."
              : "Packaged Yet AI GUI did not finish loading. See the fallback panel above for the engine-served Web UI URL and repair steps.";
            showReadinessFallback(readinessMessage);
          }, 8000);
        };
        if (shellFallback && frame) armReadinessFallbackTimer(frameGeneration);
        window.postIntellijMessage = (message) => { $postIntellij };
        const isPlainObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
        const hasOnlyKeys = (record, keys) => Object.keys(record).every((key) => keys.includes(key));
        const isRequestId = (value) => value === undefined || (typeof value === "string" && value.length > 0 && value.length <= 128 && value.split("").every((char) => {
          const code = char.charCodeAt(0);
          return code >= 0x20 && (code < 0x7f || code > 0x9f);
        }));
        const isFrameNonce = (value) => typeof value === "string" && /^[0-9a-f]{32}$/.test(value);
        const maxIdeActionRequestBytes = 8192;
        const maxApplyWorkspaceEditRequestBytes = 65536;
        const maxControlledAgentEditRequestBytes = 65536;
        const maxControlledFileReadRequestBytes = 8192;
        const allowedIdeActionNames = ["getContextSnapshot", "openWorkspaceFile", "revealWorkspaceRange", "getActiveFileExcerpt"];
        const optionalString = (value, maxLength) => value === undefined || (typeof value === "string" && value.length <= maxLength);
        const optionalNonEmptyString = (value, maxLength) => value === undefined || (typeof value === "string" && value.length > 0 && value.length <= maxLength);
        const requiredRequestId = (value) => typeof value === "string" && value.length > 0 && value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value) && !/(authorization|bearer|api[_-]?key|token|secret|access[_-]?token|provider[_-]?key|openai[_-]?api[_-]?key|sk-(?:proj-)?[A-Za-z0-9_-]{8,})/i.test(value);
        const requiredLoopbackRuntimeUrl = (value) => {
          if (typeof value !== "string" || value.length === 0 || value.length > 2048) return false;
          try {
            const parsed = new URL(value);
            const hostname = parsed.hostname.toLowerCase();
            const isLoopback = hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]";
            return (parsed.protocol === "http:" || parsed.protocol === "https:") && isLoopback && /^[1-9][0-9]{0,4}$/.test(parsed.port) && Number(parsed.port) <= 65535 && parsed.username === "" && parsed.password === "" && parsed.search === "" && parsed.hash === "" && (parsed.pathname === "" || parsed.pathname === "/");
          } catch (_) {
            return false;
          }
        };
        const optionalPanelScopedProxyBaseUrl = (value) => value === undefined || (typeof value === "string" && /^\/panel\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value));
        const optionalNumber = (value) => value === undefined || (Number.isInteger(value) && value >= 0 && value <= 1000000);
        const isSecretLikePathSegment = (value) => /^(?:auth|authorization|bearer|cookie|credential|credentials|password|secret|token|access[_-]?token|api[_-]?key)(?:\.|-|_|$)/i.test(value) || /(?:^|[._-])(?:auth|credential|credentials|password|secret|token|access[_-]?token|api[_-]?key)(?:[._-]|$)/i.test(value) || /^sk-(?:proj-)?[A-Za-z0-9_-]{8,}/i.test(value);
        const safePath = (value, maxLength) => value === undefined || (typeof value === "string" && value.length > 0 && value.length <= maxLength && !value.startsWith("/") && !value.startsWith("~") && !value.includes("%") && !value.includes("\\") && !value.includes(":") && !value.includes("?") && !value.includes("#") && /^[^\u0000-\u001f\u007f-\u009f]+$/.test(value) && value.split("/").every((part) => part.length > 0 && part !== "." && part !== ".." && !isSecretLikePathSegment(part)));
        const safeRequiredWorkspacePath = (value) => safePath(value, 512) && !value.includes("%") && !value.includes("?") && !value.includes("#") && !value.includes("//") && !value.endsWith("/") && value.split("/").every((part) => part.length > 0 && !/(?:^|[._-])(?:auth|credential|credentials|password|secret|token|access[_-]?token|api[_-]?key)(?:[._-]|$)|^sk-(?:proj-)?[A-Za-z0-9_-]{8,}/i.test(part));
        const controlledFileReadPath = (value) => typeof value === "string" && value.length > 0 && value.length <= 180 && !value.startsWith("/") && !/^[A-Za-z]:/.test(value) && !value.startsWith("~") && !value.includes("\\") && !/[\\:*?\"<>|{}\[\]$^+]/.test(value) && !value.includes("//") && !value.endsWith("/") && value.split("/").every((part) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part) && part !== "." && part !== ".." && !part.startsWith(".") && !/^(node_modules|vendor|dist|build|out|target|coverage|__pycache__|generated|tmp|temp|secrets?|credentials?|private)$/i.test(part));
        const controlledAgentEditPath = controlledFileReadPath;
        const safeControlledAgentEditId = (value) => typeof value === "string" && value.length > 0 && value.length <= 120 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) && !/(assistant|authorization|bearer|api[_-]?key|token|secret|sk-(?:proj-)?)/i.test(value);
        const safeControlledAgentEditSummary = (value, maxLength) => typeof value === "string" && value.length > 0 && value.length <= maxLength && /^[^\u0000-\u001f\u007f-\u009f]+$/.test(value) && !/(api[_-]?key|authorization|bearer|cookie|token|secret|password|raw[_\- ]?(file|body|patch|diff|command)|file[_\- ]?(body|content)|provider|shell|command|cwd|env|git|tool|chmod|symlink|binary|create|delete|rename|move|auto[_\- ]?(apply|run|repair)|sk-(?:proj-)?|\/(?:Users|Home|Tmp|Var|Etc|Opt|Mnt|Volumes|Private)(?=\/|$|[^A-Za-z0-9_])|[A-Za-z]:(?:\/|\\)|~(?:\/|\\))/i.test(value);
        const sha256Hash = (value) => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
        const safeControlledFileReadId = (value) => typeof value === "string" && value.length > 0 && value.length <= 80 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && !/(assistant|sk-(?:proj-)?)/i.test(value);
        const isIdeActionPosition = (position) => isPlainObject(position) && hasOnlyKeys(position, ["line", "character"]) && Number.isInteger(position.line) && position.line >= 0 && position.line <= 1000000 && Number.isInteger(position.character) && position.character >= 0 && position.character <= 1000000;
        const isIdeActionRange = (range) => isPlainObject(range) && hasOnlyKeys(range, ["start", "end"]) && isIdeActionPosition(range.start) && isIdeActionPosition(range.end) && (range.end.line > range.start.line || (range.end.line === range.start.line && range.end.character >= range.start.character));
        const isContextFile = (file) => file === undefined || (isPlainObject(file) && hasOnlyKeys(file, ["displayPath", "workspaceRelativePath", "languageId"]) && Object.keys(file).length > 0 && safePath(file.displayPath, 256) && safePath(file.workspaceRelativePath, 512) && (file.languageId === undefined || (typeof file.languageId === "string" && file.languageId.length > 0 && file.languageId.length <= 64 && /^[A-Za-z0-9_.+-]+$/.test(file.languageId))));
        const isContextSelection = (selection) => selection === undefined || (isPlainObject(selection) && hasOnlyKeys(selection, ["startLine", "startCharacter", "endLine", "endCharacter", "text"]) && Object.keys(selection).length > 0 && optionalNumber(selection.startLine) && optionalNumber(selection.startCharacter) && optionalNumber(selection.endLine) && optionalNumber(selection.endCharacter) && optionalString(selection.text, 8000));
        const isContextSnapshotPayload = (payload) => isPlainObject(payload) && hasOnlyKeys(payload, ["kind", "source", "file", "selection"]) && payload.kind === "active_editor" && (payload.source === "vscode" || payload.source === "jetbrains" || payload.source === "browser") && isContextFile(payload.file) && isContextSelection(payload.selection);
        const isHostReadyPayload = (payload) => isPlainObject(payload) && hasOnlyKeys(payload, ["runtimeUrl", "runtimeProxyBaseUrl", "sessionToken", "productId", "displayName", "cloudRequired"]) && requiredLoopbackRuntimeUrl(payload.runtimeUrl) && optionalPanelScopedProxyBaseUrl(payload.runtimeProxyBaseUrl) && optionalString(payload.sessionToken, 4096) && optionalNonEmptyString(payload.productId, 256) && optionalNonEmptyString(payload.displayName, 256) && (payload.cloudRequired === undefined || payload.cloudRequired === false);
        const isHostIdeActionProgressPayload = (payload) => isPlainObject(payload) && hasOnlyKeys(payload, ["phase", "status", "summary", "cloudRequired", "action", "workspaceRelativePath"]) && ["queued", "checkingPolicy", "running", "completed"].includes(payload.phase) && ["pending", "inProgress", "succeeded", "rejected", "unavailable", "failed"].includes(payload.status) && typeof payload.summary === "string" && payload.summary.length > 0 && payload.summary.length <= 1000 && (payload.cloudRequired === undefined || payload.cloudRequired === false) && (payload.action === undefined || allowedIdeActionNames.includes(payload.action)) && safePath(payload.workspaceRelativePath, 512);
        const isHostIdeActionResultContext = (context) => isPlainObject(context) && hasOnlyKeys(context, ["source", "hasActiveEditor", "workspaceFolderCount"]) && context.source === "jetbrains" && typeof context.hasActiveEditor === "boolean" && Number.isInteger(context.workspaceFolderCount) && context.workspaceFolderCount >= 0 && context.workspaceFolderCount <= 100;
        const isActiveFileExcerptText = (text) => typeof text === "string" && text.length > 0 && text.length <= 8000 && !/(authorization|bearer|cookie|api[_-]?key|token|secret|password|private[_-]?path|\/(?:Users|Home|Tmp|Var|Etc|Opt|Mnt|Volumes|Private)(?=\/|$|[^A-Za-z0-9_])|[A-Za-z]:(?:\/|\\)|~(?:\/|\\)|(?:^|[^A-Za-z0-9_-])sk-(?:proj-)?[A-Za-z0-9_-]{8,})/i.test(text);
        const isActiveFileExcerptAttachment = (attachment) => isPlainObject(attachment) && hasOnlyKeys(attachment, ["kind", "source", "file", "range", "text", "truncated"]) && attachment.kind === "active_file_excerpt" && attachment.source === "jetbrains" && isPlainObject(attachment.file) && hasOnlyKeys(attachment.file, ["displayPath", "workspaceRelativePath", "languageId"]) && safePath(attachment.file.displayPath, 256) && safePath(attachment.file.workspaceRelativePath, 512) && (attachment.file.languageId === undefined || (typeof attachment.file.languageId === "string" && attachment.file.languageId.length > 0 && attachment.file.languageId.length <= 64 && /^[A-Za-z0-9_.+-]+$/.test(attachment.file.languageId))) && isIdeActionRange(attachment.range) && isActiveFileExcerptText(attachment.text) && typeof attachment.truncated === "boolean";
        const isHostIdeActionResultPayload = (payload) => isPlainObject(payload) && hasOnlyKeys(payload, ["status", "message", "cloudRequired", "action", "workspaceRelativePath", "range", "context", "contextAttachment"]) && ["succeeded", "rejected", "unavailable", "failed"].includes(payload.status) && typeof payload.message === "string" && payload.message.length > 0 && payload.message.length <= 1000 && (payload.cloudRequired === undefined || payload.cloudRequired === false) && (payload.action === undefined || allowedIdeActionNames.includes(payload.action)) && safePath(payload.workspaceRelativePath, 512) && (payload.range === undefined || isIdeActionRange(payload.range)) && (payload.context === undefined || isHostIdeActionResultContext(payload.context)) && (payload.contextAttachment === undefined || isActiveFileExcerptAttachment(payload.contextAttachment));
        const isHostApplyWorkspaceEditResultPayload = (payload) => isPlainObject(payload) && hasOnlyKeys(payload, ["status", "message", "cloudRequired", "appliedEditCount", "affectedFiles"]) && ["applied", "denied", "rejected", "failed"].includes(payload.status) && typeof payload.message === "string" && payload.message.length > 0 && payload.message.length <= 1000 && (payload.cloudRequired === undefined || payload.cloudRequired === false) && (payload.appliedEditCount === undefined || (Number.isInteger(payload.appliedEditCount) && payload.appliedEditCount >= 0 && payload.appliedEditCount <= 64)) && (payload.affectedFiles === undefined || (Array.isArray(payload.affectedFiles) && payload.affectedFiles.length <= 4 && payload.affectedFiles.every((path) => safeRequiredWorkspacePath(path))));
        const isControlledAgentEditLimits = (limits) => isPlainObject(limits) && hasOnlyKeys(limits, ["maxFiles", "maxEdits", "maxPatchBytes"]) && Number.isInteger(limits.maxFiles) && limits.maxFiles >= 1 && limits.maxFiles <= 4 && Number.isInteger(limits.maxEdits) && limits.maxEdits >= 1 && limits.maxEdits <= 16 && Number.isInteger(limits.maxPatchBytes) && limits.maxPatchBytes >= 1 && limits.maxPatchBytes <= 12000;
        const isControlledAgentResultEdit = (edit) => isPlainObject(edit) && hasOnlyKeys(edit, ["operation", "workspaceRelativePath", "fileLabel", "expectedContentHash", "actualContentHash", "startLine", "endLine", "replacementByteCount", "sanitizedSummary"]) && edit.operation === "replace" && controlledAgentEditPath(edit.workspaceRelativePath) && safeControlledAgentEditSummary(edit.fileLabel, 160) && sha256Hash(edit.expectedContentHash) && (edit.actualContentHash === undefined || sha256Hash(edit.actualContentHash)) && Number.isInteger(edit.startLine) && edit.startLine >= 1 && edit.startLine <= 1000000 && Number.isInteger(edit.endLine) && edit.endLine >= edit.startLine && edit.endLine <= 1000000 && Number.isInteger(edit.replacementByteCount) && edit.replacementByteCount >= 0 && edit.replacementByteCount <= 12000 && safeControlledAgentEditSummary(edit.sanitizedSummary, 240);
        const isControlledAgentEditPolicyFlags = (flags) => isPlainObject(flags) && hasOnlyKeys(flags, ["boundedReplacementEditAllowed", "fileCreateAllowed", "fileDeleteAllowed", "fileRenameAllowed", "fileMoveAllowed", "chmodAllowed", "symlinkAllowed", "binaryEditAllowed", "directoryEditAllowed", "shellAllowed", "gitAllowed", "providerAllowed", "toolAllowed", "networkAllowed", "autoApplyAllowed", "autoRunAllowed"]) && typeof flags.boundedReplacementEditAllowed === "boolean" && flags.fileCreateAllowed === false && flags.fileDeleteAllowed === false && flags.fileRenameAllowed === false && flags.fileMoveAllowed === false && flags.chmodAllowed === false && flags.symlinkAllowed === false && flags.binaryEditAllowed === false && flags.directoryEditAllowed === false && flags.shellAllowed === false && flags.gitAllowed === false && flags.providerAllowed === false && flags.toolAllowed === false && flags.networkAllowed === false && flags.autoApplyAllowed === false && flags.autoRunAllowed === false;
        const isControlledAgentEditResultDetails = (result) => isPlainObject(result) && hasOnlyKeys(result, ["status", "cloudRequired", "privatePathExposed", "rawBodyIncluded", "rawDiffIncluded", "authority", "message", "appliedEditCount", "affectedFiles", "blockedReason"]) && ["applied", "blocked", "failed"].includes(result.status) && result.cloudRequired === false && result.privatePathExposed === false && result.rawBodyIncluded === false && result.rawDiffIncluded === false && result.authority === "bounded_replacement_edit" && safeControlledAgentEditSummary(result.message, 240) && (result.appliedEditCount === undefined || (Number.isInteger(result.appliedEditCount) && result.appliedEditCount >= 0 && result.appliedEditCount <= 16)) && (result.affectedFiles === undefined || (Array.isArray(result.affectedFiles) && result.affectedFiles.length <= 4 && result.affectedFiles.every(controlledAgentEditPath))) && (result.blockedReason === undefined || ["edit_disabled", "policy_denied", "unsafe_path", "outside_workspace", "hidden_path", "dependency_path", "generated_path", "unsupported_operation", "missing_expected_hash", "hash_mismatch", "unconfirmed_request", "assistant_minted", "budget_exceeded", "line_range_invalid"].includes(result.blockedReason));
        const isControlledAgentEditResultPayload = (payload) => isPlainObject(payload) && hasOnlyKeys(payload, ["type", "schemaVersion", "state", "authority", "cloudRequired", "controlledWorkspaceId", "runId", "runtimeSessionId", "sessionId", "workspaceReadinessId", "requestId", "requestIdMintedBy", "userConfirmed", "limits", "edits", "policyFlags", "result"]) && payload.type === "controlled_agent_edit_executor" && payload.schemaVersion === "2026-07-02" && ["applied", "blocked", "failed"].includes(payload.state) && payload.authority === "bounded_replacement_edit" && payload.cloudRequired === false && safeControlledAgentEditId(payload.controlledWorkspaceId) && safeControlledAgentEditId(payload.runId) && (payload.runtimeSessionId === undefined || safeControlledAgentEditId(payload.runtimeSessionId)) && (payload.sessionId === undefined || safeControlledAgentEditId(payload.sessionId)) && safeControlledAgentEditId(payload.workspaceReadinessId) && safeControlledAgentEditId(payload.requestId) && ["gui", "host"].includes(payload.requestIdMintedBy) && payload.userConfirmed === true && isControlledAgentEditLimits(payload.limits) && Array.isArray(payload.edits) && payload.edits.length > 0 && payload.edits.length <= 16 && payload.edits.every(isControlledAgentResultEdit) && isControlledAgentEditPolicyFlags(payload.policyFlags) && isControlledAgentEditResultDetails(payload.result) && payload.result.status === payload.state;
        const isReadBudget = (budget) => isPlainObject(budget) && hasOnlyKeys(budget, ["scope", "maxBytes", "maxLines", "allowBody", "singleFileOnly", "recursive", "globAllowed", "regexAllowed", "indexingAllowed", "budgetLabel"]) && budget.scope === "single_explicit_file" && Number.isInteger(budget.maxBytes) && budget.maxBytes >= 1 && budget.maxBytes <= 8192 && Number.isInteger(budget.maxLines) && budget.maxLines >= 1 && budget.maxLines <= 240 && typeof budget.allowBody === "boolean" && budget.singleFileOnly === true && budget.recursive === false && budget.globAllowed === false && budget.regexAllowed === false && budget.indexingAllowed === false && optionalNonEmptyString(budget.budgetLabel, 100);
        const isControlledAgentFileReadPayload = (payload) => isPlainObject(payload) && hasOnlyKeys(payload, ["kind", "version", "authority", "cloudRequired", "executionAllowed", "agentStartAllowed", "workspace", "request", "policyFlags", "result"]) && payload.kind === "controlled_agent_file_read" && payload.version === "2026-06-29" && payload.authority === "bounded_text_file_read" && payload.cloudRequired === false && payload.executionAllowed === false && payload.agentStartAllowed === false && isPlainObject(payload.workspace) && hasOnlyKeys(payload.workspace, ["controlledWorkspaceId", "runId", "workspaceMode", "host", "privatePathExposed", "workspaceLabel"]) && safeControlledFileReadId(payload.workspace.controlledWorkspaceId) && safeControlledFileReadId(payload.workspace.runId) && ["disposable", "worktree", "existing"].includes(payload.workspace.workspaceMode) && payload.workspace.host === "jetbrains" && payload.workspace.privatePathExposed === false && optionalNonEmptyString(payload.workspace.workspaceLabel, 100) && isPlainObject(payload.request) && hasOnlyKeys(payload.request, ["requestId", "source", "requestIdMintedBy", "assistantMinted", "workspaceRelativePath", "textOnly", "maxBytes", "budget", "requestedAt", "reason"]) && safeControlledFileReadId(payload.request.requestId) && ["gui", "host"].includes(payload.request.source) && ["gui", "host"].includes(payload.request.requestIdMintedBy) && payload.request.assistantMinted === false && controlledFileReadPath(payload.request.workspaceRelativePath) && payload.request.textOnly === true && Number.isInteger(payload.request.maxBytes) && payload.request.maxBytes >= 1 && payload.request.maxBytes <= 8192 && isReadBudget(payload.request.budget) && optionalNonEmptyString(payload.request.reason, 240) && isPlainObject(payload.policyFlags) && hasOnlyKeys(payload.policyFlags, ["fileReadAllowed", "fileWriteAllowed", "shellAllowed", "gitAllowed", "providerAllowed", "toolAllowed", "hiddenSearchAllowed", "indexingAllowed", "binaryReadAllowed", "symlinkAllowed", "autoStartAllowed", "autoApplyAllowed", "autoRunAllowed"]) && payload.policyFlags.fileReadAllowed === false && payload.policyFlags.fileWriteAllowed === false && payload.policyFlags.shellAllowed === false && payload.policyFlags.gitAllowed === false && payload.policyFlags.providerAllowed === false && payload.policyFlags.toolAllowed === false && payload.policyFlags.hiddenSearchAllowed === false && payload.policyFlags.indexingAllowed === false && payload.policyFlags.binaryReadAllowed === false && payload.policyFlags.symlinkAllowed === false && payload.policyFlags.autoStartAllowed === false && payload.policyFlags.autoApplyAllowed === false && payload.policyFlags.autoRunAllowed === false && isPlainObject(payload.result) && hasOnlyKeys(payload.result, ["status", "cloudRequired", "executionAllowed", "bodyIncluded", "truncated", "blockedReason", "message"]) && payload.result.status === "disabled" && payload.result.cloudRequired === false && payload.result.executionAllowed === false && payload.result.bodyIncluded === false && payload.result.truncated === false && payload.result.blockedReason === "read_disabled" && optionalNonEmptyString(payload.result.message, 240);
        const isHostRuntimeStatusPayload = (payload) => isPlainObject(payload) && hasOnlyKeys(payload, ["protocolVersion", "surface", "lifecycle", "runtimeOwner", "launchMode", "tokenState", "processState", "diagnosis", "nextAction", "cloudRequired", "authority"]) && payload.protocolVersion === "2026-06-21" && payload.surface === "jetbrains" && ["connected", "auth_mismatch", "invalid_settings", "failed", "restarting", "stopped"].includes(payload.lifecycle) && ["ide_host", "external"].includes(payload.runtimeOwner) && ["auto", "connect", "launch"].includes(payload.launchMode) && ["unknown", "not_required", "absent", "present", "mismatch", "invalid"].includes(payload.tokenState) && ["unknown", "not_owned", "running", "exited", "stopped", "failed"].includes(payload.processState) && isSafeStatusMessage(payload.diagnosis) && isSafeStatusMessage(payload.nextAction) && payload.cloudRequired === false && payload.authority === "metadata_only";
        const isHostMessage = (message) => {
          if (!isPlainObject(message) || !hasOnlyKeys(message, ["version", "type", "requestId", "payload"]) || message.version !== bridgeVersion) return false;
          if (message.type === "host.openedFromCommand") return message.requestId === undefined && (message.payload === undefined || (isPlainObject(message.payload) && Object.keys(message.payload).length === 0));
          if (!isRequestId(message.requestId)) return false;
          if (message.type === "host.ready") return isHostReadyPayload(message.payload);
          if (message.type === "host.contextSnapshot") return isContextSnapshotPayload(message.payload);
          if (message.type === "host.ideActionProgress") return isHostIdeActionProgressPayload(message.payload);
          if (message.type === "host.ideActionResult") return isHostIdeActionResultPayload(message.payload);
          if (message.type === "host.applyWorkspaceEditResult") return isHostApplyWorkspaceEditResultPayload(message.payload);
          if (message.type === "host.controlledAgentEditResult") return isControlledAgentEditResultPayload(message.payload);
          if (message.type === "host.controlledAgentFileReadResult") return isControlledAgentFileReadPayload(message.payload);
          if (message.type === "host.runtimeStatus") return message.requestId === undefined && isHostRuntimeStatusPayload(message.payload);
          return false;
        };
        const isPreReadyTerminalBlockedControlledAgentEditResult = (message) => {
          if (message.type !== "host.controlledAgentEditResult" || !isControlledAgentEditResultPayload(message.payload)) return false;
          const payload = message.payload;
          const result = payload.result;
          const flags = payload.policyFlags;
          return payload.state === "blocked" &&
            result.status === "blocked" &&
            result.appliedEditCount === 0 &&
            ["edit_disabled", "policy_denied"].includes(result.blockedReason) &&
            flags.boundedReplacementEditAllowed === false &&
            result.privatePathExposed === false &&
            result.rawBodyIncluded === false &&
            result.rawDiffIncluded === false;
        };
        const isGuiIdeActionPayload = (payload) => {
          if (!isPlainObject(payload) || typeof payload.action !== "string" || !allowedIdeActionNames.includes(payload.action)) return false;
          if (payload.action === "getContextSnapshot") return hasOnlyKeys(payload, ["action"]);
          if (payload.action === "getActiveFileExcerpt") return hasOnlyKeys(payload, ["action"]);
          if (payload.action === "openWorkspaceFile") return hasOnlyKeys(payload, ["action", "workspaceRelativePath"]) && safeRequiredWorkspacePath(payload.workspaceRelativePath);
          if (payload.action === "revealWorkspaceRange") return hasOnlyKeys(payload, ["action", "workspaceRelativePath", "range"]) && safeRequiredWorkspacePath(payload.workspaceRelativePath) && isIdeActionRange(payload.range);
          return false;
        };
        const isGuiIdeActionRequest = (message) => {
          if (!isPlainObject(message) || !hasOnlyKeys(message, ["version", "type", "requestId", "payload"]) || message.version !== bridgeVersion || message.type !== "gui.ideActionRequest" || !requiredRequestId(message.requestId)) return false;
          let serialized;
          try { serialized = JSON.stringify(message); } catch (_) { return false; }
          if (typeof serialized !== "string" || new Blob([serialized]).size > maxIdeActionRequestBytes) return false;
          return isGuiIdeActionPayload(message.payload);
        };
        const isSafeStatusMessage = (value) => typeof value === "string" && value.length > 0 && value.length <= 1000 && /^[^\u0000-\u001f\u007f-\u009f]+$/.test(value) && !/(authorization|bearer|cookie|api[_-]?key|token|secret|password|private[_-]?path|provider[_-]?response|raw[_-]?prompt|file[_-]?content|sk-(?:proj-)?[A-Za-z0-9_-]{8,})/i.test(value) && !(/\/(?:Users|Home|Tmp|Var|Etc|Opt|Mnt|Volumes|Private)(?=\/|$|[^A-Za-z0-9_])|[A-Za-z]:(?:\/|\\)|~(?:\/|\\)/i.test(value));
        const isApplyWorkspaceTextReplacement = (replacement) => isPlainObject(replacement) && hasOnlyKeys(replacement, ["range", "replacementText"]) && isIdeActionRange(replacement.range) && typeof replacement.replacementText === "string" && replacement.replacementText.length <= 8192 && /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]*$/.test(replacement.replacementText);
        const isApplyWorkspaceFileEdit = (edit) => isPlainObject(edit) && hasOnlyKeys(edit, ["workspaceRelativePath", "textReplacements"]) && safeRequiredWorkspacePath(edit.workspaceRelativePath) && Array.isArray(edit.textReplacements) && edit.textReplacements.length > 0 && edit.textReplacements.length <= 16 && edit.textReplacements.every(isApplyWorkspaceTextReplacement);
        const isGuiApplyWorkspaceEditRequest = (message) => {
          if (!isPlainObject(message) || !hasOnlyKeys(message, ["version", "type", "requestId", "payload"]) || message.version !== bridgeVersion || message.type !== "gui.applyWorkspaceEditRequest" || !requiredRequestId(message.requestId)) return false;
          let serialized;
          try { serialized = JSON.stringify(message); } catch (_) { return false; }
          if (typeof serialized !== "string" || new Blob([serialized]).size > maxApplyWorkspaceEditRequestBytes) return false;
          const payload = message.payload;
          if (!isPlainObject(payload) || !hasOnlyKeys(payload, ["requiresUserConfirmation", "summary", "cloudRequired", "edits"]) || payload.requiresUserConfirmation !== true || (payload.cloudRequired !== undefined && payload.cloudRequired !== false) || !isSafeStatusMessage(payload.summary) || !Array.isArray(payload.edits) || payload.edits.length === 0 || payload.edits.length > 4 || !payload.edits.every(isApplyWorkspaceFileEdit)) return false;
          const seen = new Set();
          let replacementTextLength = 0;
          for (const edit of payload.edits) {
            if (seen.has(edit.workspaceRelativePath)) return false;
            seen.add(edit.workspaceRelativePath);
            for (const replacement of edit.textReplacements) replacementTextLength += replacement.replacementText.length;
          }
          return replacementTextLength <= 32768;
        };
        const isControlledAgentReplacementEdit = (edit) => {
          if (!isPlainObject(edit) || !hasOnlyKeys(edit, ["operation", "workspaceRelativePath", "fileLabel", "expectedContentHash", "startLine", "endLine", "replacementText", "replacementByteCount", "sanitizedSummary"]) || edit.operation !== "replace" || !controlledAgentEditPath(edit.workspaceRelativePath) || !safeControlledAgentEditSummary(edit.fileLabel, 160) || !sha256Hash(edit.expectedContentHash) || !Number.isInteger(edit.startLine) || edit.startLine < 1 || edit.startLine > 1000000 || !Number.isInteger(edit.endLine) || edit.endLine < edit.startLine || edit.endLine > 1000000 || typeof edit.replacementText !== "string" || edit.replacementText.length > 12000 || !/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]*$/.test(edit.replacementText) || !Number.isInteger(edit.replacementByteCount) || edit.replacementByteCount < 0 || edit.replacementByteCount > 12000 || !safeControlledAgentEditSummary(edit.sanitizedSummary, 240)) return false;
          return new Blob([edit.replacementText]).size === edit.replacementByteCount;
        };
        const isRecoverableGuiControlledAgentEditEnvelope = (message) => {
          if (!isPlainObject(message) || !hasOnlyKeys(message, ["version", "type", "requestId", "payload"]) || message.version !== bridgeVersion || message.type !== "gui.controlledAgentEditRequest" || !requiredRequestId(message.requestId)) return false;
          let serialized;
          try { serialized = JSON.stringify(message); } catch (_) { return false; }
          return typeof serialized === "string" && new Blob([serialized]).size <= maxControlledAgentEditRequestBytes;
        };
        const isGuiControlledAgentEditRequest = (message) => {
          if (!isPlainObject(message) || !hasOnlyKeys(message, ["version", "type", "requestId", "payload"]) || message.version !== bridgeVersion || message.type !== "gui.controlledAgentEditRequest" || !requiredRequestId(message.requestId)) return false;
          let serialized;
          try { serialized = JSON.stringify(message); } catch (_) { return false; }
          if (typeof serialized !== "string" || new Blob([serialized]).size > maxControlledAgentEditRequestBytes) return false;
          const payload = message.payload;
          if (!isPlainObject(payload) || !hasOnlyKeys(payload, ["requestId", "requestIdMintedBy", "source", "assistantMinted", "controlledWorkspaceId", "runId", "runtimeSessionId", "sessionId", "workspaceReadinessId", "userConfirmed", "limits", "edits"]) || payload.requestId !== message.requestId || !safeControlledAgentEditId(payload.requestId) || payload.requestIdMintedBy !== "gui" || payload.source !== "gui" || payload.assistantMinted !== false || !safeControlledAgentEditId(payload.controlledWorkspaceId) || !safeControlledAgentEditId(payload.runId) || (payload.runtimeSessionId !== undefined && !safeControlledAgentEditId(payload.runtimeSessionId)) || (payload.sessionId !== undefined && !safeControlledAgentEditId(payload.sessionId)) || !safeControlledAgentEditId(payload.workspaceReadinessId) || payload.userConfirmed !== true || !isControlledAgentEditLimits(payload.limits) || !Array.isArray(payload.edits) || payload.edits.length === 0 || payload.edits.length > payload.limits.maxEdits || payload.edits.length > 16 || !payload.edits.every(isControlledAgentReplacementEdit)) return false;
          const seen = new Set();
          let replacementByteCount = 0;
          for (const edit of payload.edits) {
            if (seen.has(edit.workspaceRelativePath)) return false;
            seen.add(edit.workspaceRelativePath);
            replacementByteCount += edit.replacementByteCount;
          }
          return seen.size <= payload.limits.maxFiles && replacementByteCount <= payload.limits.maxPatchBytes && replacementByteCount <= 12000;
        };
        const isGuiControlledFileReadRequest = (message) => {
          if (!isPlainObject(message) || !hasOnlyKeys(message, ["version", "type", "requestId", "payload"]) || message.version !== bridgeVersion || message.type !== "gui.controlledAgentFileReadRequest" || !requiredRequestId(message.requestId)) return false;
          let serialized;
          try { serialized = JSON.stringify(message); } catch (_) { return false; }
          if (typeof serialized !== "string" || new Blob([serialized]).size > maxControlledFileReadRequestBytes) return false;
          const payload = message.payload;
          return isPlainObject(payload) && hasOnlyKeys(payload, ["requestIdMintedBy", "source", "assistantMinted", "controlledWorkspaceId", "runId", "runtimeSessionId", "sessionId", "workspaceRelativePath", "maxBytes", "maxLines", "allowBody", "singleFileOnly", "recursive", "globAllowed", "regexAllowed", "indexingAllowed"]) && ["gui", "host"].includes(payload.requestIdMintedBy) && ["gui", "host"].includes(payload.source) && payload.assistantMinted === false && safeControlledFileReadId(payload.controlledWorkspaceId) && safeControlledFileReadId(payload.runId) && (payload.runtimeSessionId === undefined || safeControlledFileReadId(payload.runtimeSessionId)) && (payload.sessionId === undefined || safeControlledFileReadId(payload.sessionId)) && controlledFileReadPath(payload.workspaceRelativePath) && Number.isInteger(payload.maxBytes) && payload.maxBytes >= 1 && payload.maxBytes <= 8192 && Number.isInteger(payload.maxLines) && payload.maxLines >= 1 && payload.maxLines <= 240 && typeof payload.allowBody === "boolean" && payload.singleFileOnly === true && payload.recursive === false && payload.globAllowed === false && payload.regexAllowed === false && payload.indexingAllowed === false;
        };
        const isGuiRuntimeRefresh = (message) => {
          if (!isPlainObject(message) || !hasOnlyKeys(message, ["version", "type", "requestId", "payload"]) || message.version !== bridgeVersion || message.type !== "gui.runtimeRefresh" || !requiredRequestId(message.requestId)) return false;
          return isPlainObject(message.payload) && Object.keys(message.payload).length === 0;
        };
        const isGuiMessage = (message) => {
          if (!isPlainObject(message) || !hasOnlyKeys(message, ["version", "type", "requestId", "payload"]) || message.version !== bridgeVersion || message.type !== "gui.ready" || !isRequestId(message.requestId)) return false;
          return isPlainObject(message.payload) && hasOnlyKeys(message.payload, ["supportedBridgeVersion", "frameNonce"]) && (message.payload.supportedBridgeVersion === undefined || message.payload.supportedBridgeVersion === bridgeVersion) && isFrameNonce(currentFrameNonce) && isFrameNonce(message.payload.frameNonce) && message.payload.frameNonce === currentFrameNonce;
        };
        const currentReadyRequestId = () => currentGuiReadyRequestId;
        const randomToken = () => {
          if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== "function") return undefined;
          const bytes = new Uint8Array(16);
          globalThis.crypto.getRandomValues(bytes);
          return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
        };
        const wrapperReadyRequestId = (sequence) => {
          const token = randomToken();
          return token === undefined ? undefined : "gui-ready-" + frameGeneration + "-" + sequence + "-" + token;
        };
        const newFrameNonce = () => randomToken();
        const sendFrameNonceChallenge = () => {
          if (frameReady || !frame || !currentFrameWindow || frame.contentWindow !== currentFrameWindow || !frameTargetOrigin || !isFrameNonce(currentFrameNonce)) return;
          currentFrameWindow.postMessage({ version: bridgeVersion, type: "host.frameNonce", payload: { frameNonce: currentFrameNonce } }, frameTargetOrigin);
          frameNonceChallengeAttempts += 1;
          if (!frameReady && frameNonceChallengeAttempts < 20) {
            window.setTimeout(sendFrameNonceChallenge, 50);
          }
        };
        const showRandomnessDiagnostic = () => {
          showDiagnostic("Secure browser randomness is unavailable. Yet AI cannot authorize the embedded GUI bridge until the shell is reloaded in a secure context.");
        };
        const resetFrameNonceChallenge = () => {
          currentFrameNonce = newFrameNonce();
          frameNonceChallengeAttempts = 0;
          if (currentFrameNonce === undefined) {
            console.log("Yet AI cannot create frame nonce because secure wrapper randomness is unavailable");
            showRandomnessDiagnostic();
            return;
          }
          sendFrameNonceChallenge();
        };
        const invalidateFrameAuthority = (reason) => {
          clearReadinessFallbackTimer();
          frameLoaded = false;
          frameReady = false;
          currentGuiReadySequence = 0;
          currentGuiReadyRequestId = undefined;
          acceptedHostReadyRequestId = undefined;
          hostReadyAcceptedForCurrentFrame = false;
          currentFrameNonce = undefined;
          pendingHostMessages.length = 0;
        };
        const isGuiUnloadedMessage = (message) => isPlainObject(message) && hasOnlyKeys(message, ["version", "type", "payload"]) && message.version === bridgeVersion && message.type === "gui.unloaded" && isPlainObject(message.payload) && Object.keys(message.payload).length === 0;
        const messageMatchesCurrentReady = (message) => frameReady && currentGuiReadySequence === guiReadySequence && message.requestId === currentReadyRequestId();
        const canDeliverHostMessage = (message) => {
          if (message.type === "host.controlledAgentEditResult" && !frameReady) return isPreReadyTerminalBlockedControlledAgentEditResult(message);
          if (message.type === "host.ideActionProgress" || message.type === "host.ideActionResult" || message.type === "host.applyWorkspaceEditResult" || message.type === "host.controlledAgentEditResult" || message.type === "host.controlledAgentFileReadResult") return frameReady && hostReadyAcceptedForCurrentFrame && acceptedHostReadyRequestId === currentReadyRequestId();
          if (message.type === "host.openedFromCommand") return frameReady && hostReadyAcceptedForCurrentFrame && acceptedHostReadyRequestId === currentReadyRequestId() && message.requestId === undefined;
          if (message.type === "host.runtimeStatus") return frameReady && message.requestId === undefined;
          if (!messageMatchesCurrentReady(message)) return false;
          if (message.type === "host.ready") return true;
          return hostReadyAcceptedForCurrentFrame && acceptedHostReadyRequestId === currentReadyRequestId();
        };
        const postToFrame = (message) => {
          if (frame && currentFrameWindow && frame.contentWindow === currentFrameWindow && frameTargetOrigin && isHostMessage(message) && canDeliverHostMessage(message)) {
            currentFrameWindow.postMessage(message, frameTargetOrigin);
            if (message.type === "host.ready") {
              acceptedHostReadyRequestId = message.requestId;
              hostReadyAcceptedForCurrentFrame = true;
            }
          }
        };
        const flushPending = () => {
          while (pendingDiagnostics.length > 0) showDiagnostic(pendingDiagnostics.shift());
          const hostMessages = pendingHostMessages.splice(0, pendingHostMessages.length);
          for (const message of hostMessages) postToFrame(message);
        };
        const sendToFrame = (message) => {
          if (!isHostMessage(message)) return;
          if (!frameReady && !isPreReadyTerminalBlockedControlledAgentEditResult(message)) {
            pushBounded(pendingHostMessages, message, maxPendingHostMessages);
            return;
          }
          postToFrame(message);
        };
        window.__yetAiSendHostMessageToFrame = sendToFrame;
        window.addEventListener("message", (event) => {
          if (event.source === currentFrameWindow && event.source === frame?.contentWindow) {
            if (frameTargetOrigin && frameTargetOrigin !== "*" && event.origin !== frameTargetOrigin) {
              console.log("Yet AI rejected iframe message from unexpected origin");
              return;
            }
            if (isGuiUnloadedMessage(event.data)) {
              invalidateFrameAuthority("gui.unloaded");
              armReadinessFallbackTimer(frameGeneration);
              window.postIntellijMessage(event.data);
            } else if (isGuiRuntimeRefresh(event.data)) {
              if (!frameReady) {
                console.log("Yet AI rejected runtime refresh before current GUI ready handshake");
                return;
              }
              window.postIntellijMessage(event.data);
            } else if (isGuiIdeActionRequest(event.data)) {
              if (!frameReady || !hostReadyAcceptedForCurrentFrame || acceptedHostReadyRequestId !== currentReadyRequestId()) {
                console.log("Yet AI rejected IDE action request before GUI bridge readiness");
                return;
              }
              window.postIntellijMessage(event.data);
            } else if (isGuiApplyWorkspaceEditRequest(event.data)) {
              if (!frameReady || !hostReadyAcceptedForCurrentFrame || acceptedHostReadyRequestId !== currentReadyRequestId()) {
                console.log("Yet AI rejected apply workspace edit request before GUI bridge readiness");
                return;
              }
              window.postIntellijMessage(event.data);
            } else if (isGuiControlledAgentEditRequest(event.data)) {
              if (!frameReady || !hostReadyAcceptedForCurrentFrame || acceptedHostReadyRequestId !== currentReadyRequestId()) {
                window.postIntellijMessage(event.data);
                return;
              }
              window.postIntellijMessage(event.data);
            } else if (isGuiControlledFileReadRequest(event.data)) {
              if (!frameReady || !hostReadyAcceptedForCurrentFrame || acceptedHostReadyRequestId !== currentReadyRequestId()) {
                console.log("Yet AI rejected controlled file read request before GUI bridge readiness");
                return;
              }
              window.postIntellijMessage(event.data);
            } else if (isRecoverableGuiControlledAgentEditEnvelope(event.data)) {
              if (!frameReady || !hostReadyAcceptedForCurrentFrame || acceptedHostReadyRequestId !== currentReadyRequestId()) {
                window.postIntellijMessage(event.data);
                return;
              }
              console.log("Yet AI rejected invalid controlled edit request after GUI bridge readiness");
            } else if (isGuiMessage(event.data)) {
              if (frameReady && event.data.payload.frameNonce === currentFrameNonce) return;
              const nextGuiReadySequence = guiReadySequence + 1;
              const nextGuiReadyRequestId = wrapperReadyRequestId(nextGuiReadySequence);
              if (nextGuiReadyRequestId === undefined) {
                console.log("Yet AI rejected gui.ready because secure wrapper randomness is unavailable");
                showRandomnessDiagnostic();
                return;
              }
              frameReady = true;
              clearReadinessFallbackTimer();
              console.log("Yet AI received validated gui.ready from current iframe");
              hideShellAfterReady();
              if (latestShellRuntimeCopyPayload !== undefined) applyShellRuntimeCopy(latestShellRuntimeCopyPayload);
              guiReadySequence = nextGuiReadySequence;
              currentGuiReadySequence = nextGuiReadySequence;
              currentGuiReadyRequestId = nextGuiReadyRequestId;
              const readyMessage = { ...event.data, requestId: currentGuiReadyRequestId, payload: { supportedBridgeVersion: event.data.payload?.supportedBridgeVersion } };
              acceptedHostReadyRequestId = undefined;
              hostReadyAcceptedForCurrentFrame = false;
              flushPending();
              window.postIntellijMessage(readyMessage);
            } else {
              console.log("Yet AI rejected invalid iframe GUI bridge message");
            }
            return;
          }
        });
        if (frame) {
          frame.addEventListener("load", () => {
            invalidateFrameAuthority("frame.load");
            frameGeneration += 1;
            currentFrameWindow = frame.contentWindow;
            window.postIntellijMessage({ version: bridgeVersion, type: "gui.unloaded", payload: {} });
            markFrameLoaded();
            armReadinessFallbackTimer(frameGeneration);
            resetFrameNonceChallenge();
          });
        }
        </script>
        </body>
        </html>
    """.trimIndent()
}

fun buildGuiFrame(guiDevUrl: String?, packagedGui: PackagedGui?): String = when {
    guiDevUrl != null -> "<iframe title=\"Yet AI GUI\" src=\"${html(guiDevUrl)}\"></iframe>"
    packagedGui != null -> "<iframe title=\"Yet AI GUI\" src=\"${html(packagedGui.indexUrl)}\"></iframe>"
    else -> ""
}

fun buildFrameOrigin(guiDevUrl: String?, packagedGui: PackagedGui?): String = when {
    guiDevUrl != null -> "\"${html(loopbackOrigin(guiDevUrl))}\""
    packagedGui != null -> "\"${html(packagedGui.origin)}\""
    else -> "undefined"
}

internal fun isGuiUnloadedBridgeMessage(raw: String): Boolean {
    val element = try {
        JsonParser.parseString(raw)
    } catch (_: RuntimeException) {
        return false
    }
    if (!element.isJsonObject) return false
    val record = element.asJsonObject
    if (!record.keySet().all { it in setOf("version", "type", "payload") }) return false
    if (record.stringValue("version") != ProductIdentity.bridgeVersion) return false
    if (record.stringValue("type") != "gui.unloaded") return false
    val payload = record.get("payload") ?: return false
    return payload.isJsonObject && payload.asJsonObject.keySet().isEmpty()
}

private fun com.google.gson.JsonObject.stringValue(name: String): String? {
    val element = get(name) ?: return null
    if (!element.isJsonPrimitive || !element.asJsonPrimitive.isString) return null
    return element.asString
}

private fun html(value: String): String = value
    .replace("&", "&amp;")
    .replace("<", "&lt;")
    .replace(">", "&gt;")
    .replace("\"", "&quot;")
