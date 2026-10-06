// Resolves the owner's company for a user-path edge call.
// GoTrue getUser() needs a live session, so it rejects the session-less JWT
// that flow-mcp signs. The fallback asks PostgREST (which verifies the JWT
// signature and expiry) for the companies RLS lets this token read, and keeps
// only the one owned by the token's own `sub`. Viewers never pass.

type Row = { id: string; owner_id: string };
export type OwnerDeps = {
  getUserId: () => Promise<string | null>;
  ownedBy: (userId: string) => Promise<string | null>;
  readableCompanies: () => Promise<Row[] | null>;
};

export function jwtSub(header: string): string | null {
  const token = header.replace(/^Bearer\s+/i, "");
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const padded = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const claims = JSON.parse(atob(padded)) as { sub?: unknown };
    return typeof claims.sub === "string" && claims.sub.length > 0 ? claims.sub : null;
  } catch {
    return null;
  }
}

export async function resolveOwnerCompany(
  header: string,
  deps: OwnerDeps,
): Promise<{ companyId: string } | { error: "unauthorized" | "no company" }> {
  const userId = await deps.getUserId().catch(() => null);
  if (userId) {
    const companyId = await deps.ownedBy(userId);
    return companyId ? { companyId } : { error: "no company" };
  }
  const sub = jwtSub(header);
  if (!sub) return { error: "unauthorized" };
  const rows = await deps.readableCompanies().catch(() => null);
  if (!rows) return { error: "unauthorized" };
  const own = rows.find((row) => row.owner_id === sub);
  return own ? { companyId: own.id } : { error: "no company" };
}
