// The live smoke's write guard: which requests may go through. Everything else is aborted.

// Every read RPC the app calls: the functions the migrations define as `stable` (a promise not to
// change the database). scripts/smoke-allow-rpcs.test.mjs fails when the app calls a stable RPC that is
// missing here, or when a volatile one is listed, so a new screen read cannot turn the smoke red.
export const readRpcs = new Set([
  "cash_month_lines",
  "cash_months",
  "cash_year_months",
  "cash_years",
  "expected_months",
  "get_breakdown",
  "get_breakdown_lines",
  "get_dashboard",
  "get_home",
  "get_line_meta",
  "get_line_split",
  "get_loan_split",
  "get_profit_months",
  "get_project",
  "get_transaction",
  "jev_key_status",
  "get_notification_prefs",
  "jev_suggestions",
  "list_auto_assigned_today",
  "list_categories",
  "list_my_companies",
  "list_project_category",
  "list_project_groups",
  "list_review",
  "list_skipped_review",
  "list_team",
  "list_unpaid",
  "mcp_company_loan_currency",
  "mcp_loan_payments",
  "missing_bills",
  "my_invites",
  "party_charges",
  "payment_recurring",
  "project_cash_month_lines",
  "project_cash_months",
  "project_category_months",
  "project_waiting",
  "recurring_changes",
  "recurring_this_month",
  "review_anomalies",
  "search_transactions",
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
 * also read: the token refresh, the flow-mcp status call and the read RPCs above. The auth
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
