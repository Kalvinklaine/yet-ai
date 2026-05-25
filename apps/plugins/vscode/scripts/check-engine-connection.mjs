import assert from "node:assert/strict";
import Module from "node:module";

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
          throw new Error("workspace configuration is not used by this check");
        },
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

try {
  const {
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
    secrets: {
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
} finally {
  Module._load = originalLoad;
}
