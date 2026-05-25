package ai.yet.plugin.ui

import ai.yet.plugin.bridge.BridgeMessages
import ai.yet.plugin.identity.ProductIdentity
import ai.yet.plugin.runtime.RuntimeConnectionManager
import ai.yet.plugin.runtime.RuntimeConnectionResult
import ai.yet.plugin.runtime.RuntimeSettings
import ai.yet.plugin.runtime.loopbackOrigin
import com.google.gson.JsonPrimitive
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory
import com.intellij.ui.jcef.JBCefApp
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefJSQuery
import java.awt.BorderLayout
import javax.swing.JLabel
import javax.swing.JPanel

class YetToolWindowFactory : ToolWindowFactory {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val contentFactory = ContentFactory.getInstance()
        val component = if (JBCefApp.isSupported()) {
            YetBrowserPanel()
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

class YetBrowserPanel : JPanel(BorderLayout()), Disposable {
    private val logger = Logger.getInstance(YetBrowserPanel::class.java)
    private val browser = JBCefBrowser()
    private val query = JBCefJSQuery.create(browser as JBCefBrowser)
    @Volatile
    private var latestConnection = RuntimeConnectionResult(RuntimeSettings.safeFallback(), "Connecting to Yet AI local runtime...", null)

    init {
        add(browser.component, BorderLayout.CENTER)
        query.addHandler { raw ->
            val guiReady = BridgeMessages.parseGuiReady(raw)
            if (guiReady == null) {
                logger.info("Yet AI rejected invalid GUI bridge message")
                return@addHandler null
            }
            logger.info("Yet AI received gui.ready")
            sendToGui(BridgeMessages.hostReady(latestConnection.settings, guiReady.requestId))
            sendToGui(BridgeMessages.openedFromCommand())
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
                sendToGui(BridgeMessages.hostReady(connection.settings, "jb-runtime-ready"))
                sendToGui(BridgeMessages.openedFromCommand())
                connection.error?.let { error -> sendDiagnostic(error) }
            }
        }
    }

    private fun sendToGui(message: String) {
        browser.cefBrowser.executeJavaScript("window.__yetAiSendHostMessageToFrame?.($message);", browser.cefBrowser.url, 0)
    }

    private fun sendDiagnostic(error: String) {
        val escaped = BridgeMessages.escapeScriptJson(JsonPrimitive(error).toString())
        browser.cefBrowser.executeJavaScript("window.__yetAiSetRuntimeDiagnostic?.($escaped);", browser.cefBrowser.url, 0)
    }

    override fun dispose() {
        query.dispose()
        browser.dispose()
    }

    private fun initialSettings(): RuntimeSettings = try {
        RuntimeSettings.current()
    } catch (_: Exception) {
        RuntimeSettings.safeFallback()
    }
}

fun renderHtml(connection: RuntimeConnectionResult, postIntellij: String, packagedGui: PackagedGui?): String {
    val settings = connection.settings
    val requestId = "jb-${System.currentTimeMillis()}"
    val frame = buildGuiFrame(settings.guiDevUrl, packagedGui)
    val frameOrigin = buildFrameOrigin(settings.guiDevUrl, packagedGui)
    val bootstrap = BridgeMessages.escapeScriptJson(
        BridgeMessages.hostReady(settings, requestId)
    )
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
        const bootstrapHostReady = $bootstrap;
        const bridgeVersion = "${ProductIdentity.bridgeVersion}";
        const frame = document.querySelector("iframe");
        const frameTargetOrigin = $frameOrigin;
        const shellStatus = document.getElementById("yet-ai-shell-status");
        const shellFallback = document.getElementById("yet-ai-shell-fallback");
        let frameLoaded = false;
        window.__yetAiSetRuntimeDiagnostic = (message) => {
          if (shellStatus && typeof message === "string") {
            shellStatus.hidden = false;
            shellStatus.textContent = `Runtime error: ${'$'}{message}`;
          }
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
        const sendToFrame = (message) => {
          if (frame && frame.contentWindow && frameTargetOrigin && isHostMessage(message)) {
            frame.contentWindow.postMessage(message, frameTargetOrigin);
          }
        };
        const isHostMessage = (message) => message && message.version === bridgeVersion && (message.type === "host.ready" || message.type === "host.openedFromCommand") && (message.payload === undefined || (typeof message.payload === "object" && message.payload !== null && !Array.isArray(message.payload)));
        const isGuiMessage = (message) => message && message.version === bridgeVersion && message.type === "gui.ready";
        window.__yetAiSendHostMessageToFrame = sendToFrame;
        window.addEventListener("message", (event) => {
          if (event.source === frame?.contentWindow) {
            if (frameTargetOrigin && frameTargetOrigin !== "*" && event.origin !== frameTargetOrigin) {
              console.log("Yet AI rejected iframe message from unexpected origin");
              return;
            }
            if (isGuiMessage(event.data)) {
              window.postIntellijMessage(event.data);
            } else {
              console.log("Yet AI rejected invalid iframe GUI bridge message");
            }
            return;
          }
        });
        if (frame) {
          frame.addEventListener("load", () => {
            markLoaded();
            sendToFrame(bootstrapHostReady);
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

private fun html(value: String): String = value
    .replace("&", "&amp;")
    .replace("<", "&lt;")
    .replace(">", "&gt;")
    .replace("\"", "&quot;")
