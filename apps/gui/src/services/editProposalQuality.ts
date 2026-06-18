import type { ApplyWorkspaceEditPayload, BridgeHost } from "../bridge/bridgeAdapter";

export type EditProposalQualitySummary = {
  fileCount: number;
  replacementCount: number;
  totalReplacementChars: number;
  maxReplacementChars: number;
  hasRedactedPreview: boolean;
  latestStatus: string;
  riskBadges: string[];
  disabledApplyReasons: string[];
};

export type BuildEditProposalQualitySummaryOptions = {
  payload: ApplyWorkspaceEditPayload;
  host: BridgeHost;
  pending: boolean;
  hasRedactedPreview: boolean;
  acknowledgedRedactedPreview: boolean;
};

const largeReplacementChars = 120;

export function buildEditProposalQualitySummary({ payload, host, pending, hasRedactedPreview, acknowledgedRedactedPreview }: BuildEditProposalQualitySummaryOptions): EditProposalQualitySummary {
  const fileCount = payload.edits.length;
  const replacementLengths = payload.edits.flatMap((file) => file.textReplacements.map((replacement) => replacement.replacementText.length));
  const replacementCount = replacementLengths.length;
  const totalReplacementChars = replacementLengths.reduce((total, length) => total + length, 0);
  const maxReplacementChars = replacementLengths.reduce((max, length) => Math.max(max, length), 0);
  const browserPreviewOnly = host !== "vscode" && host !== "jetbrains";
  const largeReplacement = maxReplacementChars >= largeReplacementChars;
  const riskBadges = [
    fileCount === 1 ? "single file" : "multi file",
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
  return {
    fileCount,
    replacementCount,
    totalReplacementChars,
    maxReplacementChars,
    hasRedactedPreview,
    latestStatus,
    riskBadges,
    disabledApplyReasons,
  };
}
