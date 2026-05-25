const shortDisplayLimit = 240;
const timelineDisplayLimit = 2000;
const defaultDisplayLimit = 500;

const secretKeyPattern = String.raw`(?:access[_-]?token|refresh[_-]?token|session[_-]?token|auth[_-]?token|api[_-]?key|client[_-]?secret|authorization|proxy[_-]?authorization|bearer|cookie|set-cookie|code[_-]?verifier|pkce[_-]?verifier|verifier|github[_-]?token|oauth[_-]?refresh[_-]?token|provider[_-]?client[_-]?secret|openai[_-]?api[_-]?key|anthropic[_-]?api[_-]?key|yet[_-]?ai[_-]?auth[_-]?token)`;

const redactionPatterns: Array<[RegExp, string]> = [
  [/\b(?:Authorization|Proxy-Authorization|Cookie|Set-Cookie)\s*:\s*[^\r\n]*/gi, "[redacted]"],
  [new RegExp(String.raw`([?&;])${secretKeyPattern}\s*=\s*[^\s&#;]+`, "gi"), "$1[redacted]"],
  [new RegExp(String.raw`(["'])${secretKeyPattern}\1\s*:\s*(["'])(?:\\.|(?!\2).)*\2`, "gi"), "[redacted]"],
  [new RegExp(String.raw`\b${secretKeyPattern}\b\s*[:=]\s*[^\s,;)}\]]+`, "gi"), "[redacted]"],
  [/(?:[A-Za-z]:[\\/](?:[^\\/\s,;]+[\\/])*\.codex[\\/]auth\.json|(?:~|\.{1,2})?[\\/]?\.codex[\\/]auth\.json|(?:[A-Za-z]:[\\/](?:[^\\/\s,;]+[\\/])*|\/(?:[^/\s,;]+\/)*|\.\/|\.\.\/)?auth\.json)\b/gi, "[redacted]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "[redacted]"],
  [/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted]"],
  [/\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g, "[redacted]"],
  [/\b[A-Za-z0-9+/=_-]{48,}\b/g, "[redacted]"],
];

export function redactSecrets(value: string): string {
  return redactionPatterns.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), value);
}

export function sanitizeDisplayText(value: string): string {
  return truncate(redactSecrets(value).trim(), shortDisplayLimit);
}

export function sanitizeTimelineText(value: string): string {
  return truncate(redactSecrets(value), timelineDisplayLimit);
}

export function sanitizeDisplayValue(value: unknown): unknown {
  if (typeof value === "string") {
    return sanitizeTimelineText(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDisplayValue(item));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => isSecretLikeKey(key) ? ["[redacted]", "[redacted]"] : [key, sanitizeDisplayValue(item)]));
  }
  return value;
}

export function isSecretLikeKey(key: string): boolean {
  return new RegExp(secretKeyPattern, "i").test(key);
}

export function sanitizeErrorText(value: string): string {
  return truncate(redactSecrets(value), defaultDisplayLimit);
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}
