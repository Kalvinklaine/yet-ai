package ai.yet.plugin.ui

import ai.yet.plugin.runtime.RuntimeConnectionResult
import ai.yet.plugin.runtime.RuntimeLifecycle
import ai.yet.plugin.runtime.RuntimeLifecycleStatus
import ai.yet.plugin.runtime.RuntimeProcessState
import ai.yet.plugin.runtime.RuntimeSettings

fun main(args: Array<String>) {
    require(args.size == 3) { "Usage: SmokeRenderWrapperHtmlKt <panel-origin> <panel-id> <panel-base-path>" }
    val origin = args[0]
    val panelId = args[1]
    val panelBasePath = args[2]
    val packagedGui = PackagedGui("$origin/index.html", origin).forPanel(PackagedGuiPanel(panelId, panelBasePath))
    val connection = RuntimeConnectionResult(
        RuntimeSettings("http://127.0.0.1:8001", null, null),
        "Connected to Yet AI local runtime.",
        null,
        RuntimeLifecycleStatus(
            lifecycle = RuntimeLifecycle.CONNECTED,
            runtimeOwner = "ide_host",
            launchMode = "launch",
            tokenState = "present",
            processState = RuntimeProcessState.RUNNING,
            diagnosis = "local runtime is reachable",
            nextAction = "Continue using Yet AI.",
        ),
    )
    print(renderHtml(connection, "window.__yetAiBridgeMessages.push(message);", packagedGui))
}
