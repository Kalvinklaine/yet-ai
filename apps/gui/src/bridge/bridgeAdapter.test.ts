import { afterEach, describe, expect, it, vi } from "vitest";
import { createBridgeAdapter, isApplyWorkspaceEditPayload, isApplyWorkspaceEditResultPayload, isGuiMessage, isHostMessage, isIdeActionProgressPayload, isIdeActionRequestPayload, isIdeActionResultPayload } from "./bridgeAdapter";
import guiReadyMessage from "../../../../packages/contracts/examples/bridge/gui-ready-message.json";
import guiReadyWithFrameNonceMessage from "../../../../packages/contracts/examples/bridge/gui-ready-with-frame-nonce.json";
import guiUnloadedMessage from "../../../../packages/contracts/examples/bridge/gui-unloaded-message.json";
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
import guiReadyFrameNonceBadLengthMessage from "../../../../packages/contracts/examples-invalid/bridge/gui-ready-frame-nonce-bad-length.json";
import guiReadyFrameNonceUppercaseMessage from "../../../../packages/contracts/examples-invalid/bridge/gui-ready-frame-nonce-uppercase.json";
import guiUnloadedRequestIdMessage from "../../../../packages/contracts/examples-invalid/bridge/gui-unloaded-request-id.json";
import guiUnloadedNonEmptyPayloadMessage from "../../../../packages/contracts/examples-invalid/bridge/gui-unloaded-non-empty-payload.json";
import guiRevealRangeMessage from "../../../../packages/contracts/examples-invalid/bridge/gui-reveal-range-message.json";
import guiShowNotificationMessage from "../../../../packages/contracts/examples-invalid/bridge/gui-show-notification-message.json";
import hostContextSnapshotAbsolutePathMessage from "../../../../packages/contracts/examples-invalid/bridge/host-context-snapshot-absolute-path.json";
import hostContextSnapshotFileContentsFieldMessage from "../../../../packages/contracts/examples-invalid/bridge/host-context-snapshot-file-contents-field.json";
import hostContextSnapshotFileOnlyMessage from "../../../../packages/contracts/examples/bridge/host-context-snapshot-file-only.json";
import hostContextSnapshotMinimalActiveEditorMessage from "../../../../packages/contracts/examples/bridge/host-context-snapshot-minimal-active-editor.json";
import hostContextSnapshotOversizedSelectionTextMessage from "../../../../packages/contracts/examples-invalid/bridge/host-context-snapshot-oversized-selection-text.json";
import hostContextSnapshotPrivilegedCommandMessage from "../../../../packages/contracts/examples-invalid/bridge/host-context-snapshot-privileged-command.json";
import hostContextSnapshotProviderResponseFieldMessage from "../../../../packages/contracts/examples-invalid/bridge/host-context-snapshot-provider-response-field.json";
import hostContextSnapshotSecretLikeWorkspacePathMessage from "../../../../packages/contracts/examples-invalid/bridge/host-context-snapshot-secret-like-workspace-path.json";
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
import guiIdeActionActiveFileExcerptMessage from "../../../../packages/contracts/examples/bridge/gui-ide-action-request-get-active-file-excerpt.json";
import hostIdeActionProgressMessage from "../../../../packages/contracts/examples/bridge/host-ide-action-progress.json";
import hostIdeActionResultSucceededMessage from "../../../../packages/contracts/examples/bridge/host-ide-action-result-succeeded.json";
import hostIdeActionResultRejectedMessage from "../../../../packages/contracts/examples/bridge/host-ide-action-result-rejected.json";
import hostIdeActionProgressSucceededGetContextSnapshotMessage from "../../../../packages/contracts/examples/bridge/host-ide-action-progress-succeeded-get-context-snapshot.json";
import hostIdeActionResultSucceededGetContextSnapshotMessage from "../../../../packages/contracts/examples/bridge/host-ide-action-result-succeeded-get-context-snapshot.json";
import hostIdeActionResultSucceededGetContextSnapshotNoActiveEditorMessage from "../../../../packages/contracts/examples/bridge/host-ide-action-result-succeeded-get-context-snapshot-no-active-editor.json";
import hostIdeActionResultSucceededContextEmptyContextMessage from "../../../../packages/contracts/examples-invalid/bridge/host-ide-action-result-succeeded-context-empty-context.json";
import hostIdeActionProgressSucceededOpenWorkspaceFileMessage from "../../../../packages/contracts/examples/bridge/host-ide-action-progress-succeeded-open-workspace-file.json";
import hostIdeActionResultSucceededOpenWorkspaceFileMessage from "../../../../packages/contracts/examples/bridge/host-ide-action-result-succeeded-open-workspace-file.json";
import hostIdeActionProgressSucceededRevealWorkspaceRangeMessage from "../../../../packages/contracts/examples/bridge/host-ide-action-progress-succeeded-reveal-workspace-range.json";
import hostIdeActionResultSucceededRevealWorkspaceRangeMessage from "../../../../packages/contracts/examples/bridge/host-ide-action-result-succeeded-reveal-workspace-range.json";
import hostIdeActionResultSucceededActiveFileExcerptMessage from "../../../../packages/contracts/examples/bridge/host-ide-action-result-succeeded-get-active-file-excerpt-vscode.json";
import hostIdeActionResultUnavailableActiveFileExcerptMessage from "../../../../packages/contracts/examples/bridge/host-ide-action-result-unavailable-get-active-file-excerpt.json";
import hostIdeActionResultActiveFileExcerptAbsolutePathMessage from "../../../../packages/contracts/examples-invalid/bridge/host-ide-action-result-active-file-excerpt-absolute-path.json";
import hostIdeActionResultActiveFileExcerptSecretTextMessage from "../../../../packages/contracts/examples-invalid/bridge/host-ide-action-result-active-file-excerpt-secret-like-text.json";
import hostIdeActionResultActiveFileExcerptUnavailableWithAttachmentMessage from "../../../../packages/contracts/examples-invalid/bridge/host-ide-action-result-active-file-excerpt-unavailable-with-attachment.json";
import hostIdeActionResultFailedOpenWithContextMessage from "../../../../packages/contracts/examples-invalid/bridge/host-ide-action-result-failed-open-with-context.json";
import hostIdeActionResultRejectedRevealWithContextMessage from "../../../../packages/contracts/examples-invalid/bridge/host-ide-action-result-rejected-reveal-with-context.json";
import hostIdeActionResultUnavailableContextWithPathRangeMessage from "../../../../packages/contracts/examples-invalid/bridge/host-ide-action-result-unavailable-context-with-path-range.json";
import hostIdeActionResultRawPromptFieldMessage from "../../../../packages/contracts/examples-invalid/bridge/host-ide-action-result-raw-prompt-field.json";
import hostIdeActionResultProviderResponseFieldMessage from "../../../../packages/contracts/examples-invalid/bridge/host-ide-action-result-provider-response-field.json";
import hostIdeActionProgressRawFileContentsFieldMessage from "../../../../packages/contracts/examples-invalid/bridge/host-ide-action-progress-raw-file-contents-field.json";

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

    expect(adapter.host).toBe("jetbrains");
    expect(logs).toContain("Bridge host jetbrains");
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
    expect(logs).toContain("Bridge host jetbrains");
    expect(logs).toContain("Rejected host bridge message from unexpected origin");
    expect(logs).toContain("Rejected host bridge message from unexpected source");
    expect(logs.filter((entry) => entry === "Rejected invalid host bridge message")).toHaveLength(7);
    adapter.dispose();
  });

  it("accepts host.ready from the captured iframe parent without token logging or storage", () => {
    const token = "iframeParentSessionTokenLocal";
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

  it("accepts valid gui.unloaded through public runtime validation", () => {
    expect(isGuiMessage(guiUnloadedMessage)).toBe(true);
    expect(isGuiMessage({ version: bridgeVersion, type: "gui.unloaded" })).toBe(true);
  });

  it("rejects gui.unloaded with requestId or non-empty payload through public runtime validation", () => {
    expect(isGuiMessage(guiUnloadedRequestIdMessage)).toBe(false);
    expect(isGuiMessage(guiUnloadedNonEmptyPayloadMessage)).toBe(false);
    expect(isGuiMessage({ version: bridgeVersion, type: "gui.unloaded", requestId: "unload-1" })).toBe(false);
    expect(isGuiMessage({ version: bridgeVersion, type: "gui.unloaded", payload: { reason: "pagehide" } })).toBe(false);
  });

  it("rejects request ids with compact secret markers", () => {
    for (const requestId of ["AuthorizationBearerFake", "apiKeySecretValue", "sk-proj-abcdef1234567890", "SK-proj-abcdef1234567890", "access_token"]) {
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

  it("rejects apply workspace edit proposals with duplicate file groups", () => {
    const message = {
      version: bridgeVersion,
      type: "gui.applyWorkspaceEditRequest",
      requestId: "req-apply-edit-duplicate-files-001",
      payload: {
        requiresUserConfirmation: true,
        summary: "Replace two ranges in the same file twice.",
        cloudRequired: false,
        edits: [
          {
            workspaceRelativePath: "src/example.ts",
            textReplacements: [
              {
                range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } },
                replacementText: "x",
              },
            ],
          },
          {
            workspaceRelativePath: "src/another.ts",
            textReplacements: [
              {
                range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } },
                replacementText: "y",
              },
            ],
          },
          {
            workspaceRelativePath: "src/example.ts",
            textReplacements: [
              {
                range: { start: { line: 2, character: 0 }, end: { line: 2, character: 1 } },
                replacementText: "z",
              },
            ],
          },
        ],
      },
    };

    expect(isGuiMessage(message)).toBe(false);
    expect(isApplyWorkspaceEditPayload(message.payload)).toBe(false);
  });

  it("does not post apply workspace edit requests with duplicate file groups through the adapter", () => {
    const logs: string[] = [];
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });

    const adapter = createBridgeAdapter((entry) => logs.push(entry));
    postMessage.mockClear();

    const message = {
      version: bridgeVersion,
      type: "gui.applyWorkspaceEditRequest",
      requestId: "req-apply-edit-duplicate-files-post-001",
      payload: {
        requiresUserConfirmation: true,
        summary: "Replace two ranges in the same file twice.",
        cloudRequired: false,
        edits: [
          {
            workspaceRelativePath: "src/example.ts",
            textReplacements: [
              {
                range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } },
                replacementText: "x",
              },
            ],
          },
          {
            workspaceRelativePath: "src/example.ts",
            textReplacements: [
              {
                range: { start: { line: 2, character: 0 }, end: { line: 2, character: 1 } },
                replacementText: "y",
              },
            ],
          },
        ],
      },
    };

    adapter.post(message as never);

    expect(postMessage).not.toHaveBeenCalled();
    expect(logs.filter((entry) => entry === "Rejected invalid GUI bridge message")).toHaveLength(1);
    adapter.dispose();
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
      "Update reviewed text near SK-proj-abcdefghijklmnopqrstuvwxyz.",
      "Update /Users",
      "Update /Users.",
      "Update /home",
      "Update /home,",
      "Update /tmp.",
      "Update /Private",
      "Update /Private:",
      "Update /etc.",
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
      "Failed while applying SK-proj-abcdefghijklmnopqrstuvwxyz.",
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
      postMessage: () => window.dispatchEvent(new MessageEvent("message", { data: hostReady({ sessionToken: "syncVscodeLocalValue" }) })),
    });

    const adapter = createBridgeAdapter((entry) => logs.push(entry));
    const messages: unknown[] = [];
    adapter.subscribe((message) => messages.push(message));

    expect(messages).toHaveLength(1);
    expect(JSON.stringify(messages[0])).toContain("syncVscodeLocalValue");
    expect(logs).toContain("Host runtime settings received");
    expect(logs.join("\n")).not.toContain("syncVscodeLocalValue");
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

  it("delivers JetBrains host apply results through the same sanitized host contract", () => {
    const logs: string[] = [];
    const messages: unknown[] = [];
    const postIntellijMessage = vi.fn();
    window.postIntellijMessage = postIntellijMessage;
    const adapter = createBridgeAdapter((entry) => logs.push(entry));
    adapter.subscribe((message) => messages.push(message));

    window.dispatchEvent(new MessageEvent("message", {
      data: {
        version: bridgeVersion,
        type: "host.applyWorkspaceEditResult",
        requestId: "gui-edit-proposal-apply-sabcdef123456-1",
        payload: {
          status: "applied",
          message: "Applied after user confirmation.",
          cloudRequired: false,
          appliedEditCount: 1,
          affectedFiles: ["src/example.ts"],
        },
      },
    }));
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        version: bridgeVersion,
        type: "host.applyWorkspaceEditResult",
        requestId: "gui-edit-proposal-apply-sabcdef123456-2",
        payload: {
          status: "failed",
          message: "Failed with Bearer unsafe-secret-token.",
          cloudRequired: false,
          appliedEditCount: 0,
          affectedFiles: ["src/example.ts"],
        },
      },
    }));

    expect(adapter.host).toBe("jetbrains");
    expect(messages).toEqual([{ version: bridgeVersion, type: "host.applyWorkspaceEditResult", requestId: "gui-edit-proposal-apply-sabcdef123456-1", payload: { status: "applied", message: "Applied after user confirmation.", cloudRequired: false, appliedEditCount: 1, affectedFiles: ["src/example.ts"] } }]);
    expect(logs).toContain("Host message host.applyWorkspaceEditResult");
    expect(logs).toContain("Rejected invalid host bridge message");
    expect(logs.join("\n")).not.toContain("unsafe-secret-token");
    expect(JSON.stringify(localStorage)).not.toContain("unsafe-secret-token");
    expect(JSON.stringify(sessionStorage)).not.toContain("unsafe-secret-token");
    adapter.dispose();
  });

  it("delivers synchronous JetBrains host.ready replies after subscribe", () => {
    const logs: string[] = [];
    window.postIntellijMessage = () => window.dispatchEvent(new MessageEvent("message", { data: hostReady({ sessionToken: "syncJetbrainsLocalValue" }) }));

    const adapter = createBridgeAdapter((entry) => logs.push(entry));
    const messages: unknown[] = [];
    adapter.subscribe((message) => messages.push(message));

    expect(adapter.host).toBe("jetbrains");
    expect(messages).toHaveLength(1);
    expect(JSON.stringify(messages[0])).toContain("syncJetbrainsLocalValue");
    expect(logs.join("\n")).not.toContain("syncJetbrainsLocalValue");
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
    expect(isGuiMessage(guiReadyWithFrameNonceMessage)).toBe(true);
    expect(isGuiMessage(guiUnloadedMessage)).toBe(true);
    expect(isGuiMessage(guiIdeActionContextMessage)).toBe(true);
    expect(isGuiMessage(guiIdeActionOpenMessage)).toBe(true);
    expect(isGuiMessage(guiIdeActionRevealMessage)).toBe(true);
    expect(isGuiMessage(guiIdeActionActiveFileExcerptMessage)).toBe(true);
    expect(isIdeActionRequestPayload(guiIdeActionRevealMessage.payload)).toBe(true);
    expect(isIdeActionRequestPayload(guiIdeActionActiveFileExcerptMessage.payload)).toBe(true);
    expect(isHostMessage(hostReadyMessage)).toBe(true);
    expect(isHostMessage(hostOpenedFromCommandMessage)).toBe(true);
    expect(isHostMessage(hostContextSnapshotMessage)).toBe(true);
    expect(isHostMessage(hostIdeActionProgressMessage)).toBe(true);
    expect(isHostMessage(hostIdeActionResultSucceededMessage)).toBe(true);
    expect(isHostMessage(hostIdeActionResultRejectedMessage)).toBe(true);
    expect(isHostMessage(hostIdeActionProgressSucceededGetContextSnapshotMessage)).toBe(true);
    expect(isHostMessage(hostIdeActionResultSucceededGetContextSnapshotMessage)).toBe(true);
    expect(isHostMessage(hostIdeActionProgressSucceededOpenWorkspaceFileMessage)).toBe(true);
    expect(isHostMessage(hostIdeActionResultSucceededOpenWorkspaceFileMessage)).toBe(true);
    expect(isHostMessage(hostIdeActionProgressSucceededRevealWorkspaceRangeMessage)).toBe(true);
    expect(isHostMessage(hostIdeActionResultSucceededRevealWorkspaceRangeMessage)).toBe(true);
    expect(isHostMessage(hostIdeActionResultSucceededActiveFileExcerptMessage)).toBe(true);
    expect(isHostMessage(hostIdeActionResultUnavailableActiveFileExcerptMessage)).toBe(true);
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

  it("rejects C0 and C1 control characters in runtime bridge summaries and messages", () => {
    const applyEditControlSummaryMessage = applyEditMessage({ requestId: "req-apply-edit-control-runtime-001", summary: "Replace one visible\u0000 editor line." });
    const hostIdeActionProgressControlSummaryMessage = { version: bridgeVersion, type: "host.ideActionProgress", requestId: "req-ide-action-control-runtime-001", payload: { phase: "running", status: "inProgress", summary: "Revealing\u0085 workspace range.", cloudRequired: false, action: "revealWorkspaceRange", workspaceRelativePath: "src/App.tsx" } };
    const hostIdeActionProgressControlMessage = { version: bridgeVersion, type: "host.ideActionProgress", requestId: "req-ide-action-control-runtime-002", payload: { phase: "completed", status: "failed", summary: "IDE rejected\u009f the request.", cloudRequired: false, action: "openWorkspaceFile" } };
    const hostIdeActionResultControlMessage = { version: bridgeVersion, type: "host.ideActionResult", requestId: "req-ide-action-control-runtime-003", payload: { status: "rejected", message: "Request rejected\u001f by local IDE policy.", cloudRequired: false, action: "openWorkspaceFile" } };
    const hostApplyWorkspaceEditResultControlMessage = { version: bridgeVersion, type: "host.applyWorkspaceEditResult", requestId: "req-apply-edit-control-runtime-002", payload: { status: "denied", message: "User declined\u009f the proposed edit.", cloudRequired: false, appliedEditCount: 0, affectedFiles: [] } };

    expect(isApplyWorkspaceEditPayload(applyEditControlSummaryMessage.payload)).toBe(false);
    expect(isGuiMessage(applyEditControlSummaryMessage)).toBe(false);
    expect(isIdeActionProgressPayload(hostIdeActionProgressControlSummaryMessage.payload)).toBe(false);
    expect(isHostMessage(hostIdeActionProgressControlSummaryMessage)).toBe(false);
    expect(isIdeActionProgressPayload(hostIdeActionProgressControlMessage.payload)).toBe(false);
    expect(isHostMessage(hostIdeActionProgressControlMessage)).toBe(false);
    expect(isIdeActionResultPayload(hostIdeActionResultControlMessage.payload)).toBe(false);
    expect(isHostMessage(hostIdeActionResultControlMessage)).toBe(false);
    expect(isApplyWorkspaceEditResultPayload(hostApplyWorkspaceEditResultControlMessage.payload)).toBe(false);
    expect(isHostMessage(hostApplyWorkspaceEditResultControlMessage)).toBe(false);

    const logs: string[] = [];
    const messages: unknown[] = [];
    const adapter = createBridgeAdapter((entry) => logs.push(entry));
    adapter.subscribe((message) => messages.push(message));
    window.dispatchEvent(new MessageEvent("message", { data: hostIdeActionProgressControlSummaryMessage }));
    window.dispatchEvent(new MessageEvent("message", { data: hostIdeActionProgressControlMessage }));
    window.dispatchEvent(new MessageEvent("message", { data: hostIdeActionResultControlMessage }));
    window.dispatchEvent(new MessageEvent("message", { data: hostApplyWorkspaceEditResultControlMessage }));

    expect(messages).toHaveLength(0);
    expect(logs.filter((entry) => entry === "Rejected invalid host bridge message")).toHaveLength(4);
    adapter.dispose();
  });

  it("validates explicit workspace snippet search bridge payloads", () => {
    const request = { version: bridgeVersion, type: "gui.ideActionRequest", requestId: "snippet-search-1", payload: { action: "searchWorkspaceSnippets", query: "chat composer" } };
    const result = {
      version: bridgeVersion,
      type: "host.ideActionResult",
      requestId: "snippet-search-1",
      payload: {
        status: "succeeded",
        message: "Workspace snippets ready.",
        cloudRequired: false,
        action: "searchWorkspaceSnippets",
        queryLabel: "chat composer",
        resultCount: 1,
        snippets: [{ workspaceRelativePath: "apps/gui/src/App.tsx", languageId: "typescript", range: { start: { line: 10, character: 0 }, end: { line: 12, character: 1 } }, text: "function ChatComposer() {\n  return null;\n}" }],
        truncated: false,
      },
    };

    expect(isIdeActionRequestPayload(request.payload)).toBe(true);
    expect(isGuiMessage(request)).toBe(true);
    expect(isIdeActionResultPayload(result.payload)).toBe(true);
    expect(isHostMessage(result)).toBe(true);
  });

  it("rejects unsafe workspace snippet queries and host results", () => {
    expect(isGuiMessage({ version: bridgeVersion, type: "gui.ideActionRequest", requestId: "snippet-search-unsafe", payload: { action: "searchWorkspaceSnippets", query: "../../secret path" } })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ideActionResult", requestId: "snippet-search-unsafe-result", payload: { status: "succeeded", message: "Workspace snippets ready.", cloudRequired: false, action: "searchWorkspaceSnippets", queryLabel: "chat composer", resultCount: 1, snippets: [{ workspaceRelativePath: "apps/gui/src/App.tsx", languageId: "typescript", range: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } }, text: "Authorization: Bearer unsafe-secret" }], truncated: false } })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ideActionResult", requestId: "snippet-search-extra", payload: { status: "succeeded", message: "Workspace snippets ready.", cloudRequired: false, action: "searchWorkspaceSnippets", queryLabel: "chat composer", resultCount: 0, snippets: [], truncated: false, workspaceRelativePath: "apps/gui/src/App.tsx" } })).toBe(false);
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
    expect(isGuiMessage({ version: bridgeVersion, type: "gui.ideActionRequest", requestId: "req-9", payload: { action: "getActiveFileExcerpt" } })).toBe(true);
    expect(isGuiMessage({ version: bridgeVersion, type: "gui.ideActionRequest", requestId: "req-10", payload: { action: "getActiveFileExcerpt", path: "src/App.tsx" } })).toBe(false);
    expect(isHostMessage(hostIdeActionResultActiveFileExcerptAbsolutePathMessage)).toBe(false);
    expect(isHostMessage(hostIdeActionResultActiveFileExcerptSecretTextMessage)).toBe(false);
    expect(isHostMessage(hostIdeActionResultActiveFileExcerptUnavailableWithAttachmentMessage)).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ideActionResult", requestId: "req-9", payload: { status: "succeeded", message: "Opened.", cloudRequired: false, action: "openWorkspaceFile" } })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ideActionResult", requestId: "req-9-context", payload: { status: "succeeded", message: "Opened.", cloudRequired: false, action: "openWorkspaceFile", workspaceRelativePath: "src/App.tsx", context: { source: "vscode" } } })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ideActionProgress", requestId: "req-9-progress-context", payload: { phase: "completed", status: "succeeded", summary: "Opened.", cloudRequired: false, action: "openWorkspaceFile", workspaceRelativePath: "src/App.tsx", context: { source: "vscode" } } })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ideActionProgress", requestId: "req-10", payload: { phase: "completed", status: "succeeded", summary: "Revealed.", cloudRequired: false, action: "revealWorkspaceRange", workspaceRelativePath: "src/App.tsx" } })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ideActionProgress", requestId: "req-11", payload: { phase: "completed", status: "succeeded", summary: "Revealed.", cloudRequired: false, action: "revealWorkspaceRange", workspaceRelativePath: "src/App.tsx", range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } } } })).toBe(true);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ideActionResult", requestId: "req-11-result", payload: { status: "succeeded", message: "Revealed.", cloudRequired: false, action: "revealWorkspaceRange", workspaceRelativePath: "src/App.tsx" } })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ideActionResult", requestId: "req-11-result-range", payload: { status: "succeeded", message: "Revealed.", cloudRequired: false, action: "revealWorkspaceRange", workspaceRelativePath: "src/App.tsx", range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } } } })).toBe(true);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ideActionResult", requestId: "req-12", payload: { status: "succeeded", message: "Opened.", cloudRequired: false, action: "openWorkspaceFile", workspaceRelativePath: "config/secret.env" } })).toBe(false);
  });

  it("validates verification command requests progress and sanitized results", () => {
    expect(isGuiMessage({ version: bridgeVersion, type: "gui.ideActionRequest", requestId: "req-verification-1", payload: { action: "runVerificationCommand", commandId: "repository-check" } })).toBe(true);
    expect(isGuiMessage({ version: bridgeVersion, type: "gui.ideActionRequest", requestId: "req-verification-2", payload: { action: "runVerificationCommand", commandId: "npm-test" } })).toBe(false);
    expect(isGuiMessage({ version: bridgeVersion, type: "gui.ideActionRequest", requestId: "req-verification-3", payload: { action: "runVerificationCommand", commandId: "gui-app-tests", command: "npm test" } })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ideActionProgress", requestId: "req-verification-4", payload: { phase: "running", status: "inProgress", summary: "Running GUI tests.", cloudRequired: false, action: "runVerificationCommand", commandId: "gui-app-tests" } })).toBe(true);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ideActionProgress", requestId: "req-verification-5", payload: { phase: "running", status: "inProgress", summary: "Running GUI tests.", cloudRequired: false, action: "runVerificationCommand" } })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ideActionResult", requestId: "req-verification-6", payload: { status: "succeeded", message: "GUI tests passed.", cloudRequired: false, action: "runVerificationCommand", commandId: "gui-app-tests", exitCode: 0, durationMs: 1200, outputTail: "passed safely", truncated: false } })).toBe(true);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ideActionResult", requestId: "req-verification-7", payload: { status: "succeeded", message: "GUI tests passed.", cloudRequired: false, action: "runVerificationCommand", commandId: "gui-app-tests", exitCode: 0, durationMs: 1200, outputTail: "Authorization: Bearer secret", truncated: false } })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ideActionResult", requestId: "req-verification-8", payload: { status: "succeeded", message: "GUI tests passed.", cloudRequired: false, action: "runVerificationCommand", commandId: "gui-app-tests", exitCode: 0, durationMs: 1200, outputTail: "passed", truncated: false, workspaceRelativePath: "src/App.tsx" } })).toBe(false);
  });

  it("accepts only minimal VS Code or JetBrains IDE action result context", () => {
    const basePayload = { status: "succeeded", message: "Context snapshot ready.", cloudRequired: false, action: "getContextSnapshot" };
    const validJetBrainsContext = { source: "jetbrains", hasActiveEditor: true, workspaceFolderCount: 1 };
    const validVsCodeContext = { source: "vscode", hasActiveEditor: false, workspaceFolderCount: 0 };

    expect(isHostMessage({ version: bridgeVersion, type: "host.ideActionResult", requestId: "req-context-jetbrains", payload: { ...basePayload, context: validJetBrainsContext } })).toBe(true);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ideActionResult", requestId: "req-context-vscode", payload: { ...basePayload, context: validVsCodeContext } })).toBe(true);

    const invalidContexts = [
      { ...validJetBrainsContext, kind: "active_editor" },
      { ...validJetBrainsContext, file: { workspaceRelativePath: "src/App.tsx" } },
      { ...validJetBrainsContext, workspaceRelativePath: "src/App.tsx" },
      { ...validJetBrainsContext, selectedText: "selection" },
      { ...validJetBrainsContext, text: "selection" },
      { ...validJetBrainsContext, rawContent: "contents" },
      { ...validJetBrainsContext, provider: "host" },
      { ...validJetBrainsContext, extra: true },
      { source: "jetbrains", workspaceFolderCount: 1 },
      { source: "jetbrains", hasActiveEditor: true },
      { source: "browser", hasActiveEditor: true, workspaceFolderCount: 1 },
    ];

    for (const context of invalidContexts) {
      expect(isHostMessage({ version: bridgeVersion, type: "host.ideActionResult", requestId: `req-invalid-${Object.keys(context).join("-")}`, payload: { ...basePayload, context } })).toBe(false);
    }
  });

  it("rejects forbidden IDE action result metadata on non-success statuses", () => {
    const context = { source: "vscode", hasActiveEditor: true, workspaceFolderCount: 1 };
    const range = { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } };

    const invalidMessages = [
      hostIdeActionResultFailedOpenWithContextMessage,
      hostIdeActionResultRejectedRevealWithContextMessage,
      hostIdeActionResultUnavailableContextWithPathRangeMessage,
      { version: bridgeVersion, type: "host.ideActionResult", requestId: "req-open-rejected-context", payload: { status: "rejected", message: "Open rejected.", cloudRequired: false, action: "openWorkspaceFile", context } },
      { version: bridgeVersion, type: "host.ideActionResult", requestId: "req-reveal-failed-context", payload: { status: "failed", message: "Reveal failed.", cloudRequired: false, action: "revealWorkspaceRange", context } },
      { version: bridgeVersion, type: "host.ideActionResult", requestId: "req-context-failed-path", payload: { status: "failed", message: "Context failed.", cloudRequired: false, action: "getContextSnapshot", workspaceRelativePath: "src/App.tsx" } },
      { version: bridgeVersion, type: "host.ideActionResult", requestId: "req-context-rejected-range", payload: { status: "rejected", message: "Context rejected.", cloudRequired: false, action: "getContextSnapshot", range } },
    ];

    for (const message of invalidMessages) {
      expect(isIdeActionResultPayload(message.payload)).toBe(false);
      expect(isHostMessage(message)).toBe(false);
    }

    expect(isHostMessage({ version: bridgeVersion, type: "host.ideActionResult", requestId: "req-context-failed-no-context", payload: { status: "failed", message: "Context failed.", cloudRequired: false, action: "getContextSnapshot" } })).toBe(true);
  });

  it("aligns successful getContextSnapshot progress and result metadata with the bridge schema", () => {
    const context = { source: "jetbrains", hasActiveEditor: true, workspaceFolderCount: 1 };

    const progressWithoutContext = { version: bridgeVersion, type: "host.ideActionProgress", requestId: "req-context-progress", payload: { phase: "completed", status: "succeeded", summary: "Context snapshot ready.", cloudRequired: false, action: "getContextSnapshot" } };
    const progressWithContext = { version: bridgeVersion, type: "host.ideActionProgress", requestId: "req-context-progress-context", payload: { ...progressWithoutContext.payload, context } };
    const resultWithContext = { version: bridgeVersion, type: "host.ideActionResult", requestId: "req-context-result", payload: { status: "succeeded", message: "Context snapshot ready.", cloudRequired: false, action: "getContextSnapshot", context } };
    const resultWithoutContext = { version: bridgeVersion, type: "host.ideActionResult", requestId: "req-context-result-missing", payload: { status: "succeeded", message: "Context snapshot ready.", cloudRequired: false, action: "getContextSnapshot" } };
    const resultWithEmptyContext = { version: bridgeVersion, type: "host.ideActionResult", requestId: "req-context-result-empty", payload: { status: "succeeded", message: "Context snapshot ready.", cloudRequired: false, action: "getContextSnapshot", context: {} } };

    expect(isIdeActionProgressPayload(progressWithoutContext.payload)).toBe(true);
    expect(isHostMessage(progressWithoutContext)).toBe(true);
    expect(isIdeActionProgressPayload(progressWithContext.payload)).toBe(false);
    expect(isHostMessage(progressWithContext)).toBe(false);
    expect(isIdeActionResultPayload(resultWithContext.payload)).toBe(true);
    expect(isHostMessage(resultWithContext)).toBe(true);
    expect(isIdeActionResultPayload(resultWithoutContext.payload)).toBe(false);
    expect(isHostMessage(resultWithoutContext)).toBe(false);
    expect(isIdeActionResultPayload(resultWithEmptyContext.payload)).toBe(false);
    expect(isHostMessage(resultWithEmptyContext)).toBe(false);
    expect(isIdeActionResultPayload(hostIdeActionResultSucceededContextEmptyContextMessage.payload)).toBe(false);
    expect(isHostMessage(hostIdeActionResultSucceededContextEmptyContextMessage)).toBe(false);
  });

  it("keeps bounded selection text as active user-selected prompt context only", () => {
    expect(isHostMessage(contextSnapshot({ payload: { kind: "active_editor", source: "vscode", selection: { text: "Bearer user-selected text stays prompt context, not action metadata" } } }))).toBe(true);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ideActionResult", requestId: "req-context", payload: { status: "succeeded", message: "Done.", cloudRequired: false, action: "getContextSnapshot", context: { text: "Bearer unsafe action metadata" } } })).toBe(false);
  });

  it("rejects invalid bridge contract fixtures through runtime validation", () => {
    expect(isGuiMessage(guiReadyExtraPayloadMessage)).toBe(false);
    expect(isGuiMessage(guiReadyFrameNonceBadLengthMessage)).toBe(false);
    expect(isGuiMessage(guiReadyFrameNonceUppercaseMessage)).toBe(false);
    expect(isGuiMessage(guiUnloadedRequestIdMessage)).toBe(false);
    expect(isGuiMessage(guiUnloadedNonEmptyPayloadMessage)).toBe(false);
    expect(isHostMessage(hostOpenedFromCommandPayloadMessage)).toBe(false);
    expect(isHostMessage(hostContextSnapshotAbsolutePathMessage)).toBe(false);
    expect(isHostMessage(hostContextSnapshotFileContentsFieldMessage)).toBe(false);
    expect(isHostMessage(hostContextSnapshotOversizedSelectionTextMessage)).toBe(false);
    expect(isHostMessage(hostContextSnapshotPrivilegedCommandMessage)).toBe(false);
    expect(isHostMessage(hostContextSnapshotProviderResponseFieldMessage)).toBe(false);
    expect(isHostMessage(hostContextSnapshotSecretLikeWorkspacePathMessage)).toBe(false);
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
    expect(isIdeActionResultPayload(hostIdeActionResultSucceededContextEmptyContextMessage.payload)).toBe(false);
    expect(isHostMessage(hostIdeActionResultSucceededContextEmptyContextMessage)).toBe(false);
    expect(isHostMessage(hostIdeActionResultFailedOpenWithContextMessage)).toBe(false);
    expect(isHostMessage(hostIdeActionResultProviderResponseFieldMessage)).toBe(false);
    expect(isHostMessage(hostIdeActionResultRawPromptFieldMessage)).toBe(false);
    expect(isHostMessage(hostIdeActionResultRejectedRevealWithContextMessage)).toBe(false);
    expect(isHostMessage(hostIdeActionResultUnavailableContextWithPathRangeMessage)).toBe(false);
    expect(isHostMessage(hostIdeActionProgressRawFileContentsFieldMessage)).toBe(false);

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
    expect(isHostMessage(hostContextSnapshotFileOnlyMessage)).toBe(true);
    expect(isHostMessage(hostContextSnapshotMinimalActiveEditorMessage)).toBe(true);
    expect(isHostMessage(hostIdeActionResultSucceededGetContextSnapshotNoActiveEditorMessage)).toBe(true);
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
    expect(isGuiMessage(guiReadyWithFrameNonceMessage)).toBe(true);
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
    expect(isGuiMessage(guiReadyFrameNonceBadLengthMessage)).toBe(false);
    expect(isGuiMessage(guiReadyFrameNonceUppercaseMessage)).toBe(false);
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
    expect(isHostMessage({ version: bridgeVersion, type: "host.ready", payload: { runtimeUrl: "http://127.0.0.1:70000" } })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ready", payload: { runtimeUrl: "http://user@127.0.0.1:8765" } })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ready", payload: { runtimeUrl: "http://127.0.0.1:8765/?token=x" } })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ready", payload: { sessionToken: "" } })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ready", payload: { sessionToken: "x".repeat(513) } })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ready", payload: { sessionToken: "sk-proj-abcdefghijkl" } })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ready", payload: { runtimeUrl: "http://127.0.0.1:70000" } })).toBe(false);
    expect(isHostMessage({ version: bridgeVersion, type: "host.ready", payload: { productId: "" } })).toBe(false);
    expect(isHostMessage(contextSnapshot({ payload: { kind: "active_editor", source: "vscode", file: { workspaceRelativePath: "../secret.ts" } } }))).toBe(false);
    expect(isHostMessage(contextSnapshot({ payload: { kind: "active_editor", source: "vscode", selection: { startLine: 2, startCharacter: 0, endLine: 1, endCharacter: 0 } } }))).toBe(false);
    expect(isHostMessage(contextSnapshot({ payload: { kind: "active_editor", source: "vscode", selection: { startLine: 2, text: "safe selected text" } } }))).toBe(false);
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
    const token = "hostSessionLocalValue";
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
