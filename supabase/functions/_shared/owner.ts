// Resolves the owner's company for a user-path edge call.
// GoTrue getUser() needs a live session, so it rejects the session-less JWT
// that flow-mcp signs. The fallback asks PostgREST (which verifies the JWT
// signature and expiry) for the companies RLS lets this token read, and keeps
// only the one owned by the token's own `sub`. Viewers never pass.
// The fallback is only for a flow-mcp token (FLOW-205): it must carry `mcp_tid`,
// and the company must be the token's own `company_id` claim.

import { jwtClaims } from "./jwt.ts";

type Row = { id: string; owner_id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** FLOW-601: the company the app shows (its x-flow-company header), or null. */
export function companyHint(req: Request): string | null {
  const value = req.headers.get("x-flow-company")?.trim() ?? "";
  return UUID.test(value) ? value.toLowerCase() : null;
}

type RpcClient = {
  rpc: (fn: "owner_company_for", args: { p_user: string; p_hint?: string }) => PromiseLike<{ data: unknown; error: unknown }>;
};

/**
 * FLOW-601: the company this user owns and has open (the app's header first, then the one they
 * last switched to). A user may own several companies or only edit one, so this is never a
 * lookup by owner_id alone. Null for a company they do not own.
 */
export async function ownedCompany(admin: RpcClient, userId: string, hint: string | null): Promise<string | null> {
  const result = await admin.rpc("owner_company_for", hint ? { p_user: userId, p_hint: hint } : { p_user: userId });
  return result.error || typeof result.data !== "string" ? null : result.data;
}

export type OwnerDeps = {
  getUserId: () => Promise<string | null>;
  ownedBy: (userId: string) => Promise<string | null>;
  readableCompanies: () => Promise<Row[] | null>;
};

export function jwtSub(header: string): string | null {
  const sub = jwtClaims(header)?.sub;
  return typeof sub === "string" && sub.length > 0 ? sub : null;
}

/** A flow-mcp token's `mcp_tid` and `company_id`, or null for any other token. */
function mcpClaims(header: string): { companyId: string } | null {
  const claims = jwtClaims(header);
  const tid = claims?.mcp_tid;
  const companyId = claims?.company_id;
  if (typeof tid !== "string" || tid.length === 0) return null;
  if (typeof companyId !== "string" || companyId.length === 0) return null;
  return { companyId };
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
  const mcp = mcpClaims(header);
  if (!sub || !mcp) return { error: "unauthorized" };
  const rows = await deps.readableCompanies().catch(() => null);
  if (!rows) return { error: "unauthorized" };
  const own = rows.find((row) => row.owner_id === sub && row.id === mcp.companyId);
  return own ? { companyId: own.id } : { error: "no company" };
}
