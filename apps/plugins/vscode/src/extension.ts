import * as vscode from "vscode";
import { clearStoredSessionToken, collectRuntimeDiagnostics, prepareEngineConnection, setStoredSessionToken, stopLaunchedEngine } from "./engineConnection";
import { assertExtensionIdentity, clearSessionTokenCommand, extensionCommand, loadProductIdentity, runtimeStatusCommand, setSessionTokenCommand } from "./identity";
import { openYetAiWebview } from "./webview";

let engineOutput: vscode.OutputChannel | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const identity = loadProductIdentity(context.extensionPath);
  assertExtensionIdentity(identity);
  engineOutput = vscode.window.createOutputChannel("Yet AI Runtime");

  const openChatDisposable = vscode.commands.registerCommand(extensionCommand, async () => {
    try {
      const connection = await prepareEngineConnection(context, identity, engineOutput!);
      openYetAiWebview(context, identity, connection);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Yet AI extension error.";
      void vscode.window.showErrorMessage(message);
      engineOutput?.appendLine(message);
    }
  });

  const runtimeStatusDisposable = vscode.commands.registerCommand(runtimeStatusCommand, async () => {
    try {
      const diagnostics = await collectRuntimeDiagnostics(context, identity);
      engineOutput?.appendLine("Yet AI runtime diagnostics:");
      engineOutput?.appendLine(`Runtime URL: ${diagnostics.runtimeUrl}`);
      engineOutput?.appendLine(`Launch mode: ${diagnostics.launchMode}`);
      engineOutput?.appendLine(`Engine binary configured: ${diagnostics.configuredEngineBinaryPath ? "yes" : "no"}`);
      engineOutput?.appendLine(`Engine binary: ${diagnostics.engineBinaryStatus}`);
      engineOutput?.appendLine(`Ping: ${diagnostics.pingStatus}`);
      engineOutput?.show(true);
      void vscode.window.showInformationMessage(`Yet AI runtime diagnostics: ping ${diagnostics.pingStatus}. See Yet AI Runtime output for details.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Yet AI diagnostics error.";
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

  context.subscriptions.push(openChatDisposable, runtimeStatusDisposable, setSessionTokenDisposable, clearSessionTokenDisposable, engineOutput);
}

export function deactivate(): void {
  stopLaunchedEngine(engineOutput);
}
