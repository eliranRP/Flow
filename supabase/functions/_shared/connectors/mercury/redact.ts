const FORBIDDEN_KEYS = new Set([
  "accountnumber",
  "routingnumber",
  "details",
  "dashboardlink",
  "note",
  "externalmemo",
  "url",
  "email",
]);

const DIGITS = /\d{4,}/g;

export function scrubDigits(value: string): string {
  return value.replace(DIGITS, "****");
}

function forbidden(key: string): boolean {
  return FORBIDDEN_KEYS.has(key.toLowerCase().replace(/[_-]/g, ""));
}

/** Drop routing fields and replace digit runs of 4 or more. */
export function redactMercury(value: unknown): unknown {
  if (typeof value === "string") return scrubDigits(value);
  if (Array.isArray(value)) return value.map((item) => redactMercury(item));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      if (forbidden(key)) continue;
      out[key] = redactMercury(inner);
    }
    return out;
  }
  return value;
}
