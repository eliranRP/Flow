// The live smoke's write guard: which requests may go through. Everything else is aborted.

// List screens only, plus the reads screens make on load: the company currency on Settings,
// the late bills on Home and the expected months on a project (FLOW-403). Detail RPCs stay on
// the owner and are not called.
export const readRpcs = new Set([
  "expected_months",
  "get_dashboard",
  "get_line_meta",
  "list_categories",
  "list_review",
  "list_unpaid",
  "mcp_company_loan_currency",
  "missing_bills",
  "sumit_status",
]);

export function rpcName(url: string): string | null {
  return /\/rest\/v1\/rpc\/([a-z0-9_]+)/.exec(url)?.[1] ?? null;
}

function parsed(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * True when the request reads only. GET, HEAD and OPTIONS go anywhere. On the Supabase host
 * (`supabaseUrl`'s origin, so a look-alike path on another host is not trusted) these POSTs
 * also read: the token refresh, the flow-mcp status call and the list RPCs above. The auth
 * user read is GET only, and every other `/auth/v1/` path, signup and admin included, is a write.
 */
export function isReadRequest(method: string, url: string, supabaseUrl: string): boolean {
  const target = parsed(url);
  const supabase = parsed(supabaseUrl);
  const onSupabase = target != null && supabase != null && target.origin === supabase.origin;
  const path = target?.pathname ?? "";
  if (path.includes("/auth/v1/")) {
    if (!onSupabase) return false;
    const user = path.endsWith("/auth/v1/user");
    const token = path.endsWith("/auth/v1/token");
    if (!user && !token) return false;
    if (method === "OPTIONS" || method === "HEAD") return true;
    if (user) return method === "GET";
    return method === "POST";
  }
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  if (method !== "POST" || !onSupabase) return false;
  if (/\/functions\/v1\/flow-mcp\/status$/.test(path)) return true;
  const rpc = rpcName(url);
  return rpc != null && readRpcs.has(rpc);
}
