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
  const diagnostic = redactRuntimeDiagnosticText(
    `ping failed with ${fakeBearer} and ${fakeSessionToken} and ${fakeApiKey}`,
    fakeSessionToken,
  );
  for (const forbidden of [fakeSessionToken, fakeApiKey, fakeBearer, "fake-bearer-session-sentinel"]) {
    assert.equal(diagnostic.includes(forbidden), false, `diagnostics leaked ${forbidden}`);
  }
} finally {
  Module._load = originalLoad;
}
