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
        getConfiguration() {
          return {
            get(key, defaultValue) {
              return Object.hasOwn(configValues, key) ? configValues[key] : defaultValue;
            },
          };
        },
        getWorkspaceFolder() { return undefined; },
        asRelativePath(uri) { return uri.fsPath ?? uri.path ?? String(uri); },
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

try {
  const extensionModule = await import("../out/extension.js");

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
  extensionModule.deactivate();

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

    const lspSpawns = [];
    const lspOutputLines = [];
    const lspOutput = { appendLine(line) { lspOutputLines.push(line); } };
    childProcess.spawn = (command, args, options) => {
      const child = new EventEmitter();
      child.stdin = { chunks: [], write(chunk) { this.chunks.push(chunk); return true; } };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.killed = false;
      child.kill = () => {
        child.killed = true;
        child.emit("exit", null, "SIGTERM");
        return true;
      };
      lspSpawns.push({ command, args, options, child });
      return child;
    };

    configValues = {
      "lsp.enabled": false,
      engineBinaryPath: executable,
    };
    startYetAiLspClient({ ...fakeContext, extensionPath: tempRoot }, { engine: { binaryName: "yet-lsp" } }, lspOutput);
    assert.equal(lspSpawns.length, 0, "disabled LSP setting launched a process");

    configValues = {
      "lsp.enabled": true,
      engineBinaryPath: executable,
      sessionToken: "legacy-lsp-token-must-not-be-used",
    };
    startYetAiLspClient({ ...fakeContext, extensionPath: tempRoot }, { engine: { binaryName: "yet-lsp" } }, lspOutput);
    assert.equal(lspSpawns.length, 1);
    assert.equal(lspSpawns[0].command, executable);
    assert.deepEqual(lspSpawns[0].args, ["--lsp-stdio"]);
    assert.equal(lspSpawns[0].options.env.YET_AI_AUTH_TOKEN, undefined);
    assert.equal(lspSpawns[0].options.env.OPENAI_API_KEY, undefined);
    assert.equal(lspSpawns[0].options.env.Authorization, undefined);
    const lspStdin = lspSpawns[0].child.stdin.chunks.join("");
    assert.match(lspStdin, /"method":"initialize"/);
    assert.match(lspStdin, /"didOpen":true/);
    assert.match(lspStdin, /"completion"/);
    assert.match(lspStdin, /"method":"initialized"/);
    assert.ok(lspOutputLines.some((line) => line.includes("Started Yet AI read-only LSP MVP from yet-lsp-executable.")));
    lspSpawns[0].child.stderr.emit("data", Buffer.from(`stderr Authorization: Bearer ${lspDiagnosticSecret} ${lspDiagnosticPath}`));
    assert.equal(lspOutputLines.join("\n").includes(lspDiagnosticSecret), false, "LSP stderr leaked secret");
    assert.equal(lspOutputLines.join("\n").includes(lspDiagnosticPath), false, "LSP stderr leaked private path");
    stopYetAiLspClient(lspOutput);
    assert.equal(lspSpawns[0].child.killed, true, "LSP deactivate cleanup did not stop process");
    assert.match(lspSpawns[0].child.stdin.chunks.join(""), /"method":"shutdown"/);
    assert.match(lspSpawns[0].child.stdin.chunks.join(""), /"method":"exit"/);

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
