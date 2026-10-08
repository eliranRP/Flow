// One JWT payload decoder for the edge functions (flow-mcp signs, mercury-sync reads).
// It reads claims only; the signature and expiry are checked by whoever trusts the token.

export function decodeJwtPart(part: string): Record<string, unknown> {
  const padded = part.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (part.length % 4)) % 4);
  return JSON.parse(atob(padded)) as Record<string, unknown>;
}

/** The payload of a `Bearer` header, or null when it isn't a readable JWT. */
export function jwtClaims(header: string): Record<string, unknown> | null {
  const part = header.replace(/^Bearer\s+/i, "").split(".")[1];
  if (!part) return null;
  try {
    const claims = decodeJwtPart(part);
    return typeof claims === "object" && claims != null ? claims : null;
  } catch {
    return null;
  }
}
