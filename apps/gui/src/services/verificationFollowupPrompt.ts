import type { IdeActionResultPayload } from "../bridge/bridgeAdapter";
import { sanitizeDisplayText, sanitizeTimelineText } from "./redaction";

export type VerificationFollowupPromptMode = "followup" | "fix";

export type VerificationResultForPrompt = IdeActionResultPayload & {
  action: "runVerificationCommand";
  status: "succeeded" | "failed";
  commandId: NonNullable<IdeActionResultPayload["commandId"]>;
  exitCode: number;
  outputTail: string;
  truncated: boolean;
};

const outputSummaryLimit = 1200;

export function buildVerificationFollowupPrompt(result: VerificationResultForPrompt, mode: VerificationFollowupPromptMode): string {
  const commandId = sanitizeDisplayText(result.commandId);
  const status = sanitizeDisplayText(result.status);
  const exitCode = Number.isFinite(result.exitCode) ? result.exitCode : "unknown";
  const truncated = result.truncated ? "yes" : "no";
  const outputSummary = boundedOutputSummary(result.outputTail);
  const title = mode === "fix" ? "Verification fix prompt" : "Verification follow-up prompt";
  const instruction = mode === "fix"
    ? "Suggest the smallest safe fix plan for this verification result. Do not apply edits, run commands, attach context, save memory, or send anything automatically. If more context is needed, ask for it explicitly."
    : "Explain this verification result and recommend the next safe manual step. Do not apply edits, run commands, attach context, save memory, or send anything automatically. If more context is needed, ask for it explicitly.";

  return [
    title,
    "",
    "Verification result metadata",
    `Command id: ${commandId}`,
    `Status: ${status}`,
    `Exit code: ${exitCode}`,
    `Output truncated: ${truncated}`,
    "",
    "Bounded sanitized output summary",
    outputSummary || "No output tail was returned.",
    "",
    instruction,
  ].join("\n");
}

function boundedOutputSummary(value: string): string {
  const sanitized = sanitizeTimelineText(value).trim();
  return sanitized.length > outputSummaryLimit ? `${sanitized.slice(0, outputSummaryLimit)}…` : sanitized;
}
