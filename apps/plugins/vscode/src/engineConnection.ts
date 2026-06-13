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
  sessionTokenSource: SessionTokenSource;
  hostReadyRuntimeDelivery: string;
  engineBinaryStatus: string;
  pluginLaunchedProcessStatus: string;
  pingStatus: string;
  packagedGuiStatus: string;
  guidance: string;
};

type LaunchMode = "auto" | "connect" | "launch";

export type EngineConnectionSettings = EngineConnection & {
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

type EngineLogOutput = {
  appendLine(value: string): void;
};

export type EngineLogRedactor = {
  append(chunk: Buffer | string): void;
  flush(): void;
};

let launchedEngine: LaunchedEngine | undefined;

const engineLogLineLimit = 8192;
const oversizedEngineLogLineMarker = "[redacted oversized engine log line]";

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
    sessionTokenSource: settings.sessionTokenSource,
    hostReadyRuntimeDelivery: hostReadyRuntimeDeliveryStatus({ ...settings, willLaunch: false }),
    engineBinaryStatus: "not checked",
    pluginLaunchedProcessStatus: launchedEngine && !launchedEngine.process.killed ? "running" : "not running",
    pingStatus: "not checked",
    packagedGuiStatus: describePackagedGuiStatus(context.extensionPath),
    guidance: runtimeDiagnosticsGuidance(settings.launchMode),
  };

  try {
    validateEngineConnectionSettings(settings);
  } catch (error) {
    const message = error instanceof Error ? redactRuntimeDiagnosticText(error.message, settings.sessionToken) : "invalid runtime settings";
    diagnostics.pingStatus = `skipped: ${message}`;
    diagnostics.engineBinaryStatus = settings.launchMode === "connect" ? "not checked in connect mode" : "not checked: runtime settings invalid";
    return diagnostics;
  }

  let binaryPath: string | undefined;
  if (settings.launchMode === "connect") {
    diagnostics.engineBinaryStatus = "not checked in connect mode";
  } else {
    try {
      binaryPath = findEngineBinary(settings.engineBinaryPath, context.extensionPath, identity.engine.binaryName);
      diagnostics.engineBinaryStatus = settings.launchMode === "auto" && binaryPath === undefined
        ? "not found; connect-only fallback"
        : describeEngineBinaryStatus(binaryPath, settings.engineBinaryPath !== undefined);
    } catch (error) {
      diagnostics.engineBinaryStatus = error instanceof Error ? `not usable: ${redactRuntimeDiagnosticText(error.message, settings.sessionToken)}` : "not usable";
      if (settings.launchMode === "launch" || (settings.launchMode === "auto" && settings.engineBinaryPath !== undefined)) {
        diagnostics.pingStatus = "skipped: engine binary not usable";
        return diagnostics;
      }
    }
  }

  if (settings.launchMode === "launch" && binaryPath === undefined) {
    diagnostics.hostReadyRuntimeDelivery = hostReadyRuntimeDeliveryStatus({ ...settings, willLaunch: false });
    diagnostics.pingStatus = "skipped: engine binary not usable";
    return diagnostics;
  }

  const shouldLaunch = settings.launchMode === "launch" || (settings.launchMode === "auto" && binaryPath !== undefined);
  diagnostics.hostReadyRuntimeDelivery = hostReadyRuntimeDeliveryStatus({ ...settings, willLaunch: shouldLaunch });
  try {
    validateRuntimeLaunchProtocol(settings.runtimeUrl, settings.launchMode, shouldLaunch);
  } catch (error) {
    const message = error instanceof Error ? redactRuntimeDiagnosticText(error.message, settings.sessionToken) : "invalid runtime launch policy";
    diagnostics.pingStatus = `skipped: ${message}`;
    return diagnostics;
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
  const binaryPath = settings.launchMode === "connect" ? undefined : findEngineBinary(settings.engineBinaryPath, context.extensionPath, identity.engine.binaryName);
  const shouldLaunch = settings.launchMode === "launch" || (settings.launchMode === "auto" && binaryPath !== undefined);

  if (shouldLaunch) {
    output.appendLine(`Preparing Yet AI local runtime in ${settings.launchMode} mode (launching IDE-managed runtime).`);
    validateRuntimeLaunchProtocol(settings.runtimeUrl, settings.launchMode, shouldLaunch);
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

  output.appendLine(`Preparing Yet AI local runtime in ${settings.launchMode} mode (connecting to existing loopback runtime).`);
  const connection = {
    runtimeUrl: settings.runtimeUrl,
    sessionToken: settings.sessionToken,
    guiDevUrl: settings.guiDevUrl,
  };
  if (connection.sessionToken !== undefined && !isBridgeSafeSessionToken(connection.sessionToken)) {
    throw new Error(`${configurationPrefix}.sessionToken must be a local runtime session token that is safe for the host.ready bridge schema.`);
  }
  if (settings.sessionTokenSource === "legacySetting") {
    output.appendLine(`Warning: ${configurationPrefix}.sessionToken is deprecated. Use the Yet AI command to store the local runtime session token in VS Code SecretStorage.`);
  } else if (settings.sessionTokenSource === "none") {
    output.appendLine("No stored local runtime session token configured; host.ready will deliver only the loopback runtime URL. If the runtime requires auth, use the Yet AI runtime status command instead of copying raw tokens into chat.");
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
  if (parsed.search.length > 0 || parsed.hash.length > 0) {
    throw new Error(`${settingName} must not include query parameters or fragments.`);
  }
  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost" && parsed.hostname !== "[::1]") {
    throw new Error(`${settingName} must point to a loopback host.`);
  }
  return vscode.Uri.parse(parsed.href, true);
}

export function validateRuntimeUrl(value: string, settingName: string): vscode.Uri {
  const uri = validateLoopbackUrl(value, settingName);
  const port = explicitRawPort(value);
  if (port === undefined || port <= 0 || port > 65535) {
    throw new Error(`${settingName} must include an explicit valid port such as http://127.0.0.1:8001.`);
  }
  if (!hasRootUrlPath(value)) {
    throw new Error(`${settingName} must not include a path.`);
  }
  return uri;
}

function explicitRawPort(value: string): number | undefined {
  const authority = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\/([^/?#]*)/.exec(value)?.[1] ?? "";
  const portText = authority.startsWith("[") ? /^\[[^\]]+\]:(\d+)$/.exec(authority)?.[1] : /:(\d+)$/.exec(authority)?.[1];
  if (!portText) {
    return undefined;
  }
  return Number.parseInt(portText, 10);
}

export function getLoopbackOrigin(value: string, settingName: string): string {
  validateLoopbackUrl(value, settingName);
  return new URL(value).origin;
}

export function validateEngineConnection(connection: EngineConnection): void {
  validateRuntimeUrl(connection.runtimeUrl, `${configurationPrefix}.runtimeUrl`);
  if (connection.guiDevUrl) {
    validateLoopbackUrl(connection.guiDevUrl, `${configurationPrefix}.guiDevUrl`);
  }
}

function hasRootUrlPath(value: string): boolean {
  const parsed = new URL(value);
  return parsed.pathname === "/" && hasRootRawUrlPath(value);
}

function hasRootRawUrlPath(value: string): boolean {
  const rawPath = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\/[^/?#]*([^?#]*)/.exec(value)?.[1];
  return rawPath === "" || rawPath === "/";
}

export function validateEngineConnectionSettings(settings: EngineConnectionSettings): void {
  validateEngineConnection(settings);
  if (settings.launchMode !== "connect" && settings.engineBinaryPath && !path.isAbsolute(settings.engineBinaryPath)) {
    throw new Error(`${configurationPrefix}.engineBinaryPath must be an absolute path.`);
  }
}

export function isBridgeSafeSessionToken(value: string): boolean {
  return value.length >= 1 && value.length <= 512 && /^(?!.*(?:[Bb][Ee][Aa][Rr][Ee][Rr]|[Aa][Pp][Ii][_-]?[Kk][Ee][Yy]|[Ss][Ee][Cc][Rr][Ee][Tt]|[Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd]|[Ss][Kk]-(?:[Pp][Rr][Oo][Jj]-)?[A-Za-z0-9_-]{8,}))[A-Za-z0-9._~+/=-]+$/.test(value);
}

export function validateRuntimeLaunchProtocol(runtimeUrl: string, launchMode: LaunchMode, willLaunch: boolean): void {
  if (!willLaunch) {
    return;
  }
  const parsed = new URL(runtimeUrl);
  if (parsed.protocol !== "http:") {
    throw new Error(
      `${configurationPrefix}.runtimeUrl must use http when ${configurationPrefix}.launchMode ${launchMode} starts the local engine. Use connect mode for an externally managed loopback HTTPS runtime.`,
    );
  }
  if (parsed.port.length === 0 || Number.parseInt(parsed.port, 10) <= 0) {
    throw new Error(
      `${configurationPrefix}.runtimeUrl must include an explicit nonzero port such as http://127.0.0.1:8001 when ${configurationPrefix}.launchMode ${launchMode} starts the local engine.`,
    );
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
  const fileName = path.basename(binaryPath);
  return configured ? `found configured binary: ${fileName}` : `found discovered binary: ${fileName}`;
}

export function runtimeDiagnosticsGuidance(launchMode: LaunchMode): string {
  if (launchMode === "connect") {
    return "Connect mode expects an already running loopback Yet AI runtime. Verify the URL, port, and local runtime session token match the external process.";
  }
  if (launchMode === "launch") {
    return "Launch mode requires an executable engine binary and a loopback http runtime URL with an explicit nonzero port.";
  }
  return "Auto mode launches a configured or discovered engine binary when available; otherwise it falls back to connect-only mode and pings the configured loopback runtime.";
}

export function hostReadyRuntimeDeliveryStatus(settings: Pick<EngineConnectionSettings, "sessionTokenSource"> & { willLaunch: boolean }): string {
  const source = settings.willLaunch
    ? "IDE-launched ephemeral runtime token"
    : settings.sessionTokenSource === "none"
      ? "runtime URL only; no token configured"
      : settings.sessionTokenSource === "secretStorage"
        ? "runtime URL plus SecretStorage token"
        : "runtime URL plus deprecated legacy setting token";
  return `${source}; delivered to the webview by trusted host.ready and not printed in diagnostics.`;
}

function describePackagedGuiStatus(extensionPath: string): string {
  const indexPath = path.join(extensionPath, "media", "gui", "index.html");
  const packagePath = path.join(extensionPath, "package.json");
  const extensionSourcesPath = path.join(extensionPath, "src");
  try {
    const indexStat = fs.statSync(indexPath);
    if (!indexStat.isFile()) {
      return "missing; packaged GUI index.html is not a file. Run npm run prepare:vscode-preview, or cd apps/plugins/vscode && npm run prepare:preview after building apps/gui.";
    }
    const staleReason = packagedGuiStaleReason(indexStat.mtimeMs, packagePath, extensionSourcesPath);
    if (staleReason) {
      return `${staleReason}. Run npm run prepare:vscode-preview to refresh generated packaged GUI artifacts.`;
    }
    return "present; packaged GUI index.html is available.";
  } catch (error) {
    if (isMissingFileError(error)) {
      return "missing; run npm run prepare:vscode-preview from the repository root to copy packaged GUI assets before install-from-file or Extension Development Host testing.";
    }
    return `not checked: ${redactRuntimeDiagnosticText(error instanceof Error ? error.message : "could not inspect packaged GUI")}`;
  }
}

function packagedGuiStaleReason(indexMtimeMs: number, packagePath: string, extensionSourcesPath: string): string | undefined {
  const packageMtimeMs = fileMtimeMs(packagePath);
  if (packageMtimeMs !== undefined && packageMtimeMs > indexMtimeMs) {
    return "possibly stale; package metadata is newer than media/gui/index.html";
  }
  const newestSourceMtimeMs = newestFileMtimeMs(extensionSourcesPath);
  if (newestSourceMtimeMs !== undefined && newestSourceMtimeMs > indexMtimeMs) {
    return "possibly stale; VS Code extension sources are newer than media/gui/index.html";
  }
  return undefined;
}

function fileMtimeMs(filePath: string): number | undefined {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() ? stat.mtimeMs : undefined;
  } catch {
    return undefined;
  }
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

function newestFileMtimeMs(directoryPath: string): number | undefined {
  let newest: number | undefined;
  try {
    for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
      const entryPath = path.join(directoryPath, entry.name);
      const entryNewest = entry.isDirectory() ? newestFileMtimeMs(entryPath) : fileMtimeMs(entryPath);
      if (entryNewest !== undefined && (newest === undefined || entryNewest > newest)) {
        newest = entryNewest;
      }
    }
  } catch {
    return newest;
  }
  return newest;
}

export function formatRuntimeDiagnostics(diagnostics: RuntimeDiagnostics): string {
  return [
    "Yet AI Runtime Status",
    `Launch mode: ${diagnostics.launchMode}`,
    `Runtime URL: ${diagnostics.runtimeUrl}`,
    `Runtime credential source: ${diagnostics.sessionTokenSource}`,
    `host.ready delivery: ${redactRuntimeDiagnosticText(diagnostics.hostReadyRuntimeDelivery)}`,
    `Engine binary path configured: ${diagnostics.configuredEngineBinaryPath ? "yes" : "no"}`,
    `Binary status: ${redactRuntimeDiagnosticText(diagnostics.engineBinaryStatus)}`,
    `Plugin-launched process: ${redactRuntimeDiagnosticText(diagnostics.pluginLaunchedProcessStatus)}`,
    `Packaged GUI: ${redactRuntimeDiagnosticText(diagnostics.packagedGuiStatus)}`,
    `Last/ping health: ${redactRuntimeDiagnosticText(diagnostics.pingStatus)}`,
    `Guidance: ${redactRuntimeDiagnosticText(diagnostics.guidance)}`,
  ].join("\n");
}

export function formatStartedRuntimeMessage(binaryPath: string): string {
  return `Started Yet AI local runtime from ${path.basename(binaryPath)}.`;
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

  const token = crypto.randomBytes(32).toString("hex");
  const port = parseRuntimePort(runtimeUrl);
  let child: childProcess.ChildProcess;
  try {
    child = childProcess.spawn(binaryPath, [], {
      env: createEngineLaunchEnvironment(process.env, token, port.toString()),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (error) {
    const message = error instanceof Error ? redactRuntimeDiagnosticText(error.message, token) : "spawn failed";
    throw new Error(`Could not start Yet AI local runtime from ${path.basename(binaryPath)}: ${message}`);
  }

  const engine: LaunchedEngine = {
    process: child,
    runtimeUrl,
    sessionToken: token,
  };
  launchedEngine = engine;
  output.appendLine(formatStartedRuntimeMessage(binaryPath));
  attachProcessLogs(child, token, output);
  child.on("exit", (code, signal) => {
    output.appendLine(`Yet AI local runtime exited with code ${code ?? "null"} and signal ${signal ?? "null"}.`);
    if (launchedEngine?.process === child) {
      launchedEngine = undefined;
    }
  });
  child.on("error", (error) => {
    output.appendLine(`Yet AI local runtime process error from ${path.basename(binaryPath)}: ${redactRuntimeDiagnosticText(error.message, token)}`);
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
  const stdoutRedactor = createEngineLogRedactor(token, output);
  const stderrRedactor = createEngineLogRedactor(token, output);
  processHandle.stdout?.on("data", (chunk: Buffer) => stdoutRedactor.append(chunk));
  processHandle.stderr?.on("data", (chunk: Buffer) => stderrRedactor.append(chunk));
  processHandle.stdout?.on("end", () => stdoutRedactor.flush());
  processHandle.stderr?.on("end", () => stderrRedactor.flush());
  processHandle.stdout?.on("close", () => stdoutRedactor.flush());
  processHandle.stderr?.on("close", () => stderrRedactor.flush());
  processHandle.on("exit", () => {
    stdoutRedactor.flush();
    stderrRedactor.flush();
  });
  processHandle.on("error", () => {
    stdoutRedactor.flush();
    stderrRedactor.flush();
  });
}

export function createEngineLogRedactor(token: string, output: EngineLogOutput, maxLineLength = engineLogLineLimit): EngineLogRedactor {
  let bufferedLine = "";
  let oversizedLine = false;

  function append(chunk: Buffer | string): void {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    let offset = 0;
    while (offset < text.length) {
      const newlineIndex = text.indexOf("\n", offset);
      if (newlineIndex === -1) {
        appendLinePart(text.slice(offset));
        return;
      }
      const linePart = text.slice(offset, newlineIndex).replace(/\r$/, "");
      appendLinePart(linePart);
      flushCompleteLine();
      offset = newlineIndex + 1;
    }
  }

  function appendLinePart(value: string): void {
    if (oversizedLine) {
      return;
    }
    if (bufferedLine.length + value.length > maxLineLength) {
      bufferedLine = "";
      oversizedLine = true;
      return;
    }
    bufferedLine += value;
  }

  function flushCompleteLine(): void {
    if (oversizedLine) {
      output.appendLine(`[engine] ${oversizedEngineLogLineMarker}`);
    } else if (bufferedLine.length > 0) {
      output.appendLine(`[engine] ${redactLogText(bufferedLine, token)}`);
    }
    bufferedLine = "";
    oversizedLine = false;
  }

  function flush(): void {
    if (bufferedLine.length > 0 || oversizedLine) {
      flushCompleteLine();
    }
  }

  return { append, flush };
}

function redactLogText(value: string, token: string): string {
  return redactRuntimeDiagnosticText(value, token);
}

export function redactRuntimeDiagnosticText(value: string, token?: string): string {
  let redacted = value;
  if (token && token.length > 0) {
    redacted = redacted.replaceAll(token, "[redacted]");
  }
  redacted = runtimeRedactionPatterns.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), redacted);
  return redacted;
}

const secretDiagnosticKeyPattern = String.raw`(?:access[_-]?token|refresh[_-]?token|session[_-]?token|session|auth[_-]?token|api[_-]?key|apikey|client[_-]?secret|authorization|proxy[_-]?authorization|bearer|cookie|set[_-]?cookie|setCookie|secret|token|oauth[_-]?code|code[_-]?verifier|pkce[_-]?verifier|github[_-]?token|oauth[_-]?refresh[_-]?token|provider[_-]?client[_-]?secret|openai[_-]?api[_-]?key|anthropic[_-]?api[_-]?key|yet[_-]?ai[_-]?auth[_-]?token)`;

const privatePathPattern = String.raw`(?:[A-Za-z]:\\[^\r\n,;)}\]\s]+(?:\\[^\r\n,;)}\]\s]+)+|/(?:Users|home|var/folders|tmp|private|Volumes)/[^\r\n,;)}\]\s]+(?:/[^\r\n,;)}\]\s]+)*)`;

const runtimeRedactionPatterns: Array<[RegExp, string]> = [
  [/\b(?:Authorization|Proxy-Authorization|Cookie|Set-Cookie)\s*:\s*[^\r\n]*/gi, "[redacted]"],
  [new RegExp(String.raw`\b(?:cookie|set[_-]?cookie|setCookie)\b\s*[:=]\s*[^\r\n]*`, "gi"), "[redacted]"],
  [new RegExp(String.raw`\b(?:authorization|proxy[_-]?authorization)\b\s*[:=]\s*(?:[A-Za-z][A-Za-z0-9._~-]*\s+)?[^\s,;)}\]]+`, "gi"), "[redacted]"],
  [new RegExp(String.raw`([?&;#])${secretDiagnosticKeyPattern}\s*=\s*[^\s&#;]+`, "gi"), "$1[redacted]"],
  [new RegExp(String.raw`(["'])${secretDiagnosticKeyPattern}\1\s*:\s*(["'])(?:\\.|(?!\2).)*\2`, "gi"), "[redacted]"],
  [new RegExp(String.raw`(["'])${secretDiagnosticKeyPattern}\1\s*:\s*(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)\b`, "gi"), "[redacted]"],
  [new RegExp(String.raw`\b${secretDiagnosticKeyPattern}\b\s*[:=]\s*[^\s,;)}\]]+`, "gi"), "[redacted]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{4,}/gi, "[redacted]"],
  [/\blocal-dev-token\b/g, "[redacted]"],
  [/\b(?:sk|sess|token)-[A-Za-z0-9_-]{8,}\b/g, "[redacted]"],
  [/\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g, "[redacted]"],
  [/\b[A-Za-z0-9+/=_-]{24,}\b/g, "[redacted]"],
  [new RegExp(privatePathPattern, "g"), "[redacted path]"],
];

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
    if (!hasRootUrlPath(runtimeUrl)) {
      parsed.pathname = "/";
      return parsed.toString();
    }
    return parsed.toString();
  } catch {
    return "invalid runtime URL";
  }
}

export function createEngineLaunchEnvironment(source: NodeJS.ProcessEnv, authToken: string, httpPort: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || !isAllowedEngineLaunchEnvironmentName(key) || (isSecretLikeEnvironmentName(key) && !isSafeSecretNamedEngineLaunchEnvironmentName(key))) {
      continue;
    }
    env[key] = value;
  }
  env.YET_AI_AUTH_TOKEN = authToken;
  env.YET_AI_HTTP_PORT = httpPort;
  return env;
}

function isSecretLikeEnvironmentName(key: string): boolean {
  const normalized = key.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  return /(?:token|apikey|keyid|authorization|bearer|cookie|secret|provider|openai|anthropic|github|aws|azure|google|gcp|gemini|vertex|credential|password|passwd|oauth|jwt|session)/.test(normalized);
}

function isAllowedEngineLaunchEnvironmentName(key: string): boolean {
  return engineLaunchEnvironmentAllowlist.has(key) || /^LC_(?:ALL|COLLATE|CTYPE|MESSAGES|MONETARY|NUMERIC|TIME|ADDRESS|IDENTIFICATION|MEASUREMENT|NAME|PAPER|TELEPHONE)$/.test(key);
}

function isSafeSecretNamedEngineLaunchEnvironmentName(key: string): boolean {
  return safeSecretNamedEngineLaunchEnvironmentAllowlist.has(key);
}

const engineLaunchEnvironmentAllowlist = new Set([
  "PATH",
  "Path",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "SystemRoot",
  "WINDIR",
  "ComSpec",
  "PATHEXT",
  "TMP",
  "TEMP",
  "DBUS_SESSION_BUS_ADDRESS",
  "XDG_RUNTIME_DIR",
  "TMPDIR",
  "LANG",
]);

const safeSecretNamedEngineLaunchEnvironmentAllowlist = new Set([
  "DBUS_SESSION_BUS_ADDRESS",
  "XDG_RUNTIME_DIR",
]);

const runtimePingTimeoutMs = 1500;

export async function pingEngineOnce(connection: EngineConnection, timeoutMs = runtimePingTimeoutMs): Promise<string> {
  const pingUrl = new URL("/v1/ping", connection.runtimeUrl).toString();
  const headers: Record<string, string> = {};
  if (connection.sessionToken) {
    headers.Authorization = `Bearer ${connection.sessionToken}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(pingUrl, { headers, signal: controller.signal });
    if (response.ok) {
      return "passed";
    }
    if (response.status === 401) {
      return "failed: HTTP 401 unauthorized local runtime session token mismatch. In auto/launch mode reopen the chat to let the IDE refresh the runtime token; in connect mode update the SecretStorage token to match the running engine.";
    }
    return `failed: HTTP ${response.status}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown ping error";
    return `failed: ${redactRuntimeDiagnosticText(message, connection.sessionToken)}`;
  } finally {
    clearTimeout(timeout);
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
