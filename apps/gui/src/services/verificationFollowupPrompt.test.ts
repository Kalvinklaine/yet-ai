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
    expect(prompt).toContain("Command id: verification-command");
    expect(prompt).toContain("Unsafe verification command id was omitted.");
    expect(prompt).toContain("Propose a safe edit only");
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
    expect(draft.prompt).toContain("Propose a safe edit only.");
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
    expect(draft.prompt).toContain("Previous proposal label: Update the visible empty state copy after manual review.");
    expect(draft.prompt).toContain("Plan title: Review copy change");
    expect(draft.prompt).toContain("Plan summary: Inert plan summary for the next manual review.");
    expect(draft.prompt).toContain("Plan steps: Inspect failing assertion; Adjust copy; Ask user to re-run verification");
    expect(draft.prompt).toContain("Touched file labels: src/App.tsx, src/services/state.ts");
    expect(draft.metadata.priorProposal).toEqual({ id: "assistant-msg-123", summary: "Update the visible empty state copy after manual review." });
    expect(draft.metadata.planPreview?.steps).toHaveLength(3);
    expect(draft.metadata.touchedFiles).toEqual(["src/App.tsx", "src/services/state.ts"]);
  });

  it("correlates failed verification with proposal history, plan step, and session labels for manual fix drafts", () => {
    const draft = buildVerificationFollowupPromptDraft(verificationResult("failed assertion label only"), "fix", {
      priorProposal: {
        id: "proposal-1",
        summary: "Adjust visible review copy.",
        touchedFiles: ["apps/gui/src/App.tsx"],
      },
      proposalHistory: [
        { id: "proposal-1", source: "assistant", kind: "original", status: "applied", summary: "Adjust visible review copy.", touchedFiles: [], touchedFileCount: 0, diagnostics: [] },
        { id: "proposal-2", source: "assistant", kind: "follow_up", status: "detected", summary: "Prepare safer fix copy.", touchedFiles: [], touchedFileCount: 0, diagnostics: [] },
      ],
      planPreview: {
        title: "Manual review plan",
        summary: "Review the failed label and prepare a bounded proposal.",
        steps: ["Inspect label", "Draft safe proposal"],
      },
      planStepLabel: "Draft safe proposal",
      sessionLabel: "Settings copy session",
    });

    expect(draft.prompt).toContain("The user must review this draft");
    expect(draft.prompt).toContain("click Send manually");
    expect(draft.prompt).toContain("Status: failed");
    expect(draft.prompt).toContain("Previous proposal label: Adjust visible review copy.");
    expect(draft.prompt).toContain("Latest proposal id: proposal-2");
    expect(draft.prompt).toContain("Proposal lineage labels: proposal-1 · applied · Adjust visible review copy.; proposal-2 · detected · Prepare safer fix copy.");
    expect(draft.prompt).toContain("Current plan step: Draft safe proposal");
    expect(draft.prompt).toContain("Session label: Settings copy session");
    expect(draft.prompt).toContain("Touched file labels: apps/gui/src/App.tsx");
    expect(draft.prompt).toContain("Propose a safe edit only");
    expect(draft.prompt).toContain("Raw command output is intentionally omitted from this fix draft.");
    expect(draft.metadata.proposalHistory).toMatchObject({ latestProposalId: "proposal-2", latestStatus: "detected", latestSummary: "Prepare safer fix copy.", latestSource: "assistant" });
    expect(draft.metadata.planPreview?.stepLabel).toBe("Draft safe proposal");
    expect(draft.metadata.session).toEqual({ label: "Settings copy session" });
  });

  it("includes sanitized fix draft lineage metadata without raw payloads", () => {
    const draft = buildVerificationFollowupPromptDraft(verificationResult("failed assertion label only"), "fix", {
      priorProposal: { id: "proposal-1", summary: "Adjust visible review copy." },
      verificationRequestId: "verify-1",
      followupDraftId: "fix-draft-1",
    });

    expect(draft.metadata.draftId).toBe("fix-draft-1");
    expect(draft.metadata.verification.requestId).toBe("verify-1");
    expect(JSON.stringify(draft.metadata)).not.toContain("failed assertion label only");
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
        steps: ["Inspect visible summary", "provider payload response", "apply patch automatically", "Review manually"],
        expectedTouchedFiles: ["src/plan.ts"],
      },
      planStepLabel: "file body should not appear",
      sessionLabel: "provider payload should not appear",
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
    expect(draft.prompt).not.toContain("provider payload");
    expect(draft.prompt).not.toContain("file body should not appear");
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
    expect(draft.prompt).toContain("Raw command output is intentionally omitted from this fix draft.");
    expect(draft.prompt).not.toContain("safe output");
  });
});
