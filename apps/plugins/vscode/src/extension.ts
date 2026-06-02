import * as vscode from "vscode";
import { clearStoredSessionToken, collectRuntimeDiagnostics, formatRuntimeDiagnostics, prepareEngineConnection, redactRuntimeDiagnosticText, setStoredSessionToken, stopLaunchedEngine } from "./engineConnection";
import { assertExtensionIdentity, clearSessionTokenCommand, configurationPrefix, extensionCommand, loadProductIdentity, runtimeStatusCommand, setSessionTokenCommand } from "./identity";
import { openYetAiWebview } from "./webview";
import { startYetAiLspClient, stopYetAiLspClient } from "./lspClient";

let engineOutput: vscode.OutputChannel | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const identity = loadProductIdentity(context.extensionPath);
  assertExtensionIdentity(identity);
  engineOutput = vscode.window.createOutputChannel("Yet AI Runtime");
  startYetAiLspClient(context, identity, engineOutput);

  const openChatDisposable = vscode.commands.registerCommand(extensionCommand, async () => {
    try {
      const connection = await prepareEngineConnection(context, identity, engineOutput!);
      openYetAiWebview(context, identity, connection);
    } catch (error) {
      const message = sanitizeCommandError(error, "Unknown Yet AI extension error.");
      void vscode.window.showErrorMessage(message);
      engineOutput?.appendLine(message);
    }
  });

  const runtimeStatusDisposable = vscode.commands.registerCommand(runtimeStatusCommand, async () => {
    try {
      const diagnostics = await collectRuntimeDiagnostics(context, identity);
      engineOutput?.appendLine(formatRuntimeDiagnostics(diagnostics));
      engineOutput?.show(true);
      void vscode.window.showInformationMessage(`Yet AI runtime diagnostics: ping ${diagnostics.pingStatus}. See Yet AI Runtime output for details.`);
    } catch (error) {
      const message = sanitizeCommandError(error, "Unknown Yet AI diagnostics error.");
      void vscode.window.showErrorMessage(message);
      engineOutput?.appendLine(message);
    }
  });

  const setSessionTokenDisposable = vscode.commands.registerCommand(setSessionTokenCommand, async () => {
    const token = await vscode.window.showInputBox({
      title: "Yet AI: Set Local Runtime Session Token",
      prompt: "Enter the local runtime session token for manual connect/debug mode. This is not a provider API key.",
      password: true,
      ignoreFocusOut: true,
      placeHolder: "local runtime session token",
    });
    if (token === undefined) {
      return;
    }
    const stored = await setStoredSessionToken(context, token);
    engineOutput?.appendLine(stored ? "Stored Yet AI local runtime session token in VS Code SecretStorage." : "Cleared Yet AI local runtime session token from VS Code SecretStorage.");
    void vscode.window.showInformationMessage(stored ? "Yet AI local runtime session token stored in SecretStorage." : "Yet AI local runtime session token cleared.");
  });

  const clearSessionTokenDisposable = vscode.commands.registerCommand(clearSessionTokenCommand, async () => {
    await clearStoredSessionToken(context);
    engineOutput?.appendLine("Cleared Yet AI local runtime session token from VS Code SecretStorage.");
    void vscode.window.showInformationMessage("Yet AI local runtime session token cleared from SecretStorage.");
  });

  const lspConfigurationDisposable = vscode.workspace.onDidChangeConfiguration((event) => {
    if (!event.affectsConfiguration(`${configurationPrefix}.lsp.enabled`)) {
      return;
    }
    if (engineOutput === undefined) {
      return;
    }
    if (vscode.workspace.getConfiguration(configurationPrefix).get<boolean>("lsp.enabled", false)) {
      startYetAiLspClient(context, identity, engineOutput);
    } else {
      stopYetAiLspClient(engineOutput);
    }
  });

  context.subscriptions.push(openChatDisposable, runtimeStatusDisposable, setSessionTokenDisposable, clearSessionTokenDisposable, lspConfigurationDisposable, engineOutput);
}

const maxCommandErrorLength = 1000;
const commandErrorTruncationMarker = "… [truncated sanitized command error]";

function sanitizeCommandError(error: unknown, fallback: string): string {
  const rawMessage = error instanceof Error ? error.message : typeof error === "string" ? error : fallback;
  const redactedMessage = redactRuntimeDiagnosticText(rawMessage);
  if (redactedMessage.length <= maxCommandErrorLength) {
    return redactedMessage;
  }
  return `${redactedMessage.slice(0, maxCommandErrorLength - commandErrorTruncationMarker.length)}${commandErrorTruncationMarker}`;
}

export function deactivate(): void {
  stopYetAiLspClient(engineOutput);
  stopLaunchedEngine(engineOutput);
}
