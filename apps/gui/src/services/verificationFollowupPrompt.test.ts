import { describe, expect, it } from "vitest";
import { buildVerificationFollowupPrompt, buildVerificationFollowupPromptDraft, type VerificationResultForPrompt } from "./verificationFollowupPrompt";

function verificationResult(outputTail: string, overrides: Partial<VerificationResultForPrompt> = {}): VerificationResultForPrompt {
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
    ...overrides,
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
    expect(prompt).toContain("Mode: followup");
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

  it("builds failed fix drafts with metadata-only authority and smallest safe fix guidance", () => {
    const draft = buildVerificationFollowupPromptDraft(verificationResult("assertion failed in visible test summary"), "fix");

    expect(draft.metadata).toMatchObject({
      kind: "agent_run.followup_prompt_draft",
      authority: "metadata_only",
      cloudRequired: false,
      executionAllowed: false,
      draftOnly: true,
      mode: "fix",
      verification: {
        commandId: "gui-app-tests",
        status: "failed",
        exitCode: 1,
        truncated: true,
      },
    });
    expect(draft.prompt).toContain("Suggest the smallest safe fix plan for this verification result.");
    expect(draft.prompt).not.toMatch(/automatically\s+(?:send|apply|run|verify|fix|repair|rollback)/i);
    expect(draft.prompt).not.toMatch(/(?:will|should)\s+(?:send|apply|run|verify|repair)/i);
    expect(draft.prompt).not.toContain("requestId");
  });

  it("builds succeeded follow-up drafts for explanation and next manual step", () => {
    const draft = buildVerificationFollowupPromptDraft(verificationResult("all checks passed", { status: "succeeded", exitCode: 0, truncated: false }), "followup");

    expect(draft.prompt).toContain("Verification follow-up prompt");
    expect(draft.prompt).toContain("Explain this verification result and recommend the next safe manual step.");
    expect(draft.prompt).toContain("Status: succeeded");
    expect(draft.prompt).toContain("Exit code: 0");
    expect(draft.prompt).toContain("Output truncated: no");
    expect(draft.metadata.verification).toEqual({ commandId: "gui-app-tests", status: "succeeded", exitCode: 0, truncated: false });
  });

  it("includes bounded sanitized prior proposal, plan preview, and touched file labels", () => {
    const draft = buildVerificationFollowupPromptDraft(verificationResult("failed test summary"), "fix", {
      priorProposal: {
        id: "assistant-msg-123",
        summary: "Update the visible empty state copy after manual review.",
        touchedFiles: ["src/App.tsx", "src/services/state.ts"],
      },
      planPreview: {
        title: "Review copy change",
        summary: "Inert plan summary for the next manual review.",
        steps: ["Inspect failing assertion", "Adjust copy", "Ask user to re-run verification"],
        expectedTouchedFiles: ["src/ignored.ts"],
      },
    });

    expect(draft.prompt).toContain("Sanitized Agent Run context");
    expect(draft.prompt).toContain("Previous proposal id: assistant-msg-123");
    expect(draft.prompt).toContain("Previous proposal summary: Update the visible empty state copy after manual review.");
    expect(draft.prompt).toContain("Plan title: Review copy change");
    expect(draft.prompt).toContain("Plan summary: Inert plan summary for the next manual review.");
    expect(draft.prompt).toContain("Plan steps: Inspect failing assertion; Adjust copy; Ask user to re-run verification");
    expect(draft.prompt).toContain("Touched file labels: src/App.tsx, src/services/state.ts");
    expect(draft.metadata.priorProposal).toEqual({ id: "assistant-msg-123", summary: "Update the visible empty state copy after manual review." });
    expect(draft.metadata.planPreview?.steps).toHaveLength(3);
    expect(draft.metadata.touchedFiles).toEqual(["src/App.tsx", "src/services/state.ts"]);
  });

  it("omits unsafe raw commands, cwd, env, diffs, file bodies, secrets, and private paths from context", () => {
    const secret = "sk-unsafecontextsecret";
    const draft = buildVerificationFollowupPromptDraft(verificationResult(`npm test -- --runInBand\n${secret}\n/Users/alice/project`, { commandId: "repository-check" }), "followup", {
      priorProposal: {
        id: "proposal-1",
        summary: `Run command npm test from cwd /Users/alice/project with env TOKEN=${secret}`,
        touchedFiles: ["src/safe.ts", "/Users/alice/project/src/private.ts", "../outside.ts", "src/file.ts?raw=1"],
      },
      planPreview: {
        title: "Plan with safe title",
        summary: "raw diff: do not include this body",
        steps: ["Inspect visible summary", "apply patch automatically", "Review manually"],
        expectedTouchedFiles: ["src/plan.ts"],
      },
    });

    expect(draft.prompt).toContain("[redacted]");
    expect(draft.prompt).toContain("Previous proposal id: proposal-1");
    expect(draft.prompt).toContain("Plan title: Plan with safe title");
    expect(draft.prompt).toContain("Plan steps: Inspect visible summary; Review manually");
    expect(draft.prompt).toContain("Touched file labels: src/safe.ts");
    expect(draft.prompt).not.toContain("npm test");
    expect(draft.prompt).not.toContain("cwd");
    expect(draft.prompt).not.toContain("TOKEN");
    expect(draft.prompt).not.toContain(secret);
    expect(draft.prompt).not.toContain("raw diff");
    expect(draft.prompt).not.toContain("apply patch");
    expect(draft.prompt).not.toContain("/Users/alice");
    expect(draft.prompt).not.toContain("../outside");
    expect(draft.prompt).not.toContain("?raw");
    expect(draft.metadata.priorProposal).toEqual({ id: "proposal-1" });
    expect(draft.metadata.planPreview).toEqual({ title: "Plan with safe title", steps: ["Inspect visible summary", "Review manually"] });
    expect(draft.metadata.touchedFiles).toEqual(["src/safe.ts"]);
    expect(JSON.stringify(draft.metadata)).not.toContain(secret);
  });

  it("caps oversized prompt content and context labels", () => {
    const draft = buildVerificationFollowupPromptDraft(verificationResult("safe output ".repeat(500)), "fix", {
      priorProposal: {
        id: "proposal-long",
        summary: "proposal summary ".repeat(80),
        touchedFiles: Array.from({ length: 20 }, (_, index) => `src/file-${index}.ts`),
      },
      planPreview: {
        title: "title ".repeat(60),
        summary: "plan summary ".repeat(80),
        steps: Array.from({ length: 20 }, (_, index) => `step ${index} ${"details ".repeat(30)}`),
      },
    });

    expect(draft.prompt.length).toBeLessThanOrEqual(2401);
    expect(draft.metadata.touchedFiles).toHaveLength(8);
    expect(draft.metadata.planPreview?.steps).toHaveLength(6);
    expect(draft.metadata.priorProposal?.summary?.length).toBeLessThanOrEqual(221);
    expect((draft.prompt.match(/safe output/g) ?? []).length).toBeLessThan(130);
  });
});
