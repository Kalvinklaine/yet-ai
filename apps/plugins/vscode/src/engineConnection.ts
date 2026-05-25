import * as vscode from "vscode";
import * as childProcess from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ProductIdentity, configurationPrefix, sessionTokenSecretKey } from "./identity";

export type EngineConnection = {
  runtimeUrl: string;
  sessionToken?: string;
  guiDevUrl?: string;
};

export type RuntimeDiagnostics = {
  runtimeUrl: string;
  launchMode: LaunchMode;
  configuredEngineBinaryPath: boolean;
  engineBinaryStatus: string;
  pingStatus: string;
};

type LaunchMode = "auto" | "connect" | "launch";

type EngineConnectionSettings = EngineConnection & {
  engineBinaryPath?: string;
  launchMode: LaunchMode;
  sessionTokenSource: SessionTokenSource;
};

export type SessionTokenSource = "none" | "secretStorage" | "legacySetting";

type LaunchedEngine = {
  process: childProcess.ChildProcess;
  runtimeUrl: string;
  sessionToken: string;
};

let launchedEngine: LaunchedEngine | undefined;

export async function readEngineConnection(context: vscode.ExtensionContext): Promise<EngineConnection> {
  const settings = await readEngineConnectionSettings(context);
  return {
    runtimeUrl: settings.runtimeUrl,
    sessionToken: settings.sessionToken,
    guiDevUrl: settings.guiDevUrl,
  };
}

export async function collectRuntimeDiagnostics(
  context: vscode.ExtensionContext,
  identity: ProductIdentity,
): Promise<RuntimeDiagnostics> {
  const settings = await readEngineConnectionSettings(context);
  const diagnostics: RuntimeDiagnostics = {
    runtimeUrl: safeRuntimeUrl(settings.runtimeUrl),
    launchMode: settings.launchMode,
    configuredEngineBinaryPath: settings.engineBinaryPath !== undefined,
    engineBinaryStatus: "not checked",
    pingStatus: "not checked",
  };

  try {
    validateEngineConnectionSettings(settings);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid runtime settings";
    diagnostics.pingStatus = `skipped: ${message}`;
    diagnostics.engineBinaryStatus = settings.engineBinaryPath ? `invalid configured path: ${message}` : "not configured";
    return diagnostics;
  }

  try {
    const binaryPath = findEngineBinary(settings.engineBinaryPath, context.extensionPath, identity.engine.binaryName);
    diagnostics.engineBinaryStatus = describeEngineBinaryStatus(binaryPath, settings.engineBinaryPath !== undefined);
  } catch (error) {
    diagnostics.engineBinaryStatus = error instanceof Error ? `not usable: ${redactRuntimeDiagnosticText(error.message, settings.sessionToken)}` : "not usable";
  }

  diagnostics.pingStatus = await pingEngineOnce(settings);
  return diagnostics;
}

export async function prepareEngineConnection(
  context: vscode.ExtensionContext,
  identity: ProductIdentity,
  output: vscode.OutputChannel,
): Promise<EngineConnection> {
  const settings = await readEngineConnectionSettings(context);
  validateEngineConnectionSettings(settings);
  const binaryPath = findEngineBinary(settings.engineBinaryPath, context.extensionPath, identity.engine.binaryName);
  const shouldLaunch = settings.launchMode === "launch" || (settings.launchMode === "auto" && binaryPath !== undefined);

  if (shouldLaunch) {
    if (!binaryPath) {
      throw new Error(`${configurationPrefix}.engineBinaryPath must point to ${identity.engine.binaryName} when launch mode is enabled.`);
    }
    const connection = await launchOrReuseEngine(settings.runtimeUrl, binaryPath, output);
    await checkEngineHealth(connection, output);
    return {
      runtimeUrl: connection.runtimeUrl,
      sessionToken: connection.sessionToken,
      guiDevUrl: settings.guiDevUrl,
    };
  }

  const connection = {
    runtimeUrl: settings.runtimeUrl,
    sessionToken: settings.sessionToken,
    guiDevUrl: settings.guiDevUrl,
  };
  if (settings.sessionTokenSource === "legacySetting") {
    output.appendLine(`Warning: ${configurationPrefix}.sessionToken is deprecated. Use the Yet AI command to store the local runtime session token in VS Code SecretStorage.`);
  }
  await checkEngineHealth(connection, output);
  return connection;
}

export async function setStoredSessionToken(context: vscode.ExtensionContext, value: string): Promise<boolean> {
  const token = value.trim();
  if (token.length === 0) {
    await clearStoredSessionToken(context);
    return false;
  }
  await context.secrets.store(sessionTokenSecretKey, token);
  return true;
}

export async function clearStoredSessionToken(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(sessionTokenSecretKey);
}

export function stopLaunchedEngine(output?: vscode.OutputChannel): void {
  if (!launchedEngine) {
    return;
  }
  output?.appendLine("Stopping Yet AI local runtime.");
  const engine = launchedEngine;
  launchedEngine = undefined;
  if (!engine.process.killed) {
    engine.process.kill();
  }
}

async function readEngineConnectionSettings(context: vscode.ExtensionContext): Promise<EngineConnectionSettings> {
  const config = vscode.workspace.getConfiguration(configurationPrefix);
  const runtimeUrl = config.get<string>("runtimeUrl", "http://127.0.0.1:8001").trim();
  const secretStorageToken = (await context.secrets.get(sessionTokenSecretKey))?.trim() ?? "";
  const legacySessionToken = config.get<string>("sessionToken", "").trim();
  const sessionToken = resolveSessionToken(secretStorageToken, legacySessionToken);
  const guiDevUrl = config.get<string>("guiDevUrl", "").trim();
  const engineBinaryPath = config.get<string>("engineBinaryPath", "").trim();
  const configuredLaunchMode = config.get<string>("launchMode", "auto").trim();
  return {
    runtimeUrl,
    sessionToken: sessionToken.value,
    sessionTokenSource: sessionToken.source,
    guiDevUrl: guiDevUrl.length > 0 ? guiDevUrl : undefined,
    engineBinaryPath: engineBinaryPath.length > 0 ? engineBinaryPath : undefined,
    launchMode: parseLaunchMode(configuredLaunchMode),
  };
}

export function resolveSessionToken(secretStorageToken: string, legacySettingToken: string): { value?: string; source: SessionTokenSource } {
  const secret = secretStorageToken.trim();
  if (secret.length > 0) {
    return { value: secret, source: "secretStorage" };
  }
  const legacy = legacySettingToken.trim();
  if (legacy.length > 0) {
    return { value: legacy, source: "legacySetting" };
  }
  return { source: "none" };
}

function parseLaunchMode(value: string): LaunchMode {
  if (value === "auto" || value === "connect" || value === "launch") {
    return value;
  }
  throw new Error(`${configurationPrefix}.launchMode must be auto, connect, or launch.`);
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
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw new Error(`${settingName} must not include user info.`);
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

function validateEngineConnectionSettings(settings: EngineConnectionSettings): void {
  validateEngineConnection(settings);
  if (settings.engineBinaryPath && !path.isAbsolute(settings.engineBinaryPath)) {
    throw new Error(`${configurationPrefix}.engineBinaryPath must be an absolute path.`);
  }
}

export function findEngineBinary(configuredPath: string | undefined, extensionPath: string, binaryName: string): string | undefined {
  if (configuredPath) {
    if (!isExecutableFile(configuredPath)) {
      throw new Error(`${configurationPrefix}.engineBinaryPath must point to an executable file.`);
    }
    return configuredPath;
  }

  const extensionCandidates = [
    path.join(extensionPath, "bin", binaryName),
    path.join(extensionPath, "bin", `${binaryName}.exe`),
    path.resolve(extensionPath, "..", "..", "..", "target", "debug", binaryName),
    path.resolve(extensionPath, "..", "..", "..", "target", "release", binaryName),
  ];
  const extensionCandidate = extensionCandidates.find(isExecutableFile);
  if (extensionCandidate) {
    return extensionCandidate;
  }

  return findOnPath(binaryName);
}

function findOnPath(binaryName: string): string | undefined {
  const suffixes = os.platform() === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (directory.length === 0) {
      continue;
    }
    for (const suffix of suffixes) {
      const candidate = path.join(directory, `${binaryName}${suffix}`);
      if (isExecutableFile(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

function isExecutableFile(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      return false;
    }
    if (os.platform() !== "win32") {
      fs.accessSync(filePath, fs.constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

function describeEngineBinaryStatus(binaryPath: string | undefined, configured: boolean): string {
  if (!binaryPath) {
    return "not found";
  }
  const basename = path.basename(binaryPath);
  return configured ? `found configured binary: ${basename}` : `found discovered binary: ${basename}`;
}

async function launchOrReuseEngine(runtimeUrl: string, binaryPath: string, output: vscode.OutputChannel): Promise<EngineConnection> {
  const existing = launchedEngine;
  if (existing && existing.runtimeUrl === runtimeUrl && !existing.process.killed) {
    return {
      runtimeUrl: existing.runtimeUrl,
      sessionToken: existing.sessionToken,
    };
  }
  stopLaunchedEngine(output);

  const token = crypto.randomBytes(32).toString("base64url");
  const port = parseRuntimePort(runtimeUrl);
  const child = childProcess.spawn(binaryPath, [], {
    env: {
      ...process.env,
      YET_AI_AUTH_TOKEN: token,
      YET_AI_HTTP_PORT: port.toString(),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  const engine: LaunchedEngine = {
    process: child,
    runtimeUrl,
    sessionToken: token,
  };
  launchedEngine = engine;
  output.appendLine(`Started Yet AI local runtime from ${binaryPath}.`);
  attachProcessLogs(child, token, output);
  child.on("exit", (code, signal) => {
    output.appendLine(`Yet AI local runtime exited with code ${code ?? "null"} and signal ${signal ?? "null"}.`);
    if (launchedEngine?.process === child) {
      launchedEngine = undefined;
    }
  });
  child.on("error", (error) => {
    output.appendLine(`Yet AI local runtime process error: ${error.message}`);
  });
  return {
    runtimeUrl,
    sessionToken: token,
  };
}

function parseRuntimePort(runtimeUrl: string): number {
  const parsed = new URL(runtimeUrl);
  if (parsed.port.length > 0) {
    return Number.parseInt(parsed.port, 10);
  }
  return parsed.protocol === "https:" ? 443 : 80;
}

function attachProcessLogs(processHandle: childProcess.ChildProcess, token: string, output: vscode.OutputChannel): void {
  processHandle.stdout?.on("data", (chunk: Buffer) => appendEngineLog(output, token, chunk));
  processHandle.stderr?.on("data", (chunk: Buffer) => appendEngineLog(output, token, chunk));
}

function appendEngineLog(output: vscode.OutputChannel, token: string, chunk: Buffer): void {
  const text = redactLogText(chunk.toString("utf8"), token);
  for (const line of text.split(/\r?\n/)) {
    if (line.length > 0) {
      output.appendLine(`[engine] ${line}`);
    }
  }
}

function redactLogText(value: string, token: string): string {
  return redactRuntimeDiagnosticText(value, token);
}

export function redactRuntimeDiagnosticText(value: string, token?: string): string {
  let redacted = value.replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]");
  redacted = redacted.replace(/\b(?:sk|sess|token)-[A-Za-z0-9_-]{8,}\b/g, "[redacted]");
  redacted = redacted.replace(/\b[A-Za-z0-9_-]{24,}\b/g, "[redacted]");
  if (token && token.length > 0) {
    redacted = redacted.replaceAll(token, "[redacted]");
  }
  return redacted;
}

export function safeRuntimeUrl(runtimeUrl: string): string {
  try {
    const parsed = new URL(runtimeUrl);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost" && parsed.hostname !== "[::1]")
    ) {
      return "invalid or non-loopback runtime URL";
    }
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "invalid runtime URL";
  }
}

async function pingEngineOnce(connection: EngineConnection): Promise<string> {
  const pingUrl = new URL("/v1/ping", connection.runtimeUrl).toString();
  const headers: Record<string, string> = {};
  if (connection.sessionToken) {
    headers.Authorization = `Bearer ${connection.sessionToken}`;
  }

  try {
    const response = await fetch(pingUrl, { headers });
    return response.ok ? "passed" : `failed: HTTP ${response.status}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown ping error";
    return `failed: ${redactRuntimeDiagnosticText(message, connection.sessionToken)}`;
  }
}

async function checkEngineHealth(connection: EngineConnection, output: vscode.OutputChannel): Promise<void> {
  let lastError: string | undefined;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const pingStatus = await pingEngineOnce(connection);
    if (pingStatus === "passed") {
      output.appendLine("Yet AI local runtime health check passed.");
      return;
    }
    lastError = pingStatus.replace(/^failed: /, "");
    await delay(250);
  }
  throw new Error(`Yet AI local runtime health check failed at /v1/ping: ${lastError ?? "no response"}.`);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
