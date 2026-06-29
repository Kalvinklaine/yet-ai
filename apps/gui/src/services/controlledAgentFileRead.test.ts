import { describe, expect, it } from "vitest";
import blockedFixture from "../../../../packages/contracts/examples/engine/controlled-agent-file-read-blocked.json";
import disabledFixture from "../../../../packages/contracts/examples/engine/controlled-agent-file-read-disabled.json";
import successFixture from "../../../../packages/contracts/examples/engine/controlled-agent-file-read-success.json";
import truncatedFixture from "../../../../packages/contracts/examples/engine/controlled-agent-file-read-truncated.json";
import { evaluateControlledAgentFileRead } from "./controlledAgentFileRead";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function authorityValues(result: ReturnType<typeof evaluateControlledAgentFileRead>): boolean[] {
  return [
    result.canReadHiddenFiles,
    result.canSearchWorkspace,
    result.canRunCommands,
    result.canWriteFiles,
    result.canUseGit,
    result.canCallProvider,
    result.canUseTools,
  ];
}

describe("evaluateControlledAgentFileRead", () => {
  it("returns disabled for absent metadata without granting authority", () => {
    const result = evaluateControlledAgentFileRead(undefined);

    expect(result.state).toBe("disabled");
    expect(result.allowedToRead).toBe(false);
    expect(authorityValues(result).every((value) => value === false)).toBe(true);
    expect(result.preview).toBeUndefined();
  });

  it("allows a safe bounded text read summary with preview metadata only", () => {
    const result = evaluateControlledAgentFileRead(clone(successFixture));

    expect(result.state).toBe("success");
    expect(result.allowedToRead).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.preview).toEqual({
      pathLabel: "docs/architecture/013-agent-readiness-milestone.md",
      byteCount: 72,
      lineCount: 2,
      contentHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      truncated: false,
      text: "# 013 Agent Run Readiness Milestone\n\nThis bounded excerpt is explicit.",
    });
    expect(authorityValues(result).every((value) => value === false)).toBe(true);
  });

  it("allows truncated metadata only when the bounded truncated result is explicit", () => {
    const result = evaluateControlledAgentFileRead(clone(truncatedFixture));

    expect(result.state).toBe("truncated");
    expect(result.allowedToRead).toBe(true);
    expect(result.preview?.truncated).toBe(true);
    expect(result.preview?.byteCount).toBe(256);
    expect(result.preview?.lineCount).toBe(8);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps disabled and blocked fixture states non-readable", () => {
    const disabled = evaluateControlledAgentFileRead(clone(disabledFixture));
    const blocked = evaluateControlledAgentFileRead(clone(blockedFixture));

    expect(disabled.state).toBe("disabled");
    expect(disabled.allowedToRead).toBe(false);
    expect(disabled.preview).toBeUndefined();
    expect(blocked.state).toBe("blocked");
    expect(blocked.allowedToRead).toBe(false);
    expect(blocked.preview).toBeUndefined();
    expect(authorityValues(disabled).every((value) => value === false)).toBe(true);
    expect(authorityValues(blocked).every((value) => value === false)).toBe(true);
  });

  it.each([
    ["absolute path", "/Users/alice/project/src/file.ts", "unsafe_path"],
    ["traversal path", "src/../secret.ts", "unsafe_path"],
    ["hidden path", "src/.env", "unsafe_path"],
    ["secret path", "src/api-token.ts", "unsafe_path"],
    ["generated path", "dist/app.js", "unsafe_path"],
    ["dependency path", "node_modules/pkg/index.js", "unsafe_path"],
    ["glob path", "src/*.ts", "unsafe_path"],
    ["regex path", "src/(.*).ts", "unsafe_path"],
  ])("blocks unsafe %s", (_label, path, code) => {
    const input = clone(successFixture) as any;
    input.request.workspaceRelativePath = path;
    input.result.sanitizedPathLabel = path;

    const result = evaluateControlledAgentFileRead(input);

    expect(result.state).toBe("blocked");
    expect(result.allowedToRead).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain(code);
    expect(result.preview).toBeUndefined();
  });

  it("rejects assistant authority, command fields, and widened policy flags", () => {
    const input = clone(successFixture) as any;
    input.request.assistantMinted = true;
    input.request.requestId = "assistant-read-1";
    input.command = "cat docs/architecture/013-agent-readiness-milestone.md";
    input.policyFlags.shellAllowed = true;
    input.policyFlags.gitAllowed = true;

    const result = evaluateControlledAgentFileRead(input);

    expect(result.state).toBe("blocked");
    expect(result.allowedToRead).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["assistant_authority", "unknown_or_invalid_field", "unsafe_metadata", "invalid_authority"]));
    expect(authorityValues(result).every((value) => value === false)).toBe(true);
  });

  it("rejects search indexing binary symlink and unbounded read fields", () => {
    const input = clone(successFixture) as any;
    input.request.budget.recursive = true;
    input.request.budget.globAllowed = true;
    input.request.budget.regexAllowed = true;
    input.request.budget.indexingAllowed = true;
    input.policyFlags.hiddenSearchAllowed = true;
    input.policyFlags.binaryReadAllowed = true;
    input.policyFlags.symlinkAllowed = true;

    const result = evaluateControlledAgentFileRead(input);

    expect(result.state).toBe("blocked");
    expect(result.allowedToRead).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["unbounded_request", "invalid_authority"]));
    expect(result.preview).toBeUndefined();
  });

  it("rejects body when body is not allowed or returned for blocked states", () => {
    const disallowedBody = clone(successFixture) as any;
    disallowedBody.request.budget.allowBody = false;
    const blockedWithBody = clone(blockedFixture) as any;
    blockedWithBody.result.bodyIncluded = true;
    blockedWithBody.result.text = "Not allowed";

    const disallowedBodyResult = evaluateControlledAgentFileRead(disallowedBody);
    const blockedWithBodyResult = evaluateControlledAgentFileRead(blockedWithBody);

    expect(disallowedBodyResult.state).toBe("blocked");
    expect(disallowedBodyResult.allowedToRead).toBe(false);
    expect(disallowedBodyResult.diagnostics.map((item) => item.code)).toContain("invalid_authority");
    expect(blockedWithBodyResult.state).toBe("blocked");
    expect(blockedWithBodyResult.allowedToRead).toBe(false);
    expect(blockedWithBodyResult.diagnostics.map((item) => item.code)).toContain("invalid_authority");
  });

  it("rejects oversized and unsafe bodies without echoing secrets", () => {
    const oversized = clone(successFixture) as any;
    oversized.request.maxBytes = 16;
    oversized.request.budget.maxBytes = 16;
    oversized.result.byteCount = 17;
    oversized.result.text = "Authorization: Bearer abcdefghijklmnopqrstuvwxyz sk-secret123456789";

    const result = evaluateControlledAgentFileRead(oversized);
    const rendered = JSON.stringify(result);

    expect(result.state).toBe("blocked");
    expect(result.allowedToRead).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain("unsafe_body");
    expect(result.preview).toBeUndefined();
    expect(rendered).toContain("[redacted]");
    expect(rendered).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(rendered).not.toContain("sk-secret123456789");
  });

  it("does not write browser storage while evaluating metadata", () => {
    localStorage.clear();
    sessionStorage.clear();

    const result = evaluateControlledAgentFileRead(clone(successFixture));

    expect(result.state).toBe("success");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
