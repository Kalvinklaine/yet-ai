import { describe, expect, it } from "vitest";
import { isSecretLikeKey, redactSecrets, sanitizeDisplayText, sanitizeDisplayValue, sanitizeTimelineText } from "./redaction";

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

  it("redacts env-style secret keys", () => {
    expectRedacted("OPENAI_API_KEY=oa-secret ANTHROPIC_API_KEY=anthropic GITHUB_TOKEN=gh YET_AI_AUTH_TOKEN=yet OAUTH_REFRESH_TOKEN=refresh PROVIDER_CLIENT_SECRET=client", ["oa-secret", "anthropic", "GITHUB_TOKEN", "refresh", "client"]);
  });

  it("redacts URL query secret params", () => {
    expectRedacted(`https://x.test/cb?api_key=short-secret&access_token=${longOpaque};code_verifier=verifier-secret&ok=1`, ["short-secret", longOpaque, "verifier-secret", "api_key", "access_token", "code_verifier"]);
  });

  it("redacts JSON and string fields", () => {
    expectRedacted(`{"access_token":"short","clientSecret":"tiny","safe":"ok"} authorization=Bearer-secret`, ["access_token", "short", "clientSecret", "tiny", "Bearer-secret"]);
  });

  it("redacts authorization key value bearer forms", () => {
    expectRedacted("authorization=Bearer short-secret proxy_authorization=Bearer proxy-secret authorization: Bearer short-secret", ["Bearer short-secret", "Bearer proxy-secret", "short-secret", "proxy-secret"]);
  });

  it("redacts JSON primitive secret fields and set-cookie variants", () => {
    expectRedacted(`{"access_token":123456} {"apiKey":true} {"refreshToken":null} {"setCookie":"sid=secret"} {"set_cookie":"sid=secret"} {"set-cookie":"sid=secret"}`, ["access_token", "123456", "apiKey", "true", "refreshToken", "null", "setCookie", "set_cookie", "set-cookie", "sid=secret"]);
  });

  it("redacts object secret-like keys and values", () => {
    expect(sanitizeDisplayValue({ accessToken: "short", nested: { clientSecret: "tiny" }, safe: "ok" })).toEqual({ "[redacted]": "[redacted]", nested: { "[redacted]": "[redacted]" }, safe: "ok" });
    expect(isSecretLikeKey("PROVIDER_CLIENT_SECRET")).toBe(true);
  });

  it("redacts credential paths and markers", () => {
    expectRedacted("auth.json .codex/auth.json .codex\\auth.json ./.codex/auth.json ../.codex/auth.json /Users/alice/.codex/auth.json C:\\Users\\alice\\.codex\\auth.json", ["auth.json", ".codex", "Users", "alice"]);
  });

  it("redacts credential paths with spaces", () => {
    expectRedacted("/Users/Alice Smith/.codex/auth.json C:\\Users\\Alice Smith\\.codex\\auth.json /Users/Alice Smith/auth.json C:\\Users\\Alice Smith\\auth.json", ["Alice Smith", ".codex", "auth.json"]);
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
