package ai.yet.plugin.ui

import ai.yet.plugin.bridge.BridgeMessages
import ai.yet.plugin.bridge.ActiveEditorContext
import ai.yet.plugin.identity.ProductIdentity
import ai.yet.plugin.runtime.RuntimeConnectionManager
import ai.yet.plugin.runtime.RuntimeConnectionResult
import ai.yet.plugin.runtime.RuntimeSettings
import ai.yet.plugin.runtime.loopbackOrigin
import com.google.gson.JsonParser
import com.google.gson.JsonPrimitive
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory
import com.intellij.ui.jcef.JBCefApp
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefJSQuery
import java.awt.BorderLayout
import java.net.URI
import java.nio.file.Path
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
          window.__yetAiPendingHostMessages = Array.isArray(window.__yetAiPendingHostMessages) ? window.__yetAiPendingHostMessages : [];
          window.__yetAiPendingHostMessages.push(message);
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
              window.__yetAiPendingDiagnostics = Array.isArray(window.__yetAiPendingDiagnostics) ? window.__yetAiPendingDiagnostics : [];
              window.__yetAiPendingDiagnostics.push(message);
            })();
        """.trimIndent()
    }
}

class YetToolWindowFactory : ToolWindowFactory {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val contentFactory = ContentFactory.getInstance()
        val component = if (JBCefApp.isSupported()) {
            YetBrowserPanel(project)
        } else {
            JPanel(BorderLayout()).apply {
                add(JLabel("Yet AI requires JCEF support to host the GUI shell."), BorderLayout.CENTER)
            }
        }
        val content = contentFactory.createContent(component, ProductIdentity.pluginName, false)
        if (component is Disposable) {
            Disposer.register(content, component)
        }
        toolWindow.contentManager.addContent(content)
    }
}

class YetBrowserPanel(private val project: Project) : JPanel(BorderLayout()), Disposable {
    private val logger = Logger.getInstance(YetBrowserPanel::class.java)
    private val browser = JBCefBrowser()
    private val query = JBCefJSQuery.create(browser as JBCefBrowser)
    private val delivery = WrapperScriptDelivery()
    @Volatile
    private var latestConnection = RuntimeConnectionResult(RuntimeSettings.safeFallback(), "Connecting to Yet AI local runtime...", null)
    @Volatile
    private var guiReadyRequestId: String? = null
    @Volatile
    private var disposed = false

    init {
        add(browser.component, BorderLayout.CENTER)
        query.addHandler { raw ->
            if (isGuiUnloaded(raw)) {
                guiReadyRequestId = null
                return@addHandler null
            }
            val guiReady = BridgeMessages.parseGuiReady(raw)
            if (guiReady == null) {
                logger.info("Yet AI rejected invalid GUI bridge message")
                return@addHandler null
            }
            logger.info("Yet AI received gui.ready")
            val requestId = guiReady.requestId
            guiReadyRequestId = requestId
            deliverReadyMessages(latestConnection.settings, requestId)
            null
        }
        val initialSettings = initialSettings()
        latestConnection = RuntimeConnectionResult(initialSettings, "Connecting to Yet AI local runtime...", null)
        val packagedGui = if (initialSettings.guiDevUrl == null) PackagedGuiServer.getInstance().start() else null
        val postIntellij = query.inject("JSON.stringify(message)", "function(error) { console.log('Yet AI bridge send failed'); }", "function(response) {}")
        browser.loadHTML(renderHtml(latestConnection, postIntellij, packagedGui))
        ApplicationManager.getApplication().executeOnPooledThread {
            val connection = RuntimeConnectionManager.getInstance().prepare()
            latestConnection = connection
            ApplicationManager.getApplication().invokeLater {
                if (!disposed) {
                    guiReadyRequestId?.let { requestId -> deliverReadyMessages(connection.settings, requestId) }
                    connection.error?.let { error -> sendDiagnostic(error) }
                }
            }
        }
    }

    private fun isGuiUnloaded(raw: String): Boolean {
        val element = try {
            JsonParser.parseString(raw)
        } catch (_: RuntimeException) {
            return false
        }
        if (!element.isJsonObject) return false
        val record = element.asJsonObject
        return record.keySet().all { it in setOf("version", "type", "payload") } &&
            record.stringValue("version") == ProductIdentity.bridgeVersion &&
            record.stringValue("type") == "gui.unloaded"
    }

    private fun deliverReadyMessages(settings: RuntimeSettings, requestId: String?) {
        JetBrainsReadyMessageDelivery.deliver(
            settings = settings,
            requestId = requestId,
            send = ::sendToGui,
            contextSupplier = { ActiveEditorContextCollector.snapshot(project) },
            logContextStatus = { logger.info(it) },
        )
    }

    private fun sendToGui(message: String) {
        if (disposed) return
        browser.cefBrowser.executeJavaScript(delivery.hostMessage(message), browser.cefBrowser.url, 0)
    }

    private fun sendDiagnostic(error: String) {
        if (disposed) return
        browser.cefBrowser.executeJavaScript(delivery.diagnostic(error), browser.cefBrowser.url, 0)
    }

    override fun dispose() {
        disposed = true
        query.dispose()
        browser.dispose()
    }

    private fun initialSettings(): RuntimeSettings = try {
        RuntimeSettings.current()
    } catch (_: Exception) {
        RuntimeSettings.safeFallback()
    }
}

object JetBrainsReadyMessageDelivery {
    fun deliver(
        settings: RuntimeSettings,
        requestId: String?,
        send: (String) -> Unit,
        contextSupplier: () -> ActiveEditorContext.Snapshot?,
        logContextStatus: (String) -> Unit,
    ) {
        if (!isValidRuntimeUrl(settings.runtimeUrl)) {
            logContextStatus("Yet AI rejected invalid runtime URL for GUI bridge ready batch")
            return
        }
        send(BridgeMessages.hostReady(settings, requestId))
        send(BridgeMessages.openedFromCommand(requestId))
        val snapshot = try {
            contextSupplier()
        } catch (_: Exception) {
            logContextStatus("Yet AI active editor context collection failed")
            null
        }
        if (snapshot != null) {
            send(BridgeMessages.contextSnapshot(snapshot, requestId))
        }
    }

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
            uri.rawQuery == null &&
            uri.rawFragment == null &&
            (path.isEmpty() || path == "/")
    }
}

object ActiveEditorContextCollector {
    fun snapshot(project: Project): ActiveEditorContext.Snapshot? = ApplicationManager.getApplication().runReadAction<ActiveEditorContext.Snapshot?> {
        val editor = FileEditorManager.getInstance(project).selectedTextEditor ?: return@runReadAction null
        val virtualFile = FileDocumentManager.getInstance().getFile(editor.document)
        val workspaceRelativePath = virtualFile?.let { workspaceRelativePath(project, it.path) }
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

    private fun workspaceRelativePath(project: Project, filePath: String): String? = try {
        val basePath = project.basePath ?: return null
        val base = Path.of(basePath).normalize()
        val file = Path.of(filePath).normalize()
        if (!file.startsWith(base)) {
            null
        } else {
            base.relativize(file).joinToString("/") { it.toString() }
        }
    } catch (_: Exception) {
        null
    }
}

fun renderHtml(connection: RuntimeConnectionResult, postIntellij: String, packagedGui: PackagedGui?): String {
    val settings = connection.settings
    val frame = buildGuiFrame(settings.guiDevUrl, packagedGui)
    val frameOrigin = buildFrameOrigin(settings.guiDevUrl, packagedGui)
    val status = connection.status?.let { "<p>${html(it)}</p>" } ?: ""
    val error = connection.error?.let { "<p><strong>Runtime error:</strong> ${html(it)}</p>" } ?: ""
    val placeholder = if (settings.guiDevUrl == null && packagedGui == null) {
        "<main><h1>Yet AI</h1>$status$error<p>Runtime: <code>${html(settings.runtimeUrl)}</code></p><p>Run <code>cd apps/gui && npm run build</code> before <code>cd apps/plugins/jetbrains && gradle build --console=plain</code> to package the GUI, or set the GUI dev URL to a loopback Vite server during development.</p></main>"
    } else {
        ""
    }
    val diagnostics = packagedGui?.let {
        "<div id=\"yet-ai-shell-status\" role=\"status\">Loading packaged Yet AI GUI from <code>${html(it.indexUrl)}</code> with origin <code>${html(it.origin)}</code>. ${html(connection.status ?: "Connecting to Yet AI local runtime...")}</div><div id=\"yet-ai-shell-fallback\" role=\"alert\" hidden>Packaged Yet AI GUI did not finish loading from the local loopback server. Reinstall the latest ZIP or rebuild with <code>npm run prepare:jetbrains-preview</code>.</div>"
    } ?: "<div id=\"yet-ai-shell-status\" role=\"status\">${html(connection.status ?: "Connecting to Yet AI local runtime...")}</div>"
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
        const pendingHostMessages = Array.isArray(window.__yetAiPendingHostMessages) ? window.__yetAiPendingHostMessages : [];
        const pendingDiagnostics = Array.isArray(window.__yetAiPendingDiagnostics) ? window.__yetAiPendingDiagnostics : [];
        window.__yetAiPendingHostMessages = pendingHostMessages;
        window.__yetAiPendingDiagnostics = pendingDiagnostics;
        const showDiagnostic = (message) => {
          if (shellStatus && typeof message === "string") {
            shellStatus.hidden = false;
            shellStatus.textContent = `Runtime error: ${'$'}{message}`;
          }
        };
        window.__yetAiSetRuntimeDiagnostic = (message) => {
          if (!frameReady) {
            pendingDiagnostics.push(message);
            return;
          }
          showDiagnostic(message);
        };
        const markLoaded = () => {
          frameLoaded = true;
          if (shellStatus) shellStatus.hidden = true;
          if (shellFallback) shellFallback.hidden = true;
        };
        if (shellFallback && frame) {
          window.setTimeout(() => {
            if (!frameLoaded) shellFallback.hidden = false;
          }, 8000);
        }
        window.postIntellijMessage = (message) => { $postIntellij };
        const isPlainObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
        const hasOnlyKeys = (record, keys) => Object.keys(record).every((key) => keys.includes(key));
        const isRequestId = (value) => value === undefined || (typeof value === "string" && value.length > 0 && value.length <= 128 && value.split("").every((char) => char >= " " && char.charCodeAt(0) !== 127));
        const isFrameNonce = (value) => typeof value === "string" && /^[0-9a-f]{32}$/.test(value);
        const optionalString = (value, maxLength) => value === undefined || (typeof value === "string" && value.length <= maxLength);
        const optionalNonEmptyString = (value, maxLength) => value === undefined || (typeof value === "string" && value.length > 0 && value.length <= maxLength);
        const requiredLoopbackRuntimeUrl = (value) => {
          if (typeof value !== "string" || value.length === 0 || value.length > 2048) return false;
          try {
            const parsed = new URL(value);
            const hostname = parsed.hostname.toLowerCase();
            const isLoopback = hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]";
            return (parsed.protocol === "http:" || parsed.protocol === "https:") && isLoopback && parsed.username === "" && parsed.password === "" && parsed.search === "" && parsed.hash === "" && (parsed.pathname === "" || parsed.pathname === "/");
          } catch (_) {
            return false;
          }
        };
        const optionalNumber = (value) => value === undefined || (Number.isInteger(value) && value >= 0 && value <= 1000000);
        const safePath = (value, maxLength) => value === undefined || (typeof value === "string" && value.length > 0 && value.length <= maxLength && !value.startsWith("/") && !value.startsWith("~") && !value.includes("\\") && !value.includes(":") && /^[^\u0000-\u001f]+$/.test(value) && value.split("/").every((part) => part !== "." && part !== ".."));
        const isContextFile = (file) => file === undefined || (isPlainObject(file) && hasOnlyKeys(file, ["displayPath", "workspaceRelativePath", "languageId"]) && Object.keys(file).length > 0 && safePath(file.displayPath, 256) && safePath(file.workspaceRelativePath, 512) && (file.languageId === undefined || (typeof file.languageId === "string" && file.languageId.length > 0 && file.languageId.length <= 64 && /^[A-Za-z0-9_.+-]+$/.test(file.languageId))));
        const isContextSelection = (selection) => selection === undefined || (isPlainObject(selection) && hasOnlyKeys(selection, ["startLine", "startCharacter", "endLine", "endCharacter", "text"]) && Object.keys(selection).length > 0 && optionalNumber(selection.startLine) && optionalNumber(selection.startCharacter) && optionalNumber(selection.endLine) && optionalNumber(selection.endCharacter) && optionalString(selection.text, 8000));
        const isContextSnapshotPayload = (payload) => isPlainObject(payload) && hasOnlyKeys(payload, ["kind", "source", "file", "selection"]) && payload.kind === "active_editor" && (payload.source === "vscode" || payload.source === "jetbrains" || payload.source === "browser") && isContextFile(payload.file) && isContextSelection(payload.selection);
        const isHostReadyPayload = (payload) => isPlainObject(payload) && hasOnlyKeys(payload, ["runtimeUrl", "sessionToken", "productId", "displayName", "cloudRequired"]) && requiredLoopbackRuntimeUrl(payload.runtimeUrl) && optionalString(payload.sessionToken, 4096) && optionalNonEmptyString(payload.productId, 256) && optionalNonEmptyString(payload.displayName, 256) && (payload.cloudRequired === undefined || payload.cloudRequired === false);
        const isHostMessage = (message) => {
          if (!isPlainObject(message) || !hasOnlyKeys(message, ["version", "type", "requestId", "payload"]) || message.version !== bridgeVersion || !isRequestId(message.requestId)) return false;
          if (message.type === "host.ready") return isHostReadyPayload(message.payload);
          if (message.type === "host.contextSnapshot") return isContextSnapshotPayload(message.payload);
          if (message.type === "host.openedFromCommand") return message.payload === undefined || (isPlainObject(message.payload) && Object.keys(message.payload).length === 0);
          return false;
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
        const resetFrameNonceChallenge = () => {
          currentFrameNonce = newFrameNonce();
          frameNonceChallengeAttempts = 0;
          if (currentFrameNonce === undefined) {
            console.log("Yet AI cannot create frame nonce because secure wrapper randomness is unavailable");
            return;
          }
          sendFrameNonceChallenge();
        };
        const invalidateFrameAuthority = (reason) => {
          frameReady = false;
          currentGuiReadySequence = 0;
          currentGuiReadyRequestId = undefined;
          acceptedHostReadyRequestId = undefined;
          hostReadyAcceptedForCurrentFrame = false;
          currentFrameNonce = undefined;
          pendingHostMessages.length = 0;
        };
        const isGuiUnloadedMessage = (message) => isPlainObject(message) && hasOnlyKeys(message, ["version", "type", "payload"]) && message.version === bridgeVersion && message.type === "gui.unloaded" && (message.payload === undefined || (isPlainObject(message.payload) && Object.keys(message.payload).length === 0));
        const messageMatchesCurrentReady = (message) => frameReady && currentGuiReadySequence === guiReadySequence && message.requestId === currentReadyRequestId();
        const canDeliverHostMessage = (message) => {
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
          pendingHostMessages.length = 0;
        };
        const sendToFrame = (message) => {
          if (!isHostMessage(message)) return;
          if (!frameReady) return;
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
              window.postIntellijMessage(event.data);
            } else if (isGuiMessage(event.data)) {
              if (frameReady && event.data.payload.frameNonce === currentFrameNonce) return;
              const nextGuiReadySequence = guiReadySequence + 1;
              const nextGuiReadyRequestId = wrapperReadyRequestId(nextGuiReadySequence);
              if (nextGuiReadyRequestId === undefined) {
                console.log("Yet AI rejected gui.ready because secure wrapper randomness is unavailable");
                return;
              }
              frameReady = true;
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
            markLoaded();
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
