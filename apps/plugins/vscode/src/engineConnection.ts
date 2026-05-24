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
  let parsed: vscode.Uri;
  try {
    parsed = vscode.Uri.parse(value, true);
  } catch {
    throw new Error(`${settingName} must be a valid URL.`);
  }
  if (parsed.scheme !== "http" && parsed.scheme !== "https") {
    throw new Error(`${settingName} must use http or https.`);
  }
  const authority = parsed.authority.toLowerCase();
  const host = authority.includes("@") ? authority.split("@").pop() ?? authority : authority;
  const hostname = host.startsWith("[") ? host.slice(1, host.indexOf("]")) : host.split(":")[0];
  if (hostname !== "127.0.0.1" && hostname !== "localhost" && hostname !== "::1") {
    throw new Error(`${settingName} must point to a loopback host.`);
  }
  return parsed;
}

export function validateEngineConnection(connection: EngineConnection): void {
  validateLoopbackUrl(connection.runtimeUrl, `${configurationPrefix}.runtimeUrl`);
  if (connection.guiDevUrl) {
    validateLoopbackUrl(connection.guiDevUrl, `${configurationPrefix}.guiDevUrl`);
  }
}
