import type { ActiveFileExcerptAttachment } from "../bridge/bridgeAdapter";
import { activeFileExcerptSummary, explicitContextBundleItemTextLength, explicitContextBundleMaxItems, explicitContextBundleMaxTextCharacters, summarizeExplicitContextBundleItem, type ExplicitContextBundleItem } from "./activeEditorContext";
import { sanitizeDisplayText } from "./redaction";

export type ContextBudgetSourceKind = "goal" | "active_file_excerpt" | "explicit_context_bundle" | "proposal_metadata";
export type ContextBudgetWarningCode = "too_many_items" | "large_context" | "omitted_context" | "excluded_context";

export type ContextBudgetSourceSummary = {
  kind: ContextBudgetSourceKind;
  label: string;
  itemCount: number;
  charCount: number;
  included: boolean;
};

export type ContextBudgetWarning = {
  code: ContextBudgetWarningCode;
  message: string;
};

export type ContextBudgetProposalMetadata = {
  label: string;
  charCount?: number;
  itemCount?: number;
  included?: boolean;
};

export type ContextBudgetInput = {
  goal: string;
  activeFileExcerpt?: ActiveFileExcerptAttachment | null;
  includeActiveFileExcerpt?: boolean;
  explicitContextItems: ExplicitContextBundleItem[];
  includeExplicitContextBundle: boolean;
  proposalMetadata?: ContextBudgetProposalMetadata[];
  excludedItemCount?: number;
  maxItems?: number;
  largeContextWarningCharacters?: number;
};

export type ContextBudgetSummary = {
  totalIncludedItems: number;
  totalIncludedCharacters: number;
  omittedItemCount: number;
  excludedItemCount: number;
  sources: ContextBudgetSourceSummary[];
  labels: string[];
  warnings: ContextBudgetWarning[];
};

const defaultLargeContextWarningCharacters = 12000;

export function buildContextBudgetSummary(input: ContextBudgetInput): ContextBudgetSummary {
  const maxItems = input.maxItems ?? explicitContextBundleMaxItems;
  const largeContextWarningCharacters = input.largeContextWarningCharacters ?? defaultLargeContextWarningCharacters;
  const goalCharacters = input.goal.trim().length;
  const goalIncluded = goalCharacters > 0;
  const sources: ContextBudgetSourceSummary[] = [
    {
      kind: "goal",
      label: "Task goal",
      itemCount: goalIncluded ? 1 : 0,
      charCount: goalCharacters,
      included: goalIncluded,
    },
  ];

  if (input.activeFileExcerpt) {
    sources.push({
      kind: "active_file_excerpt",
      label: activeFileExcerptSummary(input.activeFileExcerpt),
      itemCount: 1,
      charCount: input.activeFileExcerpt.text.length,
      included: input.includeActiveFileExcerpt === true,
    });
  }

  if (input.explicitContextItems.length > 0) {
    sources.push({
      kind: "explicit_context_bundle",
      label: "Explicit context bundle",
      itemCount: input.explicitContextItems.length,
      charCount: input.explicitContextItems.reduce((total, item) => total + explicitContextBundleItemTextLength(item), 0),
      included: input.includeExplicitContextBundle,
    });
  }

  for (const metadata of input.proposalMetadata ?? []) {
    const label = sanitizeDisplayText(metadata.label).trim();
    if (!label) {
      continue;
    }
    sources.push({
      kind: "proposal_metadata",
      label,
      itemCount: Math.max(0, metadata.itemCount ?? 1),
      charCount: Math.max(0, metadata.charCount ?? label.length),
      included: metadata.included !== false,
    });
  }

  const labels = input.explicitContextItems.map((item) => summarizeExplicitContextBundleItem(item).line);
  if (input.activeFileExcerpt) {
    labels.unshift(activeFileExcerptSummary(input.activeFileExcerpt));
  }
  for (const metadata of input.proposalMetadata ?? []) {
    if (metadata.label.trim()) {
      labels.push(sanitizeDisplayText(metadata.label));
    }
  }

  const includedSources = sources.filter((source) => source.included);
  const totalIncludedItems = includedSources.reduce((total, source) => total + source.itemCount, 0);
  const totalIncludedCharacters = includedSources.reduce((total, source) => total + source.charCount, 0);
  const omittedItemCount = sources.filter((source) => !source.included).reduce((total, source) => total + source.itemCount, 0);
  const excludedItemCount = Math.max(0, input.excludedItemCount ?? 0);
  const warnings: ContextBudgetWarning[] = [];

  if (totalIncludedItems > maxItems) {
    warnings.push({ code: "too_many_items", message: `Context has ${totalIncludedItems} included items; keep it to ${maxItems} or fewer before Send.` });
  }
  if (totalIncludedCharacters > largeContextWarningCharacters) {
    warnings.push({ code: "large_context", message: `Context has ${totalIncludedCharacters} included characters; narrow it before Send if the model reports context pressure.` });
  }
  if (input.explicitContextItems.length > explicitContextBundleMaxItems || sources.some((source) => source.kind === "explicit_context_bundle" && source.charCount > explicitContextBundleMaxTextCharacters)) {
    warnings.push({ code: "too_many_items", message: "Explicit context exceeds the one-shot bundle bounds; remove items before Send." });
  }
  if (omittedItemCount > 0) {
    warnings.push({ code: "omitted_context", message: `${omittedItemCount} context item${omittedItemCount === 1 ? " is" : "s are"} currently omitted from the next Send.` });
  }
  if (excludedItemCount > 0) {
    warnings.push({ code: "excluded_context", message: `${excludedItemCount} context item${excludedItemCount === 1 ? " was" : "s were"} excluded by bundle limits or user choice.` });
  }

  return {
    totalIncludedItems,
    totalIncludedCharacters,
    omittedItemCount,
    excludedItemCount,
    sources,
    labels: labels.map((label) => sanitizeDisplayText(label)),
    warnings,
  };
}
