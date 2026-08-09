const SECRET_KEY_RE =
  /\b(?:api[_-]?key|apikey|secret|token|password|passwd|credential|private[_-]?key|auth(?:orization)?[_-]?header|access[_-]?key|client[_-]?secret)\b/i;

const SECRET_VALUE_PATTERNS = [
  /\b(?:sk|pk|ak|ghp|gho|glpat|xox[baprs]|eyJ)[A-Za-z0-9_-]{8,}\b/gi,
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/gi,
  /(?:key|secret|token|password)\s*[:=]\s*["']?[A-Za-z0-9._~+/-]{8,}["']?/gi,
  /AIza[0-9A-Za-z_-]{35}/g,
  /-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+ PRIVATE KEY-----/g,
];

/**
 * Redacts secret-looking tokens from arbitrary text before it is sent to an
 * LLM or written to a report. Defense in depth: npm-cleanup never includes
 * `.env` values in LLM payloads, but this guarantees nothing leaks.
 */
export function redactSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_VALUE_PATTERNS) {
    out = out.replace(re, "[REDACTED]");
  }
  out = out.replace(
    /(^|[\s"'=:])("?)([^"'=\s:]{2,80}?)\2\s*=\s*("?)[^"';\n]{4,200}?\4(?=[;\n]|$)/gm,
    (match, _pre: string, _q1: string, keyPart: string, _q2: string) => {
      if (SECRET_KEY_RE.test(keyPart)) {
        return `${_pre}${_q1}${keyPart}${_q2}=[REDACTED]`;
      }
      return match;
    },
  );
  return out;
}

export function containsSecretShape(text: string): boolean {
  for (const re of SECRET_VALUE_PATTERNS) {
    if (re.test(text)) return true;
  }
  return false;
}