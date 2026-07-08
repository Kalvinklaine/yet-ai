import type { ExplicitContextBundleItem } from "./activeEditorContext";
import { summarizeExplicitContextBundleItem } from "./activeEditorContext";
import { redactSecrets, sanitizeDisplayText, sanitizeTimelineText } from "./redaction";

export type ControlledAgentTaskPresetId = "fix-small-bug" | "add-focused-test" | "refactor-small-function" | "explain-selected-code" | "improve-copy-or-typing";

export type ControlledAgentTaskPresetWorkflowClass = "fix" | "test" | "refactor" | "inspect" | "improve";

export type ControlledAgentTaskPreset = {
  presetId: ControlledAgentTaskPresetId;
  label: string;
  intent: string;
  workflowClass: ControlledAgentTaskPresetWorkflowClass;
  allowedSources: string[];
  applySupported: boolean;
  maxFiles: number;
  verificationSupported: boolean;
};

export type ControlledAgentTaskPresetContext = {
  goal?: unknown;
  contextItems?: readonly ExplicitContextBundleItem[];
  selectedSearchResultCount?: unknown;
  selectedMemoryCount?: unknown;
  verificationEvidenceCount?: unknown;
  presetConfig?: unknown;
};

export type ControlledAgentTaskPresetPolicy = {
  canAutoSend: false;
  canAutoSearch: false;
  canAutoAttachContext: false;
  canAutoApply: false;
  canAutoRunVerification: false;
  canCallProviders: false;
  canReadHiddenFiles: false;
  canUseFreeformCommands: false;
};

export type ControlledAgentTaskPresetGuidance = {
  kind: "controlled_agent_task_preset_guidance";
  authority: "draft_guidance_only";
  presetId: ControlledAgentTaskPresetId;
  label: string;
  useful: boolean;
  contextSummary: {
    totalCount: number;
    activeEditorCount: number;
    snippetCount: number;
    memoryCount: number;
    verificationCount: number;
    selectedSearchResultCount: number;
    labels: string[];
  };
  recommendedNextSteps: string[];
  draftPrompt: string;
  diagnostics: string[];
  policy: ControlledAgentTaskPresetPolicy;
};

const labelLimit = 160;
const goalLimit = 220;
const maxLabels = 8;
const maxDiagnostics = 16;

export const controlledAgentTaskPresets: ControlledAgentTaskPreset[] = [
  {
    presetId: "fix-small-bug",
    label: "Fix small bug",
    intent: "Investigate a focused defect using explicit selected context and propose a bounded manual change.",
    workflowClass: "fix",
    allowedSources: ["active file excerpt", "selected range", "user selected files", "user selected search results"],
    applySupported: true,
    maxFiles: 3,
    verificationSupported: true,
  },
  {
    presetId: "add-focused-test",
    label: "Add focused test",
    intent: "Draft a narrow test addition for selected behavior or a selected safe test location.",
    workflowClass: "test",
    allowedSources: ["active file excerpt", "selected range", "user selected files", "user selected search results"],
    applySupported: true,
    maxFiles: 2,
    verificationSupported: true,
  },
  {
    presetId: "refactor-small-function",
    label: "Refactor small function",
    intent: "Suggest a small behavior-preserving rework for one selected function.",
    workflowClass: "refactor",
    allowedSources: ["active file excerpt", "selected range", "user selected files"],
    applySupported: true,
    maxFiles: 1,
    verificationSupported: true,
  },
  {
    presetId: "explain-selected-code",
    label: "Explain selected code",
    intent: "Explain the selected code using only visible selected context.",
    workflowClass: "inspect",
    allowedSources: ["active file excerpt", "selected range", "user selected search results"],
    applySupported: false,
    maxFiles: 0,
    verificationSupported: false,
  },
  {
    presetId: "improve-copy-or-typing",
    label: "Improve copy or typing",
    intent: "Suggest a small wording or type annotation improvement in selected files.",
    workflowClass: "improve",
    allowedSources: ["active file excerpt", "selected range", "user selected files"],
    applySupported: true,
    maxFiles: 2,
    verificationSupported: true,
  },
];

export function buildControlledAgentTaskPresetGuidance(presetId: ControlledAgentTaskPresetId, context: ControlledAgentTaskPresetContext = {}): ControlledAgentTaskPresetGuidance {
  const preset = presetById(presetId);
  const diagnostics = validateControlledAgentTaskPresetConfig(context.presetConfig ?? preset);
  const contextSummary = summarizePresetContext(context);
  const goal = safeLabel(context.goal, goalLimit) || "Describe the local coding task goal before asking for preset guidance.";
  const steps = recommendedSteps(preset, contextSummary, diagnostics.length > 0);
  const draftPrompt = buildDraftPrompt(preset, goal, contextSummary, steps, diagnostics.length > 0);
  return {
    kind: "controlled_agent_task_preset_guidance",
    authority: "draft_guidance_only",
    presetId: preset.presetId,
    label: preset.label,
    useful: diagnostics.length === 0,
    contextSummary,
    recommendedNextSteps: steps,
    draftPrompt,
    diagnostics,
    policy: noAuthorityPolicy(),
  };
}

export function validateControlledAgentTaskPresetConfig(value: unknown): string[] {
  const diagnostics: string[] = [];
  scanUnsafePresetValue(value, diagnostics);
  if (isPlainObject(value)) {
    validateBooleanFalse(value, diagnostics, ["hiddenReadAllowed", "hiddenSearchAllowed", "indexingAllowed", "broadWorkspaceScanAllowed", "providerToolsAllowed", "rawProviderPayloadStored", "automaticApplyAllowed", "broadWorkspaceMutationAllowed", "freeformCommandAllowed", "automaticRunAllowed", "productionReady", "releaseReady", "marketplaceReady"]);
    validateBooleanTrue(value, diagnostics, ["requiresReview", "requiresUserConfirmation", "requiresUserApproval", "startRequiresUser", "contextRequiresUser"]);
    validateMutationScope(value, diagnostics);
    validateCommandMode(value, diagnostics);
  }
  return uniqueStrings(diagnostics).slice(0, maxDiagnostics);
}

function presetById(presetId: ControlledAgentTaskPresetId): ControlledAgentTaskPreset {
  const preset = controlledAgentTaskPresets.find((item) => item.presetId === presetId);
  if (!preset) {
    throw new Error("Unknown controlled agent task preset.");
  }
  return preset;
}

function summarizePresetContext(context: ControlledAgentTaskPresetContext): ControlledAgentTaskPresetGuidance["contextSummary"] {
  const items = Array.isArray(context.contextItems) ? context.contextItems : [];
  const memoryCount = items.filter((item) => item.kind === "project_memory").length + safeCount(context.selectedMemoryCount);
  const verificationCount = items.filter((item) => item.kind === "verification_output").length + safeCount(context.verificationEvidenceCount);
  const selectedSearchResultCount = items.filter((item) => item.kind === "workspace_snippet").length + safeCount(context.selectedSearchResultCount);
  return {
    totalCount: items.length,
    activeEditorCount: items.filter((item) => item.kind === "active_editor").length,
    snippetCount: items.filter((item) => item.kind === "workspace_snippet").length,
    memoryCount,
    verificationCount,
    selectedSearchResultCount,
    labels: items.slice(0, maxLabels).map((item) => safeLabel(summarizeExplicitContextBundleItem(item).line, labelLimit)).filter(Boolean),
  };
}

function recommendedSteps(preset: ControlledAgentTaskPreset, summary: ControlledAgentTaskPresetGuidance["contextSummary"], blocked: boolean): string[] {
  if (blocked) {
    return ["Stop: the selected preset metadata is unsafe. Choose a safe preset before drafting a prompt."];
  }
  const steps = ["Review the selected preset and goal before sending any prompt."];
  if (summary.totalCount === 0) {
    steps.push("Attach explicit selected context first; do not ask the assistant to read hidden files or search automatically.");
  } else {
    steps.push(`Use the ${summary.totalCount} selected context item${summary.totalCount === 1 ? "" : "s"} only; cite uncertainty when context is incomplete.`);
  }
  if (preset.workflowClass === "fix") {
    steps.push("Ask for the likely cause, a smallest bounded manual edit proposal, and a user-approved verification choice.");
  }
  if (preset.workflowClass === "test") {
    steps.push("Ask for focused test scenarios and a bounded test edit proposal only after a user-selected test location is available.");
  }
  if (preset.workflowClass === "refactor") {
    steps.push("Ask for a behavior-preserving proposal for one selected function and a manual review stop before edits.");
  }
  if (preset.workflowClass === "inspect") {
    steps.push("Ask for explanation, assumptions, and missing context only; do not request edits or verification runs.");
  }
  if (preset.workflowClass === "improve") {
    steps.push("Ask for a small copy or typing improvement with a bounded manual proposal and no broad rewrite.");
  }
  if (preset.verificationSupported && summary.verificationCount === 0) {
    steps.push("If verification is needed, choose an existing allowlisted verification option manually after reviewing the proposal.");
  }
  return steps;
}

function buildDraftPrompt(preset: ControlledAgentTaskPreset, goal: string, summary: ControlledAgentTaskPresetGuidance["contextSummary"], steps: string[], blocked: boolean): string {
  const lines = [
    `${preset.label} preset guidance`,
    "",
    "Goal",
    goal,
    "",
    "Preset intent",
    safeLabel(preset.intent, labelLimit),
    "",
    "Available explicit context",
    `- Selected items: ${summary.totalCount}`,
    `- Active file excerpts: ${summary.activeEditorCount}`,
    `- User selected snippets/search results: ${summary.selectedSearchResultCount}`,
    `- Project memory titles or selected memory items: ${summary.memoryCount}`,
    `- Verification evidence attachments: ${summary.verificationCount}`,
    summary.labels.length > 0 ? summary.labels.map((label) => `- ${label}`).join("\n") : "- No explicit context is selected yet.",
    "",
    "Boundaries",
    "Use only the explicit selected context listed above. Do not infer from hidden files, unselected project files, private paths, raw memory bodies, browser storage, provider logs, or secrets.",
    "Do not auto-send, auto-search, auto-attach context, read files, index the workspace, call tools, call providers, run shell or git commands, apply edits, save memory, or run verification.",
    preset.applySupported ? `Any edit proposal must be bounded to existing text files, at most ${preset.maxFiles} file${preset.maxFiles === 1 ? "" : "s"}, and require manual review plus explicit user confirmation.` : "This preset is explanation-only. Do not propose workspace mutations.",
    preset.verificationSupported ? "Verification guidance may name a needed allowlisted verification choice, but it must wait for explicit user approval." : "Do not suggest running verification for this explanation-only preset unless the user separately asks for it.",
    "",
    "Recommended next steps",
    steps.map((step) => `- ${step}`).join("\n"),
    "",
    presetInstruction(preset),
  ];
  if (blocked) {
    lines.push("", "Unsafe preset metadata was detected, so do not send this draft until the preset is replaced with safe metadata.");
  }
  return lines.join("\n");
}

function presetInstruction(preset: ControlledAgentTaskPreset): string {
  if (preset.workflowClass === "fix") {
    return "Draft request: identify the likely small bug from explicit context, separate facts from assumptions, propose the smallest manual fix, and list the safest user-approved verification option.";
  }
  if (preset.workflowClass === "test") {
    return "Draft request: propose focused tests for visible behavior, name expected outcomes, and stop before any edit unless the user confirms the selected test file.";
  }
  if (preset.workflowClass === "refactor") {
    return "Draft request: propose a behavior-preserving rework for the selected function only, explain risk, and stop at manual review.";
  }
  if (preset.workflowClass === "inspect") {
    return "Draft request: explain the selected code clearly, cite only selected context, and list missing context without asking for hidden reads.";
  }
  return "Draft request: propose a small wording or typing improvement, keep the change bounded, and stop before manual apply or verification.";
}

function noAuthorityPolicy(): ControlledAgentTaskPresetPolicy {
  return {
    canAutoSend: false,
    canAutoSearch: false,
    canAutoAttachContext: false,
    canAutoApply: false,
    canAutoRunVerification: false,
    canCallProviders: false,
    canReadHiddenFiles: false,
    canUseFreeformCommands: false,
  };
}

function validateBooleanFalse(value: unknown, diagnostics: string[], keys: string[], path = "preset", seen = new WeakSet<object>()): void {
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return;
    }
    seen.add(value);
    value.forEach((item, index) => validateBooleanFalse(item, diagnostics, keys, `${path}[${index}]`, seen));
    return;
  }
  if (!isPlainObject(value)) {
    return;
  }
  if (seen.has(value)) {
    return;
  }
  seen.add(value);
  for (const [key, item] of Object.entries(value)) {
    if (keys.includes(key) && item !== false) {
      diagnostics.push(`Unsafe preset flag rejected near ${safeLabel(path + "." + key, 80)}.`);
    }
    validateBooleanFalse(item, diagnostics, keys, `${path}.${key}`, seen);
  }
}

function validateBooleanTrue(value: unknown, diagnostics: string[], keys: string[], path = "preset", seen = new WeakSet<object>()): void {
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return;
    }
    seen.add(value);
    value.forEach((item, index) => validateBooleanTrue(item, diagnostics, keys, `${path}[${index}]`, seen));
    return;
  }
  if (!isPlainObject(value)) {
    return;
  }
  if (seen.has(value)) {
    return;
  }
  seen.add(value);
  for (const [key, item] of Object.entries(value)) {
    if (keys.includes(key) && item !== true) {
      diagnostics.push(`Required user gate missing near ${safeLabel(path + "." + key, 80)}.`);
    }
    validateBooleanTrue(item, diagnostics, keys, `${path}.${key}`, seen);
  }
}

function validateMutationScope(value: unknown, diagnostics: string[]): void {
  if (!isPlainObject(value)) {
    return;
  }
  const scope = findKeyValue(value, "workspaceMutationScope");
  if (typeof scope === "string" && scope !== "none" && scope !== "bounded_existing_text_files") {
    diagnostics.push("Unsafe workspace mutation scope rejected.");
  }
  const maxFiles = findKeyValue(value, "maxFiles");
  if (typeof maxFiles === "number" && (!Number.isInteger(maxFiles) || maxFiles < 0 || maxFiles > 5)) {
    diagnostics.push("Unsafe broad file count rejected.");
  }
}

function validateCommandMode(value: unknown, diagnostics: string[]): void {
  if (!isPlainObject(value)) {
    return;
  }
  const mode = findKeyValue(value, "allowedCommandMode");
  if (typeof mode === "string" && mode !== "none" && mode !== "fixed_allowlisted_ids") {
    diagnostics.push("Unsafe command mode rejected.");
  }
}

function scanUnsafePresetValue(value: unknown, diagnostics: string[], path = "preset", depth = 0, seen = new WeakSet<object>()): void {
  if (depth > 8 || diagnostics.length >= maxDiagnostics * 2) {
    return;
  }
  if (typeof value === "string") {
    if (isUnsafeText(value)) {
      diagnostics.push(`Unsafe preset text rejected near ${safeLabel(path, 80)}.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return;
    }
    seen.add(value);
    value.slice(0, 50).forEach((item, index) => scanUnsafePresetValue(item, diagnostics, `${path}[${index}]`, depth + 1, seen));
    return;
  }
  if (!isPlainObject(value)) {
    return;
  }
  if (seen.has(value)) {
    return;
  }
  seen.add(value);
  for (const [key, item] of Object.entries(value).slice(0, 50)) {
    if (unsafeKeyPattern.test(key)) {
      diagnostics.push(`Unsafe preset field rejected near ${safeLabel(path + "." + key, 80)}.`);
    }
    scanUnsafePresetValue(item, diagnostics, `${path}.${key}`, depth + 1, seen);
  }
}

function findKeyValue(value: unknown, key: string, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > 8 || !isPlainObject(value)) {
    return undefined;
  }
  if (seen.has(value)) {
    return undefined;
  }
  seen.add(value);
  if (Object.prototype.hasOwnProperty.call(value, key)) {
    return value[key];
  }
  for (const item of Object.values(value)) {
    if (isPlainObject(item)) {
      const found = findKeyValue(item, key, depth + 1, seen);
      if (found !== undefined) {
        return found;
      }
    }
  }
  return undefined;
}

function safeCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.min(Math.floor(value), 99);
}

function safeLabel(value: unknown, limit: number): string {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    return "";
  }
  const sanitized = sanitizeTimelineText(sanitizeDisplayText(String(value))).replace(/[\r\n]+/g, " ").trim();
  const redacted = redactUnsafeDisplayText(sanitized);
  return redacted.length > limit ? `${redacted.slice(0, limit)}…` : redacted;
}

function redactUnsafeDisplayText(value: string): string {
  if (!value) {
    return value;
  }
  const redacted = redactSecrets(value);
  if (privatePathPattern.test(redacted) || stackTracePattern.test(redacted)) {
    return "[redacted]";
  }
  return redacted;
}

function isUnsafeText(value: string): boolean {
  const redacted = redactSecrets(value);
  return redacted !== value || unsafeTextPattern.test(value) || privatePathPattern.test(value) || stackTracePattern.test(value);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => safeLabel(value, labelLimit)).filter(Boolean)));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const unsafeKeyPattern = /^(?:prompt|rawPrompt|raw_prompt|file|filePath|absolutePath|path|privatePath|private_path|diff|rawDiff|raw_diff|patch|command|cmd|args|arguments|cwd|env|environment|secret|token|apiKey|api_key|providerPayload|provider_payload|tool|toolCall|tool_call|output|rawOutput|raw_output|stdout|stderr)$/i;
const unsafeTextPattern = /(?:^|\b)(?:raw[_ -]?(?:prompt|file|diff|command|output|payload)|file[_ -]?(?:body|content)|provider[_ -]?(?:tool|payload|response)|tool[_ -]?call|hidden[_ -]?(?:read|search)|private[_ -]?path|broad[_ -]?(?:workspace|mutation|rewrite)|free(?:form|-form| form)[_ -]?command|arbitrary[_ -]?(?:shell|command)|production[_ -]?ready|release[_ -]?ready|marketplace[_ -]?ready|command|cmd|cwd|env|shell|git|stdout|stderr|auto[_ -]?(?:apply|run|verify|search|send|attach)|indexing)(?:\b|$)/i;
const privatePathPattern = /(?:^|\s)(?:\/(?:Users|home|tmp|var|etc|opt|mnt|Volumes|private)(?=\/|\s|$)|[A-Za-z]:(?:\\|\/)|~(?:\\|\/))/;
const stackTracePattern = /(?:^|\n)\s*at\s+\S+\s+\([^)]*:\d+:\d+\)|Traceback \(most recent call last\):|panicked at .*:\d+:\d+/;
