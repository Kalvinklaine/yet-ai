import { describe, expect, it } from "vitest";
import { buildVerificationFollowupPrompt, type VerificationResultForPrompt } from "./verificationFollowupPrompt";

function verificationResult(outputTail: string): VerificationResultForPrompt {
  return {
    status: "failed",
    message: "Verification failed.",
    cloudRequired: false,
    action: "runVerificationCommand",
    commandId: "gui-app-tests",
    exitCode: 1,
    durationMs: 25,
    outputTail,
    truncated: true,
  };
}

describe("buildVerificationFollowupPrompt", () => {
  it("builds bounded sanitized follow-up prompts without secret-like output", () => {
    const rawSecret = "access_token=" + "v".repeat(64);
    const oversized = "safe output line ".repeat(400);
    const prompt = buildVerificationFollowupPrompt(verificationResult(`failed /Users/alice/private/repo ${rawSecret}\nraw prompt: PROMPT_BODY\n${oversized}`), "followup");

    expect(prompt).toContain("Verification follow-up prompt");
    expect(prompt).toContain("Draft-only handoff");
    expect(prompt).toContain("It does not send chat, run commands, apply edits, attach context, save memory, or start repair automatically.");
    expect(prompt).toContain("Command id: gui-app-tests");
    expect(prompt).toContain("Status: failed");
    expect(prompt).toContain("Exit code: 1");
    expect(prompt).toContain("Output truncated: yes");
    expect(prompt).toContain("[redacted]");
    expect(prompt.length).toBeLessThan(1800);
    expect(prompt).not.toContain(rawSecret);
    expect(prompt).not.toContain("access_token");
    expect(prompt).not.toContain("/Users/alice");
    expect(prompt).not.toContain("PROMPT_BODY");
    expect((prompt.match(/safe output line/g) ?? []).length).toBeLessThan(90);
  });

  it("sanitizes command metadata before drafting fix prompts", () => {
    const result = verificationResult("all good");
    result.commandId = ("repository-check access_token=" + "c".repeat(64)) as VerificationResultForPrompt["commandId"];
    const prompt = buildVerificationFollowupPrompt(result, "fix");

    expect(prompt).toContain("Verification fix prompt");
    expect(prompt).toContain("Command id: repository-check [redacted]");
    expect(prompt).toContain("Suggest the smallest safe fix plan");
    expect(prompt).not.toContain("access_token");
    expect(prompt).not.toContain("c".repeat(64));
  });
});
