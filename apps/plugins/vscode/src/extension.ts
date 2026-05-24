import * as vscode from "vscode";
import { prepareEngineConnection, stopLaunchedEngine } from "./engineConnection";
import { assertExtensionIdentity, extensionCommand, loadProductIdentity } from "./identity";
import { openYetAiWebview } from "./webview";

let engineOutput: vscode.OutputChannel | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const identity = loadProductIdentity(context.extensionPath);
  assertExtensionIdentity(identity);
  engineOutput = vscode.window.createOutputChannel("Yet AI Runtime");

  const disposable = vscode.commands.registerCommand(extensionCommand, async () => {
    try {
      const connection = await prepareEngineConnection(context, identity, engineOutput!);
      openYetAiWebview(context, identity, connection);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Yet AI extension error.";
      void vscode.window.showErrorMessage(message);
      engineOutput?.appendLine(message);
    }
  });

  context.subscriptions.push(disposable, engineOutput);
}

export function deactivate(): void {
  stopLaunchedEngine(engineOutput);
}
