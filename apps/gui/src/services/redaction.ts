const shortDisplayLimit = 240;
const timelineDisplayLimit = 2000;
const defaultDisplayLimit = 500;
const objectDisplayDepthLimit = 8;
const arrayDisplayItemLimit = 50;
const objectDisplayEntryLimit = 50;
const objectDisplayNodeLimit = 500;

const secretKeyPattern = String.raw`(?:access[_-]?token|refresh[_-]?token|session[_-]?token|auth[_-]?token|api[_-]?key|client[_-]?secret|authorization|proxy[_-]?authorization|bearer|cookie|set[_-]?cookie|setCookie|code[_-]?verifier|pkce[_-]?verifier|verifier|github[_-]?token|oauth[_-]?refresh[_-]?token|provider[_-]?client[_-]?secret|openai[_-]?api[_-]?key|anthropic[_-]?api[_-]?key|yet[_-]?ai[_-]?auth[_-]?token)`;
const secretKeyRegExp = new RegExp(secretKeyPattern, "i");
const rawContentKeyPattern = String.raw`(?:raw[\s_-]?(?:prompt|tool[\s_-]?output|output|dump)|provider[\s_-]?(?:response|body)|file[\s_-]?contents?|workspace[\s_-]?contents?|chain[\s_-]?of[\s_-]?thought|task[\s_-]?board[\s_-]?dump|tool[\s_-]?raw[\s_-]?output|full[\s_-]?board[\s_-]?json)`;
const rawContentKeyRegExp = new RegExp(rawContentKeyPattern, "i");

const redactionPatterns: Array<[RegExp, string]> = [
  [/\b(?:Authorization|Proxy-Authorization|Cookie|Set-Cookie)\s*:\s*[^\r\n]*/gi, "[redacted]"],
  [new RegExp(String.raw`\b(?:cookie|set[_-]?cookie|setCookie)\b\s*[:=]\s*[^\r\n]*`, "gi"), "[redacted]"],
  [new RegExp(String.raw`\b(?:authorization|proxy[_-]?authorization)\b\s*[:=]\s*Bearer\s+[^\s,;)}\]]+`, "gi"), "[redacted]"],
  [new RegExp(String.raw`([?&;])${secretKeyPattern}\s*=\s*[^\s&#;]+`, "gi"), "$1[redacted]"],
  [new RegExp(String.raw`(["'])${secretKeyPattern}\1\s*:\s*(["'])(?:\\.|(?!\2).)*\2`, "gi"), "[redacted]"],
  [new RegExp(String.raw`(["'])${secretKeyPattern}\1\s*:\s*(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)\b`, "gi"), "[redacted]"],
  [new RegExp(String.raw`\b${secretKeyPattern}\b\s*[:=]\s*[^\s,;)}\]]+`, "gi"), "[redacted]"],
  [new RegExp(String.raw`\b${rawContentKeyPattern}\b\s*(?::|=)?\s*[^\r\n]*`, "gi"), "[redacted]"],
  [/(?:[A-Za-z]:[\\/][^\r\n,;]*?(?:\.codex[\\/]auth\.json|auth\.json)|\/[^\r\n,;]*?(?:\.codex\/auth\.json|auth\.json)|(?:~|\.{1,2})?[\\/]?\.codex[\\/]auth\.json|\bauth\.json\b)/gi, "[redacted]"],
  [/(?:\/(?:Users|home)\/[^\r\n,;]+|[A-Za-z]:[\\/]Users[\\/][^\r\n,;]+)/gi, "[redacted]"],
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
  return sanitizeDisplayValueInner(value, new WeakSet<object>(), { remaining: objectDisplayNodeLimit }, 0);
}

export function isSecretLikeKey(key: string): boolean {
  return secretKeyRegExp.test(key);
}

export function isRawContentLikeKey(key: string): boolean {
  return rawContentKeyRegExp.test(normalizeKey(key));
}

export function sanitizeErrorText(value: string): string {
  return truncate(redactSecrets(value), defaultDisplayLimit);
}

function sanitizeDisplayValueInner(value: unknown, seen: WeakSet<object>, budget: { remaining: number }, depth: number): unknown {
  budget.remaining -= 1;
  if (budget.remaining < 0) {
    return "[redacted]";
  }
  if (typeof value === "string") {
    return sanitizeTimelineText(value);
  }
  if (depth > objectDisplayDepthLimit) {
    return "[redacted]";
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return "[redacted]";
    }
    seen.add(value);
    const sanitized = value.slice(0, arrayDisplayItemLimit).map((item) => sanitizeDisplayValueInner(item, seen, budget, depth + 1));
    if (value.length > arrayDisplayItemLimit) {
      sanitized.push(`[${value.length - arrayDisplayItemLimit} more items redacted]`);
    }
    return sanitized;
  }
  if (typeof value === "object" && value !== null) {
    if (seen.has(value)) {
      return "[redacted]";
    }
    seen.add(value);
    const entries = Object.entries(value);
    const sanitized = entries.slice(0, objectDisplayEntryLimit).map(([key, item]) => {
      if (isSecretLikeKey(key) || isRawContentLikeKey(key)) {
        return ["[redacted]", "[redacted]"];
      }
      return [key, sanitizeDisplayValueInner(item, seen, budget, depth + 1)];
    });
    if (entries.length > objectDisplayEntryLimit) {
      sanitized.push(["[redacted]", `[${entries.length - objectDisplayEntryLimit} more fields redacted]`]);
    }
    return Object.fromEntries(sanitized);
  }
  return value;
}

function normalizeKey(key: string): string {
  return key.replace(/[\s._-]+/g, "_");
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}
