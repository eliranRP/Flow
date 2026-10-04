const FORBIDDEN_KEYS = new Set([
  "accountnumber",
  "routingnumber",
  "details",
  "dashboardlink",
  "note",
  "externalmemo",
  "url",
  "email",
  "authorization",
  "checknumber",
  "attachments",
]);

const DIGITS = /\d{4,}/g;
const SECRET_TOKEN = /secret-token:[^\s"]+/gi;
const BEARER = /bearer\s+\S+/gi;
const URL_TEXT = /https?:\/\/\S+/gi;
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

export function scrubDigits(value: string): string {
  return value.replace(DIGITS, "****");
}

/** Strip token shapes, bearer values, urls, emails, then long digit runs. */
export function scrubSecrets(value: string): string {
  return scrubDigits(
    value
      .replace(SECRET_TOKEN, "secret-token:[redacted]")
      .replace(BEARER, "Bearer [redacted]")
      .replace(URL_TEXT, "[redacted-url]")
      .replace(EMAIL, "[redacted-email]"),
  );
}

function stripSecret(value: string, secret: string): string {
  if (secret.length === 0) return value;
  return value.split(secret).join("[redacted]");
}

function forbidden(key: string): boolean {
  return FORBIDDEN_KEYS.has(key.toLowerCase().replace(/[_-]/g, ""));
}

/**
 * Drop routing fields, Authorization, and token shapes.
 * `secret` is the live token, removed before the text is logged.
 */
export function redactMercury(value: unknown, secret?: string): unknown {
  if (typeof value === "string") {
    return scrubSecrets(secret ? stripSecret(value, secret) : value);
  }
  if (Array.isArray(value)) return value.map((item) => redactMercury(item, secret));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      if (forbidden(key)) continue;
      out[key] = redactMercury(inner, secret);
    }
    return out;
  }
  return value;
}
