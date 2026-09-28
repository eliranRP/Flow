/**
 * Time one Home round trip against the hosted Supabase project.
 * Run from Israel when you want the 4G/Wi-Fi number (decision 0034).
 *
 *   pnpm latency
 *
 * Uses SUPABASE_URL (or VITE_SUPABASE_URL) and VITE_SUPABASE_ANON_KEY.
 * If SUPABASE_ACCESS_TOKEN is set, the call is authenticated and get_home()
 * can return the company. Without it the script still records status and time.
 * Nothing secret is printed.
 */

import { loadLocalEnv } from "./env.ts";

loadLocalEnv();

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;

if (!url || !anonKey) {
  console.error("Set SUPABASE_URL and VITE_SUPABASE_ANON_KEY. See .env.example.");
  process.exit(1);
}

const endpoint = `${url.replace(/\/$/, "")}/rest/v1/rpc/get_home`;
const started = performance.now();
const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken || anonKey}`,
    "Content-Type": "application/json",
  },
  body: "{}",
});
const elapsed = performance.now() - started;
const body = await response.text();

console.log(
  JSON.stringify({
    endpoint: "/rest/v1/rpc/get_home",
    status: response.status,
    ms: Math.round(elapsed),
    bytes: body.length,
    authenticated: Boolean(accessToken),
  }),
);

if (!response.ok && !accessToken) {
  console.error(
    "The call was not authenticated. Set SUPABASE_ACCESS_TOKEN to time a real Home payload. A 401 still measures the round trip.",
  );
}
