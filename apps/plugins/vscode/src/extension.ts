import * as vscode from "vscode";
import { readEngineConnection, validateEngineConnection } from "./engineConnection";
import { assertExtensionIdentity, extensionCommand, loadProductIdentity } from "./identity";
import { openYetAiWebview } from "./webview";

export function activate(context: vscode.ExtensionContext): void {
  const identity = loadProductIdentity(context.extensionPath);
  assertExtensionIdentity(identity);

  const disposable = vscode.commands.registerCommand(extensionCommand, () => {
    try {
      const connection = readEngineConnection();
      validateEngineConnection(connection);
      openYetAiWebview(context, identity, connection);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Yet AI extension error.";
      void vscode.window.showErrorMessage(message);
    }
  });

  context.subscriptions.push(disposable);
}

export function deactivate(): void {}
