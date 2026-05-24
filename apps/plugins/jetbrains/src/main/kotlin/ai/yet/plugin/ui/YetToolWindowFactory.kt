package ai.yet.plugin.ui

import ai.yet.plugin.bridge.BridgeMessages
import ai.yet.plugin.identity.ProductIdentity
import ai.yet.plugin.runtime.RuntimeSettings
import ai.yet.plugin.runtime.loopbackOrigin
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
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
        toolWindow.contentManager.addContent(contentFactory.createContent(component, ProductIdentity.pluginName, false))
    }
}

class YetBrowserPanel : JPanel(BorderLayout()) {
    private val logger = Logger.getInstance(YetBrowserPanel::class.java)
    private val browser = JBCefBrowser()
    private val query = JBCefJSQuery.create(browser as JBCefBrowser)

    init {
        add(browser.component, BorderLayout.CENTER)
        query.addHandler { raw ->
            if (!BridgeMessages.isGuiReady(raw)) {
                logger.info("Yet AI rejected invalid GUI bridge message")
                return@addHandler null
            }
            logger.info("Yet AI received gui.ready")
            val settings = RuntimeSettings.current()
            sendToGui(BridgeMessages.hostReady(settings, BridgeMessages.requestId(raw)))
            sendToGui(BridgeMessages.openedFromCommand())
            null
        }
        browser.loadHTML(renderHtml(RuntimeSettings.current(), query))
    }

    private fun sendToGui(message: String) {
        browser.cefBrowser.executeJavaScript("window.postMessage($message, window.location.origin);", browser.cefBrowser.url, 0)
    }
}

private fun renderHtml(settings: RuntimeSettings, query: JBCefJSQuery): String {
    val requestId = "jb-${System.currentTimeMillis()}"
    val guiDevOrigin = settings.guiDevUrl?.let { loopbackOrigin(it) }
    val bootstrap = BridgeMessages.escapeScriptJson(
        BridgeMessages.hostReady(settings, requestId)
    )
    val frame = settings.guiDevUrl?.let { "<iframe title=\"Yet AI GUI\" src=\"${html(it)}\"></iframe>" } ?: ""
    val placeholder = if (settings.guiDevUrl == null) {
        "<main><h1>Yet AI</h1><p>Local runtime shell is ready.</p><p>Runtime: <code>${html(settings.runtimeUrl)}</code></p><p>Set the GUI dev URL to a loopback Vite server to host the GUI during development.</p></main>"
    } else {
        ""
    }
    val postIntellij = query.inject("JSON.stringify(message)", "function(error) { console.log('Yet AI bridge send failed'); }", "function(response) {}")
    val frameOrigin = guiDevOrigin?.let { "\"${html(it)}\"" } ?: "undefined"
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
        </style>
        </head>
        <body>
        $placeholder$frame
        <script>
        const bootstrapHostReady = $bootstrap;
        const bridgeVersion = "${ProductIdentity.bridgeVersion}";
        const requestId = "$requestId";
        const frame = document.querySelector("iframe");
        const frameTargetOrigin = $frameOrigin;
        window.postIntellijMessage = (message) => { $postIntellij };
        const sendToFrame = (message) => {
          if (frame && frame.contentWindow && frameTargetOrigin) {
            frame.contentWindow.postMessage(message, frameTargetOrigin);
          }
        };
        const isHostMessage = (message) => message && message.version === bridgeVersion && (message.type === "host.ready" || message.type === "host.openedFromCommand");
        const isGuiMessage = (message) => message && message.version === bridgeVersion && message.type === "gui.ready";
        window.addEventListener("message", (event) => {
          if (event.source === frame?.contentWindow) {
            if (event.origin !== frameTargetOrigin) {
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
          if (isHostMessage(event.data)) {
            console.log("Yet AI host message", event.data.type);
            sendToFrame(event.data);
          }
        });
        window.postIntellijMessage({ version: bridgeVersion, type: "gui.ready", requestId, payload: { supportedBridgeVersion: bridgeVersion } });
        if (frame) {
          frame.addEventListener("load", () => sendToFrame(bootstrapHostReady));
        }
        </script>
        </body>
        </html>
    """.trimIndent()
}

private fun html(value: String): String = value
    .replace("&", "&amp;")
    .replace("<", "&lt;")
    .replace(">", "&gt;")
    .replace("\"", "&quot;")
