import * as vscode from "vscode";
import { configurationPrefix } from "./identity";

export type EngineConnection = {
  runtimeUrl: string;
  sessionToken?: string;
  guiDevUrl?: string;
};

export function readEngineConnection(): EngineConnection {
  const config = vscode.workspace.getConfiguration(configurationPrefix);
  const runtimeUrl = config.get<string>("runtimeUrl", "http://127.0.0.1:8001").trim();
  const sessionToken = config.get<string>("sessionToken", "").trim();
  const guiDevUrl = config.get<string>("guiDevUrl", "").trim();
  return {
    runtimeUrl,
    sessionToken: sessionToken.length > 0 ? sessionToken : undefined,
    guiDevUrl: guiDevUrl.length > 0 ? guiDevUrl : undefined,
  };
}

export function validateLoopbackUrl(value: string, settingName: string): vscode.Uri {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${settingName} must be a valid URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${settingName} must use http or https.`);
  }
  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost" && parsed.hostname !== "[::1]") {
    throw new Error(`${settingName} must point to a loopback host.`);
  }
  return vscode.Uri.parse(parsed.href, true);
}

export function getLoopbackOrigin(value: string, settingName: string): string {
  validateLoopbackUrl(value, settingName);
  return new URL(value).origin;
}

export function validateEngineConnection(connection: EngineConnection): void {
  validateLoopbackUrl(connection.runtimeUrl, `${configurationPrefix}.runtimeUrl`);
  if (connection.guiDevUrl) {
    validateLoopbackUrl(connection.guiDevUrl, `${configurationPrefix}.guiDevUrl`);
  }
}
