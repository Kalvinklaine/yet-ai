import { afterEach, describe, expect, it, vi } from "vitest";
import { createBridgeAdapter, isApplyWorkspaceEditPayload, isApplyWorkspaceEditResultPayload, isGuiMessage, isHostMessage, isIdeActionProgressPayload, isIdeActionRequestPayload, isIdeActionResultPayload } from "./bridgeAdapter";
import guiReadyMessage from "../../../../packages/contracts/examples/bridge/gui-ready-message.json";
import hostOpenedFromCommandMessage from "../../../../packages/contracts/examples/bridge/host-opened-from-command-message.json";
import hostContextSnapshotMessage from "../../../../packages/contracts/examples/bridge/host-context-snapshot-message.json";
import hostReadyMessage from "../../../../packages/contracts/examples/bridge/host-ready-message.json";
import guiApplyWorkspaceEditRequestValidMessage from "../../../../packages/contracts/examples/bridge/gui-apply-workspace-edit-request-message.json";
import hostApplyWorkspaceEditResultAppliedMessage from "../../../../packages/contracts/examples/bridge/host-apply-workspace-edit-result-applied.json";
import hostApplyWorkspaceEditResultDeniedMessage from "../../../../packages/contracts/examples/bridge/host-apply-workspace-edit-result-denied.json";
import guiApplyWorkspaceEditRequestMessage from "../../../../packages/contracts/examples-invalid/bridge/gui-apply-workspace-edit-request-message.json";
import guiCopyTextMessage from "../../../../packages/contracts/examples-invalid/bridge/gui-copy-text-message.json";
import guiExecuteIdeToolMessage from "../../../../packages/contracts/examples-invalid/bridge/gui-execute-ide-tool-message.json";
import guiGetHostContextMessage from "../../../../packages/contracts/examples-invalid/bridge/gui-get-host-context-message.json";
import guiOpenFileMessage from "../../../../packages/contracts/examples-invalid/bridge/gui-open-file-message.json";
import guiReadyExtraPayloadMessage from "../../../../packages/contracts/examples-invalid/bridge/gui-ready-extra-payload.json";
import guiRevealRangeMessage from "../../../../packages/contracts/examples-invalid/bridge/gui-reveal-range-message.json";
import guiShowNotificationMessage from "../../../../packages/contracts/examples-invalid/bridge/gui-show-notification-message.json";
import hostContextSnapshotAbsolutePathMessage from "../../../../packages/contracts/examples-invalid/bridge/host-context-snapshot-absolute-path.json";
import hostContextSnapshotPrivilegedCommandMessage from "../../../../packages/contracts/examples-invalid/bridge/host-context-snapshot-privileged-command.json";
import hostContextSnapshotUnknownFieldMessage from "../../../../packages/contracts/examples-invalid/bridge/host-context-snapshot-unknown-field.json";
import hostOpenedFromCommandPayloadMessage from "../../../../packages/contracts/examples-invalid/bridge/host-opened-from-command-payload.json";
import guiApplyWorkspaceEditMissingConfirmationMessage from "../../../../packages/contracts/examples-invalid/bridge/gui-apply-workspace-edit-missing-confirmation.json";
import guiApplyWorkspaceEditReversedRangeMessage from "../../../../packages/contracts/examples-invalid/bridge/gui-apply-workspace-edit-reversed-range.json";
import guiApplyWorkspaceEditPrivatePathSummaryMessage from "../../../../packages/contracts/examples-invalid/bridge/gui-apply-workspace-edit-private-path-summary.json";
import guiApplyWorkspaceEditDrivePathSummaryMessage from "../../../../packages/contracts/examples-invalid/bridge/gui-apply-workspace-edit-drive-path-summary.json";
import guiApplyWorkspaceEditEmptySegmentPathMessage from "../../../../packages/contracts/examples-invalid/bridge/gui-apply-workspace-edit-empty-segment-path.json";
import guiApplyWorkspaceEditTrailingSlashPathMessage from "../../../../packages/contracts/examples-invalid/bridge/gui-apply-workspace-edit-trailing-slash-path.json";
import guiApplyWorkspaceEditKeyLikeSummaryMessage from "../../../../packages/contracts/examples-invalid/bridge/gui-apply-workspace-edit-key-like-summary.json";
import hostApplyWorkspaceEditResultSecretMessage from "../../../../packages/contracts/examples-invalid/bridge/host-apply-workspace-edit-result-secret-message.json";
import hostApplyWorkspaceEditResultKeyLikeMessage from "../../../../packages/contracts/examples-invalid/bridge/host-apply-workspace-edit-result-key-like-message.json";
import guiIdeActionContextMessage from "../../../../packages/contracts/examples/bridge/gui-ide-action-request-get-context-snapshot.json";
import guiIdeActionOpenMessage from "../../../../packages/contracts/examples/bridge/gui-ide-action-request-open-workspace-file.json";
import guiIdeActionRevealMessage from "../../../../packages/contracts/examples/bridge/gui-ide-action-request-reveal-workspace-range.json";
import hostIdeActionProgressMessage from "../../../../packages/contracts/examples/bridge/host-ide-action-progress.json";
import hostIdeActionResultSucceededMessage from "../../../../packages/contracts/examples/bridge/host-ide-action-result-succeeded.json";
import hostIdeActionResultRejectedMessage from "../../../../packages/contracts/examples/bridge/host-ide-action-result-rejected.json";

const bridgeVersion = "2026-05-15";
const parentDescriptor = Object.getOwnPropertyDescriptor(window, "parent");
const referrerDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, "referrer");

afterEach(() => {
  delete window.acquireVsCodeApi;
  delete window.postIntellijMessage;
  localStorage.clear();
  sessionStorage.clear();
  if (parentDescriptor) {
    Object.defineProperty(window, "parent", parentDescriptor);
  }
  if (referrerDescriptor) {
    Object.defineProperty(Document.prototype, "referrer", referrerDescriptor);
  }
});

describe("bridgeAdapter", () => {
  it("sends and logs gui.ready in browser mock mode", () => {
    const logs: string[] = [];
    const adapter = createBridgeAdapter((entry) => logs.push(entry));
    expect(adapter.host).toBe("browser");
    expect(logs).toContain("Bridge host browser");
    expect(logs).toContain("Browser mock sent gui.ready");
    adapter.dispose();
  });

  it("echoes each JetBrains iframe frame nonce once in gui.ready using the referrer origin", () => {
    const logs: string[] = [];
    const parent = { postMessage: vi.fn() };
    Object.defineProperty(Document.prototype, "referrer", {
      configurable: true,
      get: () => "https://wrapper.example/shell.html",
    });
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: parent,
    });

    const adapter = createBridgeAdapter((entry) => logs.push(entry));
    const dispatchNonce = (frameNonce: string) => window.dispatchEvent(new MessageEvent("message", {
      data: {
        version: bridgeVersion,
        type: "host.frameNonce",
        payload: { frameNonce },
      },
      origin: "https://wrapper.example",
      source: parent as unknown as Window,
    }));

    dispatchNonce("0123456789abcdef0123456789abcdef");
    dispatchNonce("0123456789abcdef0123456789abcdef");
    dispatchNonce("fedcba9876543210fedcba9876543210");

    expect(adapter.host).toBe("browser");
    expect(logs).toContain("Bridge host browser");
    expect(logs).not.toContain("Browser mock sent gui.ready");
    expect(parent.postMessage).toHaveBeenCalledTimes(2);
    expect(parent.postMessage).toHaveBeenNthCalledWith(1, {
      version: bridgeVersion,
      type: "gui.ready",
      payload: {
        supportedBridgeVersion: bridgeVersion,
        frameNonce: "0123456789abcdef0123456789abcdef",
      },
    }, "https://wrapper.example");
    expect(parent.postMessage).toHaveBeenNthCalledWith(2, {
      version: bridgeVersion,
      type: "gui.ready",
      payload: {
        supportedBridgeVersion: bridgeVersion,
        frameNonce: "fedcba9876543210fedcba9876543210",
      },
    }, "https://wrapper.example");
    adapter.dispose();
  });

  it("sends JetBrains iframe unload notifications to the parent wrapper", () => {
    const parent = { postMessage: vi.fn() };
    Object.defineProperty(Document.prototype, "referrer", {
      configurable: true,
      get: () => "https://wrapper.example/shell.html",
    });
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: parent,
    });

    const adapter = createBridgeAdapter(() => undefined);
    window.dispatchEvent(new PageTransitionEvent("pagehide"));

    expect(parent.postMessage).toHaveBeenCalledWith({
      version: bridgeVersion,
      type: "gui.unloaded",
      payload: {},
    }, "https://wrapper.example");
    adapter.dispose();
  });

  it("rejects invalid JetBrains frame nonce messages without emitting gui.ready", () => {
    const parent = { postMessage: vi.fn() };
    Object.defineProperty(Document.prototype, "referrer", {
      configurable: true,
      get: () => "https://wrapper.example/shell.html",
    });
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: parent,
    });

    const logs: string[] = [];
    const adapter = createBridgeAdapter((entry) => logs.push(entry));
    parent.postMessage.mockClear();
    const base = {
      version: bridgeVersion,
      type: "host.frameNonce",
    };
    const dispatch = (data: unknown, origin = "https://wrapper.example", source: Window = parent as unknown as Window) => window.dispatchEvent(new MessageEvent("message", {
      data,
      origin,
      source,
    }));

    for (const message of [
      { ...base },
      { ...base, payload: {} },
      { ...base, payload: { frameNonce: "0123456789abcdef0123456789abcde" } },
      { ...base, payload: { frameNonce: "0123456789abcdef0123456789abcdef0" } },
      { ...base, payload: { frameNonce: "0123456789ABCDEF0123456789ABCDEF" } },
      { ...base, payload: { frameNonce: 123 } },
      { ...base, payload: { frameNonce: "0123456789abcdef0123456789abcdef", extra: true } },
    ]) {
      dispatch(message);
    }
    dispatch({ ...base, payload: { frameNonce: "0123456789abcdef0123456789abcdef" } }, "https://attacker.example");
    dispatch({ ...base, payload: { frameNonce: "0123456789abcdef0123456789abcdef" } }, "https://wrapper.example", { postMessage: vi.fn() } as unknown as Window);

    expect(parent.postMessage).not.toHaveBeenCalled();
    expect(logs).toContain("Bridge host browser");
    expect(logs).toContain("Rejected host bridge message from unexpected origin");
    expect(logs).toContain("Rejected host bridge message from unexpected source");
    expect(logs.filter((entry) => entry === "Rejected invalid host bridge message")).toHaveLength(7);
    adapter.dispose();
  });

  it("accepts host.ready from the captured iframe parent without token logging or storage", () => {
    const token = "iframe-parent-session-token-secret";
    const logs: string[] = [];
    const messages: unknown[] = [];
    const parent = { postMessage: vi.fn() };
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: parent,
    });

    const adapter = createBridgeAdapter((entry) => logs.push(entry));
    adapter.subscribe((message) => messages.push(message));
    window.dispatchEvent(new MessageEvent("message", {
      data: hostReady({ sessionToken: token }),
      source: parent as unknown as Window,
    }));

    expect(messages).toHaveLength(1);
    expect(JSON.stringify(messages[0])).toContain(token);
    expect(logs).toContain("Host runtime settings received");
    expect(logs.join("\n")).not.toContain(token);
    expect(JSON.stringify(localStorage)).not.toContain(token);
    expect(JSON.stringify(sessionStorage)).not.toContain(token);
    adapter.dispose();
  });

  it("rejects valid-looking host messages from an unexpected iframe source", () => {
    const logs: string[] = [];
    const messages: unknown[] = [];
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: { postMessage: vi.fn() },
    });

    const adapter = createBridgeAdapter((entry) => logs.push(entry));
    adapter.subscribe((message) => messages.push(message));
    window.dispatchEvent(new MessageEvent("message", {
      data: hostReady(),
      source: { postMessage: vi.fn() } as unknown as Window,
    }));

    expect(messages).toHaveLength(0);
    expect(logs).toContain("Rejected host bridge message from unexpected source");
    expect(logs).not.toContain("Host runtime settings received");
    adapter.dispose();
  });

  it("rejects parent host messages from the wrong origin when referrer origin is known", () => {
    const logs: string[] = [];
    const messages: unknown[] = [];
    const parent = { postMessage: vi.fn() };
    Object.defineProperty(Document.prototype, "referrer", {
      configurable: true,
      get: () => "https://wrapper.example/shell.html",
    });
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: parent,
    });

    const adapter = createBridgeAdapter((entry) => logs.push(entry));
    adapter.subscribe((message) => messages.push(message));
    window.dispatchEvent(new MessageEvent("message", {
      data: hostReady(),
      origin: "https://attacker.example",
      source: parent as unknown as Window,
    }));

    expect(messages).toHaveLength(0);
    expect(logs).toContain("Rejected host bridge message from unexpected origin");
    adapter.dispose();
  });

  it("keeps top-level browser mock message behavior", () => {
    const logs: string[] = [];
    const messages: unknown[] = [];
    const adapter = createBridgeAdapter((entry) => logs.push(entry));
    adapter.subscribe((message) => messages.push(message));
    window.dispatchEvent(new MessageEvent("message", { data: hostReady() }));
    expect(messages).toHaveLength(1);
    expect(logs).toContain("Host runtime settings received");
    adapter.dispose();
  });

  it("keeps direct VS Code mode posting and receiving", () => {
    const logs: string[] = [];
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });

    const adapter = createBridgeAdapter((entry) => logs.push(entry));
    const messages: unknown[] = [];
    adapter.subscribe((message) => messages.push(message));
    window.dispatchEvent(new MessageEvent("message", { data: hostReady() }));

    expect(adapter.host).toBe("vscode");
    expect(postMessage).toHaveBeenCalledWith({
      version: bridgeVersion,
      type: "gui.ready",
      payload: { supportedBridgeVersion: bridgeVersion },
    });
    expect(messages).toHaveLength(1);
    adapter.dispose();
  });

  it("rejects request ids with compact secret markers", () => {
    for (const requestId of ["AuthorizationBearerFake", "apiKeySecretValue", "sk-proj-abcdef1234567890", "access_token"]) {
      expect(isGuiMessage({ ...guiIdeActionContextMessage, requestId })).toBe(false);
      expect(isHostMessage({ ...hostIdeActionProgressMessage, requestId })).toBe(false);
    }
    expect(isGuiMessage({ ...guiIdeActionContextMessage, requestId: "gui-ide-action-1" })).toBe(true);
    expect(isHostMessage({ ...hostIdeActionProgressMessage, requestId: "gui-ide-action-1" })).toBe(true);
  });

  it("posts only gui.ready to VS Code and drops disabled privileged GUI messages with generic logs", () => {
    const logs: string[] = [];
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });

    const adapter = createBridgeAdapter((entry) => logs.push(entry));
    postMessage.mockClear();

    const disabledMessages = [
      guiOpenFileMessage,
      guiRevealRangeMessage,
      guiApplyWorkspaceEditRequestMessage,
      guiExecuteIdeToolMessage,
      guiCopyTextMessage,
      guiShowNotificationMessage,
      guiGetHostContextMessage,
    ];

    for (const message of disabledMessages) {
      expect(isGuiMessage(message)).toBe(false);
      adapter.post(message as never);
    }

    expect(postMessage).not.toHaveBeenCalled();
    expect(logs.filter((entry) => entry === "Rejected invalid GUI bridge message")).toHaveLength(disabledMessages.length);
    expect(logs.join("\n")).not.toContain("src/example.ts");
    expect(logs.join("\n")).not.toContain("Example text");
    expect(logs.join("\n")).not.toContain("example.disabledTool");
    adapter.dispose();
  });

  it("posts valid apply workspace edit requests only through explicit adapter.post", () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });

    const adapter = createBridgeAdapter(() => undefined);
    postMessage.mockClear();
    adapter.post(guiApplyWorkspaceEditRequestValidMessage as never);

    expect(isGuiMessage(guiApplyWorkspaceEditRequestValidMessage)).toBe(true);
    expect(isApplyWorkspaceEditPayload(guiApplyWorkspaceEditRequestValidMessage.payload)).toBe(true);
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith(guiApplyWorkspaceEditRequestValidMessage);
    adapter.dispose();
  });

  it("accepts valid apply workspace edit proposals with multiple text replacements", () => {
    const message = {
      version: bridgeVersion,
      type: "gui.applyWorkspaceEditRequest",
      requestId: "req-apply-edit-multiple-001",
      payload: {
        requiresUserConfirmation: true,
        summary: "Replace two reviewed ranges.",
        cloudRequired: false,
        edits: [
          {
            workspaceRelativePath: "src/example.ts",
            textReplacements: [
              {
                range: { start: { line: 4, character: 2 }, end: { line: 4, character: 18 } },
                replacementText: "const label = \"Yet AI\";",
              },
              {
                range: { start: { line: 6, character: 0 }, end: { line: 6, character: 12 } },
                replacementText: "export {};",
              },
            ],
          },
        ],
      },
    };

    expect(isGuiMessage(message)).toBe(true);
    expect(isApplyWorkspaceEditPayload(message.payload)).toBe(true);
  });

  it("rejects missing, undefined, or non-canonical apply workspace edit paths", () => {
    const missingPathMessage = applyEditMessage({ requestId: "req-apply-edit-missing-path-001", summary: "Missing path." });
    delete (missingPathMessage.payload.edits[0] as Record<string, unknown>).workspaceRelativePath;
    const invalidMessages = [
      missingPathMessage,
      applyEditMessage({ requestId: "req-apply-edit-undefined-path-001", summary: "Undefined path.", fileEdit: { workspaceRelativePath: undefined } }),
      applyEditMessage({ requestId: "req-apply-edit-empty-segment-001", fileEdit: { workspaceRelativePath: "src//main.ts" } }),
      applyEditMessage({ requestId: "req-apply-edit-trailing-slash-001", fileEdit: { workspaceRelativePath: "src/" } }),
      applyEditMessage({ requestId: "req-apply-edit-leading-slash-001", fileEdit: { workspaceRelativePath: "/src/main.ts" } }),
      applyEditMessage({ requestId: "req-apply-edit-dot-segment-001", fileEdit: { workspaceRelativePath: "./src/main.ts" } }),
    ];

    for (const message of invalidMessages) {
      expect(isGuiMessage(message)).toBe(false);
      expect(isApplyWorkspaceEditPayload(message.payload)).toBe(false);
    }
  });

  it("rejects apply workspace edit summaries with raw private absolute paths", () => {
    for (const summary of [
      "Update reviewed text in /Users/alice/project/src/main.ts.",
      "Update reviewed text in /home/alice/project/src/main.ts.",
      "Update reviewed text in /tmp/project/src/main.ts.",
      "Update reviewed text in /var/project/src/main.ts.",
      "Update reviewed text in /Volumes/work/project/src/main.ts.",
      "Update reviewed text in /Private/work/project/src/main.ts.",
      "Update reviewed text in ~/project/src/main.ts.",
      "Update reviewed text in C:/Users/alice/project/src/main.ts.",
      "Update reviewed text in C:\\Users\\alice\\project\\src\\main.ts.",
    ]) {
      const message = applyEditMessage({ summary });
      expect(isGuiMessage(message)).toBe(false);
      expect(isApplyWorkspaceEditPayload(message.payload)).toBe(false);
    }
  });

  it("rejects apply workspace edit summaries with key-like secret values", () => {
    for (const summary of [
      "Update reviewed text near sk-abcdefghijklmnopqrstuvwxyz.",
      "Update reviewed text near sk-proj-abcdefghijklmnopqrstuvwxyz.",
    ]) {
      const message = applyEditMessage({ summary });
      expect(isGuiMessage(message)).toBe(false);
      expect(isApplyWorkspaceEditPayload(message.payload)).toBe(false);
    }
  });

  it("rejects undefined affected files in apply workspace edit results", () => {
    const message = {
      version: bridgeVersion,
      type: "host.applyWorkspaceEditResult",
      requestId: "req-apply-edit-001",
      payload: {
        status: "applied",
        message: "Applied after user confirmation.",
        cloudRequired: false,
        appliedEditCount: 1,
        affectedFiles: [undefined],
      },
    };

    expect(isApplyWorkspaceEditResultPayload(message.payload)).toBe(false);
    expect(isHostMessage(message)).toBe(false);
  });

  it("rejects apply workspace edit results with raw POSIX private paths", () => {
    const message = {
      version: bridgeVersion,
      type: "host.applyWorkspaceEditResult",
      requestId: "req-apply-edit-001",
      payload: {
        status: "failed",
        message: "Failed while applying /home/alice/project/src/private.ts.",
        cloudRequired: false,
        appliedEditCount: 0,
        affectedFiles: ["src/example.ts"],
      },
    };

    expect(isApplyWorkspaceEditResultPayload(message.payload)).toBe(false);
    expect(isHostMessage(message)).toBe(false);
  });

  it("rejects apply workspace edit result messages with key-like secret values", () => {
    for (const resultMessage of [
      "Failed while applying sk-abcdefghijklmnopqrstuvwxyz.",
      "Failed while applying sk-proj-abcdefghijklmnopqrstuvwxyz.",
    ]) {
      const message = {
        version: bridgeVersion,
        type: "host.applyWorkspaceEditResult",
        requestId: "req-apply-edit-001",
        payload: {
          status: "failed",
          message: resultMessage,
          cloudRequired: false,
          appliedEditCount: 0,
          affectedFiles: ["src/example.ts"],
        },
      };

      expect(isApplyWorkspaceEditResultPayload(message.payload)).toBe(false);
      expect(isHostMessage(message)).toBe(false);
    }
  });

  it("rejects invalid apply workspace edit requests before posting", () => {
    const logs: string[] = [];
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });

    const adapter = createBridgeAdapter((entry) => logs.push(entry));
    postMessage.mockClear();

    for (const message of [guiApplyWorkspaceEditMissingConfirmationMessage, guiApplyWorkspaceEditReversedRangeMessage]) {
      expect(isGuiMessage(message)).toBe(false);
      adapter.post(message as never);
    }

    expect(postMessage).not.toHaveBeenCalled();
    expect(logs.filter((entry) => entry === "Rejected invalid GUI bridge message")).toHaveLength(2);
    adapter.dispose();
  });

  it("posts accepted gui.ready through adapter.post", () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });

    const adapter = createBridgeAdapter(() => undefined);
    postMessage.mockClear();
    adapter.post(guiReadyMessage as never);

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith(guiReadyMessage);
    adapter.dispose();
  });

  it("rejects malformed outbound GUI messages before posting", () => {
    const logs: string[] = [];
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });

    const adapter = createBridgeAdapter((entry) => logs.push(entry));
    postMessage.mockClear();

    const invalidMessages = [
      { version: "1", type: "gui.ready", payload: { supportedBridgeVersion: bridgeVersion } },
      { version: bridgeVersion, type: "gui.ready", payload: { supportedBridgeVersion: bridgeVersion, token: "secret-token-value" } },
      { version: bridgeVersion, type: "gui.unknown", requestId: "unknown-secret-id", payload: { text: "secret payload" } },
      { version: bridgeVersion, type: "gui.ready", requestId: "", payload: { supportedBridgeVersion: bridgeVersion } },
      { version: bridgeVersion, type: "gui.ready", requestId: "a".repeat(129), payload: { supportedBridgeVersion: bridgeVersion } },
      { version: bridgeVersion, type: "gui.ready", requestId: "../secret", payload: { supportedBridgeVersion: bridgeVersion } },
      { version: bridgeVersion, type: "gui.ready", requestId: "sk-secret/request", payload: { supportedBridgeVersion: bridgeVersion } },
    ];

    for (const message of invalidMessages) {
      adapter.post(message as never);
    }

    expect(postMessage).not.toHaveBeenCalled();
    expect(logs.filter((entry) => entry === "Rejected invalid GUI bridge message")).toHaveLength(invalidMessages.length);
    expect(logs.join("\n")).not.toContain("secret-token-value");
    expect(logs.join("\n")).not.toContain("unknown-secret-id");
    expect(logs.join("\n")).not.toContain("secret payload");
    adapter.dispose();
  });

  it("delivers synchronous VS Code host.ready replies after subscribe", () => {
    const logs: string[] = [];
    window.acquireVsCodeApi = () => ({
      postMessage: () => window.dispatchEvent(new MessageEvent("message", { data: hostReady({ sessionToken: "sync-vscode-token" }) })),
    });

    const adapter = createBridgeAdapter((entry) => logs.push(entry));
    const messages: unknown[] = [];
    adapter.subscribe((message) => messages.push(message));

    expect(messages).toHaveLength(1);
    expect(JSON.stringify(messages[0])).toContain("sync-vscode-token");
    expect(logs).toContain("Host runtime settings received");
    expect(logs.join("\n")).not.toContain("sync-vscode-token");
    adapter.dispose();
  });

  it("keeps direct JetBrains mode posting and receiving", () => {
    const logs: string[] = [];
    const postIntellijMessage = vi.fn();
    window.postIntellijMessage = postIntellijMessage;

    const adapter = createBridgeAdapter((entry) => logs.push(entry));
    const messages: unknown[] = [];
    adapter.subscribe((message) => messages.push(message));
    window.dispatchEvent(new MessageEvent("message", { data: hostReady() }));

    expect(adapter.host).toBe("jetbrains");
    expect(postIntellijMessage).toHaveBeenCalledWith({
      version: bridgeVersion,
      type: "gui.ready",
      payload: { supportedBridgeVersion: bridgeVersion },
    });
    expect(messages).toHaveLength(1);
    adapter.dispose();
  });

  it("delivers synchronous JetBrains host.ready replies after subscribe", () => {
    const logs: string[] = [];
    window.postIntellijMessage = () => window.dispatchEvent(new MessageEvent("message", { data: hostReady({ sessionToken: "sync-jetbrains-token" }) }));

    const adapter = createBridgeAdapter((entry) => logs.push(entry));
    const messages: unknown[] = [];
    adapter.subscribe((message) => messages.push(message));

    expect(adapter.host).toBe("jetbrains");
    expect(messages).toHaveLength(1);
    expect(JSON.stringify(messages[0])).toContain("sync-jetbrains-token");
    expect(logs.join("\n")).not.toContain("sync-jetbrains-token");
    adapter.dispose();
  });

  it("does not flush invalid queued host replies", () => {
    window.postIntellijMessage = () => window.dispatchEvent(new MessageEvent("message", { data: { version: bridgeVersion, type: "host.ready", payload: { sessionToken: 123 } } }));

    const logs: string[] = [];
    const adapter = createBridgeAdapter((entry) => logs.push(entry));
    const messages: unknown[] = [];
    adapter.subscribe((message) => messages.push(message));

    expect(messages).toHaveLength(0);
    expect(logs).toContain("Rejected invalid host bridge message");
    adapter.dispose();
  });

  it("does not flush wrong-source queued parent messages", () => {
    const parent = { postMessage: vi.fn() };
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: parent,
    });

    const logs: string[] = [];
    const adapter = createBridgeAdapter((entry) => logs.push(entry));
    const messages: unknown[] = [];
    adapter.subscribe((message) => messages.push(message));
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        version: bridgeVersion,
        type: "host.frameNonce",
        payload: { frameNonce: "0123456789abcdef0123456789abcdef" },
      },
      source: parent as unknown as Window,
    }));
    window.dispatchEvent(new MessageEvent("message", {
      data: hostReady(),
      source: { postMessage: vi.fn() } as unknown as Window,
    }));

    expect(messages).toHaveLength(0);
    expect(logs).toContain("Rejected host bridge message from unexpected source");
    adapter.dispose();
  });

  it("clears pending host replies on dispose", () => {
    window.postIntellijMessage = () => window.dispatchEvent(new MessageEvent("message", { data: hostReady() }));

    const adapter = createBridgeAdapter(() => undefined);
    adapter.dispose();
    const messages: unknown[] = [];
    adapter.subscribe((message) => messages.push(message));

    expect(messages).toHaveLength(0);
  });

  it("accepts positive bridge contract fixtures through runtime validation", () => {
    expect(isGuiMessage(guiReadyMessage)).toBe(true);
    expect(isGuiMessage(guiIdeActionContextMessage)).toBe(true);
    expect(isGuiMessage(guiIdeActionOpenMessage)).toBe(true);
    expect(isGuiMessage(guiIdeActionRevealMessage)).toBe(true);
    expect(isIdeActionRequestPayload(guiIdeActionRevealMessage.payload)).toBe(true);
    expect(isHostMessage(hostReadyMessage)).toBe(true);
    expect(isHostMessage(hostOpenedFromCommandMessage)).toBe(true);
    expect(isHostMessage(hostContextSnapshotMessage)).toBe(true);
    expect(isHostMessage(hostIdeActionProgressMessage)).toBe(true);
    expect(isHostMessage(hostIdeActionResultSucceededMessage)).toBe(true);
    expect(isHostMessage(hostIdeActionResultRejectedMessage)).toBe(true);
    expect(isIdeActionProgressPayload(hostIdeActionProgressMessage.payload)).toBe(true);
    expect(isIdeActionResultPayload(hostIdeActionResultSucceededMessage.payload)).toBe(true);
    expect(isGuiMessage(guiApplyWorkspaceEditRequestValidMessage)).toBe(true);
    expect(isHostMessage(hostApplyWorkspaceEditResultAppliedMessage)).toBe(true);
    expect(isHostMessage(hostApplyWorkspaceEditResultDeniedMessage)).toBe(true);

    const logs: string[] = [];
    const messages: unknown[] = [];
    const adapter = createBridgeAdapter((entry) => logs.push(entry));
    adapter.subscribe((message) => messages.push(message));
    window.dispatchEvent(new MessageEvent("message", { data: hostReadyMessage }));
    window.dispatchEvent(new MessageEvent("message", { data: hostOpenedFromCommandMessage }));
    window.dispatchEvent(new MessageEvent("message", { data: hostContextSnapshotMessage }));
    window.dispatchEvent(new MessageEvent("message", { data: hostIdeActionProgressMessage }));

    expect(messages).toEqual([hostReadyMessage, hostOpenedFromCommandMessage, hostContextSnapshotMessage, hostIdeActionProgressMessage]);
    expect(logs).toContain("Host runtime settings received");
    expect(logs).toContain("Host message host.contextSnapshot");
    expect(logs.join("\n")).not.toContain(hostReadyMessage.payload.sessionToken);
    expect(logs.join("\n")).not.toContain(hostContextSnapshotMessage.payload.selection.text);
    adapter.dispose();
  });

  it("validates IDE action messages and rejects traversal, private paths, secret-like messages, and raw fields", () => {
    expect(isGuiMessage({ version: bridgeVersion, type: "gui.ideActionRequest", requestId: "req-1", payload: { action: "getContextSnapshot" } })).toBe(true);
    expect(isGuiMessage({ version: bridgeVersion, type: "gui.ideActionRequest", requestId: "req-2", payload: { action: "openWorkspaceFile", workspaceRelativePath: "src/App.tsx" } })).toBe(true);
    expect(isGuiMessage({ version: bridgeVersion, type: "gui.ideActionRequest", requestId: "req-3", payload: { action: "openWorkspaceFile", workspaceRelativePath: "../secret.ts" } })).toBe(false);
    expect(isGuiMessage({ version: bridgeVersion, type: "gui.ideActionRequest", requestId: "req-4", payload: { action: "revealWorkspaceRange", workspaceRelativePath: "/Users/alice/project/src/App.tsx", range: { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } } } })).toBe(false);
    expect(isGuiMessage({ version: bridgeVersion, type: "gui.ideActionRequest", requestId: "req-5", payload: { action: "revealWorkspaceRange", workspaceRelativePath: "src/App.tsx", range: { start: { line: 2, character: 0 }, end: { line: 1, character: 3 } } } })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ideActionProgress", requestId: "req-6", payload: { phase: "running", status: "inProgress", summary: "Reading /Users/alice/project/file.ts", cloudRequired: false, action: "getContextSnapshot" } })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ideActionResult", requestId: "req-7", payload: { status: "failed", message: "provider response sk-abcdefghijklmnopqrstuvwxyz", cloudRequired: false, action: "getContextSnapshot" } })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ideActionResult", requestId: "req-8", payload: { status: "succeeded", message: "Done.", cloudRequired: false, action: "getContextSnapshot", rawPrompt: "show me" } })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ideActionResult", requestId: "req-9", payload: { status: "succeeded", message: "Opened.", cloudRequired: false, action: "openWorkspaceFile" } })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ideActionProgress", requestId: "req-10", payload: { phase: "completed", status: "succeeded", summary: "Revealed.", cloudRequired: false, action: "revealWorkspaceRange", workspaceRelativePath: "src/App.tsx" } })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ideActionProgress", requestId: "req-11", payload: { phase: "completed", status: "succeeded", summary: "Revealed.", cloudRequired: false, action: "revealWorkspaceRange", workspaceRelativePath: "src/App.tsx", range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } } } })).toBe(true);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ideActionResult", requestId: "req-12", payload: { status: "succeeded", message: "Opened.", cloudRequired: false, action: "openWorkspaceFile", workspaceRelativePath: "config/secret.env" } })).toBe(false);
  });

  it("keeps bounded selection text as active user-selected prompt context only", () => {
    expect(isHostMessage(contextSnapshot({ payload: { kind: "active_editor", source: "vscode", selection: { text: "Bearer user-selected text stays prompt context, not action metadata" } } }))).toBe(true);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ideActionResult", requestId: "req-context", payload: { status: "succeeded", message: "Done.", cloudRequired: false, action: "getContextSnapshot", context: { text: "Bearer unsafe action metadata" } } })).toBe(false);
  });

  it("rejects invalid bridge contract fixtures through runtime validation", () => {
    expect(isGuiMessage(guiReadyExtraPayloadMessage)).toBe(false);
    expect(isHostMessage(hostOpenedFromCommandPayloadMessage)).toBe(false);
    expect(isHostMessage(hostContextSnapshotAbsolutePathMessage)).toBe(false);
    expect(isHostMessage(hostContextSnapshotPrivilegedCommandMessage)).toBe(false);
    expect(isHostMessage(hostContextSnapshotUnknownFieldMessage)).toBe(false);
    expect(isGuiMessage(guiApplyWorkspaceEditMissingConfirmationMessage)).toBe(false);
    expect(isGuiMessage(guiApplyWorkspaceEditReversedRangeMessage)).toBe(false);
    expect(isGuiMessage(guiApplyWorkspaceEditPrivatePathSummaryMessage)).toBe(false);
    expect(isGuiMessage(guiApplyWorkspaceEditDrivePathSummaryMessage)).toBe(false);
    expect(isGuiMessage(guiApplyWorkspaceEditEmptySegmentPathMessage)).toBe(false);
    expect(isGuiMessage(guiApplyWorkspaceEditTrailingSlashPathMessage)).toBe(false);
    expect(isGuiMessage(guiApplyWorkspaceEditKeyLikeSummaryMessage)).toBe(false);
    expect(isApplyWorkspaceEditResultPayload(hostApplyWorkspaceEditResultSecretMessage.payload)).toBe(false);
    expect(isHostMessage(hostApplyWorkspaceEditResultSecretMessage)).toBe(false);
    expect(isApplyWorkspaceEditResultPayload(hostApplyWorkspaceEditResultKeyLikeMessage.payload)).toBe(false);
    expect(isHostMessage(hostApplyWorkspaceEditResultKeyLikeMessage)).toBe(false);

    const logs: string[] = [];
    const messages: unknown[] = [];
    const adapter = createBridgeAdapter((entry) => logs.push(entry));
    adapter.subscribe((message) => messages.push(message));
    window.dispatchEvent(new MessageEvent("message", { data: hostOpenedFromCommandPayloadMessage }));
    window.dispatchEvent(new MessageEvent("message", { data: hostContextSnapshotPrivilegedCommandMessage }));

    expect(messages).toHaveLength(0);
    expect(logs).toContain("Rejected invalid host bridge message");
    expect(logs.join("\n")).not.toContain("README.md");
    expect(logs.join("\n")).not.toContain("replaceRange");
    adapter.dispose();
  });

  it("accepts current non-privileged host messages", () => {
    expect(isHostMessage(hostReady())).toBe(true);
    expect(isHostMessage({ version: bridgeVersion, type: "host.openedFromCommand" })).toBe(true);
    expect(isHostMessage({ version: bridgeVersion, type: "host.openedFromCommand", payload: {} })).toBe(true);
    expect(isHostMessage(contextSnapshot())).toBe(true);
  });

  it("accepts JetBrains active editor context snapshots", () => {
    const message = contextSnapshot({
      payload: {
        kind: "active_editor",
        source: "jetbrains",
        file: {
          displayPath: "src/App.kt",
          workspaceRelativePath: "src/App.kt",
          languageId: "kotlin",
        },
        selection: {
          startLine: 4,
          startCharacter: 2,
          endLine: 4,
          endCharacter: 20,
          text: "val answer = 42",
        },
      },
    });

    expect(isHostMessage(message)).toBe(true);
  });

  it("validates gui.ready against the strict current schema", () => {
    expect(isGuiMessage({ version: bridgeVersion, type: "gui.ready" })).toBe(true);
    expect(isGuiMessage({ version: bridgeVersion, type: "gui.ready", requestId: "r1", payload: { supportedBridgeVersion: bridgeVersion } })).toBe(true);
    expect(isGuiMessage({ version: bridgeVersion, type: "gui.ready", payload: { supportedBridgeVersion: bridgeVersion, frameNonce: "0123456789abcdef0123456789abcdef" } })).toBe(true);
    expect(isGuiMessage({ version: "", type: "gui.ready" })).toBe(false);
    expect(isGuiMessage({ version: "1", type: "gui.ready" })).toBe(false);
    expect(isGuiMessage({ version: bridgeVersion, type: "gui.ready", requestId: "" })).toBe(false);
    expect(isGuiMessage({ version: bridgeVersion, type: "gui.ready", requestId: "a".repeat(129) })).toBe(false);
    expect(isGuiMessage({ version: bridgeVersion, type: "gui.ready", requestId: "bad\nrequest" })).toBe(false);
    expect(isGuiMessage({ version: bridgeVersion, type: "gui.ready", requestId: "bad\u007frequest" })).toBe(false);
    expect(isGuiMessage({ version: bridgeVersion, type: "gui.ready", requestId: "bad\u0080request" })).toBe(false);
    expect(isGuiMessage({ version: bridgeVersion, type: "gui.ready", requestId: "bad\u009frequest" })).toBe(false);
    expect(isGuiMessage({ version: bridgeVersion, type: "gui.ready", requestId: "../secret" })).toBe(false);
    expect(isGuiMessage({ version: bridgeVersion, type: "gui.ready", requestId: "sk-secret/request" })).toBe(false);
    expect(isGuiMessage({ version: bridgeVersion, type: "gui.ready", payload: { supportedBridgeVersion: "1" } })).toBe(false);
    expect(isGuiMessage({ version: bridgeVersion, type: "gui.ready", payload: { supportedBridgeVersion: bridgeVersion, extra: true } })).toBe(false);
    expect(isGuiMessage({ version: bridgeVersion, type: "gui.ready", extra: true })).toBe(false);
  });

  it("rejects unknown, disabled, or invalid host messages", () => {
    expect(isHostMessage({ version: bridgeVersion, type: "host.themeChanged", requestId: "r1", payload: { theme: "dark" } })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.openedFromCommand", requestId: "opened-001", payload: {} })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.openedFromCommand", payload: { action: "edit" } })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.unknown" })).toBe(false);
    expect(isHostMessage({ version: "", type: "host.ready", payload: {} })).toBe(false);
    expect(isHostMessage({ version: "1", type: "host.ready", payload: {} })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ready", requestId: "", payload: {} })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ready", requestId: "a".repeat(129), payload: {} })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ready", requestId: "bad\nrequest", payload: {} })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ready", requestId: "bad\u007frequest", payload: {} })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ready", requestId: "bad\u0080request", payload: {} })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ready", requestId: "bad\u009frequest", payload: {} })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ready", payload: [] })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ready", payload: { sessionToken: 123 } })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ready", payload: { cloudRequired: "false" } })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ready", payload: { cloudRequired: true } })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ready", payload: { unknown: true } })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ready", payload: {}, extra: true })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ready", payload: { runtimeUrl: "ftp://127.0.0.1:8765" } })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ready", payload: { runtimeUrl: "https://example.com:8765" } })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ready", payload: { runtimeUrl: "http://127.0.0.1" } })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ready", payload: { runtimeUrl: "http://user@127.0.0.1:8765" } })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ready", payload: { runtimeUrl: "http://127.0.0.1:8765/?token=x" } })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ready", payload: { sessionToken: "" } })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ready", payload: { sessionToken: "x".repeat(4097) } })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ready", payload: { productId: "" } })).toBe(false);
    expect(isHostMessage(contextSnapshot({ payload: { kind: "active_editor", source: "vscode", file: { workspaceRelativePath: "../secret.ts" } } }))).toBe(false);
    expect(isHostMessage(contextSnapshot({ payload: { kind: "active_editor", source: "vscode", file: { displayPath: "/Users/alice/secret.ts" } } }))).toBe(false);
    expect(isHostMessage(contextSnapshot({ payload: { kind: "active_editor", source: "vscode", selection: { text: "x".repeat(8001) } } }))).toBe(false);
    expect(isHostMessage(contextSnapshot({ payload: { kind: "active_editor", source: "vscode", selection: { startLine: -1 } } }))).toBe(false);
    expect(isHostMessage(contextSnapshot({ payload: { kind: "active_editor", source: "vscode", tool: { name: "edit" } } }))).toBe(false);
  });

  it("rejects unsafe or privileged JetBrains context snapshots", () => {
    expect(isHostMessage(contextSnapshot({ payload: { kind: "active_editor", source: "jetbrains", file: { workspaceRelativePath: "../secret.kt" } } }))).toBe(false);
    expect(isHostMessage(contextSnapshot({ payload: { kind: "active_editor", source: "jetbrains", file: { displayPath: "C:\\Users\\alice\\secret.kt" } } }))).toBe(false);
    expect(isHostMessage(contextSnapshot({ payload: { kind: "active_editor", source: "jetbrains", selection: { text: "x".repeat(8001) } } }))).toBe(false);
    expect(isHostMessage(contextSnapshot({ payload: { kind: "active_editor", source: "jetbrains", tool: { name: "edit" } } }))).toBe(false);
    expect(isHostMessage(contextSnapshot({ payload: { kind: "active_editor", source: "jetbrains", edit: { replaceRange: true } } }))).toBe(false);
  });

  it("logs rejected host messages", () => {
    const logs: string[] = [];
    const adapter = createBridgeAdapter((entry) => logs.push(entry));
    window.dispatchEvent(new MessageEvent("message", { data: { version: bridgeVersion, type: "host.unknown" } }));
    window.dispatchEvent(new MessageEvent("message", { data: hostReady() }));
    expect(logs).toContain("Rejected invalid host bridge message");
    expect(logs).toContain("Host runtime settings received");
    adapter.dispose();
  });

  it("emits valid host.ready to subscribers without logging the token", () => {
    const token = "host-session-token-secret";
    const logs: string[] = [];
    const messages: unknown[] = [];
    const adapter = createBridgeAdapter((entry) => logs.push(entry));
    adapter.subscribe((message) => messages.push(message));
    window.dispatchEvent(new MessageEvent("message", {
      data: hostReady({ sessionToken: token }),
    }));
    expect(messages).toHaveLength(1);
    expect(JSON.stringify(messages[0])).toContain(token);
    expect(logs).toContain("Host runtime settings received");
    expect(logs.join("\n")).not.toContain(token);
    adapter.dispose();
  });
});

function applyEditMessage(options: { requestId?: string; summary?: string; fileEdit?: Record<string, unknown> } = {}) {
  return {
    version: bridgeVersion,
    type: "gui.applyWorkspaceEditRequest",
    requestId: options.requestId ?? "req-apply-edit-test-001",
    payload: {
      requiresUserConfirmation: true,
      summary: options.summary ?? "Update reviewed text.",
      cloudRequired: false,
      edits: [
        {
          workspaceRelativePath: "src/main.ts",
          textReplacements: [
            {
              range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } },
              replacementText: "x",
            },
          ],
          ...(options.fileEdit ?? {}),
        },
      ],
    },
  };
}

function hostReady(payload: Record<string, unknown> = {}) {
  return {
    version: bridgeVersion,
    type: "host.ready",
    requestId: "r1",
    payload: {
      runtimeUrl: "http://127.0.0.1:8765",
      productId: "yet-ai",
      displayName: "Yet AI",
      cloudRequired: false,
      ...payload,
    },
  };
}

function contextSnapshot(options: { payload?: Record<string, unknown> } = {}) {
  return {
    version: bridgeVersion,
    type: "host.contextSnapshot",
    requestId: "context-1",
    payload: options.payload ?? {
      kind: "active_editor",
      source: "vscode",
      file: {
        displayPath: "src/main.ts",
        workspaceRelativePath: "src/main.ts",
        languageId: "typescript",
      },
      selection: {
        startLine: 1,
        startCharacter: 2,
        endLine: 3,
        endCharacter: 4,
        text: "const value = 1;",
      },
    },
  };
}
