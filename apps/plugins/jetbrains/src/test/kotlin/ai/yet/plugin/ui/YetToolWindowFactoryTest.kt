package ai.yet.plugin.ui

import ai.yet.plugin.bridge.ActiveEditorContext
import ai.yet.plugin.bridge.BridgeMessages
import ai.yet.plugin.bridge.ControlledIdeActions
import ai.yet.plugin.runtime.RuntimeConnectionResult
import ai.yet.plugin.runtime.RuntimeLifecycle
import ai.yet.plugin.runtime.RuntimeLifecycleStatus
import ai.yet.plugin.runtime.RuntimeProcessState
import ai.yet.plugin.runtime.RuntimeSettings
import com.google.gson.JsonParser
import java.util.concurrent.CompletableFuture
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class YetToolWindowFactoryTest {
    @Test
    fun packagedGuiUsesLoopbackServerIframe() {
        val packagedGui = PackagedGui("http://127.0.0.1:49221/index.html", "http://127.0.0.1:49221")
        val html = renderHtml(
            RuntimeConnectionResult(RuntimeSettings("http://127.0.0.1:8001", null, null), null, null),
            "console.log('bridge')",
            packagedGui,
        )

        assertContains(html, "<iframe title=\"Yet AI GUI\" src=\"http://127.0.0.1:49221/index.html\"></iframe>")
        assertContains(html, "const frameTargetOrigin = \"http://127.0.0.1:49221\";")
        assertContains(html, "Loading packaged Yet AI GUI from <code>http://127.0.0.1:49221/index.html</code>")
        assertContains(html, "Connecting to Yet AI local runtime")
        assertContains(html, "Packaged Yet AI GUI did not finish loading from the local loopback server")
        assertContains(html, "window.setTimeout")
        assertContains(html, "window.__yetAiSendHostMessageToFrame = sendToFrame")
        assertContains(html, "window.__yetAiSetRuntimeDiagnostic")
        assertContains(html, "const maxPendingHostMessages = 32;")
        assertContains(html, "const maxPendingDiagnostics = 16;")
        assertContains(html, "const boundedArray = (value, maxSize) => Array.isArray(value) ? value.slice(-maxSize) : [];")
        assertContains(html, "const pushBounded = (queue, message, maxSize) => {")
        assertContains(html, "const pendingHostMessages = boundedArray(window.__yetAiPendingHostMessages, maxPendingHostMessages)")
        assertContains(html, "const pendingDiagnostics = boundedArray(window.__yetAiPendingDiagnostics, maxPendingDiagnostics)")
        assertContains(html, "window.__yetAiPendingHostMessages = pendingHostMessages")
        assertContains(html, "window.__yetAiPendingDiagnostics = pendingDiagnostics")
        assertContains(html, "if (!frameReady && !isPreReadyTerminalBlockedControlledAgentEditResult(message)) {")
        assertContains(html, "pushBounded(pendingHostMessages, message, maxPendingHostMessages);")
        assertContains(html, "return;")
        assertContains(html, "flushPending()")
        assertContains(html, "message.type === \"host.contextSnapshot\"")
        assertFalse(html.contains("isHostMessage(event.data)"))
        assertFalse(html.contains("window.postIntellijMessage({ version: bridgeVersion, type: \"gui.ready\""))
        assertFalse(html.contains("Yet AI host message"))
        assertFalse(html.contains("window.__yetAiSendHostMessageToFrame?."))
        assertFalse(html.contains("window.postMessage(message"))
        assertFalse(html.contains("jar:file:"))
        assertFalse(html.contains("const frameTargetOrigin = \"*\";"))
        assertFalse(html.contains("<div id=\"root\"></div>"))
        assertFalse(html.contains("/assets/index-"))
    }

    @Test
    fun wrapperFlushesQueuedMessagesOnlyWhenGuiIsReady() {
        val html = renderHtml(
            RuntimeConnectionResult(RuntimeSettings("http://127.0.0.1:8001", null, null), null, "runtime unavailable"),
            "console.log('bridge')",
            PackagedGui("http://127.0.0.1:49221/index.html", "http://127.0.0.1:49221"),
        )

        assertContains(html, "let frameReady = false")
        assertContains(html, "pushBounded(pendingHostMessages, message, maxPendingHostMessages);")
        assertContains(html, "let frameGeneration = 0;")
        assertContains(html, "let currentFrameWindow = frame?.contentWindow;")
        assertContains(html, "let currentGuiReadyRequestId;")
        assertContains(html, "let guiReadySequence = 0;")
        assertContains(html, "let currentGuiReadySequence = 0;")
        assertContains(html, "let acceptedHostReadyRequestId;")
        assertContains(html, "let hostReadyAcceptedForCurrentFrame = false;")
        assertContains(html, "let currentFrameNonce;")
        assertContains(html, "let frameNonceChallengeAttempts = 0;")
        assertContains(html, "const currentReadyRequestId = () => currentGuiReadyRequestId;")
        assertContains(html, "const randomToken = () => {")
        assertContains(html, "globalThis.crypto.getRandomValues(bytes);")
        assertContains(html, "const wrapperReadyRequestId = (sequence) => {")
        assertContains(html, "return token === undefined ? undefined : \"gui-ready-\" + frameGeneration + \"-\" + sequence + \"-\" + token;")
        assertContains(html, "const newFrameNonce = () => randomToken();")
        assertContains(html, "type: \"host.frameNonce\"")
        assertContains(html, "payload: { frameNonce: currentFrameNonce }")
        assertContains(html, "if (frameReady || !frame || !currentFrameWindow || frame.contentWindow !== currentFrameWindow || !frameTargetOrigin || !isFrameNonce(currentFrameNonce)) return;")
        assertContains(html, "frameNonceChallengeAttempts < 20")
        assertContains(html, "resetFrameNonceChallenge()")
        assertContains(html, "const invalidateFrameAuthority = (reason) => {")
        assertContains(html, "const isGuiUnloadedMessage = (message) =>")
        assertContains(html, "invalidateFrameAuthority(\"gui.unloaded\")")
        assertContains(html, "currentGuiReadySequence === guiReadySequence")
        assertContains(html, "frame && currentFrameWindow && frame.contentWindow === currentFrameWindow")
        assertContains(html, "event.source === currentFrameWindow && event.source === frame?.contentWindow")
        assertContains(html, "while (pendingDiagnostics.length > 0) showDiagnostic(pendingDiagnostics.shift())")
        assertContains(html, "const hostMessages = pendingHostMessages.splice(0, pendingHostMessages.length);")
        assertContains(html, "for (const message of hostMessages) postToFrame(message);")
        assertContains(html, "if (!frameReady && !isPreReadyTerminalBlockedControlledAgentEditResult(message)) {")
        assertContains(html, "pushBounded(pendingHostMessages, message, maxPendingHostMessages);")
        assertContains(html, "return;")
        assertContains(html, "if (frameReady && event.data.payload.frameNonce === currentFrameNonce) return;")
        assertContains(html, "const nextGuiReadySequence = guiReadySequence + 1;")
        assertContains(html, "const nextGuiReadyRequestId = wrapperReadyRequestId(nextGuiReadySequence);")
        assertContains(html, "if (nextGuiReadyRequestId === undefined) {")
        assertContains(html, "Yet AI rejected gui.ready because secure wrapper randomness is unavailable")
        assertContains(html, "const showRandomnessDiagnostic = () => {")
        assertContains(html, "Secure browser randomness is unavailable. Yet AI cannot authorize the embedded GUI bridge until the shell is reloaded in a secure context.")
        assertContains(html, "showRandomnessDiagnostic();")
        assertContains(html, "frameReady = true;")
        assertContains(html, "guiReadySequence = nextGuiReadySequence;")
        assertContains(html, "currentGuiReadySequence = nextGuiReadySequence;")
        assertContains(html, "currentGuiReadyRequestId = nextGuiReadyRequestId;")
        assertContains(html, "const readyMessage = { ...event.data, requestId: currentGuiReadyRequestId, payload: { supportedBridgeVersion: event.data.payload?.supportedBridgeVersion } };")
        assertFalse(html.contains("currentGuiReadyRequestId = event.data.requestId"))
        assertFalse(html.contains("event.data.requestId === undefined ?"))
        assertContains(html, "acceptedHostReadyRequestId = undefined;")
        assertContains(html, "hostReadyAcceptedForCurrentFrame = false;")
        assertContains(html, "flushPending();")
        assertContains(html, "window.postIntellijMessage(readyMessage);")
        assertContains(html, "frameReady = false;")
        assertContains(html, "invalidateFrameAuthority(\"frame.load\")")
        assertContains(html, "frameGeneration += 1;")
        assertContains(html, "currentFrameWindow = frame.contentWindow;")
        assertContains(html, "currentGuiReadySequence = 0;")
        assertContains(html, "currentGuiReadyRequestId = undefined;")
        assertContains(html, "acceptedHostReadyRequestId = undefined;")
        assertContains(html, "hostReadyAcceptedForCurrentFrame = false;")
        assertContains(html, "currentFrameNonce = undefined;")
        assertContains(html, "pendingHostMessages.length = 0;")
        assertFalse(html.contains("const bootstrapHostReady"))
    }

    @Test
    fun wrapperAcceptsOnlyStrictGuiReady() {
        val html = renderHtml(
            RuntimeConnectionResult(RuntimeSettings("http://127.0.0.1:8001", null, null), null, null),
            "console.log('bridge')",
            PackagedGui("http://127.0.0.1:49221/index.html", "http://127.0.0.1:49221"),
        )

        assertContains(html, "const isRequestId = (value) => value === undefined || (typeof value === \"string\" && value.length > 0 && value.length <= 128")
        assertContains(html, "const code = char.charCodeAt(0);")
        assertContains(html, "return code >= 0x20 && (code < 0x7f || code > 0x9f);")
        assertContains(html, "const isFrameNonce = (value) => typeof value === \"string\" && /^[0-9a-f]{32}$/.test(value);")
        assertContains(html, "!isPlainObject(message) || !hasOnlyKeys(message, [\"version\", \"type\", \"requestId\", \"payload\"])")
        assertContains(html, "message.version !== bridgeVersion || message.type !== \"gui.ready\" || !isRequestId(message.requestId)")
        assertContains(html, "hasOnlyKeys(message.payload, [\"supportedBridgeVersion\", \"frameNonce\"])")
        assertContains(html, "message.payload.supportedBridgeVersion === undefined || message.payload.supportedBridgeVersion === bridgeVersion")
        assertContains(html, "isFrameNonce(currentFrameNonce) && isFrameNonce(message.payload.frameNonce) && message.payload.frameNonce === currentFrameNonce")
        assertContains(html, "currentFrameWindow.postMessage({ version: bridgeVersion, type: \"host.frameNonce\", payload: { frameNonce: currentFrameNonce } }, frameTargetOrigin);")
        assertContains(html, "const readyMessage = { ...event.data, requestId: currentGuiReadyRequestId, payload: { supportedBridgeVersion: event.data.payload?.supportedBridgeVersion } };")
        assertContains(html, "if (frameReady && event.data.payload.frameNonce === currentFrameNonce) return;")
        assertFalse(html.contains("currentGuiReadyRequestId = message.requestId"))
        assertFalse(html.contains("currentGuiReadyRequestId = event.data.requestId"))
        assertFalse(html.contains("window.addEventListener(\"message\", (event) => {\n          if (isGuiMessage(event.data))"))
        assertFalse(html.contains("message.type === \"gui.openFile\""))
        assertFalse(html.contains("message.type === \"gui.revealRange\""))
        assertContains(html, "gui.applyWorkspaceEditRequest")
        assertFalse(html.contains("message.type === \"gui.executeIdeTool\""))
        assertFalse(html.contains("message.type === \"gui.copyText\""))
        assertFalse(html.contains("message.type === \"gui.showNotification\""))
        assertFalse(html.contains("message.type === \"gui.getHostContext\""))
        assertFalse(html.contains("clipboard"))
        assertFalse(html.contains("executeCommand"))
        assertFalse(html.contains("runShellCommand"))
        assertFalse(html.contains("writeWorkspaceFile"))
    }

    @Test
    fun wrapperSafelyForwardsStrictReadOnlyIdeActionRequests() {
        val html = renderHtml(
            RuntimeConnectionResult(RuntimeSettings("http://127.0.0.1:8001", null, null), null, null),
            "console.log('bridge')",
            PackagedGui("http://127.0.0.1:49221/index.html", "http://127.0.0.1:49221"),
        )

        assertContains(html, "const maxIdeActionRequestBytes = 8192;")
        assertContains(html, "message.type !== \"gui.ideActionRequest\"")
        assertContains(html, "const allowedIdeActionNames = [\"getContextSnapshot\", \"openWorkspaceFile\", \"revealWorkspaceRange\", \"getActiveFileExcerpt\"];")
        assertContains(html, "if (payload.action === \"getActiveFileExcerpt\") return hasOnlyKeys(payload, [\"action\"]);")
        assertContains(html, "const isActiveFileExcerptAttachment = (attachment)")
        assertContains(html, "const isGuiIdeActionRequest = (message) => {")
        assertContains(html, "JSON.stringify(message)")
        assertContains(html, "new Blob([serialized]).size > maxIdeActionRequestBytes")
        assertContains(html, "requiredRequestId(message.requestId)")
        assertContains(html, "safeRequiredWorkspacePath(payload.workspaceRelativePath)")
        assertContains(html, "isIdeActionRange(payload.range)")
        assertContains(html, "} else if (isGuiIdeActionRequest(event.data)) {")
        assertContains(html, "!frameReady || !hostReadyAcceptedForCurrentFrame || acceptedHostReadyRequestId !== currentReadyRequestId()")
        assertContains(html, "window.postIntellijMessage(event.data);")
        assertContains(html, "event.source === currentFrameWindow && event.source === frame?.contentWindow")
        assertContains(html, "event.origin !== frameTargetOrigin")
        assertContains(html, "message.type === \"host.ideActionProgress\"")
        assertContains(html, "message.type === \"host.ideActionResult\"")
        assertContains(html, "const isHostIdeActionResultContext = (context)")
        assertContains(html, "hasActiveEditor")
        assertContains(html, "workspaceFolderCount")
        assertContains(html, "isHostIdeActionProgressPayload(message.payload)")
        assertContains(html, "isHostIdeActionResultPayload(message.payload)")

        listOf("writeWorkspaceFile", "runShellCommand", "gitStatus", "runTask", "executeIdeTool", "callProvider", "readWorkspaceFile", "indexWorkspace").forEach { action ->
            assertFalse(html.contains("\"$action\""), action)
        }
        assertFalse(html.contains("hasOnlyKeys(payload.context, [\"source\", \"kind\"])") )
        assertFalse(html.contains("payload.context.kind === \"active_editor\""))
        assertFalse(html.contains("window.postMessage(message"))
    }

    @Test
    fun wrapperSafelyForwardsStrictApplyWorkspaceEditRequestsAfterReadyHandshake() {
        val html = renderHtml(
            RuntimeConnectionResult(RuntimeSettings("http://127.0.0.1:8001", null, null), null, null),
            "console.log('bridge')",
            PackagedGui("http://127.0.0.1:49221/index.html", "http://127.0.0.1:49221"),
        )

        assertContains(html, "const maxApplyWorkspaceEditRequestBytes = 65536;")
        assertContains(html, "message.type !== \"gui.applyWorkspaceEditRequest\"")
        assertContains(html, "const isGuiApplyWorkspaceEditRequest = (message) => {")
        assertContains(html, "payload.requiresUserConfirmation !== true")
        assertContains(html, "payload.cloudRequired !== false")
        assertContains(html, "payload.edits.length > 4")
        assertContains(html, "edit.textReplacements.length <= 16")
        assertContains(html, "replacementTextLength <= 32768")
        assertContains(html, "} else if (isGuiApplyWorkspaceEditRequest(event.data)) {")
        assertContains(html, "Yet AI rejected apply workspace edit request before GUI bridge readiness")
        assertContains(html, "window.postIntellijMessage(event.data);")
        assertContains(html, "message.type === \"host.applyWorkspaceEditResult\"")
        assertContains(html, "isHostApplyWorkspaceEditResultPayload(message.payload)")
        assertContains(html, "[\"applied\", \"denied\", \"rejected\", \"failed\"].includes(payload.status)")
        assertContains(html, "payload.affectedFiles.every((path) => safeRequiredWorkspacePath(path))")
        assertContains(html, "acceptedHostReadyRequestId === currentReadyRequestId()")
        assertFalse(html.contains("runShellCommand"))
        assertFalse(html.contains("writeWorkspaceFile"))
    }

    @Test
    fun wrapperSafelyForwardsRuntimeRefreshOnlyAfterReadyHandshake() {
        val html = renderHtml(
            RuntimeConnectionResult(RuntimeSettings("http://127.0.0.1:8001", null, null), null, null),
            "console.log('bridge')",
            PackagedGui("http://127.0.0.1:49221/index.html", "http://127.0.0.1:49221"),
        )

        assertContains(html, "const isGuiRuntimeRefresh = (message) => {")
        assertContains(html, "message.type !== \"gui.runtimeRefresh\"")
        assertContains(html, "!requiredRequestId(message.requestId)")
        assertContains(html, "isPlainObject(message.payload) && Object.keys(message.payload).length === 0")
        assertContains(html, "} else if (isGuiRuntimeRefresh(event.data)) {")
        assertContains(html, "if (!frameReady) {")
        assertContains(html, "Yet AI rejected runtime refresh before current GUI ready handshake")
        assertContains(html, "window.postIntellijMessage(event.data);")
        assertContains(html, "event.source === currentFrameWindow && event.source === frame?.contentWindow")
        assertContains(html, "event.origin !== frameTargetOrigin")
    }

    @Test
    fun wrapperReadyIdUsesRandomTokenAndKeepsStaleMessagesBoundToCurrentReady() {
        val html = renderHtml(
            RuntimeConnectionResult(RuntimeSettings("http://127.0.0.1:8001", null, null), null, null),
            "console.log('bridge')",
            PackagedGui("http://127.0.0.1:49221/index.html", "http://127.0.0.1:49221"),
        )

        assertContains(html, "const bytes = new Uint8Array(16);")
        assertContains(html, "globalThis.crypto.getRandomValues(bytes);")
        assertContains(html, "byte.toString(16).padStart(2, \"0\")")
        assertContains(html, "const newFrameNonce = () => randomToken();")
        assertContains(html, "\"gui-ready-\" + frameGeneration + \"-\" + sequence + \"-\" + token")
        assertContains(html, "message.requestId === currentReadyRequestId()")
        assertContains(html, "acceptedHostReadyRequestId === currentReadyRequestId()")
        assertFalse(html.contains("\"gui-ready-\" + frameGeneration + \"-\" + sequence;"))
        assertFalse(html.contains("currentGuiReadyRequestId = event.data.requestId"))
    }

    @Test
    fun wrapperBindsGuiReadyAndDeliveryToCurrentFrameWindow() {
        val html = renderHtml(
            RuntimeConnectionResult(RuntimeSettings("http://127.0.0.1:8001", null, null), null, null),
            "console.log('bridge')",
            PackagedGui("http://127.0.0.1:49221/index.html", "http://127.0.0.1:49221"),
        )

        assertContains(html, "let currentFrameWindow = frame?.contentWindow;")
        assertContains(html, "if (event.source === currentFrameWindow && event.source === frame?.contentWindow) {")
        assertContains(html, "frame && currentFrameWindow && frame.contentWindow === currentFrameWindow")
        assertContains(html, "currentFrameWindow.postMessage(message, frameTargetOrigin);")
        assertContains(html, "currentFrameWindow = frame.contentWindow;")
        assertContains(html, "if (frameTargetOrigin && frameTargetOrigin !== \"*\" && event.origin !== frameTargetOrigin)")
        assertFalse(html.contains("postMessage(message, \"*\")"))
        assertFalse(html.contains("postMessage(message, '*')"))
        assertFalse(html.contains("if (event.source === frame?.contentWindow)"))
        assertFalse(html.contains("frame.contentWindow.postMessage(message, frameTargetOrigin);"))
    }

    @Test
    fun wrapperHtmlDoesNotSerializeSessionToken() {
        val html = renderHtml(
            RuntimeConnectionResult(RuntimeSettings("http://127.0.0.1:8001", null, "raw-static-session-token"), null, null),
            "console.log('bridge')",
            PackagedGui("http://127.0.0.1:49221/index.html", "http://127.0.0.1:49221"),
        )

        assertFalse(html.contains("raw-static-session-token"))
        assertFalse(html.contains("const bootstrapHostReady"))
        assertFalse(html.contains("sendToFrame(bootstrapHostReady);"))
    }

    @Test
    fun wrapperValidatesHostMessagesStrictlyBeforeForwarding() {
        val html = renderHtml(
            RuntimeConnectionResult(RuntimeSettings("http://127.0.0.1:8001", null, null), null, null),
            "console.log('bridge')",
            PackagedGui("http://127.0.0.1:49221/index.html", "http://127.0.0.1:49221"),
        )

        assertContains(html, "if (message.type === \"host.ready\") return isHostReadyPayload(message.payload)")
        assertContains(html, "hasOnlyKeys(payload, [\"runtimeUrl\", \"sessionToken\", \"productId\", \"displayName\", \"cloudRequired\"])")
        assertContains(html, "requiredLoopbackRuntimeUrl(payload.runtimeUrl)")
        assertContains(html, "hostname === \"127.0.0.1\" || hostname === \"localhost\" || hostname === \"::1\" || hostname === \"[::1]\"")
        assertContains(html, "/^[1-9][0-9]{0,4}$/.test(parsed.port) && Number(parsed.port) <= 65535")
        assertContains(html, "parsed.username === \"\" && parsed.password === \"\"")
        assertContains(html, "parsed.search === \"\" && parsed.hash === \"\"")
        assertContains(html, "parsed.pathname === \"\" || parsed.pathname === \"/\"")
        assertContains(html, "optionalString(payload.sessionToken, 4096)")
        assertContains(html, "payload.cloudRequired === undefined || payload.cloudRequired === false")
        assertContains(html, "const isSecretLikePathSegment = (value)")
        assertContains(html, "!isSecretLikePathSegment(part)")
        assertContains(html, "!value.includes(\"%\")")
        assertContains(html, "!value.includes(\"?\")")
        assertContains(html, "!value.includes(\"#\")")
        assertContains(html, "if (message.type === \"host.contextSnapshot\") return isContextSnapshotPayload(message.payload)")
        assertContains(html, "if (message.type === \"host.openedFromCommand\") return message.requestId === undefined && (message.payload === undefined || (isPlainObject(message.payload) && Object.keys(message.payload).length === 0))")
        assertContains(html, "if (message.type === \"host.runtimeStatus\") return message.requestId === undefined && isHostRuntimeStatusPayload(message.payload)")
        assertContains(html, "const isHostRuntimeStatusPayload = (payload) => isPlainObject(payload)")
        assertContains(html, "payload.authority === \"metadata_only\"")
        assertContains(html, "if (message.type === \"host.ideActionProgress\") return isHostIdeActionProgressPayload(message.payload)")
        assertContains(html, "if (message.type === \"host.ideActionResult\") return isHostIdeActionResultPayload(message.payload)")
        assertContains(html, "const messageMatchesCurrentReady = (message) => frameReady && currentGuiReadySequence === guiReadySequence && message.requestId === currentReadyRequestId();")
        assertContains(html, "return hostReadyAcceptedForCurrentFrame && acceptedHostReadyRequestId === currentReadyRequestId();")
        assertContains(html, "if (message.type === \"host.ready\") {")
        assertContains(html, "acceptedHostReadyRequestId = message.requestId;")
        assertContains(html, "hostReadyAcceptedForCurrentFrame = true;")
        assertFalse(html.contains("ideActionRequestTypesRejectedByPolicy"))
    }

    @Test
    fun wrapperInvalidatesStaleFrameAuthorityAndBoundsPendingQueues() {
        val html = renderHtml(
            RuntimeConnectionResult(RuntimeSettings("http://127.0.0.1:8001", null, null), null, null),
            "console.log('bridge')",
            PackagedGui("http://127.0.0.1:49221/index.html", "http://127.0.0.1:49221"),
        )

        assertContains(html, "const maxPendingHostMessages = 32;")
        assertPendingHostReplayBehavior()
        assertContains(html, "const maxPendingDiagnostics = 16;")
        assertContains(html, "const boundedArray = (value, maxSize) => Array.isArray(value) ? value.slice(-maxSize) : [];")
        assertContains(html, "while (queue.length > maxSize) queue.shift();")
        assertContains(html, "pushBounded(pendingDiagnostics, message, maxPendingDiagnostics);")
        assertContains(html, "const invalidateFrameAuthority = (reason) => {")
        assertContains(html, "const hostMessages = pendingHostMessages.splice(0, pendingHostMessages.length);")
        assertContains(html, "for (const message of hostMessages) postToFrame(message);")
        assertContains(html, "frameReady = false;")
        assertContains(html, "acceptedHostReadyRequestId = undefined;")
        assertContains(html, "hostReadyAcceptedForCurrentFrame = false;")
        assertContains(html, "currentFrameNonce = undefined;")
        assertContains(html, "pendingHostMessages.length = 0;")
        assertContains(html, "invalidateFrameAuthority(\"gui.unloaded\")")
        assertContains(html, "invalidateFrameAuthority(\"frame.load\")")
        assertContains(html, "window.postIntellijMessage({ version: bridgeVersion, type: \"gui.unloaded\", payload: {} });")
    }

    @Test
    fun pendingAutoGuiReadyCorrelationFieldsUseExternalOwnerUntilPrepareResolves() {
        val connection = pendingRuntimeConnection(
            RuntimeSettings("http://127.0.0.1:8001/private?token=must-not-leak", null, "host-secret-token", launchMode = ai.yet.plugin.runtime.LaunchMode.AUTO),
        )
        val fields = hostBridgeCorrelationFields(connection.settings, connection.lifecycleStatus, "initial")

        assertEquals("initial", fields["reason"])
        assertEquals("present", fields["tokenState"])
        assertEquals("http://127.0.0.1:8001", fields["runtime"])
        assertEquals("auto", fields["launchMode"])
        assertEquals("external/connect", fields["runtimeOwner"])
        val combined = fields.values.joinToString(" ")
        assertFalse(combined.contains("plugin-managed"), combined)
        assertFalse(combined.contains("host-secret-token"), combined)
        assertFalse(combined.contains("must-not-leak"), combined)
        assertFalse(combined.contains("private"), combined)
    }

    @Test
    fun pendingAutoRuntimeStatusUsesExternalNotOwnedAndWrapperAcceptedPayload() {
        val connection = pendingRuntimeConnection(
            RuntimeSettings("http://127.0.0.1:8001", null, null, launchMode = ai.yet.plugin.runtime.LaunchMode.AUTO),
        )
        val status = BridgeMessages.runtimeStatus(connection.lifecycleStatus)
        val payload = JsonParser.parseString(status).asJsonObject.getAsJsonObject("payload")

        assertEquals("restarting", payload.get("lifecycle").asString)
        assertEquals("external", payload.get("runtimeOwner").asString)
        assertEquals("auto", payload.get("launchMode").asString)
        assertEquals("not_owned", payload.get("processState").asString)
        assertContains(payload.get("diagnosis").asString, "prepare is pending")
        assertTrue(isWrapperAcceptedRuntimeStatusPayload(payload))
        assertFalse(status.contains("ide_host"), status)
        assertFalse(status.contains("plugin-managed"), status)
    }

    @Test
    fun guiReadyCorrelationFieldsUseExternalAutoLifecycleOwner() {
        val fields = hostBridgeCorrelationFields(
            RuntimeSettings("http://127.0.0.1:8001/private?token=must-not-leak", null, "host-secret-token", launchMode = ai.yet.plugin.runtime.LaunchMode.AUTO),
            RuntimeLifecycleStatus(
                lifecycle = RuntimeLifecycle.CONNECTED,
                runtimeOwner = "external",
                launchMode = "auto",
                tokenState = "present",
                processState = RuntimeProcessState.NOT_OWNED,
                diagnosis = "local runtime is reachable",
                nextAction = "Continue using Yet AI.",
            ),
            "initial",
        )

        assertEquals("initial", fields["reason"])
        assertEquals("present", fields["tokenState"])
        assertEquals("http://127.0.0.1:8001", fields["runtime"])
        assertEquals("auto", fields["launchMode"])
        assertEquals("external/connect", fields["runtimeOwner"])
        assertFalse(fields.values.joinToString(" ").contains("plugin-managed"))
        assertFalse(fields.values.joinToString(" ").contains("host-secret-token"))
        assertFalse(fields.values.joinToString(" ").contains("must-not-leak"))
    }

    @Test
    fun guiReadyCorrelationFieldsUseLifecycleTokenStateForAuthMismatch() {
        val settings = RuntimeSettings(
            "http://127.0.0.1:8001/private?token=must-not-leak",
            null,
            "host-secret-token",
            launchMode = ai.yet.plugin.runtime.LaunchMode.AUTO,
        )
        val lifecycleStatus = RuntimeLifecycleStatus(
            lifecycle = RuntimeLifecycle.AUTH_MISMATCH,
            runtimeOwner = "external",
            launchMode = "connect",
            tokenState = "mismatch",
            processState = RuntimeProcessState.NOT_OWNED,
            diagnosis = "runtime rejected the current local credentials",
            nextAction = "Update the local runtime connection.",
        )
        val fields = hostBridgeCorrelationFields(settings, lifecycleStatus, "401_recovery")

        assertEquals("401_recovery", fields["reason"])
        assertEquals("mismatch", fields["tokenState"])
        assertEquals("http://127.0.0.1:8001", fields["runtime"])
        assertEquals("connect", fields["launchMode"])
        assertEquals("external/connect", fields["runtimeOwner"])
        val combined = fields.values.joinToString(" ")
        assertFalse(combined.contains("present"), combined)
        assertFalse(combined.contains("host-secret-token"), combined)
        assertFalse(combined.contains("must-not-leak"), combined)
        assertFalse(combined.contains("private"), combined)
    }

    @Test
    fun guiReadyCorrelationFieldsUsePluginManagedLifecycleOwner() {
        val fields = hostBridgeCorrelationFields(
            RuntimeSettings("http://127.0.0.1:8001", null, "host-secret-token", launchMode = ai.yet.plugin.runtime.LaunchMode.AUTO),
            RuntimeLifecycleStatus(
                lifecycle = RuntimeLifecycle.CONNECTED,
                runtimeOwner = "ide_host",
                launchMode = "auto",
                tokenState = "present",
                processState = RuntimeProcessState.RUNNING,
                diagnosis = "local runtime is reachable",
                nextAction = "Continue using Yet AI.",
            ),
            "initial",
        )

        assertEquals("initial", fields["reason"])
        assertEquals("present", fields["tokenState"])
        assertEquals("http://127.0.0.1:8001", fields["runtime"])
        assertEquals("auto", fields["launchMode"])
        assertEquals("plugin-managed", fields["runtimeOwner"])
        assertFalse(fields.values.joinToString(" ").contains("host-secret-token"))
    }

    @Test
    fun runtimeUpdateReadyReasonClassifies401RecoveryStatus() {
        val recovery = RuntimeConnectionResult(
            RuntimeSettings("http://127.0.0.1:8001", null, "fresh-token"),
            "Connected to Yet AI local runtime after refreshing the runtime session token.",
            null,
        )
        val update = RuntimeConnectionResult(RuntimeSettings("http://127.0.0.1:8001", null, null), "Connected.", null)

        assertEquals("401_recovery", runtimeUpdateReadyReason(recovery))
        assertEquals("runtime_update", runtimeUpdateReadyReason(update))
    }

    @Test
    fun ideActionBridgeExecutesHostAndReturnsProgressAndResult() {
        val sent = mutableListOf<String>()
        val handled = JetBrainsIdeActionBridge.handleReadOnlyIdeActionRequest(
            """{"version":"2026-05-15","type":"gui.ideActionRequest","requestId":"req-1","payload":{"action":"openWorkspaceFile","workspaceRelativePath":"src/Main.kt"}}""",
            send = { sent.add(it) },
            host = FakeIdeActionHost(IdeActionHostResult(ControlledIdeActions.ResultStatus.Succeeded, "Workspace file opened.", workspaceRelativePath = "src/Main.kt")),
        )

        assertTrue(handled)
        assertEquals(listOf("host.ideActionProgress", "host.ideActionProgress", "host.ideActionProgress", "host.ideActionResult"), sent.map(::messageType))
        assertContains(sent[0], "\"checkingPolicy\"")
        assertContains(sent[1], "\"running\"")
        assertContains(sent[2], "\"completed\"")
        assertContains(sent[3], "\"succeeded\"")
        assertContains(sent[3], "Workspace file opened.")
        assertContains(sent[3], "\"workspaceRelativePath\":\"src/Main.kt\"")
    }

    @Test
    fun ideActionBridgeContextResultMetadataIsSanitized() {
        val sent = mutableListOf<String>()
        JetBrainsIdeActionBridge.handleReadOnlyIdeActionRequest(
            """{"version":"2026-05-15","type":"gui.ideActionRequest","requestId":"req-ctx","payload":{"action":"getContextSnapshot"}}""",
            send = { sent.add(it) },
            host = FakeIdeActionHost(IdeActionHostResult(ControlledIdeActions.ResultStatus.Succeeded, "IDE context snapshot captured.", hasActiveEditor = true, workspaceFolderCount = 1)),
        )

        val payload = JsonParser.parseString(sent.last()).asJsonObject.getAsJsonObject("payload")
        val context = payload.getAsJsonObject("context")
        assertEquals("jetbrains", context.get("source").asString)
        assertTrue(context.get("hasActiveEditor").asBoolean)
        assertEquals(1, context.get("workspaceFolderCount").asInt)
        assertFalse(context.has("kind"))
        assertFalse(payload.has("workspaceRelativePath"))
    }

    @Test
    fun ideActionBridgeRejectsInvalidRequestWithSafeRequestIdOnly() {
        val sent = mutableListOf<String>()
        val handled = JetBrainsIdeActionBridge.handleReadOnlyIdeActionRequest(
            """{"version":"2026-05-15","type":"gui.ideActionRequest","requestId":"req-2","payload":{"action":"runShellCommand"}}""",
            send = { sent.add(it) },
            host = FakeIdeActionHost(IdeActionHostResult(ControlledIdeActions.ResultStatus.Succeeded, "unused")),
        )

        assertTrue(handled)
        assertEquals(listOf("host.ideActionResult"), sent.map(::messageType))
        assertContains(sent.single(), "\"rejected\"")

        val ignored = JetBrainsIdeActionBridge.handleReadOnlyIdeActionRequest("not-json", send = { sent.add(it) }, host = FakeIdeActionHost(IdeActionHostResult(ControlledIdeActions.ResultStatus.Succeeded, "unused")))
        assertFalse(ignored)
    }

    @Test
    fun applyWorkspaceEditBridgeRequiresConfirmationBeforeApplying() {
        val sent = mutableListOf<String>()
        val host = FakeApplyWorkspaceEditHost(ApplyWorkspaceEditHostResult(ControlledIdeActions.ApplyWorkspaceEditStatus.Applied, "Edit request applied.", 1, listOf("src/Main.kt")))
        val handled = JetBrainsApplyWorkspaceEditBridge.handleApplyWorkspaceEditRequest(
            applyMessage(),
            send = { sent.add(it) },
            host = host,
            confirmer = FakeApplyWorkspaceEditConfirmer(true),
        )

        assertTrue(handled)
        assertEquals(1, host.appliedCount)
        val message = JsonParser.parseString(sent.single()).asJsonObject
        assertEquals("host.applyWorkspaceEditResult", message.get("type").asString)
        assertEquals("req-apply-1", message.get("requestId").asString)
        val payload = message.getAsJsonObject("payload")
        assertEquals("applied", payload.get("status").asString)
        assertEquals(1, payload.get("appliedEditCount").asInt)
        assertEquals(listOf("src/Main.kt"), payload.getAsJsonArray("affectedFiles").map { it.asString })
    }

    @Test
    fun applyWorkspaceEditBridgeReturnsDeniedWithoutMutation() {
        val sent = mutableListOf<String>()
        val host = FakeApplyWorkspaceEditHost(ApplyWorkspaceEditHostResult(ControlledIdeActions.ApplyWorkspaceEditStatus.Applied, "unused"))
        val handled = JetBrainsApplyWorkspaceEditBridge.handleApplyWorkspaceEditRequest(
            applyMessage(),
            send = { sent.add(it) },
            host = host,
            confirmer = FakeApplyWorkspaceEditConfirmer(false),
        )

        assertTrue(handled)
        assertEquals(0, host.appliedCount)
        val payload = JsonParser.parseString(sent.single()).asJsonObject.getAsJsonObject("payload")
        assertEquals("denied", payload.get("status").asString)
        assertEquals(0, payload.get("appliedEditCount").asInt)
    }

    @Test
    fun applyWorkspaceEditBridgeRejectsInvalidAndSanitizesFailures() {
        val rejected = mutableListOf<String>()
        val rejectedHandled = JetBrainsApplyWorkspaceEditBridge.handleApplyWorkspaceEditRequest(
            """{"version":"2026-05-15","type":"gui.applyWorkspaceEditRequest","requestId":"req-apply-2","payload":{"shell":true}}""",
            send = { rejected.add(it) },
            host = FakeApplyWorkspaceEditHost(ApplyWorkspaceEditHostResult(ControlledIdeActions.ApplyWorkspaceEditStatus.Applied, "unused")),
            confirmer = FakeApplyWorkspaceEditConfirmer(true),
        )
        assertTrue(rejectedHandled)
        assertEquals("rejected", JsonParser.parseString(rejected.single()).asJsonObject.getAsJsonObject("payload").get("status").asString)

        val failed = mutableListOf<String>()
        JetBrainsApplyWorkspaceEditBridge.handleApplyWorkspaceEditRequest(
            applyMessage(),
            send = { failed.add(it) },
            host = FakeApplyWorkspaceEditHost(ApplyWorkspaceEditHostResult(ControlledIdeActions.ApplyWorkspaceEditStatus.Failed, "raw provider response sk-proj-12345678 /Users/person/file.kt", -1, listOf("/Users/person/file.kt"))),
            confirmer = FakeApplyWorkspaceEditConfirmer(true),
        )
        val failedText = failed.single()
        val failedPayload = JsonParser.parseString(failedText).asJsonObject.getAsJsonObject("payload")
        assertEquals("failed", failedPayload.get("status").asString)
        assertEquals("Edit request status changed.", failedPayload.get("message").asString)
        assertFalse(failedText.contains("sk-proj-12345678"))
        assertFalse(failedText.contains("/Users/person"))
    }

    @Test
    fun applyWorkspaceEditReadinessGateRequiresAcceptedHostReadyForCurrentFrame() {
        assertFalse(canHandleApplyWorkspaceEdit(disposed = false, runtimePrepared = false, guiReadyRequestId = null, acceptedHostReadyRequestId = null))
        assertFalse(canHandleApplyWorkspaceEdit(disposed = false, runtimePrepared = true, guiReadyRequestId = "ready-1", acceptedHostReadyRequestId = null))
        assertFalse(canHandleApplyWorkspaceEdit(disposed = false, runtimePrepared = true, guiReadyRequestId = "ready-2", acceptedHostReadyRequestId = "ready-1"))
        assertFalse(canHandleApplyWorkspaceEdit(disposed = true, runtimePrepared = true, guiReadyRequestId = "ready-1", acceptedHostReadyRequestId = "ready-1"))
        assertTrue(canHandleApplyWorkspaceEdit(disposed = false, runtimePrepared = true, guiReadyRequestId = "ready-1", acceptedHostReadyRequestId = "ready-1"))
    }

    @Test
    fun applyWorkspaceEditBridgeDoesNotCorrelateOversizedInvalidRequestOrLeakRawValues() {
        val raw = """{"version":"2026-05-15","type":"gui.applyWorkspaceEditRequest","requestId":"req-oversized","payload":{"requiresUserConfirmation":true,"summary":"${"x".repeat(66000)} raw token sk-proj-12345678 /Users/person/private.kt","cloudRequired":false,"edits":[]}}"""
        val sent = mutableListOf<String>()
        val handled = JetBrainsApplyWorkspaceEditBridge.handleApplyWorkspaceEditRequest(
            raw,
            send = { sent.add(it) },
            host = FakeApplyWorkspaceEditHost(ApplyWorkspaceEditHostResult(ControlledIdeActions.ApplyWorkspaceEditStatus.Applied, "unused")),
            confirmer = FakeApplyWorkspaceEditConfirmer(true),
        )

        assertFalse(handled)
        assertEquals(emptyList(), sent)
        assertNull(ControlledIdeActions.safeApplyWorkspaceEditRequestIdFromRaw(raw))
    }

    @Test
    fun deliveryGateSkipsJavaScriptAfterDispose() {
        val executed = mutableListOf<String>()
        val gate = TestDeliveryGate { executed.add(it) }

        assertTrue(gate.deliver("first"))
        gate.dispose()
        assertFalse(gate.deliver("second"))
        assertEquals(listOf("first"), executed)
    }

    @Test
    fun pendingRuntimeConnectionDoesNotReportConnectedBeforePrepareCompletes() {
        val result = pendingRuntimeConnection(RuntimeSettings("http://127.0.0.1:8001", null, null, launchMode = ai.yet.plugin.runtime.LaunchMode.LAUNCH))

        assertEquals(RuntimeLifecycle.RESTARTING, result.lifecycleStatus.lifecycle)
        assertEquals("ide_host", result.lifecycleStatus.runtimeOwner)
        assertEquals(RuntimeProcessState.UNKNOWN, result.lifecycleStatus.processState)
        assertFalse(BridgeMessages.runtimeStatus(result.lifecycleStatus).contains("\"lifecycle\":\"connected\""))
        assertContains(result.lifecycleStatus.diagnosis, "prepare is pending")
    }

    @Test
    fun readyDeliverySendsContextAfterReadyMessagesWhenSupplierReturnsSnapshot() {
        val sent = mutableListOf<String>()
        val logs = mutableListOf<String>()
        val snapshot = ActiveEditorContext.snapshot(
            displayPath = "src/App.kt",
            workspaceRelativePath = "src/App.kt",
            languageId = "kotlin",
            selectionStartLine = 1,
            selectionStartCharacter = 2,
            selectionEndLine = 1,
            selectionEndCharacter = 6,
            selectionText = "safe text",
        )

        JetBrainsReadyMessageDelivery.deliver(
            settings = RuntimeSettings("http://127.0.0.1:8001", null, "session-token"),
            requestId = "ready-1",
            send = { sent.add(it) },
            contextSupplier = { snapshot },
            logContextStatus = { logs.add(it) },
        )

        assertEquals(listOf("host.ready", "host.openedFromCommand", "host.contextSnapshot"), sent.map(::messageType))
        assertContains(sent[0], "\"sessionToken\":\"session-token\"")
        assertFalse(JsonParser.parseString(sent[1]).asJsonObject.has("requestId"))
        assertFalse(sent.any { messageType(it) == "host.runtimeStatus" })
        assertContains(sent[2], "\"source\":\"jetbrains\"")
        assertContains(sent[2], "safe text")
        assertEquals(emptyList(), logs)
    }

    @Test
    fun contextRefreshDeliverySendsFreshSnapshotWithCurrentReadyRequest() {
        val sent = mutableListOf<String>()
        val logs = mutableListOf<String>()
        val snapshot = ActiveEditorContext.snapshot(
            displayPath = "src/Fresh.kt",
            workspaceRelativePath = "src/Fresh.kt",
            languageId = "kotlin",
            selectionStartLine = 2,
            selectionStartCharacter = 0,
            selectionEndLine = 2,
            selectionEndCharacter = 12,
            selectionText = "fresh select",
        )

        JetBrainsContextSnapshotDelivery.deliver(
            requestId = "gui-ready-current",
            send = { sent.add(it) },
            contextSupplier = { snapshot },
            logContextStatus = { logs.add(it) },
        )

        assertEquals(listOf("host.contextSnapshot"), sent.map(::messageType))
        val message = JsonParser.parseString(sent.single()).asJsonObject
        assertEquals("gui-ready-current", message.get("requestId").asString)
        assertContains(sent.single(), "fresh select")
        assertEquals(emptyList(), logs)
    }

    @Test
    fun contextRefreshDeliverySkipsNullAndLogsFailuresWithoutRawContext() {
        val sent = mutableListOf<String>()
        val logs = mutableListOf<String>()

        JetBrainsContextSnapshotDelivery.deliver(
            requestId = "gui-ready-current",
            send = { sent.add(it) },
            contextSupplier = { null },
            logContextStatus = { logs.add(it) },
        )
        JetBrainsContextSnapshotDelivery.deliver(
            requestId = "gui-ready-current",
            send = { sent.add(it) },
            contextSupplier = { throw IllegalStateException("raw selected secret /Users/person/private.kt") },
            logContextStatus = { logs.add(it) },
        )

        assertEquals(emptyList(), sent)
        assertEquals(listOf("Yet AI active editor context refresh failed"), logs)
        assertFalse(logs.joinToString("\n").contains("raw selected secret"))
        assertFalse(logs.joinToString("\n").contains("/Users/person/private.kt"))
    }

    @Test
    fun readyDeliveryDoesNotOverwritePreciseRuntimeStatusWithSyntheticConnectedStatus() {
        val sent = mutableListOf<String>()
        val preciseStatus = RuntimeLifecycleStatus(
            lifecycle = RuntimeLifecycle.STOPPED,
            runtimeOwner = "ide_host",
            launchMode = "launch",
            tokenState = "present",
            processState = RuntimeProcessState.EXITED,
            diagnosis = "plugin-launched runtime process exited unexpectedly",
            nextAction = "Click Refresh runtime, then run Yet AI: Restart Runtime.",
        )

        sent.add(BridgeMessages.runtimeStatus(preciseStatus))
        JetBrainsReadyMessageDelivery.deliver(
            settings = RuntimeSettings("http://127.0.0.1:8001", null, "session-token"),
            requestId = "ready-precise",
            send = { sent.add(it) },
            contextSupplier = { null },
            logContextStatus = {},
        )

        val runtimeStatusMessages = sent.filter { messageType(it) == "host.runtimeStatus" }
        assertEquals(1, runtimeStatusMessages.size)
        val payload = JsonParser.parseString(runtimeStatusMessages.single()).asJsonObject.getAsJsonObject("payload")
        assertEquals("stopped", payload.get("lifecycle").asString)
        assertEquals("exited", payload.get("processState").asString)
        assertFalse(sent.drop(1).any { messageType(it) == "host.runtimeStatus" })
    }

    @Test
    fun readyDeliveryCanSendFreshHostReadyForExistingGuiRequestAfterRuntimeRelaunch() {
        val sent = mutableListOf<String>()
        val requestId = "gui-ready-current"

        JetBrainsReadyMessageDelivery.deliver(
            settings = RuntimeSettings("http://127.0.0.1:8001", null, "old-plugin-token"),
            requestId = requestId,
            send = { sent.add(it) },
            contextSupplier = { null },
            logContextStatus = {},
        )
        JetBrainsReadyMessageDelivery.deliver(
            settings = RuntimeSettings("http://127.0.0.1:8001", null, "fresh-plugin-token"),
            requestId = requestId,
            send = { sent.add(it) },
            contextSupplier = { null },
            logContextStatus = {},
        )

        val readyMessages = sent.filter { messageType(it) == "host.ready" }
        assertEquals(2, readyMessages.size)
        assertTrue(readyMessages.all { it.contains("\"requestId\":\"$requestId\"") }, readyMessages.joinToString("\n"))
        assertContains(readyMessages[0], "\"sessionToken\":\"old-plugin-token\"")
        assertContains(readyMessages[1], "\"sessionToken\":\"fresh-plugin-token\"")
    }

    @Test
    fun readyDeliverySkipsContextWhenSupplierReturnsNull() {
        val sent = mutableListOf<String>()

        JetBrainsReadyMessageDelivery.deliver(
            settings = RuntimeSettings("http://127.0.0.1:8001", null, null),
            requestId = "ready-2",
            send = { sent.add(it) },
            contextSupplier = { null },
            logContextStatus = {},
        )

        assertEquals(listOf("host.ready", "host.openedFromCommand"), sent.map(::messageType))
    }

    @Test
    fun readyDeliveryRejectsInvalidRuntimeUrlBatchBeforeCollectingContext() {
        val sent = mutableListOf<String>()
        val logs = mutableListOf<String>()
        var contextCollected = false

        JetBrainsReadyMessageDelivery.deliver(
            settings = RuntimeSettings("https://example.com/", null, null),
            requestId = "ready-invalid",
            send = { sent.add(it) },
            contextSupplier = {
                contextCollected = true
                null
            },
            logContextStatus = { logs.add(it) },
        )

        assertEquals(emptyList(), sent)
        assertFalse(contextCollected)
        assertEquals(listOf("Yet AI rejected invalid runtime URL for GUI bridge ready batch"), logs)
    }

    @Test
    fun readyDeliveryAcceptsUppercaseLocalhostRuntimeUrl() {
        val sent = mutableListOf<String>()

        JetBrainsReadyMessageDelivery.deliver(
            settings = RuntimeSettings("http://LOCALHOST:8001/", null, null),
            requestId = "ready-uppercase-localhost",
            send = { sent.add(it) },
            contextSupplier = { null },
            logContextStatus = {},
        )

        assertEquals(listOf("host.ready", "host.openedFromCommand"), sent.map(::messageType))
    }

    @Test
    fun readyDeliveryRejectsMissingRuntimeUrlBatchBeforeCollectingContext() {
        val sent = mutableListOf<String>()
        var contextCollected = false

        JetBrainsReadyMessageDelivery.deliver(
            settings = RuntimeSettings("", null, null),
            requestId = "ready-missing",
            send = { sent.add(it) },
            contextSupplier = {
                contextCollected = true
                null
            },
            logContextStatus = {},
        )

        assertEquals(emptyList(), sent)
        assertFalse(contextCollected)
    }

    @Test
    fun readyDeliveryKeepsReadyMessagesWhenSupplierThrowsAndLogsNoRawContext() {
        val sent = mutableListOf<String>()
        val logs = mutableListOf<String>()

        JetBrainsReadyMessageDelivery.deliver(
            settings = RuntimeSettings("http://127.0.0.1:8001", null, null),
            requestId = "ready-3",
            send = { sent.add(it) },
            contextSupplier = { throw IllegalStateException("raw-selected-text /Users/person/private/File.kt") },
            logContextStatus = { logs.add(it) },
        )

        assertEquals(listOf("host.ready", "host.openedFromCommand"), sent.map(::messageType))
        assertEquals(listOf("Yet AI active editor context collection failed"), logs)
        assertFalse(logs.joinToString("\n").contains("raw-selected-text"))
        assertFalse(logs.joinToString("\n").contains("/Users/person/private/File.kt"))
    }

    @Test
    fun panelSourceContainsDisposalGuardForAsyncDelivery() {
        val source = java.nio.file.Files.readString(java.nio.file.Path.of("src/main/kotlin/ai/yet/plugin/ui/YetToolWindowFactory.kt"))
        val actionSource = java.nio.file.Files.readString(java.nio.file.Path.of("src/main/kotlin/ai/yet/plugin/actions/OpenChatAction.kt"))

        assertContains(source, "private var disposed = false")
        assertContains(source, "invokeLater {")
        assertContains(source, "if (!disposed) {")
        assertContains(source, "if (disposed) return")
        assertContains(source, "window.__yetAiPendingHostMessages = Array.isArray(window.__yetAiPendingHostMessages) ? window.__yetAiPendingHostMessages.slice(-maxPendingHostMessages) : []")
        assertContains(source, "window.__yetAiPendingDiagnostics = Array.isArray(window.__yetAiPendingDiagnostics) ? window.__yetAiPendingDiagnostics.slice(-maxPendingDiagnostics) : []")
        assertContains(source, "if (!frameReady && !isPreReadyTerminalBlockedControlledAgentEditResult(message)) {")
        assertContains(source, "pushBounded(pendingHostMessages, message, maxPendingHostMessages)")
        assertContains(source, "pushBounded(pendingDiagnostics, message, maxPendingDiagnostics)")
        assertContains(source, "isGuiUnloadedBridgeMessage(raw)")
        assertContains(source, "guiReadyRequestId = null")
        assertContains(source, "fun refreshActiveEditorContext()")
        assertContains(source, "val requestId = guiReadyRequestId ?: return")
        assertContains(source, "ToolWindowManagerListener.TOPIC")
        assertContains(source, "override fun toolWindowShown(toolWindow: ToolWindow)")
        assertContains(actionSource, "toolWindow.activate({ YetToolWindowFactory.refreshActiveEditorContext(toolWindow) })")
        assertContains(source, "disposed = true")
    }

    @Test
    fun panelSourceLogsGuiReadyAndHostReadyCorrelationEvents() {
        val source = java.nio.file.Files.readString(java.nio.file.Path.of("src/main/kotlin/ai/yet/plugin/ui/YetToolWindowFactory.kt"))

        assertContains(source, "bridge.gui_ready")
        assertContains(source, "bridge.host_ready.delivered")
        assertContains(source, "hostBridgeCorrelationFields(latestConnection.settings, latestConnection.lifecycleStatus, \"initial\")")
        assertContains(source, "pendingHostReadyReason = \"manual_refresh\"")
        assertContains(source, "pendingHostReadyReason = runtimeUpdateReadyReason(connection)")
        assertContains(source, "pendingHostReadyReason ?: \"runtime_update\"")
        assertContains(source, "runtimeUpdateReadyReason(connection)")
        assertFalse(source.contains("raw GUI"))
    }

    @Test
    fun panelDefersHostReadyUntilPreparedRuntimeConnection() {
        val source = java.nio.file.Files.readString(java.nio.file.Path.of("src/main/kotlin/ai/yet/plugin/ui/YetToolWindowFactory.kt"))

        assertContains(source, "private var runtimePrepared = false")
        assertContains(source, "private var acceptedHostReadyRequestId: String? = null")
        assertContains(source, "val applyEditHandled = handleApplyWorkspaceEditRequest(raw)")
        assertContains(source, "if (!canHandleApplyWorkspaceEdit())")
        assertContains(source, "ControlledIdeActions.safeApplyWorkspaceEditRequestIdFromRaw(raw)")
        assertContains(source, "acceptedHostReadyRequestId = requestId.takeIf { delivered && !disposed }")
        assertContains(source, "val latestError = latestConnection.error")
        assertContains(source, "if (latestError != null) {")
        assertContains(source, "sendDiagnostic(latestError)")
        assertContains(source, "} else if (runtimePrepared) {")
        assertContains(source, "Yet AI deferred host.ready until runtime prepare completes")
        assertContains(source, "runtimePrepared = connection.error == null")
        assertContains(source, "RuntimeConnectionListener.TOPIC")
        assertContains(source, "override fun runtimeConnectionUpdated(result: RuntimeConnectionResult)")
        assertContains(source, "handleRuntimeConnection(result)")
        assertContains(source, "if (connection.error == null) {")
        assertContains(source, "guiReadyRequestId?.let { requestId -> deliverReadyMessages(connection.settings, requestId) }")
        assertContains(source, "sendDiagnostic(connection.error)")
        assertFalse(source.contains("deliverReadyMessages(latestConnection.settings, requestId)\n            null"))
        assertFalse(source.contains("guiReadyRequestId?.let { requestId -> deliverReadyMessages(connection.settings, requestId) }\n                    connection.error?.let"))
    }

    @Test
    fun panelBridgesGuiRuntimeRefreshToRuntimePrepareOnPooledThread() {
        val source = java.nio.file.Files.readString(java.nio.file.Path.of("src/main/kotlin/ai/yet/plugin/ui/YetToolWindowFactory.kt"))

        assertContains(source, "BridgeMessages.parseGuiRuntimeRefresh(raw)")
        assertContains(source, "refreshRuntimeFromGui()")
        assertContains(source, "ApplicationManager.getApplication().executeOnPooledThread")
        assertContains(source, "RuntimeConnectionManager.getInstance().prepare()")
        assertContains(source, "handleRuntimeConnection(connection)")
        assertFalse(source.contains("guiReadyRequestId = runtimeRefresh.requestId"))
    }

    @Test
    fun runtimeManagerPublishesPrepareFailuresForOpenPanels() {
        val source = java.nio.file.Files.readString(java.nio.file.Path.of("src/main/kotlin/ai/yet/plugin/runtime/RuntimeConnectionManager.kt"))

        assertContains(source, "if (publishUpdates) publishRuntimeConnectionUpdate(result)")
        assertContains(source, "publishUpdates && (result.error != null || result.settings != previousConnection)")
        assertContains(source, "private fun publishRuntimeConnectionUpdate(result: RuntimeConnectionResult)")
    }

    @Test
    fun panelSendsRuntimeStatusBeforeDiagnosticsWhenPrepareFails() {
        val source = java.nio.file.Files.readString(java.nio.file.Path.of("src/main/kotlin/ai/yet/plugin/ui/YetToolWindowFactory.kt"))

        assertContains(source, "runtimePrepared = connection.error == null")
        assertContains(source, "sendRuntimeStatus(connection.lifecycleStatus)\n        if (connection.error == null)")
        assertContains(source, "sendDiagnostic(connection.error)")
        assertFalse(source.contains("if (connection.error == null) {\n            guiReadyRequestId?.let { requestId -> deliverReadyMessages(connection.settings, requestId) }\n        } else {\n            sendDiagnostic(connection.error)\n        }\n        sendRuntimeStatus"))
    }

    @Test
    fun guiUnloadedBridgeMessageRequiresStrictShape() {
        assertTrue(isGuiUnloadedBridgeMessage("""{"version":"2026-05-15","type":"gui.unloaded","payload":{}}"""))

        assertFalse(isGuiUnloadedBridgeMessage("""{"version":"2026-05-15","type":"gui.unloaded"}"""))
        assertFalse(isGuiUnloadedBridgeMessage("""{"version":"2026-05-15","type":"gui.unloaded","payload":null}"""))
        assertFalse(isGuiUnloadedBridgeMessage("""{"version":"2026-05-15","type":"gui.unloaded","payload":[]}"""))
        assertFalse(isGuiUnloadedBridgeMessage("""{"version":"2026-05-15","type":"gui.unloaded","payload":{"reason":"reload"}}"""))
        assertFalse(isGuiUnloadedBridgeMessage("""{"version":"2026-05-14","type":"gui.unloaded","payload":{}}"""))
        assertFalse(isGuiUnloadedBridgeMessage("""{"version":"2026-05-15","type":"gui.unloaded","payload":{},"extra":true}"""))
        assertFalse(isGuiUnloadedBridgeMessage("[]"))
        assertFalse(isGuiUnloadedBridgeMessage("null"))
        assertFalse(isGuiUnloadedBridgeMessage("not-json"))
    }

    @Test
    fun wrapperScriptDeliveryQueuesBeforeWrapperHelpersExist() {
        val delivery = WrapperScriptDelivery()
        val hostScript = delivery.hostMessage("{\"version\":\"2026-05-15\",\"type\":\"host.ready\",\"payload\":{}}")
        val diagnosticScript = delivery.diagnostic("runtime failed")

        assertContains(hostScript, "if (typeof window.__yetAiSendHostMessageToFrame === \"function\")")
        assertContains(hostScript, "window.__yetAiSendHostMessageToFrame(message);")
        assertContains(hostScript, "const maxPendingHostMessages = 32;")
        assertContains(hostScript, "window.__yetAiPendingHostMessages = Array.isArray(window.__yetAiPendingHostMessages) ? window.__yetAiPendingHostMessages.slice(-maxPendingHostMessages) : []")
        assertContains(hostScript, "window.__yetAiPendingHostMessages.push(message)")
        assertContains(hostScript, "while (window.__yetAiPendingHostMessages.length > maxPendingHostMessages) window.__yetAiPendingHostMessages.shift();")
        assertFalse(hostScript.contains("window.postMessage"))
        assertContains(diagnosticScript, "if (typeof window.__yetAiSetRuntimeDiagnostic === \"function\")")
        assertContains(diagnosticScript, "window.__yetAiSetRuntimeDiagnostic(message);")
        assertContains(diagnosticScript, "const maxPendingDiagnostics = 16;")
        assertContains(diagnosticScript, "window.__yetAiPendingDiagnostics = Array.isArray(window.__yetAiPendingDiagnostics) ? window.__yetAiPendingDiagnostics.slice(-maxPendingDiagnostics) : []")
        assertContains(diagnosticScript, "window.__yetAiPendingDiagnostics.push(message)")
        assertContains(diagnosticScript, "while (window.__yetAiPendingDiagnostics.length > maxPendingDiagnostics) window.__yetAiPendingDiagnostics.shift();")
        assertContains(diagnosticScript, "runtime failed")
    }

    @Test
    fun devGuiUrlKeepsLoopbackIframe() {
        val frame = buildGuiFrame("http://127.0.0.1:5173/gui", null)
        val origin = buildFrameOrigin("http://127.0.0.1:5173/gui", null)

        assertEquals("<iframe title=\"Yet AI GUI\" src=\"http://127.0.0.1:5173/gui\"></iframe>", frame)
        assertEquals("\"http://127.0.0.1:5173\"", origin)
    }

    @Test
    fun placeholderIsKeptWhenPackagedGuiIsMissing() {
        val html = renderHtml(
            RuntimeConnectionResult(RuntimeSettings("http://127.0.0.1:8001", null, null), "Connected", null),
            "console.log('bridge')",
            null,
        )

        assertContains(html, "Run <code>cd apps/gui && npm run build</code>")
        assertContains(html, "Connected")
        assertFalse(html.contains("<iframe title=\"Yet AI GUI\""))
    }

    @Test
    fun toolWindowContentIsRecreatedOnlyWhenEmpty() {
        assertTrue(shouldCreateYetToolWindowContent(0))
        assertFalse(shouldCreateYetToolWindowContent(1))
        assertFalse(shouldCreateYetToolWindowContent(2))
    }

    @Test
    fun mainToolWindowContentHasNoDuplicateTabTitleAndStaysNonCloseable() {
        val source = java.nio.file.Files.readString(java.nio.file.Path.of("src/main/kotlin/ai/yet/plugin/ui/YetToolWindowFactory.kt"))

        assertContains(source, "createContent(component, null, true)")
        assertContains(source, "content.isCloseable = false")
        assertFalse(source.contains("createContent(component, ProductIdentity.pluginName"))
    }

    @Test
    fun toolWindowRegistersLiveActiveEditorContextRefreshListeners() {
        val source = java.nio.file.Files.readString(java.nio.file.Path.of("src/main/kotlin/ai/yet/plugin/ui/YetToolWindowFactory.kt"))

        assertContains(source, "registerLiveContextRefresh(project, content, component)")
        assertContains(source, "FileEditorManagerListener.FILE_EDITOR_MANAGER")
        assertContains(source, "override fun selectionChanged(event: FileEditorManagerEvent)")
        assertContains(source, "addSelectionListener")
        assertContains(source, "override fun selectionChanged(event: SelectionEvent)")
        assertContains(source, "addCaretListener")
        assertContains(source, "override fun caretPositionChanged(event: CaretEvent)")
        assertContains(source, "Alarm(Alarm.ThreadToUse.SWING_THREAD, this)")
        assertContains(source, "contextRefreshAlarm.cancelAllRequests()")
        assertContains(source, "contextRefreshAlarm.addRequest({ refreshActiveEditorContext() }, 200)")
        assertContains(source, "if (guiReadyRequestId == null || disposed) return")
        assertContains(source, "project.messageBus.connect(content)")
        assertContains(source, "content,")
    }

    @Test
    fun pluginPreventsClosingTheOnlyToolWindowContent() {
        val pluginXml = java.nio.file.Files.readString(java.nio.file.Path.of("src/main/resources/META-INF/plugin.xml"))

        assertContains(pluginXml, "canCloseContents=\"false\"")
        assertFalse(pluginXml.contains("canCloseContents=\"true\""))
    }
}

private fun applyMessage(): String = """{"version":"2026-05-15","type":"gui.applyWorkspaceEditRequest","requestId":"req-apply-1","payload":{"requiresUserConfirmation":true,"summary":"Replace reviewed range.","cloudRequired":false,"edits":[{"workspaceRelativePath":"src/Main.kt","textReplacements":[{"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":4}},"replacementText":"updated"}]}]}}"""

private fun messageType(message: String): String = JsonParser.parseString(message).asJsonObject.get("type").asString

private fun isWrapperAcceptedRuntimeStatusPayload(payload: com.google.gson.JsonObject): Boolean {
    val allowedKeys = setOf("protocolVersion", "surface", "lifecycle", "runtimeOwner", "launchMode", "tokenState", "processState", "diagnosis", "nextAction", "cloudRequired", "authority")
    return payload.keySet().all { it in allowedKeys } &&
        payload.get("protocolVersion")?.asString == "2026-06-21" &&
        payload.get("surface")?.asString == "jetbrains" &&
        payload.get("lifecycle")?.asString in setOf("connected", "auth_mismatch", "invalid_settings", "failed", "restarting", "stopped") &&
        payload.get("runtimeOwner")?.asString in setOf("ide_host", "external") &&
        payload.get("launchMode")?.asString in setOf("auto", "connect", "launch") &&
        payload.get("tokenState")?.asString in setOf("unknown", "not_required", "absent", "present", "mismatch", "invalid") &&
        payload.get("processState")?.asString in setOf("unknown", "not_owned", "running", "exited", "stopped", "failed") &&
        payload.get("diagnosis")?.asString?.isNotBlank() == true &&
        payload.get("nextAction")?.asString?.isNotBlank() == true &&
        payload.get("cloudRequired")?.asBoolean == false &&
        payload.get("authority")?.asString == "metadata_only"
}

private fun assertPendingHostReplayBehavior() {
    val readyRequestId = "gui-ready-1"
    val hostReady = hostMessage(
        BridgeMessages.hostReady(
            RuntimeSettings("http://127.0.0.1:8001", null, null),
            readyRequestId,
        ),
    )
    val openedFromCommand = hostMessage(BridgeMessages.openedFromCommand())
    val runtimeStatus = hostMessage(
        BridgeMessages.runtimeStatus(
            RuntimeLifecycleStatus(
                lifecycle = RuntimeLifecycle.CONNECTED,
                runtimeOwner = "ide_host",
                launchMode = "launch",
                tokenState = "present",
                processState = RuntimeProcessState.RUNNING,
                diagnosis = "runtime connected",
                nextAction = "Continue.",
            ),
        ),
    )
    val staleContext = hostMessage(
        BridgeMessages.contextSnapshot(
            ActiveEditorContext.snapshot(displayPath = "src/Stale.kt", workspaceRelativePath = "src/Stale.kt")!!,
            "old-ready",
        ),
    )
    val diagnostics = (1..18).map { "diagnostic-$it" }
    val extraHostMessages = (1..29).map { index ->
        hostMessage(
            BridgeMessages.contextSnapshot(
                ActiveEditorContext.snapshot(displayPath = "src/File$index.kt", workspaceRelativePath = "src/File$index.kt")!!,
                readyRequestId,
            ),
        )
    }
    val replay = PendingHostReplayHarness(
        pendingHostMessages = listOf(runtimeStatus, hostReady, openedFromCommand, staleContext) + extraHostMessages.take(28),
        pendingDiagnostics = diagnostics,
        readyRequestId = readyRequestId,
    )

    replay.sendToFrame(extraHostMessages.last())
    replay.markFrameReady()
    replay.flushPending()
    replay.flushPending()

    val postedTypes = replay.posted.map(::jsonMessageType)
    val contextPaths = replay.posted
        .filter { jsonMessageType(it) == "host.contextSnapshot" }
        .map { it.getAsJsonObject("payload").getAsJsonObject("file").get("workspaceRelativePath").asString }

    assertEquals(31, replay.posted.size)
    assertEquals("host.ready", postedTypes.first())
    assertEquals(1, postedTypes.count { it == "host.ready" })
    assertEquals(1, postedTypes.count { it == "host.openedFromCommand" })
    assertEquals(0, postedTypes.count { it == "host.runtimeStatus" })
    assertEquals((1..29).map { "src/File$it.kt" }, contextPaths)
    assertEquals((3..18).map { "diagnostic-$it" }, replay.shownDiagnostics)
    assertEquals(0, replay.pendingHostLength)
    assertEquals(0, replay.pendingDiagnosticsLength)
}

private fun hostMessage(message: String) = JsonParser.parseString(message).asJsonObject

private fun jsonMessageType(message: com.google.gson.JsonObject): String = message.get("type").asString

private class PendingHostReplayHarness(
    pendingHostMessages: List<com.google.gson.JsonObject>,
    pendingDiagnostics: List<String>,
    private val readyRequestId: String,
) {
    private val maxPendingHostMessages = 32
    private val maxPendingDiagnostics = 16
    private val pendingHostMessages = pendingHostMessages.takeLast(maxPendingHostMessages).toMutableList()
    private val pendingDiagnostics = pendingDiagnostics.takeLast(maxPendingDiagnostics).toMutableList()
    private var frameReady = false
    private var currentGuiReadySequence = 0
    private val guiReadySequence = 1
    private var currentGuiReadyRequestId: String? = null
    private var acceptedHostReadyRequestId: String? = null
    private var hostReadyAcceptedForCurrentFrame = false
    val posted = mutableListOf<com.google.gson.JsonObject>()
    val shownDiagnostics = mutableListOf<String>()
    val pendingHostLength: Int get() = pendingHostMessages.size
    val pendingDiagnosticsLength: Int get() = pendingDiagnostics.size

    fun markFrameReady() {
        frameReady = true
        currentGuiReadySequence = 1
        currentGuiReadyRequestId = readyRequestId
    }

    fun sendToFrame(message: com.google.gson.JsonObject) {
        if (!isHostMessage(message)) return
        if (!frameReady) {
            pushBounded(pendingHostMessages, message, maxPendingHostMessages)
            return
        }
        postToFrame(message)
    }

    fun flushPending() {
        while (pendingDiagnostics.isNotEmpty()) shownDiagnostics.add(pendingDiagnostics.removeAt(0))
        val hostMessages = pendingHostMessages.toList()
        pendingHostMessages.clear()
        hostMessages.forEach(::postToFrame)
    }

    private fun postToFrame(message: com.google.gson.JsonObject) {
        if (isHostMessage(message) && canDeliverHostMessage(message)) {
            posted.add(message)
            if (jsonMessageType(message) == "host.ready") {
                acceptedHostReadyRequestId = requestId(message)
                hostReadyAcceptedForCurrentFrame = true
            }
        }
    }

    private fun canDeliverHostMessage(message: com.google.gson.JsonObject): Boolean {
        return when (jsonMessageType(message)) {
            "host.openedFromCommand" -> frameReady && hostReadyAcceptedForCurrentFrame && acceptedHostReadyRequestId == currentReadyRequestId() && requestId(message) == null
            "host.runtimeStatus" -> frameReady && requestId(message) == null
            "host.ready" -> messageMatchesCurrentReady(message)
            else -> messageMatchesCurrentReady(message) && hostReadyAcceptedForCurrentFrame && acceptedHostReadyRequestId == currentReadyRequestId()
        }
    }

    private fun messageMatchesCurrentReady(message: com.google.gson.JsonObject): Boolean =
        frameReady && currentGuiReadySequence == guiReadySequence && requestId(message) == currentReadyRequestId()

    private fun currentReadyRequestId(): String? = currentGuiReadyRequestId

    private fun isHostMessage(message: com.google.gson.JsonObject): Boolean {
        if (message.get("version")?.asString != "2026-05-15") return false
        return when (jsonMessageType(message)) {
            "host.ready" -> hasPayload(message)
            "host.contextSnapshot" -> hasPayload(message)
            "host.openedFromCommand" -> requestId(message) == null
            "host.runtimeStatus" -> requestId(message) == null && hasPayload(message)
            else -> false
        }
    }

    private fun requestId(message: com.google.gson.JsonObject): String? {
        val element = message.get("requestId") ?: return null
        return if (element.isJsonNull) null else element.asString
    }

    private fun hasPayload(message: com.google.gson.JsonObject): Boolean = message.get("payload")?.isJsonObject == true

    private fun pushBounded(queue: MutableList<com.google.gson.JsonObject>, message: com.google.gson.JsonObject, maxSize: Int) {
        queue.add(message)
        while (queue.size > maxSize) queue.removeAt(0)
    }
}

private class FakeIdeActionHost(private val result: IdeActionHostResult) : IdeActionHost {
    override fun execute(request: ControlledIdeActions.Request): CompletableFuture<IdeActionHostResult> = CompletableFuture.completedFuture(result)
}

private class FakeApplyWorkspaceEditHost(private val result: ApplyWorkspaceEditHostResult) : ApplyWorkspaceEditHost {
    var appliedCount = 0

    override fun apply(request: ControlledIdeActions.ApplyWorkspaceEditRequest): CompletableFuture<ApplyWorkspaceEditHostResult> {
        appliedCount += 1
        return CompletableFuture.completedFuture(result)
    }
}

private class FakeApplyWorkspaceEditConfirmer(private val confirmed: Boolean) : ApplyWorkspaceEditConfirmer {
    override fun confirm(summary: String, affectedFiles: List<String>): Boolean = confirmed
}

private class TestDeliveryGate(private val execute: (String) -> Unit) {
    private var disposed = false

    fun deliver(script: String): Boolean {
        if (disposed) return false
        execute(script)
        return true
    }

    fun dispose() {
        disposed = true
    }
}
