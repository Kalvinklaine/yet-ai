import { sanitizeTimelineText } from "./redaction";

export type ControlledAgentWorkflowTranscriptDiagnosticCode = "malformed_input" | "unsafe_metadata_omitted" | "unsafe_text_replaced";

export type ControlledAgentWorkflowTranscriptDiagnostic = {
  code: ControlledAgentWorkflowTranscriptDiagnosticCode;
  message: string;
};

export type ControlledAgentWorkflowTranscriptBuildResult = {
  transcript: Record<string, unknown>;
  diagnostics: ControlledAgentWorkflowTranscriptDiagnostic[];
};

const transcriptKeys = [
  "kind",
  "version",
  "authority",
  "cloudRequired",
  "executionAllowed",
  "transcriptId",
  "runId",
  "generatedAt",
  "hostSurface",
  "taskPresetLabel",
  "localFirst",
  "providerAccess",
  "explicitUserGates",
  "stageTransitions",
  "contextSearch",
  "proposal",
  "patchPlan",
  "apply",
  "verification",
  "followup",
  "recovery",
  "omissions",
  "finalEvidence",
  "safetyReview",
] as const;

const unsafeKeyPattern = /(?:raw|prompt|file(?:body|content|contents)|diff(?:Text|Body|Raw)?|patch(?:Text|Body|Raw)?|replacement(?:Text|Body)|command(?:String|Output|Raw)?|cmd|args|cwd|env|shell|stdout|stderr|provider(?:Payload|Response|Body|Tool|Call)|privatePath|secret|token|password|cookie|authorization|bridge(?:Dump|Payload)|browserStorage|localStorage|sessionStorage|git|network|tool(?:Call|Use))/i;
const unsafeTextPattern = /authorization|bearer|api[_-]?key|token|secret|password|cookie|raw[_ -]?(?:prompt|provider|response|command|output|stdout|stderr|file|diff|patch|log)|provider[_ -]?(?:payload|response|body|tool|call)|bridge[_ -]?(?:dump|payload)|browser[_ -]?(?:storage|localStorage|sessionStorage|dump)|localStorage|sessionStorage|file[_ -]?(?:body|content)|replacement[_ -]?(?:text|body)|\bdiff\b|\bpatch\b|command[_ -]?(?:string|output)|stdout|stderr|\bcwd\b|\benv\b|\bargs\b|\bshell\b|\bgit\b|\bnetwork\b|npm\s+run|cargo\s+(?:check|test)|tool[_ -]?(?:call|use)|hidden[_ -]?(?:read|search|scan)|index[_ -]?workspace|broad[_ -]?workspace|auto[_ -]?(?:send|apply|run|verify|fix|repair|rollback)|autonom(?:y|ous)|production|release|marketplace|publication|signing|notarization|real[_ -]?provider[_ -]?ci|sk-(?:proj-)?[A-Za-z0-9_-]{8,}|\/(?:Users|home|tmp|var|etc|opt|mnt|Volumes|private)(?=\/|$)|[A-Za-z]:(?:\\|\/)|~(?:\\|\/)|BEGIN [A-Z ]*PRIVATE KEY/i;
const safeSchemaKeys = new Set([
  ...transcriptKeys,
  "gate",
  "confirmed",
  "assistantMinted",
  "requestId",
  "at",
  "label",
  "from",
  "to",
  "status",
  "durationMs",
  "explicitSelectionOnly",
  "selectedContextLabels",
  "selectedSearchLabels",
  "contextItemCount",
  "searchResultCount",
  "selectedByteCount",
  "selectedLineCount",
  "omittedUnsafeCount",
  "evidenceHash",
  "providerLabel",
  "summary",
  "citedEvidenceCount",
  "riskCount",
  "proposalHash",
  "fileCount",
  "editCount",
  "replacementByteCount",
  "reviewLabel",
  "planHash",
  "appliedFileCount",
  "blockedFileCount",
  "resultHash",
  "bundleId",
  "commandIds",
  "commandCount",
  "passedCount",
  "failedCount",
  "outputTailStored",
  "draftOnly",
  "requiresUserSend",
  "actionLabel",
  "summaryHash",
  "recoveryLabel",
  "manualOnly",
  "attemptCount",
  "rawDataOmitted",
  "unsafeItemCount",
  "privatePathCount",
  "secretCount",
  "unsupportedHostCount",
  "staleEvidenceCount",
  "omissionHash",
  "result",
  "sanitizedReportReady",
  "taskCompleted",
  "changedFileCount",
  "testCount",
  "verificationCommandCount",
  "rawPromptsIncluded",
  "rawProviderResponsesIncluded",
  "fileBodiesIncluded",
  "diffsIncluded",
  "replacementTextIncluded",
  "commandStringsIncluded",
  "commandOutputIncluded",
  "providerPayloadsIncluded",
  "privatePathsIncluded",
  "secretsIncluded",
  "bridgeDumpsIncluded",
  "browserStorageDumpsIncluded",
  "authorityToActIncluded",
  "overclaimIncluded",
  "safeToShare",
]);

const safeHash = "sha256:0000000000000000000000000000000000000000000000000000000000000000";

export function buildControlledAgentWorkflowTranscript(input: unknown): ControlledAgentWorkflowTranscriptBuildResult {
  const diagnostics: ControlledAgentWorkflowTranscriptDiagnostic[] = [];
  if (!isPlainObject(input)) diagnostics.push(diagnostic("malformed_input", "Workflow transcript input must be an object."));
  const metadata = isPlainObject(input) ? input : {};
  const transcript: Record<string, unknown> = {};
  for (const key of transcriptKeys) transcript[key] = sanitizeValue(metadata[key], fallbackFor(key), diagnostics, key);
  return { transcript, diagnostics: dedupeDiagnostics(diagnostics) };
}

export function isControlledAgentWorkflowTranscriptSafe(value: unknown): boolean {
  return isPlainObject(value) && !hasUnsafeMarker(value);
}

function sanitizeValue(value: unknown, fallback: unknown, diagnostics: ControlledAgentWorkflowTranscriptDiagnostic[], path: string): unknown {
  if (Array.isArray(value)) return value.slice(0, arrayLimit(path)).map((item, index) => sanitizeValue(item, itemFallback(path), diagnostics, `${path}.${index}`));
  if (isPlainObject(value)) {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (!safeSchemaKeys.has(key) && unsafeKeyPattern.test(key)) {
        diagnostics.push(diagnostic("unsafe_metadata_omitted", "Unsafe transcript metadata field was omitted."));
        continue;
      }
      output[key] = sanitizeValue(item, fallbackFor(key), diagnostics, `${path}.${key}`);
    }
    return output;
  }
  if (typeof value === "string") {
    if (unsafeTextPattern.test(value)) {
      diagnostics.push(diagnostic("unsafe_text_replaced", "Unsafe transcript text was replaced with bounded metadata."));
      return unsafeStringFallback(path, fallback);
    }
    return path.endsWith("Hash") ? value : boundedText(value, stringLimit(path));
  }
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
  if (typeof value === "boolean") return value;
  return fallback;
}

function fallbackFor(key: string): unknown {
  switch (key) {
    case "kind": return "controlled_agent_workflow_transcript";
    case "version": return "2026-07-08";
    case "authority": return "display_export_metadata_only";
    case "cloudRequired":
    case "executionAllowed": return false;
    case "localFirst": return true;
    case "transcriptId": return "transcript-sanitized";
    case "runId": return "run-sanitized";
    case "generatedAt": return "2026-07-08T00:00:00Z";
    case "hostSurface": return "local-mock";
    case "taskPresetLabel": return "Sanitized task preset";
    case "providerAccess": return "not-used";
    case "explicitUserGates": return [];
    case "stageTransitions": return [];
    case "contextSearch": return { explicitSelectionOnly: true, selectedContextLabels: [], selectedSearchLabels: [], contextItemCount: 0, searchResultCount: 0, selectedByteCount: 0, selectedLineCount: 0, omittedUnsafeCount: 0, evidenceHash: safeHash };
    case "proposal": return { status: "blocked", providerLabel: "Not used", summary: "Proposal metadata unavailable after unsafe content was omitted.", citedEvidenceCount: 0, riskCount: 0, proposalHash: safeHash };
    case "patchPlan": return { status: "blocked", fileCount: 0, editCount: 0, replacementByteCount: 0, reviewLabel: "No reviewed plan", planHash: safeHash };
    case "apply": return { status: "blocked", requestId: "apply-sanitized", appliedFileCount: 0, blockedFileCount: 0, resultHash: safeHash, summary: "Apply metadata unavailable after unsafe content was omitted." };
    case "verification": return { status: "blocked", bundleId: "verify-sanitized", commandIds: [], commandCount: 0, passedCount: 0, failedCount: 0, outputTailStored: false, resultHash: safeHash, summary: "Verification metadata unavailable after unsafe content was omitted." };
    case "followup": return { status: "skipped", draftOnly: true, requiresUserSend: true, actionLabel: "No follow up requested", summaryHash: safeHash };
    case "recovery": return { status: "skipped", recoveryLabel: "No recovery needed", manualOnly: true, attemptCount: 0, summary: "No recovery action was selected." };
    case "omissions": return { rawDataOmitted: true, unsafeItemCount: 0, privatePathCount: 0, secretCount: 0, unsupportedHostCount: 0, staleEvidenceCount: 0, omissionHash: safeHash };
    case "finalEvidence": return { result: "blocked", sanitizedReportReady: true, taskCompleted: false, changedFileCount: 0, testCount: 0, verificationCommandCount: 0, evidenceHash: safeHash, summary: "Task evidence was sanitized after unsafe content was omitted." };
    case "safetyReview": return safetyReview();
    case "assistantMinted":
    case "rawPromptsIncluded":
    case "rawProviderResponsesIncluded":
    case "fileBodiesIncluded":
    case "diffsIncluded":
    case "replacementTextIncluded":
    case "commandStringsIncluded":
    case "commandOutputIncluded":
    case "providerPayloadsIncluded":
    case "privatePathsIncluded":
    case "secretsIncluded":
    case "bridgeDumpsIncluded":
    case "browserStorageDumpsIncluded":
    case "authorityToActIncluded":
    case "overclaimIncluded": return false;
    case "safeToShare":
    case "rawDataOmitted":
    case "sanitizedReportReady":
    case "draftOnly":
    case "requiresUserSend":
    case "manualOnly":
    case "explicitSelectionOnly": return true;
    case "outputTailStored": return false;
    case "evidenceHash":
    case "proposalHash":
    case "planHash":
    case "resultHash":
    case "summaryHash":
    case "omissionHash": return safeHash;
    default: return undefined;
  }
}

function unsafeStringFallback(path: string, fallback: unknown): string {
  if (path === "proposal.summary") return "Proposal metadata unavailable after unsafe content was omitted.";
  if (path === "apply.summary") return "Apply metadata unavailable after unsafe content was omitted.";
  if (path === "verification.summary") return "Verification metadata unavailable after unsafe content was omitted.";
  if (path === "finalEvidence.summary") return "Task evidence was sanitized after unsafe content was omitted.";
  if (typeof fallback === "string") return fallback;
  return "Sanitized metadata omitted unsafe raw content.";
}

function itemFallback(path: string): unknown {
  if (path.endsWith("explicitUserGates")) return { gate: "start", confirmed: false, assistantMinted: false, requestId: "gate-sanitized", at: "2026-07-08T00:00:00Z", label: "Sanitized gate metadata" };
  if (path.endsWith("stageTransitions")) return { at: "2026-07-08T00:00:00Z", from: "draft", to: "blocked", status: "blocked", durationMs: 0, label: "Sanitized transition metadata" };
  return "Sanitized metadata omitted unsafe raw content.";
}

function safetyReview(): Record<string, boolean> {
  return {
    rawPromptsIncluded: false,
    rawProviderResponsesIncluded: false,
    fileBodiesIncluded: false,
    diffsIncluded: false,
    replacementTextIncluded: false,
    commandStringsIncluded: false,
    commandOutputIncluded: false,
    providerPayloadsIncluded: false,
    privatePathsIncluded: false,
    secretsIncluded: false,
    bridgeDumpsIncluded: false,
    browserStorageDumpsIncluded: false,
    authorityToActIncluded: false,
    overclaimIncluded: false,
    safeToShare: true,
  };
}

function hasUnsafeMarker(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasUnsafeMarker);
  if (isPlainObject(value)) return Object.entries(value).some(([key, item]) => (!safeSchemaKeys.has(key) && unsafeKeyPattern.test(key)) || hasUnsafeMarker(item));
  return typeof value === "string" && unsafeTextPattern.test(value);
}

function boundedText(value: string, limit: number): string {
  const sanitized = sanitizeTimelineText(value).trim();
  return sanitized.length > limit ? `${sanitized.slice(0, limit)}…` : sanitized;
}

function arrayLimit(path: string): number {
  if (path.endsWith("explicitUserGates")) return 12;
  if (path.endsWith("stageTransitions")) return 20;
  if (path.endsWith("selectedContextLabels") || path.endsWith("selectedSearchLabels")) return 12;
  if (path.endsWith("commandIds")) return 3;
  return 20;
}

function stringLimit(path: string): number {
  if (path.endsWith("summary")) return 360;
  return 120;
}

function diagnostic(code: ControlledAgentWorkflowTranscriptDiagnosticCode, message: string): ControlledAgentWorkflowTranscriptDiagnostic {
  return { code, message };
}

function dedupeDiagnostics(diagnostics: ControlledAgentWorkflowTranscriptDiagnostic[]): ControlledAgentWorkflowTranscriptDiagnostic[] {
  const seen = new Set<string>();
  return diagnostics.filter((item) => {
    if (seen.has(item.code)) return false;
    seen.add(item.code);
    return true;
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
