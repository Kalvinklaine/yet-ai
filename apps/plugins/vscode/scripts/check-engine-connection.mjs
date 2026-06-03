import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Module from "node:module";

let configValues = {};
const registeredCommands = new Map();
const errorMessages = [];
const informationMessages = [];
const outputLines = [];
const registeredCompletionProviders = [];
const registeredHoverProviders = [];
const registeredDocumentSymbolProviders = [];
let workspaceTextDocuments = [];
const workspaceOpenDocumentListeners = [];
const workspaceChangeDocumentListeners = [];
const workspaceCloseDocumentListeners = [];
const workspaceConfigurationListeners = [];
const originalFetch = globalThis.fetch;
const originalLoad = Module._load;
const originalSpawn = childProcess.spawn;
Module._load = function load(request, parent, isMain) {
  if (request === "vscode") {
    return {
      Uri: {
        parse(value) {
          return { href: value, fsPath: value, path: value, scheme: "file", toString: () => value };
        },
        joinPath(base, ...segments) {
          const basePath = base.fsPath ?? base.path ?? String(base);
          const fsPath = path.join(basePath, ...segments);
          return { fsPath, path: fsPath, scheme: "file", toString: () => fsPath };
        },
      },
      ViewColumn: { Beside: 2 },
      CompletionItemKind: { Text: 1 },
      SymbolKind: { Function: 11, Class: 4, Property: 6, Struct: 22 },
      CompletionItem: class CompletionItem {
        constructor(label, kind) {
          this.label = label;
          this.kind = kind;
        }
      },
      Position: class Position {
        constructor(line, character) {
          this.line = line;
          this.character = character;
        }
      },
      Range: class Range {
        constructor(start, end) {
          this.start = start;
          this.end = end;
        }
      },
      Hover: class Hover {
        constructor(contents) {
          this.contents = contents;
        }
      },
      DocumentSymbol: class DocumentSymbol {
        constructor(name, detail, kind, range, selectionRange) {
          this.name = name;
          this.detail = detail;
          this.kind = kind;
          this.range = range;
          this.selectionRange = selectionRange;
        }
      },
      CompletionList: class CompletionList {
        constructor(items, isIncomplete) {
          this.items = items;
          this.isIncomplete = isIncomplete;
        }
      },
      languages: {
        registerHoverProvider(selector, provider) {
          const registration = { selector, provider, disposed: false };
          registeredHoverProviders.push(registration);
          return { dispose() { registration.disposed = true; } };
        },
        registerDocumentSymbolProvider(selector, provider) {
          const registration = { selector, provider, disposed: false };
          registeredDocumentSymbolProviders.push(registration);
          return { dispose() { registration.disposed = true; } };
        },
        registerCompletionItemProvider(selector, provider) {
          const registration = { selector, provider, disposed: false };
          registeredCompletionProviders.push(registration);
          return { dispose() { registration.disposed = true; } };
        },
      },
      commands: {
        registerCommand(command, callback) {
          registeredCommands.set(command, callback);
          return { dispose() {} };
        },
      },
      window: {
        activeTextEditor: undefined,
        createOutputChannel() {
          return {
            appendLine(line) { outputLines.push(line); },
            show() {},
            dispose() {},
          };
        },
        createWebviewPanel() {
          return {
            webview: {
              cspSource: "vscode-resource:",
              html: "",
              asWebviewUri(uri) { return uri; },
              onDidReceiveMessage() { return { dispose() {} }; },
              postMessage() { return Promise.resolve(true); },
            },
          };
        },
        showErrorMessage(message) {
          errorMessages.push(message);
          return Promise.resolve(undefined);
        },
        showInformationMessage(message) {
          informationMessages.push(message);
          return Promise.resolve(undefined);
        },
        showInputBox() {
          return Promise.resolve(undefined);
        },
      },
      workspace: {
        get textDocuments() { return workspaceTextDocuments; },
        getConfiguration() {
          return {
            get(key, defaultValue) {
              return Object.hasOwn(configValues, key) ? configValues[key] : defaultValue;
            },
          };
        },
        getWorkspaceFolder() { return undefined; },
        asRelativePath(uri) { return uri.fsPath ?? uri.path ?? String(uri); },
        onDidOpenTextDocument(callback) {
          workspaceOpenDocumentListeners.push(callback);
          return { dispose() {} };
        },
        onDidChangeTextDocument(callback) {
          workspaceChangeDocumentListeners.push(callback);
          return { dispose() {} };
        },
        onDidCloseTextDocument(callback) {
          workspaceCloseDocumentListeners.push(callback);
          return { dispose() {} };
        },
        onDidChangeConfiguration(callback) {
          workspaceConfigurationListeners.push(callback);
          return { dispose() {} };
        },
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

try {
  const extensionModule = await import("../out/extension.js");

  const packageManifest = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8"));
  assert.equal(packageManifest.contributes.configuration.properties["yetai.lsp.enabled"].default, false);
  assert.ok(packageManifest.activationEvents.includes("onStartupFinished"), "manifest lacks a non-chat activation path for opt-in LSP startup");

  const {
    createLspProcessEnvironment,
    sanitizeLspDiagnostic,
    startYetAiLspClient,
    stopYetAiLspClient,
  } = await import("../out/lspClient.js");

  const {
    collectRuntimeDiagnostics,
    createEngineLogRedactor,
    findEngineBinary,
    prepareEngineConnection,
    formatRuntimeDiagnostics,
    formatStartedRuntimeMessage,
    pingEngineOnce,
    redactRuntimeDiagnosticText,
    resolveSessionToken,
    safeRuntimeUrl,
    setStoredSessionToken,
    validateEngineConnectionSettings,
    validateLoopbackUrl,
    validateRuntimeLaunchProtocol,
    validateRuntimeUrl,
  } = await import("../out/engineConnection.js");

  assert.deepEqual(resolveSessionToken(" secret-token ", " legacy-token "), {
    value: "secret-token",
    source: "secretStorage",
  });
  assert.deepEqual(resolveSessionToken("   ", " legacy-token "), {
    value: "legacy-token",
    source: "legacySetting",
  });
  assert.deepEqual(resolveSessionToken("", "  "), { source: "none" });

  assert.doesNotThrow(() => validateLoopbackUrl("https://127.0.0.1:5173", "yetai.guiDevUrl"));
  assert.doesNotThrow(() => validateRuntimeUrl("http://127.0.0.1:8001", "yetai.runtimeUrl"));
  assert.doesNotThrow(() => validateRuntimeUrl("http://127.0.0.1:8001/", "yetai.runtimeUrl"));
  assert.doesNotThrow(() => validateLoopbackUrl("https://127.0.0.1:5173/gui", "yetai.guiDevUrl"));
  for (const runtimeUrl of [
    "http://127.0.0.1:8001/foo",
    "http://127.0.0.1:8001/foo/..",
    "http://127.0.0.1:8001/foo/%2e%2e",
    "http://127.0.0.1:8001/%2e",
    "http://127.0.0.1:8001/%2e%2e",
    "http://127.0.0.1:8001/a/b/../..",
    "http://127.0.0.1:8001/foo/../bar",
    "http://127.0.0.1:8001/%2e%2e/foo",
  ]) {
    assert.throws(
      () => validateRuntimeUrl(runtimeUrl, "yetai.runtimeUrl"),
      /yetai\.runtimeUrl must not include a path\./,
    );
  }
  assert.throws(
    () => validateLoopbackUrl("http://127.0.0.1:8001/?token=fake-secret", "yetai.runtimeUrl"),
    /yetai\.runtimeUrl must not include query parameters or fragments\./,
  );
  assert.throws(
    () => validateLoopbackUrl("http://127.0.0.1:8001/#fake-secret", "yetai.runtimeUrl"),
    /yetai\.runtimeUrl must not include query parameters or fragments\./,
  );
  assert.throws(
    () => validateLoopbackUrl("https://localhost:5173/?token=fake-secret", "yetai.guiDevUrl"),
    /yetai\.guiDevUrl must not include query parameters or fragments\./,
  );
  assert.throws(
    () => validateLoopbackUrl("https://localhost:5173/#fake-secret", "yetai.guiDevUrl"),
    /yetai\.guiDevUrl must not include query parameters or fragments\./,
  );

  const connectHttpsSettings = {
    runtimeUrl: "https://127.0.0.1:8001",
    guiDevUrl: "https://127.0.0.1:5173",
    launchMode: "connect",
    sessionTokenSource: "secretStorage",
  };
  assert.doesNotThrow(() => validateEngineConnectionSettings(connectHttpsSettings));
  assert.doesNotThrow(() => validateRuntimeLaunchProtocol(connectHttpsSettings.runtimeUrl, "connect", false));
  assert.throws(
    () => validateRuntimeLaunchProtocol("https://127.0.0.1:8001", "launch", true),
    /yetai\.runtimeUrl must use http when yetai\.launchMode launch starts the local engine\./,
  );
  assert.throws(
    () => validateRuntimeLaunchProtocol("https://127.0.0.1:8001", "auto", true),
    /yetai\.runtimeUrl must use http when yetai\.launchMode auto starts the local engine\./,
  );
  assert.doesNotThrow(() => validateRuntimeLaunchProtocol("http://127.0.0.1:8001", "launch", true));
  assert.throws(
    () => validateRuntimeLaunchProtocol("http://127.0.0.1", "launch", true),
    /yetai\.runtimeUrl must include an explicit nonzero port such as http:\/\/127\.0\.0\.1:8001/,
  );
  assert.throws(
    () => validateRuntimeLaunchProtocol("http://127.0.0.1:0", "auto", true),
    /yetai\.runtimeUrl must include an explicit nonzero port such as http:\/\/127\.0\.0\.1:8001/,
  );
  assert.doesNotThrow(() => validateRuntimeLaunchProtocol("https://127.0.0.1:8001", "connect", false));

  const secretOperations = [];
  const fakeContext = {
    extensionPath: process.cwd(),
    secrets: {
      async get() {
        return undefined;
      },
      async store(key, value) {
        secretOperations.push({ type: "store", key, value });
      },
      async delete(key) {
        secretOperations.push({ type: "delete", key });
      },
    },
  };

  const commandPrivatePath = path.join(os.homedir(), "Library", "Application Support", "yet-ai", "command-error.json");
  const commandRuntimeToken = "token-command-runtime-sentinel";
  const commandBearerValue = "command-bearer-secret-sentinel";
  const commandProviderKey = "sk-command-provider-secret-sentinel";
  const commandQuerySecret = "command-query-secret-sentinel";
  const commandFragmentSecret = "command-fragment-secret-sentinel";
  const commandErrorText = `top command failed with local-dev-token ${commandRuntimeToken} Authorization: Bearer ${commandBearerValue} ${commandProviderKey} http://127.0.0.1:8001/ping?session_token=${commandQuerySecret}#access_token=${commandFragmentSecret} ${commandPrivatePath}`;
  const commandContext = {
    extensionPath: process.cwd(),
    extensionUri: { fsPath: process.cwd(), path: process.cwd(), scheme: "file", toString: () => process.cwd() },
    subscriptions: [],
    secrets: {
      async get() {
        throw new Error(commandErrorText);
      },
    },
  };
  extensionModule.activate(commandContext);
  assert.equal(typeof registeredCommands.get("yetaicmd.openChat"), "function");
  assert.equal(typeof registeredCommands.get("yetaicmd.showRuntimeStatus"), "function");
  await registeredCommands.get("yetaicmd.openChat")();
  await registeredCommands.get("yetaicmd.showRuntimeStatus")();
  const commandRenderedText = [...errorMessages, ...outputLines].join("\n");
  assert.match(commandRenderedText, /top command failed/);
  for (const forbidden of [
    "local-dev-token",
    commandRuntimeToken,
    commandBearerValue,
    commandProviderKey,
    commandQuerySecret,
    commandFragmentSecret,
    commandPrivatePath,
    os.homedir(),
  ]) {
    assert.equal(commandRenderedText.includes(forbidden), false, `top-level command error leaked ${forbidden}`);
  }
  assert.equal(errorMessages.length, 2);
  assert.equal(outputLines.length, 2);

  const longCommandSecret = "long-command-secret-sentinel";
  const longCommandErrorText = `long command failed Authorization: Bearer ${longCommandSecret}\n${"safe detail\n".repeat(300)}`;
  const longCommandContext = {
    extensionPath: process.cwd(),
    extensionUri: { fsPath: process.cwd(), path: process.cwd(), scheme: "file", toString: () => process.cwd() },
    subscriptions: [],
    secrets: {
      async get() {
        throw new Error(longCommandErrorText);
      },
    },
  };
  extensionModule.activate(longCommandContext);
  const longErrorStart = errorMessages.length;
  const longOutputStart = outputLines.length;
  await registeredCommands.get("yetaicmd.openChat")();
  const longCommandMessages = [...errorMessages.slice(longErrorStart), ...outputLines.slice(longOutputStart)];
  assert.equal(longCommandMessages.length, 2);
  for (const message of longCommandMessages) {
    assert.equal(message.includes(longCommandSecret), false, "long top-level command error leaked secret");
    assert.equal(message.length, 1000, "long top-level command error was not capped");
    assert.equal(message.endsWith("… [truncated sanitized command error]"), true, "long top-level command error was not marked truncated");
  }

  const nonErrorSecret = "non-error-command-secret-sentinel";
  const nonErrorContext = {
    extensionPath: process.cwd(),
    extensionUri: { fsPath: process.cwd(), path: process.cwd(), scheme: "file", toString: () => process.cwd() },
    subscriptions: [],
    secrets: {
      async get() {
        throw `non-error command failed Authorization: Bearer ${nonErrorSecret}`;
      },
    },
  };
  extensionModule.activate(nonErrorContext);
  const nonErrorStart = errorMessages.length;
  const nonErrorOutputStart = outputLines.length;
  await registeredCommands.get("yetaicmd.openChat")();
  const nonErrorMessages = [...errorMessages.slice(nonErrorStart), ...outputLines.slice(nonErrorOutputStart)];
  assert.equal(nonErrorMessages.length, 2);
  for (const message of nonErrorMessages) {
    assert.match(message, /non-error command failed/);
    assert.equal(message.includes(nonErrorSecret), false, "non-Error top-level command error leaked secret");
    assert.ok(message.length <= 1000, "non-Error top-level command error was not bounded");
  }
  await extensionModule.deactivate();

  assert.equal(await setStoredSessionToken(fakeContext, "  local-session-token  "), true);
  assert.deepEqual(secretOperations.at(-1), {
    type: "store",
    key: "yetai.localRuntimeSessionToken",
    value: "local-session-token",
  });
  assert.equal(await setStoredSessionToken(fakeContext, "   \t  "), false);
  assert.deepEqual(secretOperations.at(-1), {
    type: "delete",
    key: "yetai.localRuntimeSessionToken",
  });

  assert.equal(
    safeRuntimeUrl("http://user:pass@127.0.0.1:8001/path?token=fake-api-key#secret-fragment"),
    "http://127.0.0.1:8001/",
  );
  assert.equal(safeRuntimeUrl("http://127.0.0.1:8001/fake-path-secret/..?token=fake-api-key"), "http://127.0.0.1:8001/");
  assert.equal(safeRuntimeUrl("https://localhost:5173/?Authorization=Bearer fake"), "https://localhost:5173/");
  assert.equal(safeRuntimeUrl("https://example.com:8001/?token=fake"), "invalid or non-loopback runtime URL");
  assert.equal(safeRuntimeUrl("not a url"), "invalid runtime URL");

  const fakeSessionToken = "fake-session-token-diagnostics-sentinel";
  const fakeApiKey = "sk-diagnostics-provider-key-sentinel";
  const fakeBearer = "Bearer fake-bearer-session-sentinel";
  const fakeBasic = "Authorization: Basic ZmFrZS1iYXNpYy1zZWNyZXQ=";
  const fakeApiKeyHeader = "Authorization: ApiKey fake-header-api-key-sentinel";
  const fakeCookie = "Cookie: session=fake-cookie-session; refresh=fake-cookie-refresh";
  const fakeSetCookie = "Set-Cookie: sid=fake-set-cookie-session; refresh=fake-set-cookie-refresh";
  const fakeSetCookieValue = "setCookie=fake-camel-cookie-session; refresh=fake-camel-cookie-refresh";
  const fakeQueryApiKey = "fake-query-api-key-sentinel";
  const fakeQueryAccessToken = "fake-query-access-token-sentinel";
  const fakeQueryRefreshToken = "fake-query-refresh-token-sentinel";
  const fakeQueryToken = "fake-query-token-sentinel";
  const fakeQuerySession = "fake-query-session-sentinel";
  const fakeQuerySecret = "fake-query-secret-sentinel";
  const fakeOauthCode = "fake-oauth-code-sentinel";
  const fakeCodeVerifier = "fake-code-verifier-sentinel";
  const fakeFragmentAccessToken = "fake-fragment-access-token-sentinel";
  const fakeFragmentRefreshToken = "fake-fragment-refresh-token-sentinel";
  const fakeFragmentOauthCode = "fake-fragment-oauth-code-sentinel";
  const fakeFragmentCodeVerifier = "fake-fragment-code-verifier-sentinel";
  const fakeJsonApiKey = "fake-json-api-key-sentinel";
  const fakeJsonApiKeySnake = "fake-json-api-key-snake-sentinel";
  const fakeJsonAccessToken = "fake-json-access-token-sentinel";
  const fakeJsonRefreshToken = "fake-json-refresh-token-sentinel";
  const fakeJsonSessionToken = "fake-json-session-token-sentinel";
  const fakeJsonAuthorization = "Basic fake-json-authorization-sentinel";
  const fakeJsonCookie = "fake-json-cookie-sentinel";
  const fakeJsonSetCookie = "fake-json-set-cookie-sentinel";
  const fakeJsonClientSecret = "fake-json-client-secret-sentinel";
  const fakeLongOpaque = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const fakeJwt = "abcdefghijklmnop.abcdefghijklmnop.abcdefghijklmnop";
  const fakePrivatePath = path.join(os.homedir(), "Library", "Application Support", "yet-ai", "private", "progress.json");
  const diagnostic = redactRuntimeDiagnosticText(
    [
      `ping failed with ${fakeBearer} and ${fakeSessionToken} and ${fakeApiKey}`,
      fakeBasic,
      fakeApiKeyHeader,
      fakeCookie,
      fakeSetCookie,
      fakeSetCookieValue,
      `http://127.0.0.1:8001/v1/ping?api_key=${fakeQueryApiKey}&access_token=${fakeQueryAccessToken}&refresh_token=${fakeQueryRefreshToken}&token=${fakeQueryToken}&session=${fakeQuerySession}&secret=${fakeQuerySecret}&oauth_code=${fakeOauthCode}&code_verifier=${fakeCodeVerifier}`,
      `http://127.0.0.1:8001/callback#access_token=${fakeFragmentAccessToken}&refresh_token=${fakeFragmentRefreshToken}&oauth_code=${fakeFragmentOauthCode}&code_verifier=${fakeFragmentCodeVerifier}`,
      `{"apiKey":"${fakeJsonApiKey}","api_key":"${fakeJsonApiKeySnake}","access_token":"${fakeJsonAccessToken}","refresh_token":"${fakeJsonRefreshToken}","sessionToken":"${fakeJsonSessionToken}","authorization":"${fakeJsonAuthorization}","cookie":"${fakeJsonCookie}","setCookie":"${fakeJsonSetCookie}","client_secret":"${fakeJsonClientSecret}"}`,
      "local-dev-token",
      fakeLongOpaque,
      fakeJwt,
      `private path ${fakePrivatePath}`,
    ].join("\n"),
    fakeSessionToken,
  );
  const forbiddenValues = [
    fakeSessionToken,
    fakeApiKey,
    fakeBearer,
    "fake-bearer-session-sentinel",
    "ZmFrZS1iYXNpYy1zZWNyZXQ=",
    "fake-header-api-key-sentinel",
    "fake-cookie-session",
    "fake-cookie-refresh",
    "fake-set-cookie-session",
    "fake-set-cookie-refresh",
    "fake-camel-cookie-session",
    "fake-camel-cookie-refresh",
    fakeQueryApiKey,
    fakeQueryAccessToken,
    fakeQueryRefreshToken,
    fakeQueryToken,
    fakeQuerySession,
    fakeQuerySecret,
    fakeOauthCode,
    fakeCodeVerifier,
    fakeFragmentAccessToken,
    fakeFragmentRefreshToken,
    fakeFragmentOauthCode,
    fakeFragmentCodeVerifier,
    fakeJsonApiKey,
    fakeJsonApiKeySnake,
    fakeJsonAccessToken,
    fakeJsonRefreshToken,
    fakeJsonSessionToken,
    "fake-json-authorization-sentinel",
    fakeJsonCookie,
    fakeJsonSetCookie,
    fakeJsonClientSecret,
    "local-dev-token",
    fakeLongOpaque,
    fakeJwt,
    fakePrivatePath,
    os.homedir(),
  ];
  for (const forbidden of forbiddenValues) {
    assert.equal(diagnostic.includes(forbidden), false, `diagnostics leaked ${forbidden}`);
  }

  const formattedDiagnostics = formatRuntimeDiagnostics({
    runtimeUrl: "http://127.0.0.1:8001/",
    launchMode: "launch",
    configuredEngineBinaryPath: true,
    engineBinaryStatus: `configured binary failed at ${fakePrivatePath} with OPENAI_API_KEY=provider-secret`,
    pluginLaunchedProcessStatus: "not running",
    pingStatus: "skipped: Authorization: Bearer formatted-secret-token /Users/private/runtime.sock",
    guidance: "Launch mode requires an executable engine binary and a loopback http runtime URL with an explicit nonzero port.",
  });
  assert.match(formattedDiagnostics, /^Yet AI Runtime Status\n/);
  assert.match(formattedDiagnostics, /Launch mode: launch/);
  assert.match(formattedDiagnostics, /Engine binary path configured: yes/);
  assert.match(formattedDiagnostics, /Plugin-launched process: not running/);
  assert.match(formattedDiagnostics, /Last\/ping health: skipped:/);
  assert.match(formattedDiagnostics, /Guidance: Launch mode requires/);
  for (const forbidden of [fakePrivatePath, os.homedir(), "provider-secret", "formatted-secret-token", "/Users/private/runtime.sock"]) {
    assert.equal(formattedDiagnostics.includes(forbidden), false, `formatted diagnostics leaked ${forbidden}`);
  }

  const shortFragmentDiagnostic = redactRuntimeDiagnosticText(
    "http://127.0.0.1:8001/callback#access_token=a1b2&refresh_token=r1b2&oauth_code=o1b2&code_verifier=c1b2",
  );
  for (const forbidden of ["a1b2", "r1b2", "o1b2", "c1b2"]) {
    assert.equal(shortFragmentDiagnostic.includes(forbidden), false, `short fragment diagnostics leaked ${forbidden}`);
  }
  assert.equal(shortFragmentDiagnostic.includes("#[redacted]"), true);
  assert.equal((shortFragmentDiagnostic.match(/&\[redacted\]/g) ?? []).length, 3);

  function collectEngineLogs(chunks, options = {}) {
    const lines = [];
    const redactor = createEngineLogRedactor(options.token ?? fakeSessionToken, { appendLine: (line) => lines.push(line) }, options.maxLineLength);
    for (const chunk of chunks) {
      redactor.append(chunk);
    }
    redactor.flush();
    return lines;
  }

  function assertEngineLogsDoNotLeak(chunks, sentinels, options = {}) {
    const lines = collectEngineLogs(chunks, options);
    const rendered = lines.join("\n");
    for (const line of lines) {
      assert.match(line, /^\[engine\] /);
    }
    for (const sentinel of sentinels) {
      assert.equal(rendered.includes(sentinel), false, `engine logs leaked ${sentinel}`);
    }
    return lines;
  }

  const splitBearerSecret = "split-bearer-secret-sentinel";
  const splitBearerLogs = assertEngineLogsDoNotLeak(
    ["safe before\nAuthorization: Bear", `er ${splitBearerSecret}`, "\nsafe after\n"],
    [splitBearerSecret, `Bearer ${splitBearerSecret}`],
  );
  assert.deepEqual(splitBearerLogs, ["[engine] safe before", "[engine] [redacted]", "[engine] safe after"]);

  const splitApiKeySecret = "sk-split-provider-key-sentinel";
  const splitApiKeyLogs = assertEngineLogsDoNotLeak(["provider key sk-split", "-provider-key-sentinel\n"], [splitApiKeySecret]);
  assert.deepEqual(splitApiKeyLogs, ["[engine] provider key [redacted]"]);

  const splitCookieSession = "split-cookie-session-sentinel";
  const splitCookieRefresh = "split-cookie-refresh-sentinel";
  const splitCookieLogs = assertEngineLogsDoNotLeak(
    ["Cookie: session=split-cookie", `-session-sentinel; refresh=${splitCookieRefresh}\n`],
    [splitCookieSession, splitCookieRefresh],
  );
  assert.deepEqual(splitCookieLogs, ["[engine] [redacted]"]);

  const splitSetCookieSession = "split-set-cookie-session-sentinel";
  const splitSetCookieRefresh = "split-set-cookie-refresh-sentinel";
  const splitSetCookieLogs = assertEngineLogsDoNotLeak(
    ["Set-Cookie: sid=split-set-cookie-session-sentinel; refresh=split-set-cookie", "-refresh-sentinel\n"],
    [splitSetCookieSession, splitSetCookieRefresh],
  );
  assert.deepEqual(splitSetCookieLogs, ["[engine] [redacted]"]);

  const splitJwt = "abcdefghijklmnop.abcdefghijklmnop.abcdefghijklmnop";
  const splitOpaque = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const splitTokenLogs = assertEngineLogsDoNotLeak(["jwt abcdefghijklmnop.abcdefgh", "ijklmnop.abcdefghijklmnop opaque abcdefghijklmnopqrstuvwxyz", "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789\n"], [splitJwt, splitOpaque]);
  assert.deepEqual(splitTokenLogs, ["[engine] jwt [redacted] opaque [redacted]"]);

  const tailSecret = "tail-token-secret-sentinel";
  const tailLogs = assertEngineLogsDoNotLeak(["tail Authorization: Bear", `er ${tailSecret}`], [tailSecret, `Bearer ${tailSecret}`]);
  assert.deepEqual(tailLogs, ["[engine] tail [redacted]"]);

  const crlfSecret = "crlf-cookie-secret-sentinel";
  const crlfLogs = assertEngineLogsDoNotLeak([`first safe\r\nsetCookie=${crlfSecret}\r\nthird safe\n`], [crlfSecret]);
  assert.deepEqual(crlfLogs, ["[engine] first safe", "[engine] [redacted]", "[engine] third safe"]);

  const oversizedSecret = "oversized-secret-sentinel";
  const oversizedLogs = assertEngineLogsDoNotLeak(["prefix-", oversizedSecret, "-suffix\nnext safe\n"], [oversizedSecret, "prefix-", "suffix"], { maxLineLength: 10 });
  assert.deepEqual(oversizedLogs, ["[engine] [redacted oversized engine log line]", "[engine] next safe"]);

  globalThis.fetch = async () => ({ ok: true, status: 200 });
  assert.equal(
    await pingEngineOnce({ runtimeUrl: "http://127.0.0.1:8001", sessionToken: "success-session-token" }, 20),
    "passed",
  );

  globalThis.fetch = async () => ({ ok: false, status: 503 });
  assert.equal(
    await pingEngineOnce({ runtimeUrl: "http://127.0.0.1:8001", sessionToken: "http-failure-session-token" }, 20),
    "failed: HTTP 503",
  );

  async function withPingStub(callback) {
    let pinged = false;
    globalThis.fetch = async () => {
      pinged = true;
      return { ok: true, status: 200 };
    };
    const result = await callback();
    return { pinged, result };
  }

  function fakeOutputChannel() {
    return { appendLine() {} };
  }

  const timeoutSessionToken = "timeout-session-token-sentinel";
  const timeoutQuerySecret = "timeout-query-secret-sentinel";
  let timeoutFetchAborted = false;
  globalThis.fetch = async (_url, options = {}) => {
    assert.ok(options.signal, "ping fetch did not receive an AbortSignal");
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        timeoutFetchAborted = true;
        reject(new Error(`AbortError for ${timeoutSessionToken} at http://127.0.0.1:8001/v1/ping?token=${timeoutQuerySecret}`));
      });
    });
  };
  const timeoutPingStatus = await pingEngineOnce(
    { runtimeUrl: "http://127.0.0.1:8001", sessionToken: timeoutSessionToken },
    5,
  );
  assert.equal(timeoutFetchAborted, true);
  assert.match(timeoutPingStatus, /^failed: /);
  assert.equal(timeoutPingStatus.includes(timeoutSessionToken), false, "ping timeout leaked session token");
  assert.equal(timeoutPingStatus.includes(timeoutQuerySecret), false, "ping timeout leaked URL secret");

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yet-ai-vscode-engine-check-"));
  try {
    const privateDirectory = path.join(tempRoot, "private-user-path");
    fs.mkdirSync(privateDirectory);
    const nonExecutable = path.join(privateDirectory, "yet-lsp-non-executable");
    const executable = path.join(privateDirectory, "yet-lsp-executable");
    fs.writeFileSync(nonExecutable, "not launchable");
    fs.writeFileSync(executable, "launchable");

    if (process.platform !== "win32") {
      fs.chmodSync(nonExecutable, 0o600);
      fs.chmodSync(executable, 0o700);
      const startMessage = formatStartedRuntimeMessage(executable);
      assert.equal(startMessage.includes(executable), false);
      assert.equal(startMessage.includes(privateDirectory), false);
      assert.match(startMessage, /yet-lsp-executable/);
      assert.throws(
        () => findEngineBinary(nonExecutable, tempRoot, "yet-lsp"),
        /engineBinaryPath must point to an executable file/,
      );
      assert.equal(findEngineBinary(executable, tempRoot, "yet-lsp"), executable);
    }

    const lspSecretEnv = createLspProcessEnvironment({
      PATH: "/usr/bin",
      YET_AI_AUTH_TOKEN: "lsp-env-session-token-sentinel",
      OPENAI_API_KEY: "sk-lsp-env-provider-secret-sentinel",
      Authorization: "Bearer lsp-env-bearer-sentinel",
    });
    assert.equal(lspSecretEnv.PATH, "/usr/bin");
    assert.equal(Object.hasOwn(lspSecretEnv, "YET_AI_AUTH_TOKEN"), false);
    assert.equal(Object.hasOwn(lspSecretEnv, "OPENAI_API_KEY"), false);
    assert.equal(Object.hasOwn(lspSecretEnv, "Authorization"), false);

    const lspDiagnosticSecret = "lsp-diagnostic-secret-sentinel";
    const lspDiagnosticPath = path.join(os.homedir(), "Library", "Application Support", "yet-ai", "lsp.log");
    const lspDiagnostic = sanitizeLspDiagnostic(
      `LSP failed Authorization: Bearer ${lspDiagnosticSecret} ${lspDiagnosticPath}\n${"safe detail\n".repeat(300)}`,
      "fallback",
    );
    assert.equal(lspDiagnostic.includes(lspDiagnosticSecret), false, "LSP diagnostic leaked secret");
    assert.equal(lspDiagnostic.includes(lspDiagnosticPath), false, "LSP diagnostic leaked private path");
    assert.equal(lspDiagnostic.length, 1000, "LSP diagnostic was not bounded");
    assert.equal(lspDiagnostic.endsWith("… [truncated sanitized LSP diagnostic]"), true);

    function createTextDocument(uri, text, version = 1, languageId = "rust") {
      return {
        uri,
        text,
        languageId,
        version,
        isClosed: false,
        isUntitled: false,
        getText() { return this.text; },
      };
    }

    function takeLspClientMessages(child) {
      const text = child.stdin.chunks.join("");
      child.stdin.chunks = [];
      const messages = [];
      let offset = 0;
      while (offset < text.length) {
        const headerEnd = text.indexOf("\r\n\r\n", offset);
        if (headerEnd === -1) {
          break;
        }
        const header = text.slice(offset, headerEnd);
        const lengthLine = header.split("\r\n").find((line) => line.toLowerCase().startsWith("content-length:"));
        const length = Number(lengthLine?.split(":")[1]?.trim());
        const bodyStart = headerEnd + 4;
        const bodyEnd = bodyStart + length;
        messages.push(JSON.parse(text.slice(bodyStart, bodyEnd)));
        offset = bodyEnd;
      }
      return messages;
    }

    function emitLspResponse(child, id, result) {
      const body = JSON.stringify({ jsonrpc: "2.0", id, result });
      child.stdout.emit("data", Buffer.from(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`));
    }

    function emitLspErrorResponse(child, id, message) {
      const body = JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32603, message } });
      child.stdout.emit("data", Buffer.from(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`));
    }

    function emitRawLspStdout(child, text) {
      child.stdout.emit("data", Buffer.from(text));
    }

    function createMockLspChild() {
      const child = new EventEmitter();
      const stdin = new EventEmitter();
      Object.assign(stdin, {
        chunks: [],
        destroyed: false,
        writableEnded: false,
        write(chunk, callback) {
          if (this.throwOnWrite) {
            throw new Error(`stdin closed Authorization: Bearer ${lspDiagnosticSecret} ${lspDiagnosticPath}`);
          }
          this.chunks.push(chunk);
          if (this.callbackErrorOnWrite && typeof callback === "function") {
            setImmediate(() => callback(new Error(`stdin callback Authorization: Bearer ${lspDiagnosticSecret} ${lspDiagnosticPath}`)));
          } else if (typeof callback === "function") {
            setImmediate(() => callback());
          }
          return true;
        },
      });
      child.stdin = stdin;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.killed = false;
      child.killSignals = [];
      child.closeOnKill = true;
      child.kill = (signal) => {
        child.killSignals.push(signal);
        if (child.killThrows) {
          throw new Error(`kill failed Authorization: Bearer ${lspDiagnosticSecret} ${lspDiagnosticPath}`);
        }
        if (child.killReturnValue === false) {
          return false;
        }
        child.killed = true;
        child.stdin.destroyed = true;
        if (child.closeOnKill) {
          child.emit("exit", null, signal ?? "SIGTERM");
          child.emit("close", null, signal ?? "SIGTERM");
        }
        return true;
      };
      return child;
    }

    function delay() {
      return new Promise((resolve) => setImmediate(resolve));
    }

    function delayMs(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function assertKillAttempted(child, signal, message) {
      if (process.platform === "win32") {
        assert.equal(child.killSignals.includes(undefined), true, message);
      } else {
        assert.equal(child.killSignals.includes(signal), true, message);
      }
    }

    function assertKillNotAttempted(child, signal, message) {
      if (process.platform === "win32") {
        assert.equal(child.killSignals.length, 0, message);
      } else {
        assert.equal(child.killSignals.includes(signal), false, message);
      }
    }

    const lspSpawns = [];
    const lspOutputLines = [];
    const lspOutput = { appendLine(line) { lspOutputLines.push(line); } };
    childProcess.spawn = (command, args, options) => {
      const child = createMockLspChild();
      lspSpawns.push({ command, args, options, child });
      return child;
    };

    configValues = {
      "lsp.enabled": false,
      engineBinaryPath: executable,
    };
    workspaceTextDocuments = [createTextDocument({ scheme: "file", toString: () => "file:///workspace/disabled.rs" }, "fn disabled() {}")];
    startYetAiLspClient({ ...fakeContext, extensionPath: tempRoot }, { engine: { binaryName: "yet-lsp" } }, lspOutput);
    assert.equal(lspSpawns.length, 0, "disabled LSP setting launched a process");
    assert.equal(registeredCompletionProviders.length, 0, "disabled LSP setting registered completion provider");
    assert.equal(registeredHoverProviders.length, 0, "disabled LSP setting registered hover provider");
    assert.equal(registeredDocumentSymbolProviders.length, 0, "disabled LSP setting registered document symbol provider");

    configValues = {
      "lsp.enabled": true,
      engineBinaryPath: executable,
      sessionToken: "legacy-lsp-token-must-not-be-used",
    };
    const fileDocument = createTextDocument({ scheme: "file", toString: () => "file:///workspace/enabled.rs" }, "fn enabled() {}", 3);
    const virtualDocument = createTextDocument({ scheme: "untitled", toString: () => "untitled:virtual" }, "fn virtual_doc() {}", 1);
    workspaceTextDocuments = [fileDocument, virtualDocument];
    startYetAiLspClient({ ...fakeContext, extensionPath: tempRoot }, { engine: { binaryName: "yet-lsp" } }, lspOutput);
    assert.equal(lspSpawns.length, 1);
    assert.equal(lspSpawns[0].command, executable);
    assert.deepEqual(lspSpawns[0].args, ["--lsp-stdio"]);
    assert.equal(lspSpawns[0].options.env.YET_AI_AUTH_TOKEN, undefined);
    assert.equal(lspSpawns[0].options.env.OPENAI_API_KEY, undefined);
    assert.equal(lspSpawns[0].options.env.Authorization, undefined);
    let lspMessages = takeLspClientMessages(lspSpawns[0].child);
    assert.equal(lspMessages.length, 1);
    assert.equal(lspMessages[0].method, "initialize");
    assert.equal(lspMessages[0].params.capabilities.textDocument.synchronization.didOpen, true);
    assert.equal(typeof lspMessages[0].params.capabilities.textDocument.completion, "object");
    assert.equal(typeof lspMessages[0].params.capabilities.textDocument.hover, "object");
    assert.equal(typeof lspMessages[0].params.capabilities.textDocument.documentSymbol, "object");
    assert.ok(lspOutputLines.some((line) => line.includes("Started Yet AI read-only LSP MVP from yet-lsp-executable.")));
    emitLspResponse(lspSpawns[0].child, lspMessages[0].id, {
      capabilities: {
        textDocumentSync: 1,
        completionProvider: { triggerCharacters: [] },
        hoverProvider: true,
        documentSymbolProvider: true,
      },
      serverInfo: { name: "Yet AI LSP" },
    });
    await delay();
    lspMessages = takeLspClientMessages(lspSpawns[0].child);
    assert.equal(lspMessages[0].method, "initialized");
    assert.equal(lspMessages[1].method, "textDocument/didOpen");
    assert.equal(lspMessages[1].params.textDocument.uri, "file:///workspace/enabled.rs");
    assert.equal(lspMessages.some((message) => JSON.stringify(message).includes("untitled:virtual")), false, "LSP synced a virtual document");
    assert.equal(registeredHoverProviders.length, 1);
    assert.equal(registeredDocumentSymbolProviders.length, 1);
    assert.equal(registeredCompletionProviders.length, 1);
    assert.ok(lspOutputLines.some((line) => line.includes("deterministic completion, hover, and document symbols")), "LSP initialization log did not mention completion, hover, and document symbols");
    assert.deepEqual(registeredHoverProviders[0].selector, { scheme: "file" });
    assert.deepEqual(registeredDocumentSymbolProviders[0].selector, { scheme: "file" });
    assert.deepEqual(registeredCompletionProviders[0].selector, { scheme: "file" });
    const completionsPromise = registeredCompletionProviders[0].provider.provideCompletionItems(fileDocument, { line: 0, character: 3 });
    lspMessages = takeLspClientMessages(lspSpawns[0].child);
    assert.equal(lspMessages.length, 1);
    assert.equal(lspMessages[0].method, "textDocument/completion");
    assert.equal(lspMessages[0].params.textDocument.uri, "file:///workspace/enabled.rs");
    emitLspResponse(lspSpawns[0].child, lspMessages[0].id, {
      isIncomplete: false,
      items: [{ label: "Yet AI LSP connected", detail: "Local read-only LSP status" }],
    });
    const completions = await completionsPromise;
    assert.equal(completions.items.length, 1);
    assert.equal(completions.items[0].label, "Yet AI LSP connected");
    assert.equal(completions.items[0].detail, "Local read-only LSP status");
    const hoverPromise = registeredHoverProviders[0].provider.provideHover(fileDocument, { line: 0, character: 3 });
    lspMessages = takeLspClientMessages(lspSpawns[0].child);
    assert.equal(lspMessages.length, 1);
    assert.equal(lspMessages[0].method, "textDocument/hover");
    assert.deepEqual(lspMessages[0].params.position, { line: 0, character: 3 });
    emitLspResponse(lspSpawns[0].child, lspMessages[0].id, {
      contents: { kind: "plaintext", value: "Yet AI read-only LSP: local document is connected." },
    });
    const hover = await hoverPromise;
    assert.equal(hover.contents, "Yet AI read-only LSP: local document is connected.");
    const symbolsPromise = registeredDocumentSymbolProviders[0].provider.provideDocumentSymbols(fileDocument);
    lspMessages = takeLspClientMessages(lspSpawns[0].child);
    assert.equal(lspMessages.length, 1);
    assert.equal(lspMessages[0].method, "textDocument/documentSymbol");
    emitLspResponse(lspSpawns[0].child, lspMessages[0].id, [
      {
        name: "enabled",
        kind: 12,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 15 } },
        selectionRange: { start: { line: 0, character: 3 }, end: { line: 0, character: 10 } },
      },
      {
        name: "EnabledClass",
        kind: 5,
        range: { start: { line: 1, character: 0 }, end: { line: 1, character: 20 } },
        selectionRange: { start: { line: 1, character: 6 }, end: { line: 1, character: 18 } },
      },
      {
        name: "EnabledStruct",
        kind: 23,
        range: { start: { line: 2, character: 0 }, end: { line: 2, character: 21 } },
        selectionRange: { start: { line: 2, character: 7 }, end: { line: 2, character: 20 } },
      },
    ]);
    const symbols = await symbolsPromise;
    assert.equal(symbols.length, 3);
    assert.equal(symbols[0].name, "enabled");
    assert.equal(symbols[0].kind, 11);
    assert.equal(symbols[1].kind, 4);
    assert.equal(symbols[2].kind, 22);
    assert.equal(symbols[0].range.start.line, 0);
    assert.equal(symbols[0].range.start.character, 0);
    assert.equal(symbols[0].selectionRange.end.line, 0);
    assert.equal(symbols[0].selectionRange.end.character, 10);
    const invalidHoverPromise = registeredHoverProviders[0].provider.provideHover(fileDocument, { line: 0, character: 3 });
    lspMessages = takeLspClientMessages(lspSpawns[0].child);
    emitLspResponse(lspSpawns[0].child, lspMessages[0].id, null);
    assert.equal(await invalidHoverPromise, undefined, "invalid hover response did not fail safe");
    const invalidSymbolsPromise = registeredDocumentSymbolProviders[0].provider.provideDocumentSymbols(fileDocument);
    lspMessages = takeLspClientMessages(lspSpawns[0].child);
    emitLspResponse(lspSpawns[0].child, lspMessages[0].id, { items: [] });
    assert.equal(await invalidSymbolsPromise, undefined, "invalid document symbol response did not fail safe");
    async function assertInvalidDocumentSymbolsFailSafe(result, message) {
      const invalidPromise = registeredDocumentSymbolProviders[0].provider.provideDocumentSymbols(fileDocument);
      lspMessages = takeLspClientMessages(lspSpawns[0].child);
      assert.equal(lspMessages[0].method, "textDocument/documentSymbol");
      emitLspResponse(lspSpawns[0].child, lspMessages[0].id, result);
      assert.equal(await invalidPromise, undefined, message);
    }

    const safeSymbolResponse = {
      name: "safe_symbol",
      kind: 12,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
      selectionRange: { start: { line: 0, character: 3 }, end: { line: 0, character: 10 } },
    };
    await assertInvalidDocumentSymbolsFailSafe(Array.from({ length: 65 }, () => safeSymbolResponse), "oversized document symbol response did not fail safe");
    await assertInvalidDocumentSymbolsFailSafe([{ ...safeSymbolResponse, name: "a".repeat(81) }], "overlong document symbol name did not fail safe");
    await assertInvalidDocumentSymbolsFailSafe([{ ...safeSymbolResponse, range: { start: { line: -1, character: 0 }, end: { line: 0, character: 10 } } }], "negative document symbol range did not fail safe");
    await assertInvalidDocumentSymbolsFailSafe([{ ...safeSymbolResponse, range: { start: { line: 0.5, character: 0 }, end: { line: 0, character: 10 } } }], "non-integer document symbol range did not fail safe");
    await assertInvalidDocumentSymbolsFailSafe([{ ...safeSymbolResponse, selectionRange: { start: { line: 0, character: 0 }, end: { line: 1_000_001, character: 0 } } }], "absurd document symbol range did not fail safe");
    await assertInvalidDocumentSymbolsFailSafe([{ ...safeSymbolResponse, selectionRange: { start: { line: 0, character: 11 }, end: { line: 0, character: 12 } } }], "selection range outside symbol range did not fail safe");
    await assertInvalidDocumentSymbolsFailSafe([{ ...safeSymbolResponse, selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 11 } } }], "selection range ending outside symbol range did not fail safe");
    assert.equal(await registeredCompletionProviders[0].provider.provideCompletionItems(virtualDocument, { line: 0, character: 1 }), undefined);
    assert.equal(await registeredHoverProviders[0].provider.provideHover(virtualDocument, { line: 0, character: 1 }), undefined);
    assert.equal(await registeredDocumentSymbolProviders[0].provider.provideDocumentSymbols(virtualDocument), undefined);
    lspMessages = takeLspClientMessages(lspSpawns[0].child);
    assert.equal(lspMessages.length, 0, "virtual document providers sent LSP traffic");
    const oversizedDocumentText = "a".repeat(256 * 1024 + 1);
    const oversizedDocument = createTextDocument({ scheme: "file", toString: () => "file:///workspace/oversized.rs" }, oversizedDocumentText, 1);
    workspaceOpenDocumentListeners.at(-1)(oversizedDocument);
    lspMessages = takeLspClientMessages(lspSpawns[0].child);
    assert.equal(lspMessages.length, 0, "oversized document open sent LSP traffic");
    assert.equal(await registeredCompletionProviders[0].provider.provideCompletionItems(oversizedDocument, { line: 0, character: 0 }), undefined);
    assert.equal(await registeredHoverProviders[0].provider.provideHover(oversizedDocument, { line: 0, character: 0 }), undefined);
    assert.equal(await registeredDocumentSymbolProviders[0].provider.provideDocumentSymbols(oversizedDocument), undefined);
    lspMessages = takeLspClientMessages(lspSpawns[0].child);
    assert.equal(lspMessages.length, 0, "oversized document providers sent LSP traffic");
    oversizedDocument.version = 2;
    workspaceChangeDocumentListeners.at(-1)({ document: oversizedDocument });
    lspMessages = takeLspClientMessages(lspSpawns[0].child);
    assert.equal(lspMessages.length, 0, "oversized skipped document change sent LSP traffic");

    const binaryDocumentText = "safe prefix\u0000binary suffix";
    const binaryDocument = createTextDocument({ scheme: "file", toString: () => "file:///workspace/binary.rs" }, binaryDocumentText, 1);
    workspaceOpenDocumentListeners.at(-1)(binaryDocument);
    assert.equal(lspSpawns[0].child.stdin.chunks.join("").includes(binaryDocumentText), false, "binary-like document body was written to LSP stdin");
    lspMessages = takeLspClientMessages(lspSpawns[0].child);
    assert.equal(lspMessages.length, 0, "binary-like document open sent LSP traffic");
    assert.equal(await registeredCompletionProviders[0].provider.provideCompletionItems(binaryDocument, { line: 0, character: 0 }), undefined);
    assert.equal(await registeredHoverProviders[0].provider.provideHover(binaryDocument, { line: 0, character: 0 }), undefined);
    assert.equal(await registeredDocumentSymbolProviders[0].provider.provideDocumentSymbols(binaryDocument), undefined);
    lspMessages = takeLspClientMessages(lspSpawns[0].child);
    assert.equal(lspMessages.length, 0, "binary-like document providers sent LSP traffic");

    const transitionDocument = createTextDocument({ scheme: "file", toString: () => "file:///workspace/transition.rs" }, "fn transition() {}", 1);
    workspaceOpenDocumentListeners.at(-1)(transitionDocument);
    lspMessages = takeLspClientMessages(lspSpawns[0].child);
    assert.equal(lspMessages[0].method, "textDocument/didOpen");
    transitionDocument.text = "unsafe\u0000transition";
    transitionDocument.version = 2;
    workspaceChangeDocumentListeners.at(-1)({ document: transitionDocument });
    assert.equal(lspSpawns[0].child.stdin.chunks.join("").includes(transitionDocument.text), false, "unsafe changed document body was written to LSP stdin");
    lspMessages = takeLspClientMessages(lspSpawns[0].child);
    assert.equal(lspMessages.length, 1, "unsafe synced document transition did not send exactly one LSP message");
    assert.equal(lspMessages[0].method, "textDocument/didClose");
    assert.equal(JSON.stringify(lspMessages[0]).includes("unsafe"), false, "unsafe transition close included document body");
    assert.equal(await registeredHoverProviders[0].provider.provideHover(transitionDocument, { line: 0, character: 0 }), undefined);
    assert.equal(await registeredDocumentSymbolProviders[0].provider.provideDocumentSymbols(transitionDocument), undefined);
    lspMessages = takeLspClientMessages(lspSpawns[0].child);
    assert.equal(lspMessages.length, 0, "unsafe transitioned document hover/symbols sent LSP traffic");

    const skippedThenSafeDocument = createTextDocument({ scheme: "file", toString: () => "file:///workspace/skipped-then-safe.rs" }, "\u0000", 1);
    workspaceOpenDocumentListeners.at(-1)(skippedThenSafeDocument);
    lspMessages = takeLspClientMessages(lspSpawns[0].child);
    assert.equal(lspMessages.length, 0, "initially skipped document sent LSP traffic");
    skippedThenSafeDocument.text = "fn now_safe() {}";
    skippedThenSafeDocument.version = 2;
    workspaceChangeDocumentListeners.at(-1)({ document: skippedThenSafeDocument });
    lspMessages = takeLspClientMessages(lspSpawns[0].child);
    assert.equal(lspMessages.length, 1, "previously skipped safe document did not sync");
    assert.equal(lspMessages[0].method, "textDocument/didOpen");
    assert.equal(lspMessages[0].params.textDocument.text, "fn now_safe() {}");
    const skippedThenSafeCompletions = registeredCompletionProviders[0].provider.provideCompletionItems(skippedThenSafeDocument, { line: 0, character: 3 });
    lspMessages = takeLspClientMessages(lspSpawns[0].child);
    assert.equal(lspMessages.length, 1, "previously skipped safe document completion did not send request");
    assert.equal(lspMessages[0].method, "textDocument/completion");
    emitLspResponse(lspSpawns[0].child, lspMessages[0].id, { isIncomplete: false, items: [] });
    await skippedThenSafeCompletions;
    const skippedThenSafeHover = registeredHoverProviders[0].provider.provideHover(skippedThenSafeDocument, { line: 0, character: 3 });
    lspMessages = takeLspClientMessages(lspSpawns[0].child);
    assert.equal(lspMessages.length, 1, "previously skipped safe document hover did not send request");
    assert.equal(lspMessages[0].method, "textDocument/hover");
    emitLspResponse(lspSpawns[0].child, lspMessages[0].id, { contents: "safe hover" });
    assert.equal((await skippedThenSafeHover).contents, "safe hover");

    const hoverFailurePromise = registeredHoverProviders[0].provider.provideHover(skippedThenSafeDocument, { line: 0, character: 3 });
    lspMessages = takeLspClientMessages(lspSpawns[0].child);
    assert.equal(lspMessages[0].method, "textDocument/hover");
    emitLspErrorResponse(lspSpawns[0].child, lspMessages[0].id, `hover failed Authorization: Bearer ${lspDiagnosticSecret} ${lspDiagnosticPath}`);
    assert.equal(await hoverFailurePromise, undefined, "hover LSP error did not fail safe");
    const symbolFailurePromise = registeredDocumentSymbolProviders[0].provider.provideDocumentSymbols(skippedThenSafeDocument);
    lspMessages = takeLspClientMessages(lspSpawns[0].child);
    assert.equal(lspMessages[0].method, "textDocument/documentSymbol");
    emitLspErrorResponse(lspSpawns[0].child, lspMessages[0].id, `symbols failed Authorization: Bearer ${lspDiagnosticSecret} ${lspDiagnosticPath}`);
    assert.deepEqual(await symbolFailurePromise, [], "document symbol LSP error did not fail safe");
    assert.equal(lspOutputLines.join("\n").includes(lspDiagnosticSecret), false, "hover/symbol failure leaked secret");
    assert.equal(lspOutputLines.join("\n").includes(lspDiagnosticPath), false, "hover/symbol failure leaked private path");

    const hugeUri = `file:///workspace/${"u".repeat(600 * 1024)}.rs`;
    const hugeUriDocument = createTextDocument({ scheme: "file", toString: () => hugeUri }, "fn safe_body() {}", 1);
    workspaceOpenDocumentListeners.at(-1)(hugeUriDocument);
    assert.equal(lspSpawns[0].child.stdin.chunks.join("").includes("fn safe_body() {}"), false, "oversized outbound LSP message was written to stdin");
    lspMessages = takeLspClientMessages(lspSpawns[0].child);
    assert.equal(lspMessages.length, 0, "oversized outbound LSP message produced framed traffic");

    fileDocument.version = 4;
    fileDocument.text = "fn enabled_again() {}";
    workspaceChangeDocumentListeners.at(-1)({ document: fileDocument });
    lspMessages = takeLspClientMessages(lspSpawns[0].child);
    assert.equal(lspMessages[0].method, "textDocument/didChange", "subsequent safe document did not continue syncing");
    workspaceChangeDocumentListeners.at(-1)({ document: fileDocument });
    lspMessages = takeLspClientMessages(lspSpawns[0].child);
    assert.equal(lspMessages[0].method, "textDocument/didChange");
    workspaceCloseDocumentListeners.at(-1)(fileDocument);
    lspMessages = takeLspClientMessages(lspSpawns[0].child);
    assert.equal(lspMessages[0].method, "textDocument/didClose");
    lspSpawns[0].child.stderr.emit("data", Buffer.from(`stderr Authorization: Bearer ${lspDiagnosticSecret} ${lspDiagnosticPath}`));
    assert.equal(lspOutputLines.join("\n").includes(lspDiagnosticSecret), false, "LSP stderr leaked secret");
    assert.equal(lspOutputLines.join("\n").includes(lspDiagnosticPath), false, "LSP stderr leaked private path");
    const splitLspSecret = "split-lsp-secret-sentinel";
    lspSpawns[0].child.stderr.emit("data", Buffer.from("split Authorization: Bear"));
    lspSpawns[0].child.stderr.emit("data", Buffer.from(`er ${splitLspSecret}\n`));
    const splitLspText = lspOutputLines.join("\n");
    assert.equal(splitLspText.includes(splitLspSecret), false, "split LSP stderr leaked secret");
    assert.equal(splitLspText.includes(`Bearer ${splitLspSecret}`), false, "split LSP stderr leaked bearer secret");
    const oversizedLspSecret = "oversized-lsp-secret-sentinel";
    const oversizedLspPath = path.join(os.homedir(), "Library", "Application Support", "yet-ai", "oversized-lsp.log");
    const singleChunkOversizedSecret = "single-chunk-oversized-lsp-secret-sentinel";
    lspSpawns[0].child.stderr.emit("data", Buffer.from(`${singleChunkOversizedSecret} ${"x".repeat(9 * 1024)}\n`));
    lspSpawns[0].child.stderr.emit("data", Buffer.from(`oversized Authorization: Bearer ${oversizedLspSecret.slice(0, 10)}`));
    lspSpawns[0].child.stderr.emit("data", Buffer.from(`${oversizedLspSecret.slice(10)} ${oversizedLspPath} ${"x".repeat(9 * 1024)}`));
    lspSpawns[0].child.stderr.emit("data", Buffer.from("\nlater safe stderr line\n"));
    const oversizedLspText = lspOutputLines.join("\n");
    assert.equal(oversizedLspText.includes(singleChunkOversizedSecret), false, "single-chunk oversized LSP stderr leaked secret");
    assert.equal(oversizedLspText.includes(oversizedLspSecret), false, "oversized LSP stderr leaked split secret");
    assert.equal(oversizedLspText.includes(oversizedLspPath), false, "oversized LSP stderr leaked private path");
    assert.equal(oversizedLspText.includes(os.homedir()), false, "oversized LSP stderr leaked home path");
    assert.equal(oversizedLspText.includes("[redacted oversized LSP stderr line]"), true, "oversized LSP stderr did not use generic marker");
    assert.equal(oversizedLspText.includes("later safe stderr line"), true, "LSP stderr did not resume after oversized line discard");
    lspSpawns[0].child.stdin.throwOnWrite = true;
    fileDocument.version = 5;
    workspaceChangeDocumentListeners.at(-1)({ document: fileDocument });
    await delay();
    assert.equal(registeredCompletionProviders.at(-1).disposed, true, "sync stdin write error did not dispose provider");
    assertKillAttempted(lspSpawns[0].child, "SIGTERM", "sync stdin write error did not terminate child");
    assert.equal(lspOutputLines.join("\n").includes(lspDiagnosticSecret), false, "LSP stdin failure leaked secret");
    assert.equal(lspOutputLines.join("\n").includes(lspDiagnosticPath), false, "LSP stdin failure leaked private path");

    const providerCountsBeforeMissingCapabilities = {
      completion: registeredCompletionProviders.length,
      hover: registeredHoverProviders.length,
      documentSymbol: registeredDocumentSymbolProviders.length,
    };
    startYetAiLspClient({ ...fakeContext, extensionPath: tempRoot }, { engine: { binaryName: "yet-lsp" } }, lspOutput);
    assert.equal(lspSpawns.length, 2, "LSP retry after sync stdin write error did not spawn");
    lspMessages = takeLspClientMessages(lspSpawns[1].child);
    emitLspResponse(lspSpawns[1].child, lspMessages[0].id, { capabilities: { textDocumentSync: 1, completionProvider: {} } });
    await delay();
    assert.equal(registeredCompletionProviders.length, providerCountsBeforeMissingCapabilities.completion + 1, "completion provider was not registered for advertised completion capability");
    assert.equal(registeredHoverProviders.length, providerCountsBeforeMissingCapabilities.hover, "hover provider registered without advertised hover capability");
    assert.equal(registeredDocumentSymbolProviders.length, providerCountsBeforeMissingCapabilities.documentSymbol, "document symbol provider registered without advertised document symbol capability");
    takeLspClientMessages(lspSpawns[1].child);
    const directStopPromise = stopYetAiLspClient(lspOutput);
    let directStopResolved = false;
    directStopPromise.then(() => {
      directStopResolved = true;
    });
    lspMessages = takeLspClientMessages(lspSpawns[1].child);
    assert.equal(lspMessages[0].method, "shutdown");
    await delay();
    assert.equal(directStopResolved, false, "LSP stop resolved before process close");
    emitLspResponse(lspSpawns[1].child, lspMessages[0].id, null);
    await delay();
    assert.equal(lspSpawns[1].child.killed, false, "LSP graceful shutdown killed before exit notification grace");
    lspMessages = takeLspClientMessages(lspSpawns[1].child);
    assert.equal(lspMessages[0].method, "exit");
    await delayMs(1200);
    assert.equal(lspSpawns[1].child.killed, true, "LSP deactivate cleanup did not stop process");
    await directStopPromise;
    assert.equal(directStopResolved, true, "LSP stop did not resolve after process close");
    assert.equal(registeredHoverProviders[0].disposed, true, "LSP hover provider was not disposed");
    assert.equal(registeredDocumentSymbolProviders[0].disposed, true, "LSP document symbol provider was not disposed");
    assert.equal(registeredCompletionProviders[0].disposed, true, "LSP completion provider was not disposed");

    startYetAiLspClient({ ...fakeContext, extensionPath: tempRoot }, { engine: { binaryName: "yet-lsp" } }, lspOutput);
    assert.equal(lspSpawns.length, 3, "LSP retry after direct stop did not spawn for stdin async error case");
    lspMessages = takeLspClientMessages(lspSpawns[2].child);
    emitLspResponse(lspSpawns[2].child, lspMessages[0].id, { capabilities: { textDocumentSync: 1, completionProvider: {} } });
    await delay();
    assert.equal(registeredCompletionProviders.at(-1).disposed, false, "stdin async error setup provider unexpectedly disposed");
    lspSpawns[2].child.stdin.emit("error", new Error(`async stdin Authorization: Bearer ${lspDiagnosticSecret} ${lspDiagnosticPath}`));
    await delay();
    assert.equal(registeredCompletionProviders.at(-1).disposed, true, "async stdin error did not dispose provider");
    assertKillAttempted(lspSpawns[2].child, "SIGTERM", "async stdin error did not terminate child");
    assert.equal(lspOutputLines.join("\n").includes(lspDiagnosticSecret), false, "async stdin error leaked secret");
    assert.equal(lspOutputLines.join("\n").includes(lspDiagnosticPath), false, "async stdin error leaked private path");
    startYetAiLspClient({ ...fakeContext, extensionPath: tempRoot }, { engine: { binaryName: "yet-lsp" } }, lspOutput);
    assert.equal(lspSpawns.length, 4, "LSP retry after stdin async error did not spawn");
    lspMessages = takeLspClientMessages(lspSpawns[3].child);
    emitLspResponse(lspSpawns[3].child, lspMessages[0].id, { capabilities: { textDocumentSync: 1, completionProvider: {} } });
    await delay();
    lspSpawns[3].child.stdin.callbackErrorOnWrite = true;
    fileDocument.version = 6;
    workspaceChangeDocumentListeners.at(-1)({ document: fileDocument });
    await delay();
    assert.equal(registeredCompletionProviders.at(-1).disposed, true, "stdin write callback error did not dispose provider");
    assertKillAttempted(lspSpawns[3].child, "SIGTERM", "stdin write callback error did not terminate child");
    assert.equal(lspOutputLines.join("\n").includes(lspDiagnosticSecret), false, "stdin write callback error leaked secret");
    assert.equal(lspOutputLines.join("\n").includes(lspDiagnosticPath), false, "stdin write callback error leaked private path");

    startYetAiLspClient({ ...fakeContext, extensionPath: tempRoot }, { engine: { binaryName: "yet-lsp" } }, lspOutput);
    assert.equal(lspSpawns.length, 5, "LSP retry after stdin callback error did not spawn");
    lspMessages = takeLspClientMessages(lspSpawns[4].child);
    emitLspResponse(lspSpawns[4].child, lspMessages[0].id, { capabilities: { textDocumentSync: 1, completionProvider: {} } });
    await delay();
    lspSpawns[4].child.stdout.emit("error", new Error(`stdout stream Authorization: Bearer ${lspDiagnosticSecret} ${lspDiagnosticPath}`));
    await delay();
    assert.equal(registeredCompletionProviders.at(-1).disposed, true, "stdout stream error did not dispose provider");
    assertKillAttempted(lspSpawns[4].child, "SIGTERM", "stdout stream error did not terminate child");
    assert.equal(lspOutputLines.join("\n").includes(lspDiagnosticSecret), false, "stdout stream error leaked secret");
    assert.equal(lspOutputLines.join("\n").includes(lspDiagnosticPath), false, "stdout stream error leaked private path");

    startYetAiLspClient({ ...fakeContext, extensionPath: tempRoot }, { engine: { binaryName: "yet-lsp" } }, lspOutput);
    assert.equal(lspSpawns.length, 6, "LSP retry after stdout stream error did not spawn");
    lspMessages = takeLspClientMessages(lspSpawns[5].child);
    emitLspResponse(lspSpawns[5].child, lspMessages[0].id, { capabilities: { textDocumentSync: 1, completionProvider: {} } });
    await delay();
    lspSpawns[5].child.stderr.emit("error", new Error(`stderr stream Authorization: Bearer ${lspDiagnosticSecret} ${lspDiagnosticPath}`));
    await delay();
    assert.equal(registeredCompletionProviders.at(-1).disposed, true, "stderr stream error did not dispose provider");
    assertKillAttempted(lspSpawns[5].child, "SIGTERM", "stderr stream error did not terminate child");
    assert.equal(lspOutputLines.join("\n").includes(lspDiagnosticSecret), false, "stderr stream error leaked secret");
    assert.equal(lspOutputLines.join("\n").includes(lspDiagnosticPath), false, "stderr stream error leaked private path");

    const staleDisposedIndex = registeredCompletionProviders.length - 1;
    startYetAiLspClient({ ...fakeContext, extensionPath: tempRoot }, { engine: { binaryName: "yet-lsp" } }, lspOutput);
    const retryAfterStopSpawn = lspSpawns.at(-1);
    lspMessages = takeLspClientMessages(retryAfterStopSpawn.child);
    emitLspResponse(retryAfterStopSpawn.child, lspMessages[0].id, { capabilities: { textDocumentSync: 1, completionProvider: {} } });
    await delay();
    assert.equal(registeredCompletionProviders.at(-1).disposed, false, "retry completion provider was unexpectedly disposed");
    retryAfterStopSpawn.child.emit("error", new Error(`async lsp error Authorization: Bearer ${lspDiagnosticSecret} ${lspDiagnosticPath}`));
    await delay();
    assert.equal(registeredCompletionProviders.at(-1).disposed, true, "async LSP error did not dispose provider");
    assert.equal(lspOutputLines.join("\n").includes(lspDiagnosticSecret), false, "async LSP error leaked secret");
    assert.equal(lspOutputLines.join("\n").includes(lspDiagnosticPath), false, "async LSP error leaked private path");
    startYetAiLspClient({ ...fakeContext, extensionPath: tempRoot }, { engine: { binaryName: "yet-lsp" } }, lspOutput);
    const retryAfterErrorSpawn = lspSpawns.at(-1);
    lspMessages = takeLspClientMessages(retryAfterErrorSpawn.child);
    emitLspResponse(retryAfterErrorSpawn.child, lspMessages[0].id, { capabilities: { textDocumentSync: 1, completionProvider: {} } });
    await delay();
    retryAfterErrorSpawn.child.emit("close", 7, null);
    await delay();
    assert.equal(registeredCompletionProviders.at(-1).disposed, true, "async LSP close did not dispose provider");
    startYetAiLspClient({ ...fakeContext, extensionPath: tempRoot }, { engine: { binaryName: "yet-lsp" } }, lspOutput);
    const retryAfterCloseSpawn = lspSpawns.at(-1);
    lspMessages = takeLspClientMessages(retryAfterCloseSpawn.child);
    emitLspResponse(retryAfterCloseSpawn.child, lspMessages[0].id, { capabilities: { textDocumentSync: 1, completionProvider: {} } });
    await delay();
    retryAfterCloseSpawn.child.emit("close", 0, null);
    await delay();
    assert.equal(registeredCompletionProviders[staleDisposedIndex].disposed, true, "stale LSP provider was not disposed");

    function startInitializedLsp() {
      startYetAiLspClient({ ...fakeContext, extensionPath: tempRoot }, { engine: { binaryName: "yet-lsp" } }, lspOutput);
      const spawn = lspSpawns.at(-1);
      const messages = takeLspClientMessages(spawn.child);
      emitLspResponse(spawn.child, messages[0].id, { capabilities: { textDocumentSync: 1, completionProvider: {} } });
      return spawn;
    }

    async function assertFatalParserRetry(rawStdout, expectedDiagnostic, label) {
      const spawnCountBefore = lspSpawns.length;
      const providerCountBefore = registeredCompletionProviders.length;
      const spawn = startInitializedLsp();
      assert.equal(lspSpawns.length, spawnCountBefore + 1, `${label} did not spawn setup client`);
      await delay();
      const activeProvider = registeredCompletionProviders.at(-1);
      assert.equal(activeProvider.disposed, false, `${label} setup provider disposed before fatal parser case`);
      emitRawLspStdout(spawn.child, rawStdout);
      await delay();
      assert.equal(activeProvider.disposed, true, `${label} fatal parser error did not dispose provider`);
      assert.ok(spawn.child.killSignals.length >= 1, `${label} fatal parser error did not terminate child`);
      assert.ok(lspOutputLines.some((line) => line.includes(expectedDiagnostic)), `${label} missing fatal diagnostic`);
      startYetAiLspClient({ ...fakeContext, extensionPath: tempRoot }, { engine: { binaryName: "yet-lsp" } }, lspOutput);
      assert.equal(lspSpawns.length, spawnCountBefore + 2, `${label} retry after fatal parser error did not spawn`);
      assert.equal(registeredCompletionProviders.length, providerCountBefore + 1, `${label} retry should not register before initialize`);
      const retrySpawn = lspSpawns.at(-1);
      const retryMessages = takeLspClientMessages(retrySpawn.child);
      emitLspResponse(retrySpawn.child, retryMessages[0].id, { capabilities: { textDocumentSync: 1, completionProvider: {} } });
      await delay();
      assert.equal(registeredCompletionProviders.length, providerCountBefore + 2, `${label} retry did not initialize provider`);
      retrySpawn.child.emit("close", 0, null);
      await delay();
    }

    await assertFatalParserRetry("Content-Length: 1\r\n\r\n{", "stdout JSON parse failed", "invalid JSON");
    await assertFatalParserRetry("Content-Type: application/vscode-jsonrpc; charset=utf-8\r\n\r\n{}", "invalid bounded content length", "missing content length");
    await assertFatalParserRetry("Content-Length: 524289\r\n\r\n", "invalid bounded content length", "oversized content length");
    await assertFatalParserRetry("x".repeat(8 * 1024 + 1), "stdout header exceeded bounded parser buffer", "oversized header");
    await assertFatalParserRetry("x".repeat(512 * 1024 + 1), "stdout exceeded bounded parser buffer", "oversized stdout");

    const preConcatSpawn = startInitializedLsp();
    await delay();
    const preConcatProvider = registeredCompletionProviders.at(-1);
    emitRawLspStdout(preConcatSpawn.child, `Content-Length: ${512 * 1024}\r\n\r\n`);
    await delay();
    emitRawLspStdout(preConcatSpawn.child, "x".repeat(512 * 1024 + 1));
    await delay();
    assert.equal(preConcatProvider.disposed, true, "oversized stdout chunk did not fail before concat allocation");
    assert.ok(preConcatSpawn.child.killSignals.length >= 1, "oversized stdout chunk did not terminate child");
    assert.ok(lspOutputLines.some((line) => line.includes("stdout exceeded bounded parser buffer")), "oversized stdout chunk missing diagnostic");

    const pendingFatalSpawn = startInitializedLsp();
    await delay();
    takeLspClientMessages(pendingFatalSpawn.child);
    const pendingFatalCompletion = registeredCompletionProviders.at(-1).provider.provideCompletionItems(fileDocument, { line: 0, character: 1 });
    lspMessages = takeLspClientMessages(pendingFatalSpawn.child);
    assert.equal(lspMessages[0].method, "textDocument/completion", "pending fatal parser case did not request completion");
    emitRawLspStdout(pendingFatalSpawn.child, "Content-Length: 1\r\n\r\n{");
    assert.equal(await pendingFatalCompletion, undefined, "pending completion did not fail safe on fatal parser error");
    assert.ok(lspOutputLines.some((line) => line.includes("completion unavailable")), "pending fatal completion did not log fail-safe diagnostic");

    const closedCompletionSpawn = startInitializedLsp();
    await delay();
    const closedCompletionProvider = registeredCompletionProviders.at(-1).provider;
    closedCompletionSpawn.child.emit("close", 0, null);
    await delay();
    assert.equal(await closedCompletionProvider.provideCompletionItems(fileDocument, { line: 0, character: 1 }), undefined, "closed completion did not fail safe");

    const stoppedCompletionSpawn = startInitializedLsp();
    await delay();
    const stoppedCompletionProvider = registeredCompletionProviders.at(-1).provider;
    void stopYetAiLspClient(lspOutput);
    await delay();
    assert.equal(await stoppedCompletionProvider.provideCompletionItems(fileDocument, { line: 0, character: 1 }), undefined, "stopped completion did not fail safe");
    stoppedCompletionSpawn.child.emit("close", 0, null);
    await delay();

    const timeoutCompletionSpawn = startInitializedLsp();
    await delay();
    takeLspClientMessages(timeoutCompletionSpawn.child);
    const timeoutCompletionPromise = registeredCompletionProviders.at(-1).provider.provideCompletionItems(fileDocument, { line: 0, character: 1 });
    lspMessages = takeLspClientMessages(timeoutCompletionSpawn.child);
    assert.equal(lspMessages[0].method, "textDocument/completion", "timeout completion did not request completion");
    assert.equal(await timeoutCompletionPromise, undefined, "timeout completion did not fail safe");
    timeoutCompletionSpawn.child.emit("close", 0, null);
    await delay();

    const hardKillSpawn = startInitializedLsp();
    await delay();
    takeLspClientMessages(hardKillSpawn.child);
    hardKillSpawn.child.closeOnKill = false;
    const hardKillStop = stopYetAiLspClient(lspOutput);
    lspMessages = takeLspClientMessages(hardKillSpawn.child);
    assert.equal(lspMessages[0].method, "shutdown", "hard-kill stop did not send shutdown");
    emitLspResponse(hardKillSpawn.child, lspMessages[0].id, null);
    await delayMs(1200);
    assertKillAttempted(hardKillSpawn.child, "SIGTERM", "bounded stop did not attempt SIGTERM");
    assertKillNotAttempted(hardKillSpawn.child, "SIGKILL", "bounded stop attempted hard kill before grace elapsed");
    await delayMs(700);
    assertKillAttempted(hardKillSpawn.child, "SIGKILL", "bounded stop did not attempt hard kill");
    hardKillSpawn.child.emit("close", null, "SIGKILL");
    await hardKillStop;

    const fallbackSpawn = startInitializedLsp();
    await delay();
    takeLspClientMessages(fallbackSpawn.child);
    fallbackSpawn.child.closeOnKill = false;
    const fallbackStop = stopYetAiLspClient(lspOutput);
    lspMessages = takeLspClientMessages(fallbackSpawn.child);
    assert.equal(lspMessages[0].method, "shutdown", "fallback stop did not send shutdown");
    await fallbackStop;
    assertKillAttempted(fallbackSpawn.child, "SIGTERM", "fallback stop did not attempt SIGTERM");
    assertKillAttempted(fallbackSpawn.child, "SIGKILL", "fallback stop did not attempt SIGKILL");
    assert.ok(lspOutputLines.some((line) => line.includes("bounded kill fallback without process close")), "fallback stop did not report bounded fallback");

    const killFalseSpawn = startInitializedLsp();
    await delay();
    takeLspClientMessages(killFalseSpawn.child);
    killFalseSpawn.child.closeOnKill = false;
    killFalseSpawn.child.killReturnValue = false;
    const killFalseStop = stopYetAiLspClient(lspOutput);
    lspMessages = takeLspClientMessages(killFalseSpawn.child);
    emitLspResponse(killFalseSpawn.child, lspMessages[0].id, null);
    await killFalseStop;
    const killFalseText = lspOutputLines.join("\n");
    assert.equal(killFalseText.includes(lspDiagnosticSecret), false, "kill false diagnostic leaked secret");
    assert.equal(killFalseText.includes(lspDiagnosticPath), false, "kill false diagnostic leaked private path");
    assert.ok(lspOutputLines.some((line) => line.includes("termination was not accepted")), "kill false was not diagnosed");

    const killThrowSpawn = startInitializedLsp();
    await delay();
    takeLspClientMessages(killThrowSpawn.child);
    killThrowSpawn.child.closeOnKill = false;
    killThrowSpawn.child.killThrows = true;
    const killThrowStop = stopYetAiLspClient(lspOutput);
    lspMessages = takeLspClientMessages(killThrowSpawn.child);
    emitLspResponse(killThrowSpawn.child, lspMessages[0].id, null);
    await killThrowStop;
    const killThrowText = lspOutputLines.join("\n");
    assert.equal(killThrowText.includes(lspDiagnosticSecret), false, "kill throw diagnostic leaked secret");
    assert.equal(killThrowText.includes(lspDiagnosticPath), false, "kill throw diagnostic leaked private path");
    assert.ok(lspOutputLines.some((line) => line.includes("termination failed")), "kill throw was not diagnosed");

    const toggleSpawnStart = lspSpawns.length;
    const toggleContext = { ...fakeContext, extensionPath: process.cwd(), extensionUri: { fsPath: process.cwd(), path: process.cwd(), scheme: "file", toString: () => process.cwd() }, subscriptions: [] };
    configValues = {
      "lsp.enabled": false,
      engineBinaryPath: executable,
    };
    extensionModule.activate(toggleContext);
    await delay();
    assert.equal(lspSpawns.length, toggleSpawnStart, "disabled activation unexpectedly spawned LSP");
    configValues = {
      "lsp.enabled": true,
      engineBinaryPath: executable,
    };
    workspaceConfigurationListeners.at(-1)({ affectsConfiguration(name) { return name === "yetai.lsp.enabled"; } });
    await delay();
    assert.equal(lspSpawns.length, toggleSpawnStart + 1, "LSP setting enable did not spawn client");
    const toggleStopChild = lspSpawns[toggleSpawnStart].child;
    lspMessages = takeLspClientMessages(toggleStopChild);
    emitLspResponse(toggleStopChild, lspMessages[0].id, { capabilities: { textDocumentSync: 1, completionProvider: {} } });
    await delay();
    takeLspClientMessages(toggleStopChild);
    configValues = {
      "lsp.enabled": false,
      engineBinaryPath: executable,
    };
    workspaceConfigurationListeners.at(-1)({ affectsConfiguration(name) { return name === "yetai.lsp.enabled"; } });
    await delay();
    lspMessages = takeLspClientMessages(toggleStopChild);
    assert.equal(lspMessages[0].method, "shutdown", "LSP setting disable did not stop client");
    configValues = {
      "lsp.enabled": true,
      engineBinaryPath: executable,
    };
    workspaceConfigurationListeners.at(-1)({ affectsConfiguration(name) { return name === "yetai.lsp.enabled"; } });
    await delay();
    assert.equal(lspSpawns.length, toggleSpawnStart + 1, "serialized LSP enable spawned before prior stop completed");
    emitLspResponse(toggleStopChild, lspMessages[0].id, null);
    await delay();
    toggleStopChild.emit("close", 0, null);
    await delay();
    assert.equal(lspSpawns.length, toggleSpawnStart + 2, "serialized LSP enable did not spawn after prior stop completed");
    const deactivateChild = lspSpawns[toggleSpawnStart + 1].child;
    lspMessages = takeLspClientMessages(deactivateChild);
    emitLspResponse(deactivateChild, lspMessages[0].id, { capabilities: { textDocumentSync: 1, completionProvider: {} } });
    await delay();
    takeLspClientMessages(deactivateChild);
    deactivateChild.closeOnKill = false;
    const deactivatePromise = extensionModule.deactivate();
    let deactivateResolved = false;
    deactivatePromise.then(() => {
      deactivateResolved = true;
    });
    await delay();
    lspMessages = takeLspClientMessages(deactivateChild);
    assert.equal(lspMessages[0].method, "shutdown", "deactivate did not begin LSP stop");
    assert.equal(deactivateResolved, false, "deactivate resolved before LSP stop completed");
    emitLspResponse(deactivateChild, lspMessages[0].id, null);
    await delay();
    await deactivatePromise;
    assert.equal(deactivateResolved, true, "deactivate did not await LSP stop completion");
    assertKillAttempted(deactivateChild, "SIGTERM", "deactivate did not attempt bounded SIGTERM");
    assertKillAttempted(deactivateChild, "SIGKILL", "deactivate did not attempt bounded SIGKILL");
    childProcess.spawn = () => {
      throw new Error(`LSP spawn failed Authorization: Bearer ${lspDiagnosticSecret} ${lspDiagnosticPath}`);
    };
    configValues = {
      "lsp.enabled": true,
      engineBinaryPath: executable,
    };
    const lspFailureOutput = [];
    startYetAiLspClient({ ...fakeContext, extensionPath: tempRoot }, { engine: { binaryName: "yet-lsp" } }, { appendLine(line) { lspFailureOutput.push(line); } });
    const lspFailureText = lspFailureOutput.join("\n");
    assert.match(lspFailureText, /failed to start from yet-lsp-executable/);
    assert.equal(lspFailureText.includes(lspDiagnosticSecret), false, "LSP spawn failure leaked secret");
    assert.equal(lspFailureText.includes(lspDiagnosticPath), false, "LSP spawn failure leaked private path");
    childProcess.spawn = originalSpawn;

    configValues = {
      runtimeUrl: "http://127.0.0.1:8001",
      launchMode: "auto",
      engineBinaryPath: executable,
    };
    globalThis.fetch = async () => ({ ok: true, status: 200 });
    const diagnostics = await collectRuntimeDiagnostics(
      { ...fakeContext, extensionPath: tempRoot },
      { engine: { binaryName: "yet-lsp" } },
    );
    assert.match(diagnostics.engineBinaryStatus, /found configured binary: yet-lsp-executable/);
    assert.equal(diagnostics.engineBinaryStatus.includes(tempRoot), false, "diagnostics exposed a private temp path");
    assert.equal(diagnostics.engineBinaryStatus.includes(privateDirectory), false, "diagnostics exposed a private directory path");

    const staleConfiguredPath = path.join(privateDirectory, "missing-yet-lsp");
    configValues = {
      runtimeUrl: "https://127.0.0.1:8001",
      launchMode: "connect",
      engineBinaryPath: staleConfiguredPath,
    };
    let pingedConnectHttps = false;
    globalThis.fetch = async () => {
      pingedConnectHttps = true;
      return { ok: true, status: 200 };
    };
    const connectDiagnostics = await collectRuntimeDiagnostics(
      { ...fakeContext, extensionPath: tempRoot },
      { engine: { binaryName: "yet-lsp" } },
    );
    assert.equal(connectDiagnostics.engineBinaryStatus, "not checked in connect mode");
    assert.equal(connectDiagnostics.pingStatus, "passed");
    assert.equal(pingedConnectHttps, true);

    const { pinged: preparedConnectPinged, result: preparedConnectConnection } = await withPingStub(() =>
      prepareEngineConnection(
        { ...fakeContext, extensionPath: tempRoot },
        { engine: { binaryName: "yet-lsp" } },
        fakeOutputChannel(),
      ),
    );
    assert.equal(preparedConnectConnection.runtimeUrl, "https://127.0.0.1:8001");
    assert.equal(preparedConnectPinged, true);

    configValues = {
      runtimeUrl: "https://127.0.0.1:8001",
      launchMode: "launch",
      engineBinaryPath: executable,
    };
    let launchHttpsPinged = false;
    globalThis.fetch = async () => {
      launchHttpsPinged = true;
      return { ok: true, status: 200 };
    };
    const launchHttpsDiagnostics = await collectRuntimeDiagnostics(
      { ...fakeContext, extensionPath: tempRoot },
      { engine: { binaryName: "yet-lsp" } },
    );
    assert.match(launchHttpsDiagnostics.engineBinaryStatus, /found configured binary: yet-lsp-executable/);
    assert.match(launchHttpsDiagnostics.pingStatus, /^skipped: yetai\.runtimeUrl must use http/);
    assert.equal(launchHttpsPinged, false);

    configValues = {
      runtimeUrl: "http://127.0.0.1",
      launchMode: "launch",
      engineBinaryPath: executable,
    };
    let launchMissingPortPinged = false;
    globalThis.fetch = async () => {
      launchMissingPortPinged = true;
      return { ok: true, status: 200 };
    };
    const launchMissingPortDiagnostics = await collectRuntimeDiagnostics(
      { ...fakeContext, extensionPath: tempRoot },
      { engine: { binaryName: "yet-lsp" } },
    );
    assert.match(launchMissingPortDiagnostics.pingStatus, /^skipped: yetai\.runtimeUrl must include an explicit nonzero port/);
    assert.equal(launchMissingPortPinged, false);

    configValues = {
      runtimeUrl: "http://127.0.0.1:0",
      launchMode: "launch",
      engineBinaryPath: executable,
    };
    let launchZeroPortPinged = false;
    globalThis.fetch = async () => {
      launchZeroPortPinged = true;
      return { ok: true, status: 200 };
    };
    const launchZeroPortDiagnostics = await collectRuntimeDiagnostics(
      { ...fakeContext, extensionPath: tempRoot },
      { engine: { binaryName: "yet-lsp" } },
    );
    assert.match(launchZeroPortDiagnostics.pingStatus, /^skipped: yetai\.runtimeUrl must include an explicit nonzero port/);
    assert.equal(launchZeroPortPinged, false);

    configValues = {
      runtimeUrl: "https://127.0.0.1:8001",
      launchMode: "auto",
      engineBinaryPath: executable,
    };
    let autoHttpsPinged = false;
    globalThis.fetch = async () => {
      autoHttpsPinged = true;
      return { ok: true, status: 200 };
    };
    const autoHttpsDiagnostics = await collectRuntimeDiagnostics(
      { ...fakeContext, extensionPath: tempRoot },
      { engine: { binaryName: "yet-lsp" } },
    );
    assert.match(autoHttpsDiagnostics.engineBinaryStatus, /found configured binary: yet-lsp-executable/);
    assert.match(autoHttpsDiagnostics.pingStatus, /^skipped: yetai\.runtimeUrl must use http/);
    assert.equal(autoHttpsPinged, false);

    if (process.platform !== "win32") {
      configValues = {
        runtimeUrl: "http://127.0.0.1:8001",
        launchMode: "launch",
        engineBinaryPath: nonExecutable,
      };
      const { pinged: launchInvalidBinaryPinged, result: launchInvalidBinaryDiagnostics } = await withPingStub(() =>
        collectRuntimeDiagnostics(
          { ...fakeContext, extensionPath: tempRoot },
          { engine: { binaryName: "yet-lsp" } },
        ),
      );
      assert.match(launchInvalidBinaryDiagnostics.engineBinaryStatus, /^not usable: /);
      assert.equal(launchInvalidBinaryDiagnostics.engineBinaryStatus.includes(privateDirectory), false);
      assert.equal(launchInvalidBinaryDiagnostics.pingStatus, "skipped: engine binary not usable");
      assert.equal(launchInvalidBinaryPinged, false);

      configValues = {
        runtimeUrl: "http://127.0.0.1:8001",
        launchMode: "auto",
        engineBinaryPath: nonExecutable,
      };
      const { pinged: autoInvalidBinaryPinged, result: autoInvalidBinaryDiagnostics } = await withPingStub(() =>
        collectRuntimeDiagnostics(
          { ...fakeContext, extensionPath: tempRoot },
          { engine: { binaryName: "yet-lsp" } },
        ),
      );
      assert.match(autoInvalidBinaryDiagnostics.engineBinaryStatus, /^not usable: /);
      assert.equal(autoInvalidBinaryDiagnostics.pingStatus, "skipped: engine binary not usable");
      assert.equal(autoInvalidBinaryPinged, false);
    }

    configValues = {
      runtimeUrl: "http://127.0.0.1:8001?token=fake-runtime-url-secret",
      launchMode: "auto",
      engineBinaryPath: executable,
    };
    const { pinged: invalidRuntimeUrlPinged, result: invalidRuntimeUrlDiagnostics } = await withPingStub(() =>
      collectRuntimeDiagnostics(
        { ...fakeContext, extensionPath: tempRoot },
        { engine: { binaryName: "yet-lsp" } },
      ),
    );
    assert.equal(invalidRuntimeUrlDiagnostics.engineBinaryStatus, "not checked: runtime settings invalid");
    assert.doesNotMatch(invalidRuntimeUrlDiagnostics.engineBinaryStatus, /invalid configured path/);
    assert.match(invalidRuntimeUrlDiagnostics.pingStatus, /^skipped: yetai\.runtimeUrl must not include query parameters or fragments\./);
    assert.equal(invalidRuntimeUrlDiagnostics.pingStatus.includes("fake-runtime-url-secret"), false);
    assert.equal(invalidRuntimeUrlPinged, false);

    configValues = {
      runtimeUrl: "http://127.0.0.1:8001/foo?token=fake-runtime-url-secret",
      launchMode: "connect",
    };
    const { pinged: invalidRuntimePathPinged, result: invalidRuntimePathDiagnostics } = await withPingStub(() =>
      collectRuntimeDiagnostics(
        { ...fakeContext, extensionPath: tempRoot },
        { engine: { binaryName: "yet-lsp" } },
      ),
    );
    assert.equal(invalidRuntimePathDiagnostics.engineBinaryStatus, "not checked in connect mode");
    assert.match(invalidRuntimePathDiagnostics.pingStatus, /^skipped: yetai\.runtimeUrl must not include query parameters or fragments\./);
    assert.equal(invalidRuntimePathDiagnostics.pingStatus.includes("fake-runtime-url-secret"), false);
    assert.equal(invalidRuntimePathPinged, false);

    configValues = {
      runtimeUrl: "http://127.0.0.1:8001/fake-path-secret/..",
      launchMode: "connect",
    };
    const { pinged: invalidRuntimeCleanPathPinged, result: invalidRuntimeCleanPathDiagnostics } = await withPingStub(() =>
      collectRuntimeDiagnostics(
        { ...fakeContext, extensionPath: tempRoot },
        { engine: { binaryName: "yet-lsp" } },
      ),
    );
    assert.equal(invalidRuntimeCleanPathDiagnostics.engineBinaryStatus, "not checked in connect mode");
    assert.match(invalidRuntimeCleanPathDiagnostics.pingStatus, /^skipped: yetai\.runtimeUrl must not include a path\./);
    assert.equal(invalidRuntimeCleanPathDiagnostics.runtimeUrl, "http://127.0.0.1:8001/");
    assert.equal(invalidRuntimeCleanPathDiagnostics.pingStatus.includes("fake-path-secret"), false);
    assert.equal(invalidRuntimeCleanPathDiagnostics.runtimeUrl.includes("fake-path-secret"), false);
    assert.equal(invalidRuntimeCleanPathPinged, false);

    const emptyPath = path.join(tempRoot, "empty-path");
    fs.mkdirSync(emptyPath);
    configValues = {
      runtimeUrl: "http://127.0.0.1:8001",
      launchMode: "auto",
      engineBinaryPath: "",
    };
    const previousPath = process.env.PATH;
    process.env.PATH = emptyPath;
    try {
      const { pinged: autoFallbackPinged, result: autoFallbackDiagnostics } = await withPingStub(() =>
        collectRuntimeDiagnostics(
          { ...fakeContext, extensionPath: tempRoot },
          { engine: { binaryName: "yet-lsp" } },
        ),
      );
      assert.equal(autoFallbackDiagnostics.engineBinaryStatus, "not found; connect-only fallback");
      assert.equal(autoFallbackDiagnostics.pingStatus, "passed");
      assert.equal(autoFallbackPinged, true);
      assert.equal(autoFallbackDiagnostics.guidance.includes("connect-only mode"), true);
      assert.equal(autoFallbackDiagnostics.pluginLaunchedProcessStatus, "not running");
      const renderedAutoFallback = formatRuntimeDiagnostics(autoFallbackDiagnostics);
      assert.match(renderedAutoFallback, /Yet AI Runtime Status/);
      assert.match(renderedAutoFallback, /Guidance: Auto mode launches/);
    } finally {
      process.env.PATH = previousPath;
    }
    const spawnedProcesses = [];
    childProcess.spawn = (command, args, options) => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.killed = false;
      child.kill = () => {
        child.killed = true;
        child.emit("exit", null, "SIGTERM");
        return true;
      };
      spawnedProcesses.push({ command, args, options, child });
      return child;
    };

    async function prepareWithLaunchMode(launchMode, runtimeUrl) {
      configValues = {
        runtimeUrl,
        launchMode,
        engineBinaryPath: executable,
        sessionToken: "legacy-token-must-not-be-used-for-launched-runtime",
      };
      const pingAuthorizations = [];
      globalThis.fetch = async (_url, options = {}) => {
        pingAuthorizations.push(options.headers?.Authorization);
        return { ok: true, status: 200 };
      };
      const connection = await prepareEngineConnection(
        { ...fakeContext, extensionPath: tempRoot },
        { engine: { binaryName: "yet-lsp" } },
        fakeOutputChannel(),
      );
      return { connection, pingAuthorizations };
    }

    const autoLaunch = await prepareWithLaunchMode("auto", "http://127.0.0.1:8765");
    assert.equal(spawnedProcesses.length, 1);
    assert.equal(spawnedProcesses[0].command, executable);
    assert.deepEqual(spawnedProcesses[0].args, []);
    assert.equal(spawnedProcesses[0].options.env.YET_AI_HTTP_PORT, "8765");
    assert.equal(typeof spawnedProcesses[0].options.env.YET_AI_AUTH_TOKEN, "string");
    assert.ok(spawnedProcesses[0].options.env.YET_AI_AUTH_TOKEN.length >= 32);
    assert.notEqual(spawnedProcesses[0].options.env.YET_AI_AUTH_TOKEN, "legacy-token-must-not-be-used-for-launched-runtime");
    assert.equal(autoLaunch.connection.runtimeUrl, "http://127.0.0.1:8765");
    assert.equal(autoLaunch.connection.sessionToken, spawnedProcesses[0].options.env.YET_AI_AUTH_TOKEN);
    assert.deepEqual(autoLaunch.pingAuthorizations, [`Bearer ${autoLaunch.connection.sessionToken}`]);

    const reusedAutoLaunch = await prepareWithLaunchMode("auto", "http://127.0.0.1:8765");
    assert.equal(spawnedProcesses.length, 1);
    assert.equal(reusedAutoLaunch.connection.sessionToken, autoLaunch.connection.sessionToken);
    assert.deepEqual(reusedAutoLaunch.pingAuthorizations, [`Bearer ${autoLaunch.connection.sessionToken}`]);

    const explicitLaunch = await prepareWithLaunchMode("launch", "http://127.0.0.1:9876");
    assert.equal(spawnedProcesses.length, 2);
    assert.equal(spawnedProcesses[0].child.killed, true);
    assert.equal(spawnedProcesses[1].command, executable);
    assert.equal(spawnedProcesses[1].options.env.YET_AI_HTTP_PORT, "9876");
    assert.equal(explicitLaunch.connection.sessionToken, spawnedProcesses[1].options.env.YET_AI_AUTH_TOKEN);
    assert.notEqual(explicitLaunch.connection.sessionToken, autoLaunch.connection.sessionToken);
    assert.deepEqual(explicitLaunch.pingAuthorizations, [`Bearer ${explicitLaunch.connection.sessionToken}`]);

    const outputErrorLines = [];
    const processErrorSecret = "process-error-session-sentinel";
    const processErrorOutput = { appendLine(line) { outputErrorLines.push(line); } };
    childProcess.spawn = (command, args, options) => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.killed = false;
      child.kill = () => true;
      setImmediate(() => child.emit("error", new Error(`process error ${processErrorSecret} ${executable} /Users/private/runtime.sock`)));
      return child;
    };
    configValues = {
      runtimeUrl: "http://127.0.0.1:7766",
      launchMode: "launch",
      engineBinaryPath: executable,
    };
    globalThis.fetch = async () => ({ ok: true, status: 200 });
    await prepareEngineConnection(
      { ...fakeContext, extensionPath: tempRoot },
      { engine: { binaryName: "yet-lsp" } },
      processErrorOutput,
    );
    await new Promise((resolve) => setImmediate(resolve));
    const processErrorText = outputErrorLines.join("\n");
    assert.equal(processErrorText.includes(processErrorSecret), false, "process error leaked secret");
    assert.equal(processErrorText.includes(privateDirectory), false, "process error leaked private path");
    assert.match(processErrorText, /yet-lsp-executable/);

    childProcess.spawn = () => {
      throw new Error(`EACCES ${executable} Authorization: Bearer thrown-spawn-secret /Users/private/runtime.sock`);
    };
    configValues = {
      runtimeUrl: "http://127.0.0.1:8899",
      launchMode: "launch",
      engineBinaryPath: executable,
    };
    await assert.rejects(
      () => prepareEngineConnection(
        { ...fakeContext, extensionPath: tempRoot },
        { engine: { binaryName: "yet-lsp" } },
        fakeOutputChannel(),
      ),
      (error) => {
        assert.equal(error.message.includes("thrown-spawn-secret"), false, error.message);
        assert.equal(error.message.includes(privateDirectory), false, error.message);
        assert.equal(error.message.includes("/Users/private/runtime.sock"), false, error.message);
        assert.match(error.message, /Could not start Yet AI local runtime from yet-lsp-executable/);
        return true;
      },
    );

    childProcess.spawn = originalSpawn;

    configValues = {
      runtimeUrl: "http://127.0.0.1:8001",
      launchMode: "connect",
      sessionToken: "legacy-connect-session-token",
    };
    let secretStorageReads = 0;
    const secretStorageContext = {
      ...fakeContext,
      extensionPath: tempRoot,
      secrets: {
        async get(key) {
          secretStorageReads += 1;
          assert.equal(key, "yetai.localRuntimeSessionToken");
          return "secret-storage-connect-session-token";
        },
      },
    };
    globalThis.fetch = async (_url, options = {}) => {
      assert.equal(options.headers?.Authorization, "Bearer secret-storage-connect-session-token");
      return { ok: true, status: 200 };
    };
    const secretStorageConnect = await prepareEngineConnection(
      secretStorageContext,
      { engine: { binaryName: "yet-lsp" } },
      fakeOutputChannel(),
    );
    assert.equal(secretStorageConnect.sessionToken, "secret-storage-connect-session-token");
    assert.equal(secretStorageReads, 1);
    assert.equal(spawnedProcesses.length, 2);

    configValues = {
      runtimeUrl: "http://127.0.0.1:8001",
      launchMode: "connect",
      sessionToken: "legacy-connect-session-token",
    };
    const outputLines = [];
    globalThis.fetch = async (_url, options = {}) => {
      assert.equal(options.headers?.Authorization, "Bearer legacy-connect-session-token");
      return { ok: true, status: 200 };
    };
    const legacyConnect = await prepareEngineConnection(
      { ...fakeContext, extensionPath: tempRoot },
      { engine: { binaryName: "yet-lsp" } },
      { appendLine(line) { outputLines.push(line); } },
    );
    assert.equal(legacyConnect.sessionToken, "legacy-connect-session-token");
    assert.equal(spawnedProcesses.length, 2);
    assert.ok(outputLines.some((line) => line.includes("sessionToken is deprecated")));
  } finally {
    configValues = {};
    childProcess.spawn = originalSpawn;
    globalThis.fetch = originalFetch;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
} finally {
  globalThis.fetch = originalFetch;
  childProcess.spawn = originalSpawn;
  Module._load = originalLoad;
}
