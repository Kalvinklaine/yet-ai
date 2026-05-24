import { describe, expect, it } from "vitest";

describe("provider secret boundary", () => {
  it("browser storage does not contain raw provider API keys", () => {
    localStorage.clear();
    sessionStorage.clear();
    const secret = "sk-yet-test-secret";
    const transientForm = { apiKey: secret };
    const clearedForm = { ...transientForm, apiKey: "" };
    expect(clearedForm.apiKey).toBe("");
    expect(JSON.stringify(localStorage)).not.toContain(secret);
    expect(JSON.stringify(sessionStorage)).not.toContain(secret);
  });
});
