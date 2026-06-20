import type { ApplyWorkspaceEditPayload, BridgeHost, WorkspaceEditRange } from "../bridge/bridgeAdapter";

export type EditProposalFileSummary = {
  workspaceRelativePath: string;
  replacementCount: number;
  lineRangeSummary: string;
  replacementCharCount: number;
  hasDeletionLikeReplacement: boolean;
  hasMultilineReplacement: boolean;
};

export type EditProposalQualitySummary = {
  fileCount: number;
  replacementCount: number;
  totalReplacementChars: number;
  maxReplacementChars: number;
  hasRedactedPreview: boolean;
  latestStatus: string;
  riskBadges: string[];
  disabledApplyReasons: string[];
  fileSummaries: EditProposalFileSummary[];
  reviewChecklist: string[];
};

export type BuildEditProposalQualitySummaryOptions = {
  payload: ApplyWorkspaceEditPayload;
  host: BridgeHost;
  pending: boolean;
  hasRedactedPreview: boolean;
  acknowledgedRedactedPreview: boolean;
};

const largeReplacementChars = 120;

const baseReviewChecklist = [
  "Review every listed file and range before requesting IDE apply.",
  "Confirm the proposal only changes the intended workspace-relative files.",
  "Use the IDE confirmation dialog for the final manual apply decision.",
];

export function buildEditProposalQualitySummary({ payload, host, pending, hasRedactedPreview, acknowledgedRedactedPreview }: BuildEditProposalQualitySummaryOptions): EditProposalQualitySummary {
  const fileSummaries = payload.edits.map((file): EditProposalFileSummary => {
    const replacementLengths = file.textReplacements.map((replacement) => replacement.replacementText.length);
    return {
      workspaceRelativePath: safeDisplayPath(file.workspaceRelativePath),
      replacementCount: file.textReplacements.length,
      lineRangeSummary: summarizeLineRanges(file.textReplacements.map((replacement) => replacement.range)),
      replacementCharCount: replacementLengths.reduce((total, length) => total + length, 0),
      hasDeletionLikeReplacement: file.textReplacements.some((replacement) => isDeletionLikeReplacement(replacement.replacementText)),
      hasMultilineReplacement: file.textReplacements.some((replacement) => isMultilineReplacement(replacement.replacementText)),
    };
  });
  const fileCount = fileSummaries.length;
  const replacementLengths = payload.edits.flatMap((file) => file.textReplacements.map((replacement) => replacement.replacementText.length));
  const replacementCount = replacementLengths.length;
  const totalReplacementChars = replacementLengths.reduce((total, length) => total + length, 0);
  const maxReplacementChars = replacementLengths.reduce((max, length) => Math.max(max, length), 0);
  const browserPreviewOnly = host !== "vscode" && host !== "jetbrains";
  const largeReplacement = maxReplacementChars >= largeReplacementChars;
  const hasMultilineReplacement = fileSummaries.some((file) => file.hasMultilineReplacement);
  const hasDeletionLikeReplacement = fileSummaries.some((file) => file.hasDeletionLikeReplacement);
  const riskBadges = [
    fileCount === 1 ? "single file" : "multi file",
    ...(hasMultilineReplacement ? ["multiline replacement"] : []),
    ...(hasDeletionLikeReplacement ? ["deletion-like replacement"] : []),
    ...(largeReplacement ? ["large replacement"] : []),
    ...(hasRedactedPreview ? ["preview redacted"] : []),
    ...(browserPreviewOnly ? ["browser preview only"] : ["IDE confirmation required"]),
  ];
  const disabledApplyReasons = [
    ...(browserPreviewOnly ? ["Browser preview cannot apply. Open VS Code or JetBrains for host confirmation."] : []),
    ...(pending ? ["An IDE apply request is already pending; clear pending state before requesting another apply."] : []),
    ...(hasRedactedPreview && !acknowledgedRedactedPreview ? ["Acknowledge the redacted/shortened preview before IDE apply."] : []),
  ];
  const latestStatus = pending ? "apply request pending" : browserPreviewOnly ? "browser preview only" : disabledApplyReasons.length > 0 ? "review blocked" : "ready for manual apply request";
  const reviewChecklist = [
    ...baseReviewChecklist,
    ...(hasRedactedPreview ? ["Acknowledge redacted or shortened previews only after inspecting the original proposal JSON."] : []),
    ...(hasDeletionLikeReplacement ? ["Check deletion-like replacements carefully because they may remove existing text."] : []),
    ...(hasMultilineReplacement ? ["Check multiline replacements for indentation and surrounding context."] : []),
  ];
  return {
    fileCount,
    replacementCount,
    totalReplacementChars,
    maxReplacementChars,
    hasRedactedPreview,
    latestStatus,
    riskBadges,
    disabledApplyReasons,
    fileSummaries,
    reviewChecklist,
  };
}

function summarizeLineRanges(ranges: WorkspaceEditRange[]): string {
  if (ranges.length === 0) {
    return "no ranges";
  }
  const lineRanges = ranges.map((range) => formatLineRange(range));
  const visible = lineRanges.slice(0, 4).join(", ");
  return ranges.length > 4 ? `${visible}, +${ranges.length - 4} more` : visible;
}

function formatLineRange(range: WorkspaceEditRange): string {
  return range.start.line === range.end.line ? `line ${range.start.line}` : `lines ${range.start.line}-${range.end.line}`;
}

function isDeletionLikeReplacement(text: string): boolean {
  return text.length === 0 || text.trim().length === 0;
}

function isMultilineReplacement(text: string): boolean {
  return /\r|\n/.test(text);
}

function safeDisplayPath(path: string): string {
  if (/^\/|^~|^[A-Za-z]:[\\/]|\\|:|\?|#|(^|\/)\.\.?($|\/)|(?:^|[._\/-])(?:auth|credential|credentials|password|secret|token|access[_-]?token|api[_-]?key)(?:[._\/-]|$)|^sk-(?:proj-)?[A-Za-z0-9_-]{8,}/i.test(path)) {
    return "[redacted]";
  }
  return path;
}
