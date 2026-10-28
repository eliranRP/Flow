/**
 * Time each screen's main read against the hosted Supabase project (decision 0230).
 * Run from Israel when you want the 4G/Wi-Fi number.
 *
 *   pnpm latency            every screen's read, 10 calls each, p50 and p90
 *   RUNS=3 pnpm latency     fewer calls
 *
 * Uses SUPABASE_URL (or VITE_SUPABASE_URL) and VITE_SUPABASE_ANON_KEY.
 * If SUPABASE_ACCESS_TOKEN is set, the calls are authenticated and each read returns the
 * company's data. Without it the script still records status and time. Nothing secret is printed.
 */

import { loadLocalEnv } from "./env.ts";

loadLocalEnv();

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
const runs = Math.max(1, Number(process.env.RUNS ?? 10) || 10);

if (!url || !anonKey) {
  console.error("Set SUPABASE_URL and VITE_SUPABASE_ANON_KEY. See .env.example.");
  process.exit(1);
}

/** Each main screen's first read, with the arguments the app sends. */
const reads: { screen: string; rpc: string; body: Record<string, unknown> }[] = [
  { screen: "Home", rpc: "get_home", body: {} },
  { screen: "Home", rpc: "cash_months", body: {} },
  { screen: "Home and profit", rpc: "get_dashboard", body: {} },
  { screen: "Projects", rpc: "projects_cash_month", body: {} },
  { screen: "Review", rpc: "list_review", body: {} },
  { screen: "Company profit", rpc: "get_breakdown", body: { p_direction: "expense", p_group_by: "category" } },
  { screen: "Company profit", rpc: "get_profit_months", body: {} },
  { screen: "Company profit", rpc: "company_next_month_inputs", body: {} },
  { screen: "Forecast", rpc: "expected_months", body: { p_months: 1 } },
  { screen: "Recurring", rpc: "recurring_schedule", body: {} },
  { screen: "Search", rpc: "search_transactions", body: {} },
  { screen: "Categories", rpc: "list_categories", body: {} },
];

const base = url.replace(/\/$/, "");
const headers = {
  apikey: anonKey,
  Authorization: `Bearer ${accessToken || anonKey}`,
  "Content-Type": "application/json",
};

// The project page reads one project: the company's first active one. Loans read their tables
// directly (loans, loan_balances), not through an RPC, so they are not timed here.
if (accessToken) {
  const projects = await fetch(`${base}/rest/v1/projects?select=id&status=eq.active&order=id&limit=1`, { headers });
  const [first] = projects.ok ? ((await projects.json()) as { id: string }[]) : [];
  if (first) reads.push({ screen: "Project page", rpc: "get_project", body: { p_id: first.id, p_basis: null } });
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] ?? 0;
}

for (const read of reads) {
  const times: number[] = [];
  let status = 0;
  let bytes = 0;
  for (let i = 0; i < runs; i += 1) {
    const started = performance.now();
    const response = await fetch(`${base}/rest/v1/rpc/${read.rpc}`, { method: "POST", headers, body: JSON.stringify(read.body) });
    const body = await response.text();
    times.push(Math.round(performance.now() - started));
    status = response.status;
    bytes = body.length;
  }
  times.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      screen: read.screen,
      rpc: read.rpc,
      status,
      bytes,
      p50: percentile(times, 0.5),
      p90: percentile(times, 0.9),
      runs,
      authenticated: Boolean(accessToken),
    }),
  );
}

if (!accessToken) {
  console.error(
    "The calls were not authenticated. Set SUPABASE_ACCESS_TOKEN to time real payloads. A 401 still measures the round trip.",
  );
}
