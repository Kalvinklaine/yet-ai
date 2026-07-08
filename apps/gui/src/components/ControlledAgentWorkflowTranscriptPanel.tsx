import { useMemo, useState } from "react";
import { buildControlledAgentWorkflowTranscript } from "../services/controlledAgentWorkflowTranscript";
import { sanitizeDisplayText } from "../services/redaction";

export type ControlledAgentWorkflowTranscriptPanelProps = {
  metadata?: unknown;
};

type MetadataRecord = Record<string, unknown>;

export function ControlledAgentWorkflowTranscriptPanel({ metadata }: ControlledAgentWorkflowTranscriptPanelProps) {
  const [open, setOpen] = useState(false);
  const result = useMemo(() => buildControlledAgentWorkflowTranscript(metadata), [metadata]);
  const transcript = result.transcript;
  const hostSurface = textValue(transcript.hostSurface, "unknown host");
  const finalEvidence = recordValue(transcript.finalEvidence);
  const omissions = recordValue(transcript.omissions);
  const finalResult = textValue(finalEvidence.result, "unknown");
  const tone = finalResult === "completed" || finalResult === "completed_with_followup" ? "ready" : "warn";
  const hostNotice = hostCopy(hostSurface, omissions);

  return (
    <section className={`readiness-card ${tone} controlled-agent-workflow-transcript-panel stack`} aria-label="Controlled workflow transcript" data-testid="controlled-agent-workflow-transcript-panel">
      <details className="debug-details" data-testid="controlled-agent-workflow-transcript-details" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>
          <h2>Controlled workflow transcript</h2>
          <span className="badge warn">display only</span>
          <span className="badge">sanitized metadata only</span>
          <span className={tone === "ready" ? "badge ok" : "badge warn"}>{sanitizeDisplayText(finalResult)}</span>
        </summary>
        {open && (
          <div className="stack">
            <span>{sanitizeDisplayText(textValue(finalEvidence.summary, "Sanitized transcript metadata is available."))}</span>
            <strong>No workflow authority is available here.</strong>
            <span className="subtle">This collapsed transcript view cannot read files, search, call providers, post bridge messages, apply edits, run verification, create follow-ups, recover tasks, or write browser storage.</span>
            <span className="subtle">Only sanitized metadata labels, statuses, counters, request ids, and evidence hashes are shown. Raw prompts, file bodies, diffs, replacements, provider payloads, private paths, secrets, command strings, and output dumps are omitted, not approved or rendered.</span>
            {hostNotice && <span className="subtle">{hostNotice}</span>}
            <TranscriptFacts transcript={transcript} />
            <UserGates gates={arrayValue(transcript.explicitUserGates)} />
            <StageTransitions transitions={arrayValue(transcript.stageTransitions)} />
            <ContextSearch contextSearch={recordValue(transcript.contextSearch)} />
            <WorkflowSummaries transcript={transcript} />
            <Omissions omissions={omissions} />
            <FinalEvidence finalEvidence={finalEvidence} />
            <SafetyReview safetyReview={recordValue(transcript.safetyReview)} />
            {result.diagnostics.length > 0 && (
              <div className="readiness-card warn" role="status" aria-label="Controlled workflow transcript diagnostics">
                <strong>Diagnostics</strong>
                {result.diagnostics.slice(0, 6).map((diagnostic) => <span key={`${diagnostic.code}:${diagnostic.message}`}>{sanitizeDisplayText(diagnostic.code)}: {sanitizeDisplayText(diagnostic.message)}</span>)}
              </div>
            )}
            <span className="subtle">No action controls are rendered. Transcript data remains bounded presentation-only evidence, not permission to share raw workflow data.</span>
          </div>
        )}
      </details>
      {hostNotice && <span className="subtle">{hostNotice}</span>}
    </section>
  );
}

function TranscriptFacts({ transcript }: { transcript: MetadataRecord }) {
  return (
    <div className="agent-progress-grid" aria-label="Controlled workflow transcript facts">
      <span>Authority: {safeValue(transcript.authority)}</span>
      <span>Cloud required: {safeValue(transcript.cloudRequired)}</span>
      <span>Execution allowed: {safeValue(transcript.executionAllowed)}</span>
      <span>Local first: {safeValue(transcript.localFirst)}</span>
      <span>Host: {safeValue(transcript.hostSurface)}</span>
      <span>Task preset: {safeValue(transcript.taskPresetLabel)}</span>
      <span>Provider access: {safeValue(transcript.providerAccess)}</span>
      <span>Transcript id: {safeValue(transcript.transcriptId)}</span>
      <span>Run id: {safeValue(transcript.runId)}</span>
      <span>Generated at: {safeValue(transcript.generatedAt)}</span>
    </div>
  );
}

function UserGates({ gates }: { gates: unknown[] }) {
  return (
    <div className="agent-progress-grid" aria-label="Controlled workflow user gates">
      <strong>User gates</strong>
      <span>Gate count: {gates.length}</span>
      {gates.slice(0, 12).map((gate, index) => {
        const item = recordValue(gate);
        return <span key={`${safeValue(item.gate)}:${index}`}>{safeValue(item.gate)} · confirmed: {safeValue(item.confirmed)} · assistant minted: {safeValue(item.assistantMinted)} · {safeValue(item.label)}</span>;
      })}
    </div>
  );
}

function StageTransitions({ transitions }: { transitions: unknown[] }) {
  return (
    <div className="agent-progress-grid" aria-label="Controlled workflow stage transitions">
      <strong>Stage transitions</strong>
      <span>Transition count: {transitions.length}</span>
      {transitions.slice(0, 20).map((transition, index) => {
        const item = recordValue(transition);
        return <span key={`${safeValue(item.from)}:${safeValue(item.to)}:${index}`}>{safeValue(item.from)} → {safeValue(item.to)} · {safeValue(item.status)} · {safeValue(item.durationMs)} ms · {safeValue(item.label)}</span>;
      })}
    </div>
  );
}

function ContextSearch({ contextSearch }: { contextSearch: MetadataRecord }) {
  return (
    <div className="agent-progress-grid" aria-label="Controlled workflow selected context and search metadata">
      <strong>Selected context and search</strong>
      <span>Explicit selection only: {safeValue(contextSearch.explicitSelectionOnly)}</span>
      <span>Context labels: {joinLabels(contextSearch.selectedContextLabels)}</span>
      <span>Search labels: {joinLabels(contextSearch.selectedSearchLabels)}</span>
      <span>Context item count: {safeValue(contextSearch.contextItemCount)}</span>
      <span>Search result count: {safeValue(contextSearch.searchResultCount)}</span>
      <span>Selected byte count: {safeValue(contextSearch.selectedByteCount)}</span>
      <span>Selected line count: {safeValue(contextSearch.selectedLineCount)}</span>
      <span>Omitted unsafe count: {safeValue(contextSearch.omittedUnsafeCount)}</span>
      <span>Evidence hash: {safeValue(contextSearch.evidenceHash)}</span>
    </div>
  );
}

function WorkflowSummaries({ transcript }: { transcript: MetadataRecord }) {
  return (
    <div className="agent-progress-grid" aria-label="Controlled workflow sanitized summaries">
      <strong>Proposal, patch, apply, verification, follow-up, and recovery</strong>
      <SummaryLine label="Proposal" data={recordValue(transcript.proposal)} fields={["status", "providerLabel", "summary", "citedEvidenceCount", "riskCount", "proposalHash"]} />
      <SummaryLine label="Patch plan" data={recordValue(transcript.patchPlan)} fields={["status", "fileCount", "editCount", "replacementByteCount", "reviewLabel", "planHash"]} />
      <SummaryLine label="Apply" data={recordValue(transcript.apply)} fields={["status", "requestId", "appliedFileCount", "blockedFileCount", "resultHash", "summary"]} />
      <SummaryLine label="Verification" data={recordValue(transcript.verification)} fields={["status", "bundleId", "commandCount", "passedCount", "failedCount", "outputTailStored", "resultHash", "summary"]} />
      <SummaryLine label="Follow-up" data={recordValue(transcript.followup)} fields={["status", "draftOnly", "requiresUserSend", "actionLabel", "summaryHash"]} />
      <SummaryLine label="Recovery" data={recordValue(transcript.recovery)} fields={["status", "recoveryLabel", "manualOnly", "attemptCount", "summary"]} />
    </div>
  );
}

function SummaryLine({ label, data, fields }: { label: string; data: MetadataRecord; fields: string[] }) {
  return <span>{label}: {fields.map((field) => `${field}=${safeValue(data[field])}`).join(" · ")}</span>;
}

function Omissions({ omissions }: { omissions: MetadataRecord }) {
  return (
    <div className="agent-progress-grid" aria-label="Controlled workflow omitted unsafe metadata statuses">
      <strong>Omitted unsafe statuses</strong>
      <span>Raw data omitted: {safeValue(omissions.rawDataOmitted)}</span>
      <span>Unsafe item count: {safeValue(omissions.unsafeItemCount)}</span>
      <span>Private path count: {safeValue(omissions.privatePathCount)}</span>
      <span>Secret count: {safeValue(omissions.secretCount)}</span>
      <span>Unsupported host count: {safeValue(omissions.unsupportedHostCount)}</span>
      <span>Stale evidence count: {safeValue(omissions.staleEvidenceCount)}</span>
      <span>Omission hash: {safeValue(omissions.omissionHash)}</span>
    </div>
  );
}

function FinalEvidence({ finalEvidence }: { finalEvidence: MetadataRecord }) {
  return (
    <div className="agent-progress-grid" aria-label="Controlled workflow final evidence labels and counts">
      <strong>Final bounded evidence</strong>
      <span>Result: {safeValue(finalEvidence.result)}</span>
      <span>Sanitized report ready: {safeValue(finalEvidence.sanitizedReportReady)}</span>
      <span>Task completed: {safeValue(finalEvidence.taskCompleted)}</span>
      <span>Changed file count: {safeValue(finalEvidence.changedFileCount)}</span>
      <span>Test count: {safeValue(finalEvidence.testCount)}</span>
      <span>Verification command count: {safeValue(finalEvidence.verificationCommandCount)}</span>
      <span>Evidence hash: {safeValue(finalEvidence.evidenceHash)}</span>
      <span>Summary: {safeValue(finalEvidence.summary)}</span>
    </div>
  );
}

function SafetyReview({ safetyReview }: { safetyReview: MetadataRecord }) {
  return (
    <div className="agent-progress-grid" aria-label="Controlled workflow safety review">
      <strong>Safety review</strong>
      <span>Raw prompts included: {safeValue(safetyReview.rawPromptsIncluded)}</span>
      <span>Provider responses included: {safeValue(safetyReview.rawProviderResponsesIncluded)}</span>
      <span>File bodies included: {safeValue(safetyReview.fileBodiesIncluded)}</span>
      <span>Diffs included: {safeValue(safetyReview.diffsIncluded)}</span>
      <span>Replacement text included: {safeValue(safetyReview.replacementTextIncluded)}</span>
      <span>Command strings included: {safeValue(safetyReview.commandStringsIncluded)}</span>
      <span>Command output included: {safeValue(safetyReview.commandOutputIncluded)}</span>
      <span>Provider payloads included: {safeValue(safetyReview.providerPayloadsIncluded)}</span>
      <span>Private paths included: {safeValue(safetyReview.privatePathsIncluded)}</span>
      <span>Secrets included: {safeValue(safetyReview.secretsIncluded)}</span>
      <span>Bridge dumps included: {safeValue(safetyReview.bridgeDumpsIncluded)}</span>
      <span>Browser storage dumps included: {safeValue(safetyReview.browserStorageDumpsIncluded)}</span>
      <span>Authority to act included: {safeValue(safetyReview.authorityToActIncluded)}</span>
      <span>Overclaim included: {safeValue(safetyReview.overclaimIncluded)}</span>
      <span>Bounded safe-share metadata only: {safeValue(safetyReview.safeToShare)}</span>
    </div>
  );
}

function hostCopy(hostSurface: string, omissions: MetadataRecord): string | undefined {
  if (hostSurface.toLowerCase() === "browser-preview" || hostSurface.toLowerCase() === "browser") return "Browser preview remains unsupported for controlled workflow transcript authority; sanitized metadata stays fail-closed and display-only.";
  if (hostSurface.toLowerCase() === "jetbrains" || Number(omissions.unsupportedHostCount) > 0) return "JetBrains or partial-host transcript evidence remains conservative: blocked or stopped sanitized metadata stays manual-only and fail-closed.";
  return undefined;
}

function joinLabels(value: unknown): string {
  const labels = arrayValue(value).map((item) => safeValue(item)).filter(Boolean);
  return labels.length > 0 ? labels.join(" · ") : "none";
}

function safeValue(value: unknown): string {
  if (value === undefined || value === null) return "none";
  return sanitizeDisplayText(String(value));
}

function textValue(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.length > 0) return sanitizeDisplayText(value);
  return fallback;
}

function recordValue(value: unknown): MetadataRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as MetadataRecord : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
