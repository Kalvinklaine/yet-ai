const forbiddenEvidenceChecks = Object.freeze([
  ["macos home path", /(?:^|[^\w/.-])\/Users\/[A-Za-z0-9._-]+(?:\/|$)/],
  ["linux home path", /(?:^|[^\w/.-])\/home\/[A-Za-z0-9._-]+(?:\/|$)/],
  ["posix private path", /(?:^|[^\w/.-])\/(?:Volumes|var|tmp|private|opt|mnt|srv)\/[A-Za-z0-9._ -]+(?:\/|$)/],
  ["windows path", /(?:\b[A-Za-z]:\\(?:Users\\)?[^\s"'<>]+|\\\\[^\s"'<>\\]+\\[^\s"'<>\\]+)/],
  ["file url", /\bfile:\/{2,3}(?:[A-Za-z]:)?[^\s"'<>]+/i],
  ["bearer or auth header", /\b(?:Bearer\s+[A-Za-z0-9._~+/=-]{8,}|Authorization\s*:\s*\S+|Proxy-Authorization\s*:\s*\S+)/i],
  ["cookie header", /\b(?:Cookie|Set-Cookie)\s*:\s*\S+/i],
  ["token or query secret", /[?#&](?:access_token|refresh_token|id_token|api_key|apikey|key|token|code|secret|auth_code|authorization_code|code_verifier|cookie)=/i],
  ["api key or secret", /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{8,}|api[_-]?key|apiKey|provider[_-]?key|providerKey|openai[_-]?key|anthropic[_-]?key|secret[_-]?key|secretKey)\b\s*[":=]\s*[^\s<][^\r\n]*/i],
  ["token field", /\b(?:access[_-]?token|accessToken|refresh[_-]?token|refreshToken|id[_-]?token|oauth[_-]?token|auth[_-]?code|authorization[_-]?code|runtime[_ -]?token|runtimeToken|session[_ -]?token|sessionToken|pkce[_-]?verifier|code[_-]?verifier)\b\s*[":=]\s*[^\s<][^\r\n]*/i],
  ["raw prompt", /\b(?:raw\s+prompts?|rawPrompt|prompt\s+dump|promptDump|verbatim\s+prompt|full\s+prompt\s+text|composer\s+text)\b\s*[":=]\s*[^\r\n]+/i],
  ["raw provider payload", /\b(?:raw\s+responses?|rawResponse|response\s+dump|responseDump|provider\s+output\s+dump|verbatim\s+response|provider\s+response|providerResponse|provider\s+payload|providerPayload|provider\s+request|completion\s+payload)\b\s*[":=]\s*[^\r\n]+/i],
  ["raw file body", /\b(?:file\s+contents?|fileContents|source\s+contents?|document\s+contents?|full\s+file\s+text|raw\s+file\s+body|rawFileBody|verbatim\s+source)\b\s*[":=]\s*[^\r\n]+/i],
  ["raw diff or patch", /\b(?:raw\s+diff|rawDiff|diff\s+dump|patch\s+body|raw\s+patch|patch\s+dump|replacement\s+body|replacement\s+text|replacementText|edit\s+hunk)\b\s*[":=]\s*[^\r\n]+/i],
  ["raw command output", /\b(?:command|stdout|stderr|cwd|env)\s*[:=]\s*[^\s<][^\r\n]*|\bterminal\s+(?:output|transcript)\s*[:=]\s*[^\s<][^\r\n]*|\bprocess\.env\b/i],
  ["bridge or request payload", /\b(?:raw\s+bridge\s+payload|bridge\s+payload\s+dump|bridge\s+payload|postMessage\s+dump|runtime\s+http\s+dump|sse\s+payload\s+dump|request\s+body|raw\s+request)\b\s*[:=]\s*[^\r\n]+/i],
  ["browser storage dump", /\b(?:localStorage|sessionStorage|indexedDB|browser\s+storage\s+dump|storage\s+dump|workspace\s+storage\s+dump)\b\s*[:=]\s*[^\r\n]+/i]
]);

const allowedPolicyLinePattern = /\b(?:must\s+not|must\s+never|do\s+not|should\s+not|forbidden|absent|exclude|exclusions?|rejects?|rejected|redacted|omitted|blocked|not\s+persist|not\s+include|not\s+claim|not\s+require|without)\b/i;

export function findForbiddenEvidenceText(text, options = {}) {
  const label = sanitizeEvidenceLabel(options.label ?? "input");
  const allowPolicyLines = options.allowPolicyLines === true;
  const matches = [];
  const lines = String(text).split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (allowPolicyLines && allowedPolicyLinePattern.test(line)) continue;
    for (const [category, pattern] of forbiddenEvidenceChecks) {
      if (pattern.test(line)) {
        matches.push({ label, category, line: index + 1 });
      }
    }
  }
  return matches;
}

export function hasForbiddenEvidenceText(text, options = {}) {
  return findForbiddenEvidenceText(text, options).length > 0;
}

export function formatForbiddenEvidenceFailures(matches) {
  return matches.map((match) => `${sanitizeEvidenceLabel(match.label)}: unsafe ${match.category} at line ${match.line}`);
}

export function sanitizeEvidenceLabel(label) {
  return String(label)
    .replace(/\bfile:\/{2,3}[^\s"'<>]+/gi, "[redacted-file-url]")
    .replace(/(?:^|[^\w/.-])\/Users\/[A-Za-z0-9._-]+(?:\/[^\s"'<>]*)?/g, " [redacted-path]")
    .replace(/(?:^|[^\w/.-])\/home\/[A-Za-z0-9._-]+(?:\/[^\s"'<>]*)?/g, " [redacted-path]")
    .replace(/(?:^|[^\w/.-])\/(?:Volumes|var|tmp|private|opt|mnt|srv)\/[A-Za-z0-9._ -]+(?:\/[^\s"'<>]*)?/g, " [redacted-path]")
    .replace(/\b[A-Za-z]:\\[^\s"'<>]+/g, "[redacted-path]")
    .replace(/\\\\[^\s"'<>\\]+\\[^\s"'<>\\]+/g, "[redacted-path]")
    .replace(/[?#&](?:access_token|refresh_token|id_token|api_key|apikey|key|token|code|secret|auth_code|authorization_code|code_verifier|cookie)=[^\s"'<>]*/gi, "[redacted-secret]")
    .replace(/[^A-Za-z0-9._:/ \[\]-]/g, "_")
    .slice(0, 160) || "input";
}

export { forbiddenEvidenceChecks };
