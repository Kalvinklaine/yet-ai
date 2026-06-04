import * as vscode from "vscode";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { EngineConnection, getLoopbackOrigin } from "./engineConnection";
import { ProductIdentity, bridgeVersion, configurationPrefix } from "./identity";

export type HostMessage = {
  version: string;
  type: "host.ready" | "host.openedFromCommand" | "host.contextSnapshot" | "host.ideActionProgress" | "host.ideActionResult" | "host.applyWorkspaceEditResult";
  requestId?: string;
  payload?: Record<string, unknown>;
};

type HostContextPayload = {
  kind: "active_editor";
  source: "vscode";
  file?: {
    displayPath?: string;
    workspaceRelativePath?: string;
    languageId?: string;
  };
  selection?: {
    startLine?: number;
    startCharacter?: number;
    endLine?: number;
    endCharacter?: number;
    text?: string;
  };
};

type GuiMessage = {
  version: string;
  type: "gui.ready" | "gui.ideActionRequest" | "gui.applyWorkspaceEditRequest";
  requestId?: string;
  payload?: Record<string, unknown>;
};

type IdeActionType = "getContextSnapshot" | "openWorkspaceFile" | "revealWorkspaceRange";

type IdeActionStatus = "succeeded" | "rejected" | "unavailable" | "failed";

type IdeActionRequest =
  | { requestId: string; action: "getContextSnapshot" }
  | { requestId: string; action: "openWorkspaceFile"; workspaceRelativePath: string }
  | { requestId: string; action: "revealWorkspaceRange"; workspaceRelativePath: string; range: ApplyWorkspaceTextReplacement["range"] };

type ApplyWorkspaceEditRequest = {
  requestId: string;
  summary: string;
  edits: ApplyWorkspaceFileEdit[];
};

type ApplyWorkspaceFileEdit = {
  workspaceRelativePath: string;
  textReplacements: ApplyWorkspaceTextReplacement[];
};

type ApplyWorkspaceTextReplacement = {
  range: {
    start: ApplyWorkspacePosition;
    end: ApplyWorkspacePosition;
  };
  replacementText: string;
};

type ApplyWorkspacePosition = {
  line: number;
  character: number;
};

type ValidatedWorkspaceEdit = {
  requestId: string;
  summary: string;
  files: ValidatedWorkspaceFileEdit[];
  editCount: number;
};

type ValidatedWorkspaceFileEdit = {
  workspaceRelativePath: string;
  uri: vscode.Uri;
  textReplacements: ApplyWorkspaceTextReplacement[];
};

type ApplyWorkspaceEditStatus = "applied" | "denied" | "rejected" | "failed";

const applyWorkspaceEditConfirmationLabel = "Apply edits";
const maxForwardedApplyWorkspaceEditMessageBytes = 65536;
const maxForwardedIdeActionMessageBytes = 8192;
const maxControlledIdeActionFileBytes = 2 * 1024 * 1024;
const inFlightIdeActionRequestIds = new Set<string>();

export function openYetAiWebview(
  context: vscode.ExtensionContext,
  identity: ProductIdentity,
  connection: EngineConnection,
): void {
  const panel = vscode.window.createWebviewPanel(
    "yetAiChat",
    identity.vscode.displayName,
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")],
    },
  );

  panel.webview.html = renderWebviewHtml(panel.webview, context.extensionUri, identity, connection);
  panel.webview.onDidReceiveMessage((message: unknown) => {
    if (!isGuiMessage(message)) {
      if (isInvalidIdeActionRequestMessage(message)) {
        const requestId = (message as { requestId: string }).requestId;
        void panel.webview.postMessage(createIdeActionResult(requestId, "rejected", "IDE action rejected by host policy."));
        return;
      }
      if (isInvalidApplyWorkspaceEditRequestMessage(message)) {
        const requestId = (message as { requestId: string }).requestId;
        void panel.webview.postMessage(createApplyWorkspaceEditResult(requestId, "rejected", "Edit request rejected by host policy."));
        return;
      }
      console.log("Yet AI rejected invalid GUI bridge message");
      return;
    }
    console.log(`Yet AI received ${message.type}`);
    if (message.type === "gui.ideActionRequest") {
      void handleIdeActionRequest(panel.webview, message);
      return;
    }
    if (message.type === "gui.applyWorkspaceEditRequest") {
      void handleApplyWorkspaceEditRequest(panel.webview, message);
      return;
    }
    void panel.webview.postMessage(createHostReady(identity, connection, message.requestId));
    void panel.webview.postMessage({
      version: bridgeVersion,
      type: "host.openedFromCommand",
      payload: {},
    } satisfies HostMessage);
    void panel.webview.postMessage(createHostContextSnapshot(message.requestId));
  });
}

export function createHostReady(
  identity: ProductIdentity,
  connection: EngineConnection,
  requestId: string | undefined,
): HostMessage {
  return {
    version: bridgeVersion,
    type: "host.ready",
    requestId,
    payload: {
      productId: identity.product.id,
      displayName: identity.product.displayName,
      runtimeUrl: connection.runtimeUrl,
      sessionToken: connection.sessionToken,
      cloudRequired: false,
    },
  };
}

export function createHostContextSnapshot(requestId: string | undefined): HostMessage {
  return {
    version: bridgeVersion,
    type: "host.contextSnapshot",
    requestId,
    payload: createActiveEditorContextPayload(),
  };
}

export function createApplyWorkspaceEditResult(
  requestId: string,
  status: ApplyWorkspaceEditStatus,
  message: string,
  appliedEditCount = 0,
  affectedFiles: string[] = [],
): HostMessage {
  return {
    version: bridgeVersion,
    type: "host.applyWorkspaceEditResult",
    requestId,
    payload: {
      status,
      message: sanitizeApplyWorkspaceEditResultMessage(message),
      cloudRequired: false,
      appliedEditCount: clampAppliedEditCount(appliedEditCount),
      affectedFiles: affectedFiles.map((file) => sanitizeRelativePath(file, 512)).filter((file): file is string => file !== undefined).slice(0, 4),
    },
  };
}

export function createIdeActionProgress(
  requestId: string,
  phase: "queued" | "checkingPolicy" | "running" | "completed",
  status: "pending" | "inProgress" | IdeActionStatus,
  summary: string,
  action?: IdeActionType,
  workspaceRelativePath?: string,
): HostMessage {
  const payload: Record<string, unknown> = {
    phase,
    status,
    summary: sanitizeIdeActionStatusMessage(summary),
    cloudRequired: false,
  };
  if (action) {
    payload.action = action;
  }
  const pathValue = sanitizeRelativePath(workspaceRelativePath, 512);
  if (pathValue) {
    payload.workspaceRelativePath = pathValue;
  }
  return { version: bridgeVersion, type: "host.ideActionProgress", requestId, payload };
}

export function createIdeActionResult(
  requestId: string,
  status: IdeActionStatus,
  message: string,
  metadata: { action?: IdeActionType; workspaceRelativePath?: string; range?: ApplyWorkspaceTextReplacement["range"]; context?: Record<string, unknown> } = {},
): HostMessage {
  const payload: Record<string, unknown> = {
    status,
    message: sanitizeIdeActionStatusMessage(message),
    cloudRequired: false,
  };
  if (metadata.action) {
    payload.action = metadata.action;
  }
  const pathValue = sanitizeRelativePath(metadata.workspaceRelativePath, 512);
  if (pathValue) {
    payload.workspaceRelativePath = pathValue;
  }
  if (metadata.range && isStrictRange(metadata.range)) {
    payload.range = metadata.range;
  }
  if (metadata.context) {
    payload.context = metadata.context;
  }
  return { version: bridgeVersion, type: "host.ideActionResult", requestId, payload };
}

export async function handleIdeActionRequest(webview: vscode.Webview, message: GuiMessage): Promise<void> {
  const requestId = typeof message.requestId === "string" ? message.requestId : "invalid-request";
  const request = parseIdeActionRequest(message);
  if (!request) {
    await webview.postMessage(createIdeActionResult(requestId, "rejected", "IDE action rejected by host policy."));
    return;
  }
  if (inFlightIdeActionRequestIds.has(request.requestId)) {
    await webview.postMessage(createIdeActionResult(request.requestId, "rejected", "IDE action rejected by host policy.", { action: request.action }));
    return;
  }

  inFlightIdeActionRequestIds.add(request.requestId);
  try {
    await webview.postMessage(createIdeActionProgress(request.requestId, "checkingPolicy", "inProgress", "IDE action policy check started.", request.action, "workspaceRelativePath" in request ? request.workspaceRelativePath : undefined));
    const result = await runIdeActionRequest(request);
    await webview.postMessage(result);
  } catch {
    await webview.postMessage(createIdeActionResult(request.requestId, "failed", "IDE action failed.", { action: request.action }));
  } finally {
    inFlightIdeActionRequestIds.delete(request.requestId);
  }
}

async function runIdeActionRequest(request: IdeActionRequest): Promise<HostMessage> {
  if (request.action === "getContextSnapshot") {
    return createIdeActionResult(request.requestId, "succeeded", "IDE context snapshot captured.", {
      action: request.action,
      context: createIdeActionContextMetadata(),
    });
  }

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return createIdeActionResult(request.requestId, "unavailable", "Workspace is unavailable.", { action: request.action, workspaceRelativePath: request.workspaceRelativePath });
  }
  const uri = await resolveExistingWorkspaceFile(request.workspaceRelativePath, workspaceFolders, maxControlledIdeActionFileBytes);
  if (!uri) {
    return createIdeActionResult(request.requestId, "rejected", "Workspace file rejected by host policy.", { action: request.action, workspaceRelativePath: request.workspaceRelativePath });
  }
  const document = await vscode.workspace.openTextDocument(uri);
  if (!document || document.isUntitled) {
    return createIdeActionResult(request.requestId, "unavailable", "Workspace file is unavailable.", { action: request.action, workspaceRelativePath: request.workspaceRelativePath });
  }
  if (request.action === "openWorkspaceFile") {
    await vscode.window.showTextDocument(document, { preview: true });
    return createIdeActionResult(request.requestId, "succeeded", "Workspace file opened.", { action: request.action, workspaceRelativePath: request.workspaceRelativePath });
  }
  if (!isRangeWithinDocument(request.range, document)) {
    return createIdeActionResult(request.requestId, "rejected", "Workspace range rejected by host policy.", { action: request.action, workspaceRelativePath: request.workspaceRelativePath });
  }
  const editor = await vscode.window.showTextDocument(document, { preview: true, selection: toVscodeRange(request.range) });
  editor.revealRange(toVscodeRange(request.range), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  return createIdeActionResult(request.requestId, "succeeded", "Workspace range revealed.", { action: request.action, workspaceRelativePath: request.workspaceRelativePath, range: request.range });
}

function toVscodeRange(range: ApplyWorkspaceTextReplacement["range"]): vscode.Range {
  return new vscode.Range(new vscode.Position(range.start.line, range.start.character), new vscode.Position(range.end.line, range.end.character));
}

function createIdeActionContextMetadata(): Record<string, unknown> {
  return {
    source: "vscode",
    hasActiveEditor: vscode.window.activeTextEditor !== undefined,
    workspaceFolderCount: Math.min(vscode.workspace.workspaceFolders?.length ?? 0, 100),
  };
}

export async function handleApplyWorkspaceEditRequest(webview: vscode.Webview, message: GuiMessage): Promise<void> {
  const requestId = typeof message.requestId === "string" ? message.requestId : "invalid-request";
  const validatedRequest = parseApplyWorkspaceEditRequest(message);
  if (!validatedRequest) {
    await webview.postMessage(createApplyWorkspaceEditResult(requestId, "rejected", "Edit request rejected by host policy."));
    return;
  }

  const validatedEdit = await validateWorkspaceEditBeforeApply(validatedRequest);
  if (!validatedEdit) {
    await webview.postMessage(createApplyWorkspaceEditResult(validatedRequest.requestId, "rejected", "Edit request rejected by host policy."));
    return;
  }

  const confirmed = await vscode.window.showWarningMessage(
    `Yet AI wants to apply ${validatedEdit.editCount} confirmed text edit${validatedEdit.editCount === 1 ? "" : "s"} to ${validatedEdit.files.length} workspace file${validatedEdit.files.length === 1 ? "" : "s"}: ${validatedEdit.summary}`,
    { modal: true },
    applyWorkspaceEditConfirmationLabel,
  );
  if (confirmed !== applyWorkspaceEditConfirmationLabel) {
    await webview.postMessage(createApplyWorkspaceEditResult(validatedEdit.requestId, "denied", "Edit request denied by user."));
    return;
  }

  const workspaceEdit = new vscode.WorkspaceEdit();
  for (const fileEdit of validatedEdit.files) {
    for (const textReplacement of fileEdit.textReplacements) {
      workspaceEdit.replace(
        fileEdit.uri,
        new vscode.Range(
          new vscode.Position(textReplacement.range.start.line, textReplacement.range.start.character),
          new vscode.Position(textReplacement.range.end.line, textReplacement.range.end.character),
        ),
        textReplacement.replacementText,
      );
    }
  }

  try {
    const applied = await vscode.workspace.applyEdit(workspaceEdit);
    if (!applied) {
      await webview.postMessage(createApplyWorkspaceEditResult(validatedEdit.requestId, "failed", "Edit request failed during apply."));
      return;
    }
    await webview.postMessage(createApplyWorkspaceEditResult(validatedEdit.requestId, "applied", "Edit request applied.", validatedEdit.editCount, validatedEdit.files.map((file) => file.workspaceRelativePath)));
  } catch {
    await webview.postMessage(createApplyWorkspaceEditResult(validatedEdit.requestId, "failed", "Edit request failed during apply."));
  }
}

export async function validateWorkspaceEditBeforeApply(request: ApplyWorkspaceEditRequest): Promise<ValidatedWorkspaceEdit | undefined> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return undefined;
  }

  const files: ValidatedWorkspaceFileEdit[] = [];
  const seenWorkspaceRelativePaths = new Set<string>();
  let editCount = 0;
  for (const fileEdit of request.edits) {
    if (seenWorkspaceRelativePaths.has(fileEdit.workspaceRelativePath)) {
      return undefined;
    }
    seenWorkspaceRelativePaths.add(fileEdit.workspaceRelativePath);
    const uri = await resolveExistingWorkspaceFile(fileEdit.workspaceRelativePath, workspaceFolders);
    if (!uri) {
      return undefined;
    }
    const document = await vscode.workspace.openTextDocument(uri);
    if (!document || document.isUntitled) {
      return undefined;
    }
    if (hasOverlappingTextReplacements(fileEdit.textReplacements)) {
      return undefined;
    }
    for (const textReplacement of fileEdit.textReplacements) {
      if (!isRangeWithinDocument(textReplacement.range, document)) {
        return undefined;
      }
      editCount += 1;
    }
    files.push({
      workspaceRelativePath: fileEdit.workspaceRelativePath,
      uri,
      textReplacements: fileEdit.textReplacements,
    });
  }

  return {
    requestId: request.requestId,
    summary: request.summary,
    files,
    editCount,
  };
}

function parseApplyWorkspaceEditRequest(message: GuiMessage): ApplyWorkspaceEditRequest | undefined {
  if (
    message.type !== "gui.applyWorkspaceEditRequest" ||
    !isRequiredRequestId(message.requestId) ||
    !isPlainRecord(message.payload) ||
    !hasOnlyKeys(message.payload, ["requiresUserConfirmation", "summary", "cloudRequired", "edits"]) ||
    message.payload.requiresUserConfirmation !== true ||
    (message.payload.cloudRequired !== undefined && message.payload.cloudRequired !== false) ||
    !isSafeSummary(message.payload.summary) ||
    !Array.isArray(message.payload.edits) ||
    message.payload.edits.length < 1 ||
    message.payload.edits.length > 4
  ) {
    return undefined;
  }

  let totalReplacementText = 0;
  const edits: ApplyWorkspaceFileEdit[] = [];
  for (const fileEdit of message.payload.edits) {
    if (
      !isPlainRecord(fileEdit) ||
      !hasOnlyKeys(fileEdit, ["workspaceRelativePath", "textReplacements"]) ||
      !isStrictSafeRelativePath(fileEdit.workspaceRelativePath) ||
      !Array.isArray(fileEdit.textReplacements) ||
      fileEdit.textReplacements.length < 1 ||
      fileEdit.textReplacements.length > 16
    ) {
      return undefined;
    }

    const textReplacements: ApplyWorkspaceTextReplacement[] = [];
    for (const textReplacement of fileEdit.textReplacements) {
      if (
        !isPlainRecord(textReplacement) ||
        !hasOnlyKeys(textReplacement, ["range", "replacementText"]) ||
        !isStrictRange(textReplacement.range) ||
        typeof textReplacement.replacementText !== "string" ||
        textReplacement.replacementText.length > 8192
      ) {
        return undefined;
      }
      totalReplacementText += textReplacement.replacementText.length;
      if (totalReplacementText > 32768) {
        return undefined;
      }
      textReplacements.push({
        range: textReplacement.range,
        replacementText: textReplacement.replacementText,
      });
    }

    edits.push({
      workspaceRelativePath: fileEdit.workspaceRelativePath,
      textReplacements,
    });
  }

  return {
    requestId: message.requestId,
    summary: message.payload.summary,
    edits,
  };
}

export function parseIdeActionRequest(message: GuiMessage): IdeActionRequest | undefined {
  if (message.type !== "gui.ideActionRequest" || !isRequiredRequestId(message.requestId) || !isPlainRecord(message.payload)) {
    return undefined;
  }
  if (hasOnlyKeys(message.payload, ["action"]) && message.payload.action === "getContextSnapshot") {
    return { requestId: message.requestId, action: "getContextSnapshot" };
  }
  if (
    hasOnlyKeys(message.payload, ["action", "workspaceRelativePath"]) &&
    message.payload.action === "openWorkspaceFile" &&
    isStrictSafeRelativePath(message.payload.workspaceRelativePath)
  ) {
    return { requestId: message.requestId, action: "openWorkspaceFile", workspaceRelativePath: message.payload.workspaceRelativePath };
  }
  if (
    hasOnlyKeys(message.payload, ["action", "workspaceRelativePath", "range"]) &&
    message.payload.action === "revealWorkspaceRange" &&
    isStrictSafeRelativePath(message.payload.workspaceRelativePath) &&
    isStrictRange(message.payload.range)
  ) {
    return { requestId: message.requestId, action: "revealWorkspaceRange", workspaceRelativePath: message.payload.workspaceRelativePath, range: message.payload.range };
  }
  return undefined;
}

async function resolveExistingWorkspaceFile(workspaceRelativePath: string, workspaceFolders: readonly vscode.WorkspaceFolder[], maxFileBytes?: number): Promise<vscode.Uri | undefined> {
  const segments = workspaceRelativePath.split("/");
  const matches: vscode.Uri[] = [];
  for (const workspaceFolder of workspaceFolders) {
    const uri = vscode.Uri.joinPath(workspaceFolder.uri, ...segments);
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type === vscode.FileType.File && (maxFileBytes === undefined || stat.size <= maxFileBytes)) {
        matches.push(uri);
      }
    } catch {
      continue;
    }
  }
  return matches.length === 1 ? matches[0] : undefined;
}

function isRangeWithinDocument(range: ApplyWorkspaceTextReplacement["range"], document: vscode.TextDocument): boolean {
  if (!isStrictRange(range) || range.start.line >= document.lineCount || range.end.line >= document.lineCount) {
    return false;
  }
  return range.start.character <= document.lineAt(range.start.line).text.length && range.end.character <= document.lineAt(range.end.line).text.length;
}

function hasOverlappingTextReplacements(textReplacements: ApplyWorkspaceTextReplacement[]): boolean {
  const sorted = [...textReplacements].sort((left, right) => comparePositions(left.range.start, right.range.start));
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (comparePositions(previous.range.start, current.range.start) === 0 && (isZeroLengthRange(previous.range) || isZeroLengthRange(current.range))) {
      return true;
    }
    if (comparePositions(previous.range.end, current.range.start) > 0) {
      return true;
    }
  }
  return false;
}

function isZeroLengthRange(range: ApplyWorkspaceTextReplacement["range"]): boolean {
  return comparePositions(range.start, range.end) === 0;
}

function comparePositions(left: ApplyWorkspacePosition, right: ApplyWorkspacePosition): number {
  if (left.line !== right.line) {
    return left.line - right.line;
  }
  return left.character - right.character;
}

function isStrictRange(value: unknown): value is ApplyWorkspaceTextReplacement["range"] {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["start", "end"]) || !isStrictPosition(value.start) || !isStrictPosition(value.end)) {
    return false;
  }
  return value.end.line > value.start.line || (value.end.line === value.start.line && value.end.character >= value.start.character);
}

function isStrictPosition(value: unknown): value is ApplyWorkspacePosition {
  return isPlainRecord(value) && hasOnlyKeys(value, ["line", "character"]) && isBoundedInteger(value.line) && isBoundedInteger(value.character);
}

function isBoundedInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value >= 0 && value <= 1000000;
}

function isStrictSafeRelativePath(value: unknown): value is string {
  return typeof value === "string" && sanitizeRelativePath(value, 512) === value;
}

function isSafeSummary(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1000 && !hasSecretLikeText(value) && !hasBinaryLikeText(value) && !hasPrivatePathLikeText(value);
}

function isRequiredRequestId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value);
}

function sanitizeApplyWorkspaceEditResultMessage(value: string): string {
  if (value.length === 0 || value.length > 1000 || hasSecretLikeText(value) || hasPrivatePathLikeText(value) || hasBinaryLikeText(value)) {
    return "Edit request status changed.";
  }
  return value;
}

function sanitizeIdeActionStatusMessage(value: string): string {
  if (value.length === 0 || value.length > 1000 || hasSecretLikeText(value) || hasPrivatePathLikeText(value) || hasBinaryLikeText(value)) {
    return "IDE action status changed.";
  }
  return value;
}

function clampAppliedEditCount(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    return 0;
  }
  return Math.min(value, 64);
}

function createActiveEditorContextPayload(): HostContextPayload {
  const payload: HostContextPayload = {
    kind: "active_editor",
    source: "vscode",
  };
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return payload;
  }

  const file = createActiveEditorFileContext(editor.document);
  if (file) {
    payload.file = file;
  }

  const selection = createActiveEditorSelectionContext(editor.document, editor.selection);
  if (selection) {
    payload.selection = selection;
  }

  return payload;
}

function createActiveEditorFileContext(document: vscode.TextDocument): HostContextPayload["file"] | undefined {
  const file: NonNullable<HostContextPayload["file"]> = {};
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  const workspaceRelativePath = workspaceFolder ? sanitizeRelativePath(vscode.workspace.asRelativePath(document.uri, false), 512) : undefined;
  const displayPath = workspaceRelativePath ?? sanitizeDisplayPath(getDocumentDisplayLabel(document));
  const languageId = sanitizeLanguageId(document.languageId);

  if (displayPath) {
    file.displayPath = displayPath;
  }
  if (workspaceRelativePath) {
    file.workspaceRelativePath = workspaceRelativePath;
  }
  if (languageId) {
    file.languageId = languageId;
  }

  return Object.keys(file).length > 0 ? file : undefined;
}

function createActiveEditorSelectionContext(document: vscode.TextDocument, selection: vscode.Selection): HostContextPayload["selection"] | undefined {
  if (selection.isEmpty) {
    return undefined;
  }
  const startLine = sanitizePositionNumber(selection.start.line);
  const startCharacter = sanitizePositionNumber(selection.start.character);
  const endLine = sanitizePositionNumber(selection.end.line);
  const endCharacter = sanitizePositionNumber(selection.end.character);
  if (startLine === undefined || startCharacter === undefined || endLine === undefined || endCharacter === undefined) {
    return undefined;
  }

  const text = sanitizeSelectionText(document.getText(selection));
  const result: NonNullable<HostContextPayload["selection"]> = {
    startLine,
    startCharacter,
    endLine,
    endCharacter,
  };
  if (text !== undefined) {
    result.text = text;
  }
  return result;
}

export function renderWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  identity: ProductIdentity,
  connection: EngineConnection,
): string {
  const nonce = createNonce();
  const guiDevOrigin = connection.guiDevUrl
    ? getLoopbackOrigin(connection.guiDevUrl, `${configurationPrefix}.guiDevUrl`)
    : undefined;
  const packagedGui = connection.guiDevUrl ? undefined : findPackagedGui(extensionUri);
  const bootstrap = serializeScriptJson({
    bridgeVersion,
    requestId: createRequestId(),
    productId: identity.product.id,
    displayName: identity.product.displayName,
    runtimeUrl: connection.runtimeUrl,
    cloudRequired: false,
    guiDevOrigin,
  });
  const frameSource = connection.guiDevUrl
    ? `<iframe title="${escapeHtml(identity.vscode.displayName)} GUI" src="${escapeHtml(connection.guiDevUrl)}"></iframe>`
    : "";
  const placeholder = connection.guiDevUrl || packagedGui ? "" : `<main><h1>${escapeHtml(identity.vscode.displayName)}</h1><p>Local runtime shell is ready.</p><p>Runtime: <code>${escapeHtml(connection.runtimeUrl)}</code></p><p>Run <code>cd apps/gui && npm run build</code> and <code>cd apps/plugins/vscode && npm run copy:gui</code> to package the GUI, or set <code>yetai.guiDevUrl</code> to a loopback Vite dev server during development.</p></main>`;
  const packagedGuiHtml = packagedGui ? rewritePackagedGuiHtml(packagedGui.html, packagedGui.root, webview) : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src ${webview.cspSource} 'nonce-${nonce}'; connect-src http://127.0.0.1:* http://localhost:* http://[::1]:* https://127.0.0.1:* https://localhost:* https://[::1]:*; frame-src http://127.0.0.1:* http://localhost:* http://[::1]:* https://127.0.0.1:* https://localhost:* https://[::1]:*;">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(identity.vscode.displayName)}</title>
<style nonce="${nonce}">
body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; }
main { padding: 24px; }
code { color: var(--vscode-textLink-foreground); }
iframe { width: 100vw; height: 100vh; border: 0; }
</style>
</head>
<body>
${placeholder}${frameSource}${packagedGuiHtml}
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const bootstrap = ${bootstrap};
window.yetAiBootstrap = bootstrap;
const frame = document.querySelector("iframe");
const frameTargetOrigin = bootstrap.guiDevOrigin;
const maxForwardedApplyWorkspaceEditMessageBytes = ${maxForwardedApplyWorkspaceEditMessageBytes};
const maxForwardedIdeActionMessageBytes = ${maxForwardedIdeActionMessageBytes};
let latestHostReady;
let frameReady = false;
const isPlainObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const isBoundedRequestId = (value) => value === undefined || (typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value));
const isRequiredRequestId = (value) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value);
const isBoundedForwardedApplyWorkspaceEditMessage = (value) => {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length <= maxForwardedApplyWorkspaceEditMessageBytes;
  } catch {
    return false;
  }
};
const isBoundedForwardedIdeActionMessage = (value) => {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length <= maxForwardedIdeActionMessageBytes;
  } catch {
    return false;
  }
};
const isStrictGuiReadyPayload = (payload) => {
  if (payload === undefined) {
    return true;
  }
  return isPlainObject(payload) && Object.keys(payload).every((key) => key === "supportedBridgeVersion") && (payload.supportedBridgeVersion === undefined || payload.supportedBridgeVersion === bootstrap.bridgeVersion);
};
const isStrictSafeRelativePath = (value) => typeof value === "string" && value.length > 0 && value.length <= 512 && !value.startsWith("/") && !value.startsWith("~") && !value.includes("%") && !value.includes("\\\\") && !value.includes(":") && !value.includes("?") && !value.includes("#") && !/[\u0000-\u001f\u007f-\u009f]/.test(value) && !/(^|\/)\.\.?(\/|$)/.test(value) && !value.includes("//") && !value.endsWith("/");
const isStrictPosition = (value) => isPlainObject(value) && Object.keys(value).every((key) => key === "line" || key === "character") && Number.isInteger(value.line) && Number.isInteger(value.character) && value.line >= 0 && value.line <= 1000000 && value.character >= 0 && value.character <= 1000000;
const isStrictRange = (value) => isPlainObject(value) && Object.keys(value).every((key) => key === "start" || key === "end") && isStrictPosition(value.start) && isStrictPosition(value.end) && (value.end.line > value.start.line || (value.end.line === value.start.line && value.end.character >= value.start.character));
const isStrictIdeActionPayload = (payload) => isPlainObject(payload) && ((Object.keys(payload).every((key) => key === "action") && payload.action === "getContextSnapshot") || (Object.keys(payload).every((key) => key === "action" || key === "workspaceRelativePath") && payload.action === "openWorkspaceFile" && isStrictSafeRelativePath(payload.workspaceRelativePath)) || (Object.keys(payload).every((key) => key === "action" || key === "workspaceRelativePath" || key === "range") && payload.action === "revealWorkspaceRange" && isStrictSafeRelativePath(payload.workspaceRelativePath) && isStrictRange(payload.range)));
const isFrameGuiMessage = (message) => isPlainObject(message) && Object.keys(message).every((key) => key === "version" || key === "type" || key === "requestId" || key === "payload") && message.version === bootstrap.bridgeVersion && ((message.type === "gui.ready" && isBoundedRequestId(message.requestId) && isStrictGuiReadyPayload(message.payload)) || (message.type === "gui.ideActionRequest" && isRequiredRequestId(message.requestId) && isBoundedForwardedIdeActionMessage(message) && isStrictIdeActionPayload(message.payload)) || (message.type === "gui.applyWorkspaceEditRequest" && isRequiredRequestId(message.requestId) && isBoundedForwardedApplyWorkspaceEditMessage(message)));
const isHostMessage = (message) => isPlainObject(message) && message.version === bootstrap.bridgeVersion && (message.type === "host.ready" || message.type === "host.openedFromCommand" || message.type === "host.contextSnapshot" || message.type === "host.ideActionProgress" || message.type === "host.ideActionResult" || message.type === "host.applyWorkspaceEditResult");
const sendToFrame = (message) => {
  if (frame && frame.contentWindow && frameTargetOrigin) {
    frame.contentWindow.postMessage(message, frameTargetOrigin);
  }
};
const replayHostReady = () => {
  if (frameReady && latestHostReady) {
    sendToFrame(latestHostReady);
  }
};
vscode.postMessage({ version: bootstrap.bridgeVersion, type: "gui.ready", requestId: bootstrap.requestId, payload: { supportedBridgeVersion: bootstrap.bridgeVersion } });
window.addEventListener("message", (event) => {
  if (event.source === frame?.contentWindow) {
    if (event.origin !== frameTargetOrigin) {
      console.log("Yet AI rejected iframe message from unexpected origin");
      return;
    }
    if (isFrameGuiMessage(event.data)) {
      if (event.data.type === "gui.ready") {
        frameReady = true;
      }
      vscode.postMessage(event.data);
      replayHostReady();
    } else {
      console.log("Yet AI rejected invalid iframe GUI bridge message");
    }
    return;
  }
  if (isHostMessage(event.data)) {
    console.log("Yet AI host message", event.data.type);
    if (event.data.type === "host.ready") {
      latestHostReady = event.data;
      replayHostReady();
      return;
    }
    sendToFrame(event.data);
  }
});
</script>
</body>
</html>`;
}

type PackagedGui = {
  root: vscode.Uri;
  html: string;
};

function findPackagedGui(extensionUri: vscode.Uri): PackagedGui | undefined {
  const root = vscode.Uri.joinPath(extensionUri, "media", "gui");
  const index = vscode.Uri.joinPath(root, "index.html");
  try {
    return {
      root,
      html: fs.readFileSync(index.fsPath, "utf8"),
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }
    throw error;
  }
}

function rewritePackagedGuiHtml(html: string, root: vscode.Uri, webview: vscode.Webview): string {
  const head = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? "";
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? "";
  return `${rewritePackagedGuiHeadAssets(head, root, webview)}${rewritePackagedGuiAssetReferences(body, root, webview)}`;
}

function rewritePackagedGuiHeadAssets(head: string, root: vscode.Uri, webview: vscode.Webview): string {
  const assets: string[] = [];
  for (const match of head.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = getHtmlAttribute(tag, "rel");
    const href = getHtmlAttribute(tag, "href");
    if (rel?.toLowerCase() === "stylesheet" && href && resolvePackagedAssetUri(href, root, webview)) {
      assets.push(rewritePackagedGuiAssetReferences(tag, root, webview));
    }
  }
  for (const match of head.matchAll(/<script\b[^>]*\bsrc=("|').+?\1[^>]*><\/script>/gi)) {
    const tag = match[0];
    const src = getHtmlAttribute(tag, "src");
    if (src && resolvePackagedAssetUri(src, root, webview)) {
      assets.push(rewritePackagedGuiAssetReferences(tag, root, webview));
    }
  }
  return assets.join("\n");
}

function rewritePackagedGuiAssetReferences(html: string, root: vscode.Uri, webview: vscode.Webview): string {
  return html.replace(/\b(src|href)=("|')(.+?)\2/g, (_match: string, attribute: string, quote: string, value: string) => {
    const uri = resolvePackagedAssetUri(value, root, webview);
    return `${attribute}=${quote}${uri ?? value}${quote}`;
  });
}

function getHtmlAttribute(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${name}=("|')(.+?)\\1`, "i"));
  return match?.[2];
}

function resolvePackagedAssetUri(value: string, root: vscode.Uri, webview: vscode.Webview): string | undefined {
  if (!value.startsWith("./") && !value.startsWith("/")) {
    return undefined;
  }
  if (value.length === 0 || value.startsWith("//") || value.includes("\\") || value.includes("?") || value.includes("#")) {
    return undefined;
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) {
    return undefined;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return undefined;
  }
  if (decoded.includes("\\") || decoded.includes("?") || decoded.includes("#")) {
    return undefined;
  }

  const relativePath = decoded.replace(/^\.\//, "").replace(/^\//, "");
  if (relativePath.length === 0 || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(relativePath)) {
    return undefined;
  }

  const segments = relativePath.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    return undefined;
  }

  return webview.asWebviewUri(vscode.Uri.joinPath(root, ...segments)).toString();
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

function getDocumentDisplayLabel(document: vscode.TextDocument): string | undefined {
  if (document.isUntitled) {
    return sanitizeDisplayPath(path.posix.basename(document.uri.path)) ?? "untitled";
  }
  if (document.uri.scheme === "file") {
    return path.basename(document.uri.fsPath);
  }
  return path.posix.basename(document.uri.path);
}

function sanitizeLanguageId(value: string): string | undefined {
  if (/^[A-Za-z0-9_.+-]{1,64}$/.test(value)) {
    return value;
  }
  return undefined;
}

function sanitizePositionNumber(value: number): number | undefined {
  if (Number.isInteger(value) && value >= 0 && value <= 1000000) {
    return value;
  }
  return undefined;
}

function sanitizeSelectionText(value: string): string | undefined {
  if (value.length === 0 || value.length > 8000 || hasSecretLikeText(value) || hasBinaryLikeText(value)) {
    return undefined;
  }
  return value;
}

function sanitizeDisplayPath(value: string | undefined): string | undefined {
  return sanitizeSafePath(value, 256);
}

function sanitizeRelativePath(value: string | undefined, maxLength: number): string | undefined {
  return sanitizeSafePath(value, maxLength);
}

function sanitizeSafePath(value: string | undefined, maxLength: number): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.replaceAll(path.sep, "/");
  if (
    normalized.length === 0 ||
    normalized.length > maxLength ||
    normalized.startsWith("/") ||
    normalized.startsWith("~") ||
    normalized.includes("\\") ||
    normalized.includes(":") ||
    normalized.includes("%") ||
    normalized.includes("?") ||
    normalized.includes("#") ||
    /[\u0000-\u001f\u007f-\u009f]/.test(normalized) ||
    /(?:^|\/)\.\.?(?:\/|$)/.test(normalized) ||
    hasSecretLikeText(normalized) ||
    normalized.split("/").some((segment) => segment.length === 0)
  ) {
    return undefined;
  }
  return normalized;
}

function hasSecretLikeText(value: string): boolean {
  return /(?:authorization|bearer|cookie|api[_-]?key|token|secret|password|private[_-]?path|provider[_-]?response|raw[_-]?prompt|file[_-]?content|sk-(?:proj-)?[A-Za-z0-9_-]{8,})/i.test(value);
}

function hasBinaryLikeText(value: string): boolean {
  return value.includes("\u0000") || /[\u0001-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
}

export function serializeScriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function isGuiMessage(value: unknown): value is GuiMessage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    hasOnlyKeys(record, ["version", "type", "requestId", "payload"]) &&
    record.version === bridgeVersion &&
    ((record.type === "gui.ready" && isBoundedRequestId(record.requestId) && isGuiReadyPayload(record.payload)) ||
      (record.type === "gui.ideActionRequest" && parseIdeActionRequest(record as GuiMessage) !== undefined) ||
      (record.type === "gui.applyWorkspaceEditRequest" && isBoundedForwardedApplyWorkspaceEditMessage(record) && parseApplyWorkspaceEditRequest(record as GuiMessage) !== undefined))
  );
}

export function isInvalidApplyWorkspaceEditRequestMessage(value: unknown): value is GuiMessage & { requestId: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    hasOnlyKeys(record, ["version", "type", "requestId", "payload"]) &&
    record.version === bridgeVersion &&
    record.type === "gui.applyWorkspaceEditRequest" &&
    isRequiredRequestId(record.requestId) &&
    isBoundedForwardedApplyWorkspaceEditMessage(record) &&
    parseApplyWorkspaceEditRequest(record as GuiMessage) === undefined
  );
}

export function isInvalidIdeActionRequestMessage(value: unknown): value is GuiMessage & { requestId: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    hasOnlyKeys(record, ["version", "type", "requestId", "payload"]) &&
    record.version === bridgeVersion &&
    record.type === "gui.ideActionRequest" &&
    isRequiredRequestId(record.requestId) &&
    isBoundedForwardedIdeActionMessage(record) &&
    parseIdeActionRequest(record as GuiMessage) === undefined
  );
}

function isBoundedForwardedApplyWorkspaceEditMessage(value: Record<string, unknown>): boolean {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8") <= maxForwardedApplyWorkspaceEditMessageBytes;
  } catch {
    return false;
  }
}

function isBoundedForwardedIdeActionMessage(value: Record<string, unknown>): boolean {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8") <= maxForwardedIdeActionMessageBytes;
  } catch {
    return false;
  }
}

export function createNonce(): string {
  return crypto.randomBytes(24).toString("base64url");
}

function isBoundedRequestId(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value) && !hasSecretRequestIdMarker(value));
}

function hasSecretRequestIdMarker(value: string): boolean {
  return /authorization|bearer|api[_-]?key|token|secret|access[_-]?token|sk-(?:proj-)?[A-Za-z0-9_-]{8,}/i.test(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGuiReadyPayload(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return hasOnlyKeys(record, ["supportedBridgeVersion"]) && (record.supportedBridgeVersion === undefined || record.supportedBridgeVersion === bridgeVersion);
}

function hasOnlyKeys(record: Record<string, unknown>, allowedKeys: string[]): boolean {
  return Object.keys(record).every((key) => allowedKeys.includes(key));
}

function hasPrivatePathLikeText(value: string): boolean {
  return /(?:\/Users\/|\/home\/|\/tmp\/|\/var\/|\/Volumes\/|\/Private\/|~[\/\\]|[A-Za-z]:[\/\\])/.test(value);
}

function createRequestId(): string {
  return `${Date.now().toString(36)}-${createNonce()}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return character;
    }
  });
}
