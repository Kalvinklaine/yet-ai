import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Module from "node:module";

let configValues = {};
const originalFetch = globalThis.fetch;
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "vscode") {
    return {
      Uri: {
        parse(value) {
          return { href: value, toString: () => value };
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
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

try {
  const {
    collectRuntimeDiagnostics,
    createEngineLogRedactor,
    findEngineBinary,
    formatStartedRuntimeMessage,
    pingEngineOnce,
    redactRuntimeDiagnosticText,
    resolveSessionToken,
    safeRuntimeUrl,
    setStoredSessionToken,
    validateEngineConnectionSettings,
    validateLoopbackUrl,
    validateRuntimeLaunchProtocol,
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
    "http://127.0.0.1:8001/path",
  );
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
  ];
  for (const forbidden of forbiddenValues) {
    assert.equal(diagnostic.includes(forbidden), false, `diagnostics leaked ${forbidden}`);
  }

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
  } finally {
    configValues = {};
    globalThis.fetch = originalFetch;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
} finally {
  globalThis.fetch = originalFetch;
  Module._load = originalLoad;
}
