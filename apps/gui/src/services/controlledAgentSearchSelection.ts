import type { ControlledAgentLexicalSearchSnippet, ControlledAgentLexicalSearchSummary } from "./controlledAgentLexicalSearch";
import { redactSecrets, sanitizeDisplayText, sanitizeDisplayValue, sanitizeTimelineText } from "./redaction";

export type ControlledAgentSearchSelectionDiagnosticCode =
  | "missing_input"
  | "malformed_input"
  | "assistant_authority_blocked"
  | "unsafe_metadata"
  | "stale_result"
  | "over_budget"
  | "empty_selection";

export type ControlledAgentSearchSelectionDiagnostic = {
  code: ControlledAgentSearchSelectionDiagnosticCode;
  message: string;
};

export type ControlledAgentSearchSelectionInput = {
  searchResultId?: unknown;
  lexicalSearch?: unknown;
  selectedResultIds?: unknown;
  explicitUserGesture?: unknown;
  userGestureId?: unknown;
  selectionMintedBy?: unknown;
  assistantMinted?: unknown;
};

export type ControlledAgentSearchSelectionItem = {
  id: string;
  label: string;
  pathLabel: string;
  range: string;
  languageId: string;
  snippetByteCount: number;
  snippetLineCount: number;
  matchCount: number;
  truncated: boolean;
};

export type ControlledAgentSelectedSearchContext = {
  kind: "controlled_agent_selected_search_context";
  source: "controlled_lexical_search";
  searchResultId: string;
  selectedResultIds: string[];
  selectedLabels: string[];
  selectedCount: number;
  totalSnippetBytes: number;
  totalSnippetLines: number;
  budgets: {
    maxSelectedResults: number;
    maxTotalSnippetBytes: number;
    maxTotalSnippetLines: number;
    maxSnippetBytes: number;
    maxSnippetLines: number;
  };
  items: ControlledAgentSearchSelectionItem[];
  policy: ControlledAgentSearchSelectionPolicy;
};

export type ControlledAgentSearchSelectionPolicy = {
  cloudRequired: false;
  executionAllowed: false;
  canAttachToPrompt: false;
  canAutoAttachContext: false;
  canAutoSend: false;
  canAutoApply: false;
  canAutoRunVerification: false;
  canCallProvider: false;
  canReadFileBodies: false;
  canRunCommands: false;
  canUseTools: false;
  canPersistSelection: false;
};

export type ControlledAgentSearchSelectionResult = {
  state: "ready" | "blocked";
  selectedContext?: ControlledAgentSelectedSearchContext;
  diagnostics: ControlledAgentSearchSelectionDiagnostic[];
  details: Record<string, string | number | boolean | string[]>;
  authority: ControlledAgentSearchSelectionPolicy;
};

export const controlledAgentSearchSelectionLimits = {
  maxSelectedResults: 4,
  maxTotalSnippetBytes: 1200,
  maxTotalSnippetLines: 80,
  maxSnippetBytes: 400,
  maxSnippetLines: 24,
} as const;

const authority: ControlledAgentSearchSelectionPolicy = {
  cloudRequired: false,
  executionAllowed: false,
  canAttachToPrompt: false,
  canAutoAttachContext: false,
  canAutoSend: false,
  canAutoApply: false,
  canAutoRunVerification: false,
  canCallProvider: false,
  canReadFileBodies: false,
  canRunCommands: false,
  canUseTools: false,
  canPersistSelection: false,
};

const safeIdPattern = /^(?!assistant(?:[._:-]|$))(?!.*(?:assistant|sk-(?:proj-)?))[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/i;
const safeHashPattern = /^sha256:[a-f0-9]{64}$/;
const unsafeKeyPattern = /^(?:command|cmd|args|arguments|cwd|env|environment|network|git|provider|tool|shell|rawCommand|raw_command|rawFile|raw_file|rawFileBody|raw_file_body|fileBody|file_body|fileContents|file_contents|rawContent|raw_content|rawPrompt|raw_prompt|rawOutput|raw_output|diff|rawDiff|raw_diff|patch|browserStorage|browser_storage|storageDump|storage_dump|hiddenRead|hidden_read|hiddenSearch|hidden_search|regex|glob|index|indexing|autoSearch|auto_search|autoAttach|auto_attach|autoSend|auto_send|autoApply|auto_apply|autoRun|auto_run|prompt|providerPayload|provider_payload|privatePath|private_path)$/i;
const unsafeTextPattern = /authorization|bearer|api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|cookie|raw[_ -]?(?:file|prompt|command|output|log|body|content|diff)|file[_ -]?(?:body|content|dump)|provider|shell|command|cwd|\benv\b|\bgit\b|\btool\b|network|hidden[_ -]?(?:scan|read|search)|index(?:ing)?|auto[_ -]?(?:search|attach|send|apply|run)|private[_ -]?path|sk-(?:proj-)?[A-Za-z0-9_-]{8,}|BEGIN [A-Z ]*PRIVATE KEY|\/(?:Users|home|tmp|var|etc|opt|mnt|Volumes|private)(?=\/|$)|[A-Za-z]:(?:\\|\/)|~(?:\\|\/)/i;
const unsafeSnippetTextPattern = /authorization|bearer|api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|cookie|raw[_ -]?(?:file|prompt|command|output|log|body|content|diff)|file[_ -]?(?:body|content|dump)|hidden[_ -]?(?:scan|read|search)|auto[_ -]?(?:search|attach|send|apply|run)|private[_ -]?path|sk-(?:proj-)?[A-Za-z0-9_-]{8,}|BEGIN [A-Z ]*PRIVATE KEY|\/(?:Users|home|tmp|var|etc|opt|mnt|Volumes|private)(?=\/|$)|[A-Za-z]:(?:\\|\/)|~(?:\\|\/)/i;
const safePathPattern = /^(?!\/)(?![A-Za-z]:)(?!~)(?!.*(?:^|\/)\.)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\/\/)(?!.*[\\:*?"<>|{}\[\]$^+])(?!(?:^|.*\/)(?:node_modules|vendor|dist|build|out|target|coverage|__pycache__|generated|tmp|temp|secrets?|credentials?|private)(?:\/|$))(?!.*(?:^|[._-])(?:credentials?|password|secret|token|access[_-]?token|auth[_-]?token|api[_-]?key)(?:[._-]|$))[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/i;
const textEncoder = new TextEncoder();

export function createControlledAgentSearchSelection(input: unknown): ControlledAgentSearchSelectionResult {
  const diagnostics: ControlledAgentSearchSelectionDiagnostic[] = [];
  if (!isPlainObject(input)) {
    diagnostics.push(diagnostic("missing_input", "Controlled search selection metadata is absent."));
    return blocked(diagnostics, { displayOnly: true });
  }

  scanUnsafeMetadata(input, diagnostics, { allowSnippet: true });
  const metadata = input as ControlledAgentSearchSelectionInput;
  if (metadata.explicitUserGesture !== true || metadata.selectionMintedBy === "assistant" || metadata.assistantMinted === true) {
    diagnostics.push(diagnostic("assistant_authority_blocked", "Controlled search selection requires explicit user authority and cannot be assistant-minted."));
  }

  const searchResultId = safeId(metadata.searchResultId);
  const userGestureId = safeId(metadata.userGestureId);
  const lexicalSearch = sanitizeLexicalSearch(metadata.lexicalSearch);
  const selectedResultIds = safeSelectedIds(metadata.selectedResultIds);
  if (!searchResultId || !userGestureId || !lexicalSearch) {
    diagnostics.push(diagnostic("malformed_input", "Controlled search selection requires safe result, gesture, and lexical search metadata."));
  }
  if (selectedResultIds.length === 0) {
    diagnostics.push(diagnostic("empty_selection", "Select at least one controlled lexical search result."));
  }
  if (selectedResultIds.length > controlledAgentSearchSelectionLimits.maxSelectedResults) {
    diagnostics.push(diagnostic("over_budget", `Select at most ${controlledAgentSearchSelectionLimits.maxSelectedResults} controlled lexical search results.`));
  }

  if (diagnostics.length > 0 || !searchResultId || !userGestureId || !lexicalSearch) {
    return blocked(diagnostics, selectionDetails(searchResultId, selectedResultIds));
  }

  const available = lexicalSearch.snippets.map((snippet) => summarizeSnippet(snippet)).filter((item): item is ControlledAgentSearchSelectionItem => item !== undefined);
  if (available.length !== lexicalSearch.snippets.length) {
    diagnostics.push(diagnostic("unsafe_metadata", "Unsafe controlled lexical search snippet metadata was omitted."));
    return blocked(diagnostics, selectionDetails(searchResultId, selectedResultIds));
  }

  const availableById = new Map(available.map((item) => [item.id, item]));
  const selectedItems: ControlledAgentSearchSelectionItem[] = [];
  const seen = new Set<string>();
  for (const id of selectedResultIds) {
    if (seen.has(id)) {
      diagnostics.push(diagnostic("stale_result", "Duplicate controlled lexical search selection id was omitted."));
      continue;
    }
    seen.add(id);
    const item = availableById.get(id);
    if (!item) {
      diagnostics.push(diagnostic("stale_result", "Selected controlled lexical search result id is stale or unavailable."));
      continue;
    }
    selectedItems.push(item);
  }

  const totalSnippetBytes = selectedItems.reduce((total, item) => total + item.snippetByteCount, 0);
  const totalSnippetLines = selectedItems.reduce((total, item) => total + item.snippetLineCount, 0);
  if (totalSnippetBytes > controlledAgentSearchSelectionLimits.maxTotalSnippetBytes || totalSnippetLines > controlledAgentSearchSelectionLimits.maxTotalSnippetLines) {
    diagnostics.push(diagnostic("over_budget", "Selected controlled lexical search snippets exceed the bounded context budget."));
  }

  if (diagnostics.length > 0 || selectedItems.length !== selectedResultIds.length) {
    return blocked(diagnostics, selectionDetails(searchResultId, selectedResultIds, selectedItems.length, totalSnippetBytes, totalSnippetLines));
  }

  const selectedContext: ControlledAgentSelectedSearchContext = {
    kind: "controlled_agent_selected_search_context",
    source: "controlled_lexical_search",
    searchResultId,
    selectedResultIds,
    selectedLabels: selectedItems.map((item) => item.label),
    selectedCount: selectedItems.length,
    totalSnippetBytes,
    totalSnippetLines,
    budgets: controlledAgentSearchSelectionLimits,
    items: selectedItems,
    policy: authority,
  };

  return {
    state: "ready",
    selectedContext,
    diagnostics: [],
    details: selectionDetails(searchResultId, selectedResultIds, selectedItems.length, totalSnippetBytes, totalSnippetLines),
    authority,
  };
}

function sanitizeLexicalSearch(value: unknown): ControlledAgentLexicalSearchSummary | undefined {
  if (!isPlainObject(value)) return undefined;
  const status = value.status === "succeeded" || value.status === "truncated" ? value.status : undefined;
  const resultCount = boundedInteger(value.resultCount, 0, 10) ? value.resultCount : undefined;
  const totalMatchCount = boundedInteger(value.totalMatchCount, 0, 100) ? value.totalMatchCount : undefined;
  const totalSnippetBytes = boundedInteger(value.totalSnippetBytes, 0, 4000) ? value.totalSnippetBytes : undefined;
  const truncated = typeof value.truncated === "boolean" ? value.truncated : undefined;
  const message = safeDisplayText(value.message, 240);
  const resultHash = typeof value.resultHash === "string" && safeHashPattern.test(value.resultHash) ? value.resultHash : undefined;
  const snippets = sanitizeSnippets(value.snippets);
  if (!status || resultCount === undefined || totalMatchCount === undefined || totalSnippetBytes === undefined || truncated === undefined || !message || !snippets || snippets.length !== resultCount) return undefined;
  return stripUndefined({ status: status as "succeeded" | "truncated", resultCount, totalMatchCount, totalSnippetBytes, truncated, resultHash, snippets, message });
}

function sanitizeSnippets(value: unknown): ControlledAgentLexicalSearchSnippet[] | undefined {
  if (!Array.isArray(value) || value.length > 10) return undefined;
  const snippets = value.map(sanitizeSnippet);
  return snippets.every((item): item is ControlledAgentLexicalSearchSnippet => item !== undefined) ? snippets : undefined;
}

function sanitizeSnippet(value: unknown): ControlledAgentLexicalSearchSnippet | undefined {
  if (!isPlainObject(value)) return undefined;
  const pathLabel = safePath(value.pathLabel);
  const range = sanitizeRange(value.range);
  const languageId = safeLanguageId(value.languageId);
  const snippet = safeSnippet(value.snippet);
  const snippetByteCount = boundedInteger(value.snippetByteCount, 1, controlledAgentSearchSelectionLimits.maxSnippetBytes) ? value.snippetByteCount : undefined;
  const snippetHash = typeof value.snippetHash === "string" && safeHashPattern.test(value.snippetHash) ? value.snippetHash : undefined;
  const matchCount = boundedInteger(value.matchCount, 0, 20) ? value.matchCount : undefined;
  const truncated = typeof value.truncated === "boolean" ? value.truncated : undefined;
  if (!pathLabel || !range || !snippet || snippetByteCount === undefined || byteLength(snippet) !== snippetByteCount || lineCount(snippet) > controlledAgentSearchSelectionLimits.maxSnippetLines || !snippetHash || matchCount === undefined || truncated === undefined) return undefined;
  return stripUndefined({ pathLabel, range, languageId, snippet, snippetByteCount, snippetHash, matchCount, truncated });
}

function summarizeSnippet(snippet: ControlledAgentLexicalSearchSnippet): ControlledAgentSearchSelectionItem | undefined {
  const pathLabel = safePath(snippet.pathLabel);
  const range = sanitizeRange(snippet.range);
  const languageId = safeLanguageId(snippet.languageId) ?? "unknown";
  const snippetText = safeSnippet(snippet.snippet);
  if (!pathLabel || !range || !snippetText || !safeHashPattern.test(snippet.snippetHash)) return undefined;
  const snippetLineCount = lineCount(snippetText);
  const label = safeLabel(`${pathLabel} · ${formatRange(range)} · ${languageId}`);
  if (!label) return undefined;
  return {
    id: resultIdForSnippet(snippet),
    label,
    pathLabel,
    range: formatRange(range),
    languageId,
    snippetByteCount: snippet.snippetByteCount,
    snippetLineCount,
    matchCount: snippet.matchCount,
    truncated: snippet.truncated,
  };
}

export function controlledAgentSearchSelectionResultId(snippet: ControlledAgentLexicalSearchSnippet): string {
  return resultIdForSnippet(snippet);
}

function resultIdForSnippet(snippet: ControlledAgentLexicalSearchSnippet): string {
  return `search-result-${stableHash(`${snippet.pathLabel}:${formatRange(snippet.range)}:${snippet.snippetHash}`)}`;
}

function safeSelectedIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(safeId).filter((item): item is string => item !== undefined).slice(0, controlledAgentSearchSelectionLimits.maxSelectedResults + 1);
}

function sanitizeRange(value: unknown): ControlledAgentLexicalSearchSnippet["range"] | undefined {
  if (!isPlainObject(value) || !isPlainObject(value.start) || !isPlainObject(value.end)) return undefined;
  const startLine = boundedInteger(value.start.line, 0, 1000000) ? value.start.line : undefined;
  const startCharacter = boundedInteger(value.start.character, 0, 1000000) ? value.start.character : undefined;
  const endLine = boundedInteger(value.end.line, 0, 1000000) ? value.end.line : undefined;
  const endCharacter = boundedInteger(value.end.character, 0, 1000000) ? value.end.character : undefined;
  if (startLine === undefined || startCharacter === undefined || endLine === undefined || endCharacter === undefined) return undefined;
  if (endLine < startLine || (endLine === startLine && endCharacter < startCharacter)) return undefined;
  return { start: { line: startLine, character: startCharacter }, end: { line: endLine, character: endCharacter } };
}

function formatRange(range: ControlledAgentLexicalSearchSnippet["range"]): string {
  return `${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`;
}

function selectionDetails(searchResultId: string | undefined, selectedResultIds: string[], selectedCount = 0, totalSnippetBytes = 0, totalSnippetLines = 0): Record<string, string | number | boolean | string[]> {
  return sanitizeDetails({ displayOnly: true, searchResultId, selectedResultIds, selectedCount, totalSnippetBytes, totalSnippetLines, autoAttachAllowed: false, providerAllowed: false });
}

function blocked(diagnostics: ControlledAgentSearchSelectionDiagnostic[], details: Record<string, string | number | boolean | string[]>): ControlledAgentSearchSelectionResult {
  return { state: "blocked", diagnostics: diagnostics.map((item) => diagnostic(item.code, item.message)).slice(0, 24), details: sanitizeDetails(diagnostics.some((item) => item.code === "unsafe_metadata") ? { ...details, redacted: "[redacted]" } : details), authority };
}

function scanUnsafeMetadata(value: unknown, diagnostics: ControlledAgentSearchSelectionDiagnostic[], options: { allowSnippet?: boolean } = {}, keyPath = "", depth = 0, seen = new WeakSet<object>()): void {
  if (depth > 8) return;
  const currentKey = (keyPath.split(".").pop() ?? "").replace(/\[\d+\]$/u, "");
  if (typeof value === "string") {
    if (options.allowSnippet && currentKey === "snippet") {
      if (!safeSnippet(value)) diagnostics.push(diagnostic("unsafe_metadata", "Unsafe controlled search selection snippet omitted."));
      return;
    }
    if (unsafeTextPattern.test(value)) diagnostics.push(diagnostic("unsafe_metadata", `Unsafe controlled search selection metadata omitted near ${sanitizeDisplayText(keyPath || "value")}.`));
    return;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    value.slice(0, 50).forEach((item, index) => scanUnsafeMetadata(item, diagnostics, options, `${keyPath}[${index}]`, depth + 1, seen));
    return;
  }
  if (isPlainObject(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    for (const [key, item] of Object.entries(value).slice(0, 50)) {
      if (unsafeKeyPattern.test(key)) diagnostics.push(diagnostic("unsafe_metadata", `Unsupported controlled search selection field ${sanitizeDisplayText(key)}.`));
      scanUnsafeMetadata(item, diagnostics, options, keyPath ? `${keyPath}.${key}` : key, depth + 1, seen);
    }
  }
}

function sanitizeDetails(input: Record<string, unknown>): Record<string, string | number | boolean | string[]> {
  const sanitized = sanitizeDisplayValue(input);
  if (!isPlainObject(sanitized)) return { displayOnly: true };
  const details: Record<string, string | number | boolean | string[]> = {};
  for (const [key, value] of Object.entries(sanitized).slice(0, 32)) {
    const safeKey = sanitizeDisplayText(key);
    if (typeof value === "string") details[safeKey] = safeText(value, 180);
    if (typeof value === "number" && Number.isFinite(value)) details[safeKey] = value;
    if (typeof value === "boolean") details[safeKey] = value;
    if (Array.isArray(value)) details[safeKey] = value.filter((item): item is string => typeof item === "string").map((item) => safeText(item, 80)).slice(0, 8);
  }
  return details;
}

function safeId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const sanitized = sanitizeDisplayText(value).trim();
  return safeIdPattern.test(sanitized) && !unsafeTextPattern.test(sanitized) ? sanitized : undefined;
}

function safePath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const sanitized = sanitizeDisplayText(value).trim();
  return safePathPattern.test(sanitized) && !unsafeTextPattern.test(sanitized) ? sanitized : undefined;
}

function safeLanguageId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const sanitized = sanitizeDisplayText(value).trim();
  return /^[A-Za-z0-9_.+-]{1,64}$/.test(sanitized) && !unsafeTextPattern.test(sanitized) ? sanitized : undefined;
}

function safeSnippet(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (unsafeSnippetTextPattern.test(value) || redactSecrets(value) !== value) return undefined;
  const sanitized = sanitizeTimelineText(value).trim();
  return sanitized.length > 0 && sanitized.length <= controlledAgentSearchSelectionLimits.maxSnippetBytes && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(sanitized) && !unsafeSnippetTextPattern.test(sanitized) ? sanitized : undefined;
}

function safeDisplayText(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const sanitized = sanitizeTimelineText(value).replace(/[\r\n\t<>]+/g, " ").trim();
  return sanitized.length > 0 && sanitized.length <= limit && !unsafeTextPattern.test(sanitized) ? sanitizeDisplayText(sanitized) : undefined;
}

function safeLabel(value: string): string | undefined {
  const sanitized = sanitizeDisplayText(value).trim();
  return sanitized && redactSecrets(value) === value && !unsafeTextPattern.test(sanitized) && !sanitized.includes("[redacted]") ? sanitized : undefined;
}

function safeText(value: string, limit: number): string {
  const sanitized = sanitizeTimelineText(value).trim();
  const safe = sanitized.length > 0 ? sanitized : "[redacted]";
  return safe.length > limit ? `${safe.slice(0, limit)}…` : safe;
}

function diagnostic(code: ControlledAgentSearchSelectionDiagnosticCode, message: string): ControlledAgentSearchSelectionDiagnostic {
  return { code, message: safeText(message, 200) };
}

function boundedInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function byteLength(value: string): number {
  return textEncoder.encode(value).length;
}

function lineCount(value: string): number {
  return value.split(/\r\n|\r|\n/).length;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
