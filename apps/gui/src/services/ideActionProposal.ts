import type { IdeActionRequestPayload, WorkspaceEditRange } from "../bridge/bridgeAdapter";

export type AssistantIdeActionProposal = {
  type: "assistant.ideActionProposal";
  version: "2026-05-15";
  requiresUserConfirmation: true;
  cloudRequired: false;
  summary: string;
} & IdeActionRequestPayload;

const proposalVersion = "2026-05-15";

export function parseAssistantIdeActionProposalContent(content: string): AssistantIdeActionProposal | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.trim());
  } catch {
    return null;
  }

  if (!isAssistantIdeActionProposal(parsed)) {
    return null;
  }
  return parsed;
}

export function toIdeActionRequestPayload(proposal: AssistantIdeActionProposal): IdeActionRequestPayload {
  if (proposal.action === "getContextSnapshot") {
    return { action: "getContextSnapshot" };
  }
  if (proposal.action === "openWorkspaceFile") {
    return { action: "openWorkspaceFile", workspaceRelativePath: proposal.workspaceRelativePath };
  }
  return { action: "revealWorkspaceRange", workspaceRelativePath: proposal.workspaceRelativePath, range: proposal.range };
}

export function describeIdeActionProposal(proposal: AssistantIdeActionProposal): string {
  if (proposal.action === "getContextSnapshot") {
    return "Get IDE context";
  }
  if (proposal.action === "openWorkspaceFile") {
    return "Open workspace file";
  }
  return "Reveal workspace range";
}

function isAssistantIdeActionProposal(value: unknown): value is AssistantIdeActionProposal {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["type", "version", "requiresUserConfirmation", "cloudRequired", "summary", "action", "workspaceRelativePath", "range"])) {
    return false;
  }
  if (
    value.type !== "assistant.ideActionProposal" ||
    value.version !== proposalVersion ||
    value.requiresUserConfirmation !== true ||
    value.cloudRequired !== false ||
    !safeSummary(value.summary)
  ) {
    return false;
  }

  if (value.action === "getContextSnapshot") {
    return hasOnlyKeys(value, ["type", "version", "requiresUserConfirmation", "cloudRequired", "summary", "action"]);
  }
  if (value.action === "openWorkspaceFile") {
    return hasOnlyKeys(value, ["type", "version", "requiresUserConfirmation", "cloudRequired", "summary", "action", "workspaceRelativePath"]) && requiredSafeRelativePath(value.workspaceRelativePath);
  }
  if (value.action === "revealWorkspaceRange") {
    return hasOnlyKeys(value, ["type", "version", "requiresUserConfirmation", "cloudRequired", "summary", "action", "workspaceRelativePath", "range"]) && requiredSafeRelativePath(value.workspaceRelativePath) && isEditRange(value.range);
  }
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function requiredSafeRelativePath(value: unknown): boolean {
  return safePath(value, 512);
}

function safePath(value: unknown, maxLength: number): boolean {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || value.startsWith("/") || value.startsWith("~") || value.includes("%") || value.includes("\\") || value.includes(":") || value.includes("?") || value.includes("#")) {
    return false;
  }
  if (/^[^\u0000-\u001f\u007f-\u009f]+$/.test(value) === false) {
    return false;
  }
  return value.split("/").every((part) => part.length > 0 && part !== "." && part !== ".." && !isSecretLikePathSegment(part));
}

function isSecretLikePathSegment(value: string): boolean {
  return /^(?:auth|authorization|bearer|cookie|credential|credentials|password|secret|token|access[_-]?token|api[_-]?key)(?:\.|-|_|$)/i.test(value) ||
    /(?:^|[._-])(?:auth|credential|credentials|password|secret|token|access[_-]?token|api[_-]?key)(?:[._-]|$)/i.test(value) ||
    /^sk-(?:proj-)?[A-Za-z0-9_-]{8,}/i.test(value);
}

function isEditRange(value: unknown): value is WorkspaceEditRange {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["start", "end"]) || !isEditPosition(value.start) || !isEditPosition(value.end)) {
    return false;
  }
  return value.end.line > value.start.line || (value.end.line === value.start.line && value.end.character >= value.start.character);
}

function isEditPosition(value: unknown): value is { line: number; character: number } {
  return isPlainObject(value) && hasOnlyKeys(value, ["line", "character"]) && Number.isInteger(value.line) && Number.isInteger(value.character) && optionalBoundedInteger(value.line, 0, 1000000) && optionalBoundedInteger(value.character, 0, 1000000);
}

function optionalBoundedInteger(value: unknown, min: number, max: number): boolean {
  return value === undefined || (Number.isInteger(value) && (value as number) >= min && (value as number) <= max);
}

function safeSummary(value: unknown): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 280 && !hasControlCharacters(value) && !unsafeDisplayText(value) && !hasPrivatePathLikeText(value) && !hasKeyLikeSecretText(value);
}

function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u001f\u007f-\u009f]/.test(value);
}

function hasPrivatePathLikeText(value: string): boolean {
  return /(?:\/(?:Users|home|tmp|var|Volumes|Private|etc|opt|mnt)(?=\/|$|[^A-Za-z0-9_])|~[\/\\]|[A-Za-z]:[\/\\])/i.test(value);
}

function hasKeyLikeSecretText(value: string): boolean {
  return /(?:^|[^A-Za-z0-9_-])sk-(?:proj-)?[A-Za-z0-9_-]{8,}/i.test(value);
}

function unsafeDisplayText(value: string): boolean {
  return /authorization|bearer|cookie|api[_-]?key|token|secret|password|private[_-]?path|provider[_-]?response|raw[_-]?prompt|file[_-]?content/i.test(value);
}
