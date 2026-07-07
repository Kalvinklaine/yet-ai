import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { isInvalidControlledLexicalSearchRequestMessage, parseControlledLexicalSearchRequest, runControlledLexicalSearchRequest } from "./controlledLexicalSearch";

async function main(): Promise<void> {
  await testSafeSearch();
  await testUnsafeQueryAndMalformedRequestsFailClosed();
  await testUnsafeHiddenDependencyAndGeneratedPathsFailClosed();
  await testBinarySecretAndPrivateSnippetsFailClosedOrSanitize();
  await testBoundsAndTruncation();
}

async function testSafeSearch(): Promise<void> {
  const workspace = await createWorkspace();
  await fs.mkdir(path.join(workspace, "src"), { recursive: true });
  await fs.writeFile(path.join(workspace, "src", "app.ts"), "alpha\nchat composer here\nomega\n", "utf8");

  const result = await runControlledLexicalSearchRequest(createRequest(["src/app.ts"], "chat composer"), [workspace]);

  assert.equal(result.type, "host.controlledAgentLexicalSearchResult");
  assert.equal(result.requestId, "search-safe");
  assert.equal(result.payload.status, "succeeded");
  assert.equal(result.payload.searchAllowed, true);
  assert.equal(result.payload.privatePathExposed, false);
  assert.equal(result.payload.rawContentIncluded, false);
  assert.equal(result.payload.policyFlags.indexingAllowed, false);
  assert.equal(result.payload.policyFlags.shellAllowed, false);
  assert.equal(result.payload.resultCount, 1);
  assert.equal(result.payload.snippets[0].pathLabel, "src/app.ts");
  assert.equal(result.payload.snippets[0].languageId, "typescript");
  assert.match(result.payload.snippets[0].snippet, /chat composer/);
  assert.equal(JSON.stringify(result).includes(workspace), false);
}

async function testUnsafeQueryAndMalformedRequestsFailClosed(): Promise<void> {
  const workspace = await createWorkspace();
  await fs.mkdir(path.join(workspace, "src"), { recursive: true });
  await fs.writeFile(path.join(workspace, "src", "app.ts"), "chat composer\n", "utf8");

  for (const query of ["", "../secret", "chat.*", "api_key", "shell command", "raw output", "/Users/private"]) {
    const message = createRequest(["src/app.ts"], query);
    assert.equal(parseControlledLexicalSearchRequest(message), undefined, query);
    const result = await runControlledLexicalSearchRequest(message, [workspace]);
    assert.equal(result.payload.status, "blocked", query);
    assert.equal(result.payload.searchAllowed, false, query);
    assert.equal(result.payload.snippets.length, 0, query);
  }

  const malformed = { version: "2026-05-15", type: "gui.controlledAgentLexicalSearchRequest", requestId: "search-bad", payload: { requestId: "search-bad" } };
  assert.equal(isInvalidControlledLexicalSearchRequestMessage(malformed), true);
  const result = await runControlledLexicalSearchRequest(malformed as never, [workspace]);
  assert.equal(result.payload.status, "blocked");
  assert.equal(result.payload.blockedReason, "policy_denied");
}

async function testUnsafeHiddenDependencyAndGeneratedPathsFailClosed(): Promise<void> {
  const workspace = await createWorkspace();
  for (const unsafePath of [".hidden/file.ts", "src/.hidden.ts", "node_modules/pkg/index.js", "vendor/lib.txt", "dist/app.js", "build/app.js", "src/api_key.txt", "/src/app.ts", "../src/app.ts"]) {
    const result = await runControlledLexicalSearchRequest(createRequest([unsafePath], "needle"), [workspace]);
    assert.equal(result.payload.status, "blocked", unsafePath);
    assert.equal(result.payload.searchAllowed, false, unsafePath);
    assert.equal(result.payload.snippets.length, 0, unsafePath);
  }
}

async function testBinarySecretAndPrivateSnippetsFailClosedOrSanitize(): Promise<void> {
  const workspace = await createWorkspace();
  await fs.mkdir(path.join(workspace, "src"), { recursive: true });
  await fs.writeFile(path.join(workspace, "src", "bin.txt"), Buffer.from([0, 1, 2]));
  await fs.writeFile(path.join(workspace, "src", "private.txt"), "needle /Users/private/project\n", "utf8");
  await fs.writeFile(path.join(workspace, "src", "secretish.txt"), "needle password value\n", "utf8");

  for (const workspaceRelativePath of ["src/bin.txt", "src/private.txt", "src/secretish.txt"]) {
    const result = await runControlledLexicalSearchRequest(createRequest([workspaceRelativePath], "needle"), [workspace]);
    assert.equal(result.payload.status, "blocked", workspaceRelativePath);
    assert.equal(result.payload.searchAllowed, false, workspaceRelativePath);
    assert.equal(result.payload.snippets.length, 0, workspaceRelativePath);
    assert.equal(JSON.stringify(result).includes("/Users/private"), false, workspaceRelativePath);
    assert.equal(JSON.stringify(result).includes("password value"), false, workspaceRelativePath);
  }
}

async function testBoundsAndTruncation(): Promise<void> {
  const workspace = await createWorkspace();
  await fs.mkdir(path.join(workspace, "src"), { recursive: true });
  await fs.writeFile(path.join(workspace, "src", "many.txt"), Array.from({ length: 10 }, (_, index) => `needle ${index} safe text`).join("\n"), "utf8");

  const result = await runControlledLexicalSearchRequest(createRequest(["src/many.txt"], "needle", { maxMatches: 3, maxSnippetBytes: 20 }), [workspace]);

  assert.equal(result.payload.status, "truncated");
  assert.equal(result.payload.truncated, true);
  assert.equal(result.payload.resultCount, 3);
  assert.equal(result.payload.snippets.every((snippet) => snippet.snippetByteCount <= 20), true);
  assert.equal(result.payload.totalMatchCount, 10);
}

async function createWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "yet-ai-controlled-search-"));
}

function createRequest(includePathLabels: string[], query: string, limits: Partial<{ maxFilesScanned: number; maxMatches: number; maxSnippetBytes: number }> = {}): Parameters<typeof runControlledLexicalSearchRequest>[0] {
  return {
    version: "2026-05-15",
    type: "gui.controlledAgentLexicalSearchRequest",
    requestId: "search-safe",
    payload: {
      requestId: "search-safe",
      requestIdMintedBy: "gui",
      source: "gui",
      assistantMinted: false,
      controlledWorkspaceId: "workspace-search-safe",
      runId: "run-search-safe",
      runtimeSessionId: "runtime-search-safe",
      workspaceReadinessId: "ready-search-safe",
      explicitUserGesture: true,
      userGestureId: "gesture-search-safe",
      host: "vscode",
      query,
      queryMode: "literal_text",
      scope: {
        kind: "controlled_workspace_bounded",
        controlledWorkspaceOnly: true,
        includePathLabels,
        excludeHidden: true,
        excludeDependencies: true,
        excludeGenerated: true,
        excludeBinary: true,
        excludeSecretLikePaths: true,
        recursiveAllowed: false,
        broadWorkspaceScanAllowed: false,
      },
      limits: {
        maxFilesScanned: limits.maxFilesScanned ?? 40,
        maxMatches: limits.maxMatches ?? 10,
        maxSnippetBytes: limits.maxSnippetBytes ?? 400,
        literalOnly: true,
        regexAllowed: false,
        globAllowed: false,
        pathQueryAllowed: false,
        indexingAllowed: false,
        backgroundAllowed: false,
      },
      policyFlags: {
        explicitLiteralSearchAllowed: true,
        hiddenSearchAllowed: false,
        backgroundSearchAllowed: false,
        indexingAllowed: false,
        regexAllowed: false,
        globAllowed: false,
        pathQueryAllowed: false,
        broadWorkspaceScanAllowed: false,
        fileReadBodyAllowed: false,
        fileWriteAllowed: false,
        shellAllowed: false,
        gitAllowed: false,
        providerAllowed: false,
        toolAllowed: false,
        autoSearchAllowed: false,
        autoApplyAllowed: false,
        autoRunAllowed: false,
      },
    },
  };
}

void main();
