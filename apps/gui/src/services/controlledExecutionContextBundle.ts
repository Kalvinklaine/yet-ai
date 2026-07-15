import type { ActiveFileExcerptAttachment } from "../bridge/bridgeAdapter";
import { activeFileExcerptToBundleItem, addExplicitContextBundleItem, explicitContextBundleItemTextLength, explicitContextBundleMaxItems, explicitContextBundleMaxTextCharacters, summarizeExplicitContextBundleItem, type ExplicitContextBundleItem } from "./activeEditorContext";
import { sanitizeDisplayText } from "./redaction";

export type ControlledExecutionContextBundleItemSummary = {
  kind: ExplicitContextBundleItem["kind"];
  typeLabel: string;
  label: string;
  charCount: number;
  redacted: boolean;
  truncated: boolean;
  line: string;
};

export type ControlledExecutionContextBundleSnapshot = {
  authority: "explicit_execution_context_snapshot";
  itemCount: number;
  totalCharacters: number;
  omittedItemCount: number;
  truncated: boolean;
  redacted: boolean;
  labels: readonly string[];
  summary: string;
  items: readonly ControlledExecutionContextBundleItemSummary[];
};

export type ControlledExecutionContextBundleInput = {
  activeFileExcerpt?: ActiveFileExcerptAttachment | null;
  includeActiveFileExcerpt?: boolean;
  explicitContextItems?: ExplicitContextBundleItem[];
  includeExplicitContextBundle?: boolean;
  maxItems?: number;
  maxTextCharacters?: number;
  maxLabelCharacters?: number;
};

const defaultMaxLabelCharacters = 180;

export function createControlledExecutionContextBundleSnapshot(input: ControlledExecutionContextBundleInput): ControlledExecutionContextBundleSnapshot {
  const maxItems = boundInteger(input.maxItems, 0, explicitContextBundleMaxItems, explicitContextBundleMaxItems);
  const maxTextCharacters = boundInteger(input.maxTextCharacters, 0, explicitContextBundleMaxTextCharacters, explicitContextBundleMaxTextCharacters);
  const maxLabelCharacters = boundInteger(input.maxLabelCharacters, 40, 400, defaultMaxLabelCharacters);
  const candidates: ExplicitContextBundleItem[] = [];

  if (input.includeExplicitContextBundle !== false) {
    candidates.push(...(input.explicitContextItems ?? []));
  }

  if (input.includeActiveFileExcerpt === true && input.activeFileExcerpt) {
    candidates.unshift(activeFileExcerptToBundleItem(input.activeFileExcerpt));
  }

  let selected: ExplicitContextBundleItem[] = [];
  let omittedItemCount = 0;
  let totalCharacters = 0;

  for (const candidate of candidates) {
    const before = selected;
    selected = addExplicitContextBundleItem(selected, candidate);
    if (selected === before) {
      omittedItemCount += 1;
      continue;
    }
    totalCharacters = selected.reduce((total, item) => total + explicitContextBundleItemTextLength(item), 0);
    if (selected.length > maxItems || totalCharacters > maxTextCharacters) {
      selected = before;
      totalCharacters = selected.reduce((total, item) => total + explicitContextBundleItemTextLength(item), 0);
      omittedItemCount += 1;
    }
  }

  const items = selected.map((item) => {
    const summary = summarizeExplicitContextBundleItem(item);
    return Object.freeze({
      kind: item.kind,
      typeLabel: boundedLabel(summary.typeLabel, maxLabelCharacters),
      label: boundedLabel(summary.label, maxLabelCharacters),
      charCount: summary.charCount,
      redacted: summary.redacted,
      truncated: summary.truncated,
      line: boundedLabel(summary.line, maxLabelCharacters),
    });
  });
  const redacted = items.some((item) => item.redacted);
  const truncated = omittedItemCount > 0 || items.some((item) => item.truncated);
  const labels = items.map((item) => item.line);
  const summary = buildSummary(items, totalCharacters, omittedItemCount, redacted, truncated, maxLabelCharacters);

  return Object.freeze({
    authority: "explicit_execution_context_snapshot",
    itemCount: items.length,
    totalCharacters,
    omittedItemCount,
    truncated,
    redacted,
    labels: Object.freeze(labels.slice()),
    summary,
    items: Object.freeze(items.slice()),
  });
}

function buildSummary(items: readonly ControlledExecutionContextBundleItemSummary[], totalCharacters: number, omittedItemCount: number, redacted: boolean, truncated: boolean, limit: number): string {
  if (items.length === 0) {
    return "Frozen execution context: no explicit context selected.";
  }
  const itemNoun = items.length === 1 ? "item" : "items";
  const labels = items.map((item) => `${item.typeLabel} ${item.label}`).join("; ");
  const suffix = [`${totalCharacters} chars`, omittedItemCount > 0 ? `${omittedItemCount} omitted` : "0 omitted", redacted ? "redacted" : "not redacted", truncated ? "bounded" : "complete"].join(" · ");
  return boundedLabel(`Frozen execution context: ${items.length} explicit ${itemNoun} · ${labels} · ${suffix}.`, Math.max(limit, 240));
}

function boundedLabel(value: string, limit: number): string {
  const sanitized = sanitizeDisplayText(value).replace(/\s+/g, " ").trim();
  if (!sanitized) {
    return "unavailable";
  }
  return sanitized.length > limit ? `${sanitized.slice(0, limit - 1)}…` : sanitized;
}

function boundInteger(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}
