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
    findEngineBinary,
    redactRuntimeDiagnosticText,
    resolveSessionToken,
    safeRuntimeUrl,
    setStoredSessionToken,
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

  const secretOperations = [];
  const fakeContext = {
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
  const diagnostic = redactRuntimeDiagnosticText(
    `ping failed with ${fakeBearer} and ${fakeSessionToken} and ${fakeApiKey}`,
    fakeSessionToken,
  );
  for (const forbidden of [fakeSessionToken, fakeApiKey, fakeBearer, "fake-bearer-session-sentinel"]) {
    assert.equal(diagnostic.includes(forbidden), false, `diagnostics leaked ${forbidden}`);
  }


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
  } finally {
    configValues = {};
    globalThis.fetch = originalFetch;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
} finally {
  globalThis.fetch = originalFetch;
  Module._load = originalLoad;
}
