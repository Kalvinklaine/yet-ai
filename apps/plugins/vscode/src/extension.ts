import * as vscode from "vscode";
import { collectRuntimeDiagnostics, prepareEngineConnection, stopLaunchedEngine } from "./engineConnection";
import { assertExtensionIdentity, extensionCommand, loadProductIdentity, runtimeStatusCommand } from "./identity";
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

  context.subscriptions.push(openChatDisposable, runtimeStatusDisposable, engineOutput);
}

export function deactivate(): void {
  stopLaunchedEngine(engineOutput);
}
