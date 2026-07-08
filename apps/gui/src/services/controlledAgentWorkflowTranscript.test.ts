import completedFixture from "../../../../packages/contracts/examples/engine/controlled-agent-workflow-transcript-completed.json";
import blockedFixture from "../../../../packages/contracts/examples/engine/controlled-agent-workflow-transcript-blocked.json";
import { describe, expect, it } from "vitest";
import { buildControlledAgentWorkflowTranscript, isControlledAgentWorkflowTranscriptSafe } from "./controlledAgentWorkflowTranscript";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

describe("buildControlledAgentWorkflowTranscript", () => {
  it("builds a sanitized completed transcript matching the completed fixture shape", () => {
    const result = buildControlledAgentWorkflowTranscript(completedFixture);

    expect(result.diagnostics).toEqual([]);
    expect(result.transcript).toEqual(completedFixture);
    expect(result.transcript.kind).toBe("controlled_agent_workflow_transcript");
    expect(result.transcript.authority).toBe("display_export_metadata_only");
    expect(result.transcript.executionAllowed).toBe(false);
    expect(result.transcript.taskPresetLabel).toBe("Small focused fix");
    expect(isControlledAgentWorkflowTranscriptSafe(result.transcript)).toBe(true);
  });

  it("builds a sanitized blocked non-happy transcript matching the blocked fixture shape", () => {
    const result = buildControlledAgentWorkflowTranscript(blockedFixture);

    expect(result.diagnostics).toEqual([]);
    expect(result.transcript).toEqual(blockedFixture);
    expect(result.transcript.hostSurface).toBe("jetbrains");
    expect((result.transcript.finalEvidence as Record<string, unknown>).result).toBe("blocked");
    expect((result.transcript.recovery as Record<string, unknown>).manualOnly).toBe(true);
    expect(isControlledAgentWorkflowTranscriptSafe(result.transcript)).toBe(true);
  });

  it("omits unsafe raw marker fields and replaces unsafe text with safe diagnostics", () => {
    const unsafe = clone(completedFixture) as Record<string, unknown>;
    unsafe.rawPrompt = "Please paste raw prompt /Users/alice/private sk-proj-123456789";
    unsafe.taskPresetLabel = "Small focused fix /Users/alice/private";
    (unsafe.proposal as Record<string, unknown>).summary = "Raw prompt body was pasted into the transcript.";
    (unsafe.verification as Record<string, unknown>).commandOutput = "stdout showed full command output";
    (unsafe.contextSearch as Record<string, unknown>).selectedContextLabels = ["safe label", "/Users/alice/private/file.ts"];
    (unsafe.finalEvidence as Record<string, unknown>).summary = "This proves production release marketplace readiness.";

    const result = buildControlledAgentWorkflowTranscript(unsafe);
    const rendered = JSON.stringify(result);

    expect(new Set(result.diagnostics.map((item) => item.code))).toEqual(new Set(["unsafe_metadata_omitted", "unsafe_text_replaced"]));
    expect(result.transcript).not.toHaveProperty("rawPrompt");
    expect((result.transcript.proposal as Record<string, unknown>).summary).toBe("Proposal metadata unavailable after unsafe content was omitted.");
    expect((result.transcript.verification as Record<string, unknown>)).not.toHaveProperty("commandOutput");
    expect((result.transcript.contextSearch as Record<string, unknown>).selectedContextLabels).toEqual(["safe label", "Sanitized metadata omitted unsafe raw content."]);
    expect((result.transcript.finalEvidence as Record<string, unknown>).summary).toBe("Task evidence was sanitized after unsafe content was omitted.");
    expect(isControlledAgentWorkflowTranscriptSafe(result.transcript)).toBe(true);
    expect(rendered).not.toContain("/Users/alice");
    expect(rendered).not.toContain("sk-proj-123456789");
    expect(rendered).not.toContain("Raw prompt body");
    expect(rendered).not.toContain("command output");
    expect(rendered).not.toContain("production release marketplace");
  });

  it("replaces contradictory verification count metadata with safe diagnostics", () => {
    const contradictory = clone(completedFixture) as Record<string, unknown>;
    (contradictory.verification as Record<string, unknown>).commandIds = ["repository-check", "gui-app-tests"];
    (contradictory.verification as Record<string, unknown>).commandCount = 1;
    (contradictory.verification as Record<string, unknown>).passedCount = 1;
    (contradictory.verification as Record<string, unknown>).failedCount = 1;

    const result = buildControlledAgentWorkflowTranscript(contradictory);
    const verification = result.transcript.verification as Record<string, unknown>;

    expect(result.diagnostics).toContainEqual({
      code: "inconsistent_verification_counts",
      message: "Contradictory verification count metadata was replaced with safe bounded metadata.",
    });
    expect(verification.commandIds).toEqual([]);
    expect(verification.commandCount).toBe(0);
    expect(verification.passedCount).toBe(0);
    expect(verification.failedCount).toBe(0);
    expect(isControlledAgentWorkflowTranscriptSafe(result.transcript)).toBe(true);
  });
});
