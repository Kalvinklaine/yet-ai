import { describe, expect, it } from "vitest";
import { isRawContentLikeKey, isSecretLikeKey, redactSecrets, sanitizeDisplayText, sanitizeDisplayValue, sanitizeTimelineText } from "./redaction";

const longOpaque = "a".repeat(64);

function expectRedacted(input: string, rawFragments: string[]) {
  const output = redactSecrets(input);
  expect(output).toContain("[redacted]");
  for (const fragment of rawFragments) {
    expect(output).not.toContain(fragment);
  }
}

describe("redaction", () => {
  it("redacts full auth and proxy auth headers", () => {
    expectRedacted("Authorization: Bearer short-secret\nProxy-Authorization: Bearer proxy-secret", ["Bearer short-secret", "Bearer proxy-secret"]);
  });

  it("redacts multi-cookie and set-cookie headers", () => {
    expectRedacted("Cookie: session=secret; refresh=also-secret\nSet-Cookie: sid=secret; HttpOnly", ["session=secret", "refresh=also-secret", "sid=secret"]);
  });

  it("redacts cookie-like key value strings", () => {
    const cases: Array<[string, string[]]> = [
      ["cookie=session=secret; refresh=also-secret", ["session=secret", "refresh=also-secret"]],
      ["set_cookie=sid=secret; refresh=also-secret", ["sid=secret", "refresh=also-secret"]],
      ["set-cookie=sid=secret; Path=/; HttpOnly; refresh=also-secret", ["sid=secret", "Path=/", "HttpOnly", "refresh=also-secret"]],
      ["setCookie=sid=secret; refresh=also-secret", ["sid=secret", "refresh=also-secret"]],
      ["setCookie: sid=secret; refresh=also-secret", ["sid=secret", "refresh=also-secret"]],
      ["Cookie=session=secret; Refresh=also-secret", ["session=secret", "Refresh=also-secret"]],
    ];
    for (const [input, rawFragments] of cases) {
      expectRedacted(input, rawFragments);
    }
  });

  it("redacts env-style secret keys", () => {
    expectRedacted("OPENAI_API_KEY=oa-secret ANTHROPIC_API_KEY=anthropic GITHUB_TOKEN=gh YET_AI_AUTH_TOKEN=yet OAUTH_REFRESH_TOKEN=refresh PROVIDER_CLIENT_SECRET=client", ["oa-secret", "anthropic", "GITHUB_TOKEN", "refresh", "client"]);
  });

  it("redacts URL query secret params", () => {
    expectRedacted(`https://x.test/cb?api_key=short-secret&access_token=${longOpaque};code_verifier=verifier-secret&ok=1`, ["short-secret", longOpaque, "verifier-secret", "api_key", "access_token", "code_verifier"]);
  });

  it("redacts setCookie URL params", () => {
    const cases: Array<[string, string[]]> = [
      ["https://x.test/cb?setCookie=sid=secret&ok=1", ["setCookie", "sid=secret"]],
      ["https://x.test/cb?ok=1&setCookie=sid=secret", ["setCookie", "sid=secret"]],
      ["https://x.test/cb;setCookie=sid=secret", ["setCookie", "sid=secret"]],
    ];
    for (const [input, rawFragments] of cases) {
      expectRedacted(input, rawFragments);
    }
  });

  it("redacts JSON and string fields", () => {
    expectRedacted(`{"access_token":"short","clientSecret":"tiny","safe":"ok"} authorization=Bearer-secret`, ["access_token", "short", "clientSecret", "tiny", "Bearer-secret"]);
  });

  it("redacts authorization key value bearer forms", () => {
    expectRedacted("authorization=Bearer short-secret proxy_authorization=Bearer proxy-secret authorization: Bearer short-secret", ["Bearer short-secret", "Bearer proxy-secret", "short-secret", "proxy-secret"]);
  });

  it("redacts JSON primitive secret fields and set-cookie variants", () => {
    expectRedacted(`{"access_token":123456} {"apiKey":true} {"refreshToken":null} {"setCookie":"sid=secret; refresh=also-secret"} {"set_cookie":"sid=secret"} {"set-cookie":"sid=secret"}`, ["access_token", "123456", "apiKey", "true", "refreshToken", "null", "setCookie", "set_cookie", "set-cookie", "sid=secret", "refresh=also-secret"]);
  });

  it("redacts object secret-like keys and values", () => {
    expect(sanitizeDisplayValue({ accessToken: "short", nested: { clientSecret: "tiny" }, safe: "ok" })).toEqual({ "[redacted]": "[redacted]", nested: { "[redacted]": "[redacted]" }, safe: "ok" });
    expect(sanitizeDisplayValue({ setCookie: "sid=secret; refresh=also-secret" })).toEqual({ "[redacted]": "[redacted]" });
    expect(isSecretLikeKey("PROVIDER_CLIENT_SECRET")).toBe(true);
  });

  it("redacts structured raw-content object values", () => {
    const rawFragments = ["PROMPT_SENTINEL", "PROVIDER_SENTINEL", "BODY_SENTINEL", "FILE_SENTINEL", "WORKSPACE_SENTINEL", "THOUGHT_SENTINEL", "BOARD_SENTINEL", "TOOL_SENTINEL", "RAW_TOOL_SENTINEL", "RAW_OUTPUT_SENTINEL", "RAW_DUMP_SENTINEL", "JSON_SENTINEL"];
    const value = {
      message: "safe status message",
      phase: "running_command",
      status: "failed",
      cardId: "T-330",
      rawPrompt: { nested: "PROMPT_SENTINEL" },
      provider_response: ["PROVIDER_SENTINEL"],
      "provider-body": { body: "BODY_SENTINEL" },
      fileContent: "FILE_SENTINEL",
      workspace_contents: { text: "WORKSPACE_SENTINEL" },
      chainOfThought: { steps: ["THOUGHT_SENTINEL"] },
      taskBoardDump: { cards: [{ title: "BOARD_SENTINEL" }] },
      toolRawOutput: "TOOL_SENTINEL",
      rawToolOutput: { nested: "RAW_TOOL_SENTINEL" },
      raw_tool_output: { nested: "RAW_TOOL_SENTINEL" },
      rawOutput: { nested: "RAW_OUTPUT_SENTINEL" },
      rawDump: { nested: "RAW_DUMP_SENTINEL" },
      fullBoardJson: { raw: "JSON_SENTINEL" },
    };

    const sanitized = sanitizeDisplayValue(value);
    const rendered = JSON.stringify(sanitized);

    expect(rendered).toContain("safe status message");
    expect(rendered).toContain("running_command");
    expect(rendered).toContain("failed");
    expect(rendered).toContain("T-330");
    expect(rendered).toContain("[redacted]");
    for (const fragment of rawFragments) {
      expect(rendered).not.toContain(fragment);
    }
    expect(isRawContentLikeKey("provider.body")).toBe(true);
    expect(isRawContentLikeKey("rawToolOutput")).toBe(true);
    expect(isRawContentLikeKey("raw_tool_output")).toBe(true);
    expect(isRawContentLikeKey("rawOutput")).toBe(true);
    expect(isRawContentLikeKey("rawDump")).toBe(true);
  });

  it("bounds structured display traversal globally", () => {
    const value = Object.fromEntries(Array.from({ length: 50 }, (_, outer) => [
      `outer${outer}`,
      Object.fromEntries(Array.from({ length: 50 }, (_, inner) => [`inner${inner}`, `GLOBAL_BUDGET_SENTINEL_${outer}_${inner}`])),
    ]));

    const rendered = JSON.stringify(sanitizeDisplayValue(value));

    expect(rendered).toContain("[redacted]");
    expect(rendered).toContain("GLOBAL_BUDGET_SENTINEL_0_0");
    expect(rendered).not.toContain("GLOBAL_BUDGET_SENTINEL_49_49");
    expect(rendered.length).toBeLessThan(22000);
  });

  it("bounds structured display arrays and objects", () => {
    const sanitizedArray = sanitizeDisplayValue(Array.from({ length: 60 }, (_, index) => `item-${index}`));
    const sanitizedObject = sanitizeDisplayValue(Object.fromEntries(Array.from({ length: 60 }, (_, index) => [`key${index}`, `value-${index}`])));

    expect(Array.isArray(sanitizedArray)).toBe(true);
    expect(sanitizedArray).toHaveLength(51);
    expect(JSON.stringify(sanitizedArray)).toContain("10 more items redacted");
    expect(Object.keys(sanitizedObject as Record<string, unknown>)).toHaveLength(51);
    expect(JSON.stringify(sanitizedObject)).toContain("10 more fields redacted");
  });

  it("redacts raw content label bodies", () => {
    const rawFragments = ["SECRET_PROMPT_BODY", "SECRET_PROVIDER_BODY", "SECRET_FILE_BODY", "SECRET_WORKSPACE_BODY", "SECRET_THOUGHT_BODY"];
    expectRedacted([
      "raw prompt: SECRET_PROMPT_BODY",
      "provider response SECRET_PROVIDER_BODY",
      "file content=SECRET_FILE_BODY",
      "workspace contents: SECRET_WORKSPACE_BODY",
      "chain of thought SECRET_THOUGHT_BODY",
    ].join("\n"), rawFragments);
  });

  it("redacts credential paths and markers", () => {
    expectRedacted("auth.json .codex/auth.json .codex\\auth.json ./.codex/auth.json ../.codex/auth.json /Users/alice/.codex/auth.json C:\\Users\\alice\\.codex\\auth.json", ["auth.json", ".codex", "Users", "alice"]);
  });

  it("redacts credential paths with spaces", () => {
    expectRedacted("/Users/Alice Smith/.codex/auth.json C:\\Users\\Alice Smith\\.codex\\auth.json /Users/Alice Smith/auth.json C:\\Users\\Alice Smith\\auth.json", ["Alice Smith", ".codex", "auth.json"]);
  });

  it("redacts broader private path and token patterns from runtime traces", () => {
    const rawToken = "runtime-token-" + "z".repeat(48);
    expectRedacted(`runtime.fetch.failure /private/tmp/yet-ai/socket ${rawToken} /Volumes/Secret Drive/auth.json`, ["/private/tmp", rawToken, "/Volumes", "auth.json"]);
  });

  it("redacts JWT sk keys and long opaque values", () => {
    const jwt = `${"a".repeat(16)}.${"b".repeat(16)}.${"c".repeat(16)}`;
    expectRedacted(`sk-secret123456789 ${jwt} ${longOpaque}`, ["sk-secret123456789", jwt, longOpaque]);
  });

  it("preserves display and timeline truncation behavior", () => {
    const shortText = "safe ".repeat(49);
    const timelineText = "safe ".repeat(401);
    expect(sanitizeDisplayText(shortText)).toHaveLength(241);
    expect(sanitizeDisplayText(shortText).endsWith("…")).toBe(true);
    expect(sanitizeTimelineText(timelineText)).toHaveLength(2001);
    expect(sanitizeTimelineText(timelineText).endsWith("…")).toBe(true);
  });
});
