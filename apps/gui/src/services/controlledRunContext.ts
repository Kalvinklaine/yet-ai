import { redactSecrets, sanitizeDisplayText } from "./redaction";

export const controlledRunContextLimits = {
  maxContextFiles: 5,
  maxFragments: 10,
  maxBytesPerItemPreview: 8 * 1024,
  maxLinesPerItemPreview: 240,
  maxTotalContextBytes: 24 * 1024,
  maxTotalContextLines: 600,
  maxLabelLength: 120,
} as const;

export type ControlledRunContextSourceKind = "workspace_fragment" | "workspace_file_preview" | "active_editor_selection" | "pasted_text" | "verification_summary" | "memory_summary";
export type ControlledRunContextClearReason = "accepted_send" | "cancelled" | "host_changed" | "run_stopped" | "runtime_disconnected" | "draft_reset";
export type ControlledRunContextBlockedReason = "empty_preview" | "unsafe_label" | "unsafe_path" | "invalid_range" | "item_too_large" | "too_many_lines" | "too_many_files" | "too_many_fragments" | "total_bytes_exceeded" | "total_lines_exceeded" | "duplicate_item";

export type ControlledRunContextRange = {
  startLine: number;
  endLine: number;
};

export type ControlledRunContextInput = {
  id: string;
  sourceKind: ControlledRunContextSourceKind;
  label: string;
  previewText: string;
  workspaceRelativePath?: string;
  range?: ControlledRunContextRange;
  hostSurfaceLabel?: string;
  draftId?: string;
  truncated?: boolean;
};

export type ControlledRunContextItem = {
  id: string;
  sourceKind: ControlledRunContextSourceKind;
  label: string;
  previewText: string;
  previewByteCount: number;
  previewLineCount: number;
  truncated: boolean;
  workspaceRelativePath?: string;
  range?: ControlledRunContextRange;
  hostSurfaceLabel: string;
  draftId?: string;
  key: string;
};

export type ControlledRunContextValidationResult =
  | { ok: true; item: ControlledRunContextItem }
  | { ok: false; reason: ControlledRunContextBlockedReason; message: string };

export type ControlledRunContextBundle = {
  items: ControlledRunContextItem[];
  cleared: boolean;
  clearReason?: ControlledRunContextClearReason;
};

export type ControlledRunContextReport = {
  selectedContextCount: number;
  safeLabels: string[];
  omittedUnsafeItemCount: number;
  totalPreviewBytes: number;
  totalPreviewLines: number;
  truncatedCount: number;
  blockedReasons: string[];
};

const generatedOrDependencySegments = new Set(["node_modules", "dist", "build", "coverage", "out", "target", ".next", ".nuxt", ".turbo", ".vite", "vendor", "__pycache__"]);
const generatedFileNames = new Set(["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb"]);
const generatedExtensions = [".min.js", ".bundle.js", ".map", ".lock"];
const textEncoder = new TextEncoder();

export function createControlledRunContextBundle(items: ControlledRunContextItem[] = []): ControlledRunContextBundle {
  return { items: items.slice(), cleared: false };
}

export function validateControlledRunContextItem(input: ControlledRunContextInput): ControlledRunContextValidationResult {
  const safeId = sanitizeToken(input.id);
  if (!safeId) {
    return blocked("unsafe_label", "Context item id must be a safe non-secret label.");
  }
  const label = boundedSafeLabel(input.label);
  if (!label) {
    return blocked("unsafe_label", "Context label must be safe, non-secret, and visible.");
  }
  const hostSurfaceLabel = boundedSafeLabel(input.hostSurfaceLabel ?? "unknown host");
  if (!hostSurfaceLabel) {
    return blocked("unsafe_label", "Host surface label must be safe.");
  }
  const path = input.workspaceRelativePath ? normalizeWorkspacePath(input.workspaceRelativePath) : undefined;
  if (requiresWorkspacePath(input.sourceKind)) {
    if (!path || !isSafeWorkspaceRelativePath(path)) {
      return blocked("unsafe_path", "Workspace context requires a safe workspace-relative text path.");
    }
  }
  if (path && !isSafeWorkspaceRelativePath(path)) {
    return blocked("unsafe_path", "Workspace-relative path is hidden, generated, dependency, absolute, or unsafe.");
  }
  const range = input.range ? normalizeRange(input.range) : undefined;
  if (requiresRange(input.sourceKind) && !range) {
    return blocked("invalid_range", "Selected file fragments require a valid inclusive line range.");
  }
  const previewText = input.previewText;
  if (!previewText.trim()) {
    return blocked("empty_preview", "Context preview must contain visible selected text.");
  }
  if (redactSecrets(previewText) !== previewText) {
    return blocked("unsafe_label", "Context preview contains secret-like text and must not be attached.");
  }
  const previewByteCount = byteLength(previewText);
  const previewLineCount = lineCount(previewText);
  if (previewByteCount > controlledRunContextLimits.maxBytesPerItemPreview) {
    return blocked("item_too_large", `Context preview must be at most ${controlledRunContextLimits.maxBytesPerItemPreview} bytes.`);
  }
  if (previewLineCount > controlledRunContextLimits.maxLinesPerItemPreview) {
    return blocked("too_many_lines", `Context preview must be at most ${controlledRunContextLimits.maxLinesPerItemPreview} lines.`);
  }
  return {
    ok: true,
    item: {
      id: safeId,
      sourceKind: input.sourceKind,
      label,
      previewText,
      previewByteCount,
      previewLineCount,
      truncated: input.truncated === true,
      ...(path ? { workspaceRelativePath: path } : {}),
      ...(range ? { range } : {}),
      hostSurfaceLabel,
      ...(input.draftId ? { draftId: boundedSafeLabel(input.draftId) || undefined } : {}),
      key: controlledRunContextItemKey({ ...input, id: safeId, label, workspaceRelativePath: path }),
    },
  };
}

export function addControlledRunContextItem(bundle: ControlledRunContextBundle, item: ControlledRunContextItem): ControlledRunContextBundle {
  if (bundle.cleared) {
    return bundle;
  }
  if (bundle.items.some((existing) => existing.key === item.key || existing.id === item.id)) {
    return bundle;
  }
  if (bundle.items.length >= controlledRunContextLimits.maxFragments) {
    return bundle;
  }
  const nextItems = [...bundle.items, item];
  const fileCount = new Set(nextItems.map((next) => next.workspaceRelativePath).filter((path): path is string => Boolean(path))).size;
  if (fileCount > controlledRunContextLimits.maxContextFiles) {
    return bundle;
  }
  if (totalBytes(nextItems) > controlledRunContextLimits.maxTotalContextBytes) {
    return bundle;
  }
  if (totalLines(nextItems) > controlledRunContextLimits.maxTotalContextLines) {
    return bundle;
  }
  return { ...bundle, items: nextItems };
}

export function clearControlledRunContextBundle(bundle: ControlledRunContextBundle, clearReason: ControlledRunContextClearReason): ControlledRunContextBundle {
  return { items: [], cleared: true, clearReason };
}

export function summarizeControlledRunContextItem(item: ControlledRunContextItem): string {
  const range = item.range ? ` · lines ${item.range.startLine}-${item.range.endLine}` : "";
  const path = item.workspaceRelativePath ? ` · ${item.workspaceRelativePath}` : "";
  const truncated = item.truncated ? " · truncated yes" : " · truncated no";
  return sanitizeDisplayText(`${item.sourceKind} · ${item.label}${path}${range} · ${item.previewByteCount} bytes · ${item.previewLineCount} lines${truncated} · ${item.hostSurfaceLabel}`);
}

export function buildControlledRunContextReport(bundle: ControlledRunContextBundle, blockedReasons: ControlledRunContextBlockedReason[] = []): ControlledRunContextReport {
  return {
    selectedContextCount: bundle.items.length,
    safeLabels: bundle.items.map((item) => summarizeControlledRunContextItem(item)),
    omittedUnsafeItemCount: blockedReasons.length,
    totalPreviewBytes: totalBytes(bundle.items),
    totalPreviewLines: totalLines(bundle.items),
    truncatedCount: bundle.items.filter((item) => item.truncated).length,
    blockedReasons: blockedReasons.map((reason) => sanitizeDisplayText(reason)),
  };
}

export function isSafeWorkspaceRelativePath(value: string): boolean {
  const path = normalizeWorkspacePath(value);
  if (!path || path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path) || path.includes("\\") || path.includes("//")) {
    return false;
  }
  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.startsWith(".") || /[\u0000-\u001F\u007F-\u009F]/u.test(segment))) {
    return false;
  }
  const lowerSegments = segments.map((segment) => segment.toLowerCase());
  if (lowerSegments.some((segment) => generatedOrDependencySegments.has(segment))) {
    return false;
  }
  const fileName = lowerSegments[lowerSegments.length - 1] ?? "";
  if (generatedFileNames.has(fileName) || generatedExtensions.some((extension) => fileName.endsWith(extension))) {
    return false;
  }
  return redactSecrets(path) === path;
}

function controlledRunContextItemKey(input: ControlledRunContextInput): string {
  return [input.sourceKind, input.workspaceRelativePath ?? "", input.range ? `${input.range.startLine}-${input.range.endLine}` : "", input.label, textHash(input.previewText)].join("|");
}

function normalizeWorkspacePath(value: string): string {
  return value.trim().replace(/^\.\//, "");
}

function normalizeRange(range: ControlledRunContextRange): ControlledRunContextRange | undefined {
  if (!Number.isInteger(range.startLine) || !Number.isInteger(range.endLine) || range.startLine < 1 || range.endLine < range.startLine) {
    return undefined;
  }
  return { startLine: range.startLine, endLine: range.endLine };
}

function requiresWorkspacePath(sourceKind: ControlledRunContextSourceKind): boolean {
  return sourceKind === "workspace_fragment" || sourceKind === "workspace_file_preview";
}

function requiresRange(sourceKind: ControlledRunContextSourceKind): boolean {
  return sourceKind === "workspace_fragment" || sourceKind === "active_editor_selection";
}

function boundedSafeLabel(value: string): string {
  const sanitized = sanitizeDisplayText(value);
  if (!sanitized || redactSecrets(value) !== value || sanitized.includes("[redacted]")) {
    return "";
  }
  return sanitized.length > controlledRunContextLimits.maxLabelLength ? `${sanitized.slice(0, controlledRunContextLimits.maxLabelLength)}…` : sanitized;
}

function sanitizeToken(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > controlledRunContextLimits.maxLabelLength || redactSecrets(trimmed) !== trimmed || /[\u0000-\u001F\u007F-\u009F]/u.test(trimmed)) {
    return "";
  }
  return trimmed;
}

function byteLength(value: string): number {
  return textEncoder.encode(value).length;
}

function lineCount(value: string): number {
  return value.split(/\r\n|\r|\n/).length;
}

function totalBytes(items: ControlledRunContextItem[]): number {
  return items.reduce((total, item) => total + item.previewByteCount, 0);
}

function totalLines(items: ControlledRunContextItem[]): number {
  return items.reduce((total, item) => total + item.previewLineCount, 0);
}

function blocked(reason: ControlledRunContextBlockedReason, message: string): ControlledRunContextValidationResult {
  return { ok: false, reason, message };
}

function textHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
