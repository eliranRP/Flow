// Flow MCP handler tests: routes, origins, mint, revoke and status, secrets, pepper, throttling and rate limits.
import { corsAllowHeaders } from "../_shared/http.ts";
import { handle, hmacSecret } from "./handler.ts";
import { criterion4 } from "../../../scripts/mcp-signing-spike.mjs";
import { assert, assertEquals, type Call, deps, env, pepperSecret, previousSecret } from "./handler_test_support.ts";

Deno.test("GET is 405 and a present Origin on the MCP route is 403", async () => {
  const get = await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp", { method: "GET" }));
  assertEquals(get.status, 405, "GET");
  assertEquals(get.headers.get("allow"), "POST", "allow");
  assertEquals(get.headers.get("access-control-allow-origin"), null, "no wildcard");
  const posted = await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp", {
    method: "POST",
    headers: { origin: "https://flow-app-dx5.pages.dev" },
  }));
  assertEquals(posted.status, 403, "MCP origin");
});

Deno.test("mint takes p_user from getUser and ignores a body user id", async () => {
  const calls: Call[] = [];
  const response = await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp/mint", {
    method: "POST",
    headers: {
      origin: "https://flow-app-dx5.pages.dev",
      authorization: "Bearer app-jwt",
      "content-type": "application/json",
    },
    body: JSON.stringify({ scope: "read", user_id: "forged-user", p_user: "forged-user" }),
  }), deps(calls, { store_mcp_credential: "11111111-1111-4000-8000-000000000001" }));
  assertEquals(response.status, 200, "mint status");
  const body = await response.json();
  assert(typeof body.secret === "string" && body.secret.startsWith("flow_mcp_"), "secret prefix");
  assertEquals(body.secret.length, "flow_mcp_".length + 43, "secret length");
  const store = calls.find((call) => call.url.endsWith("/store_mcp_credential"));
  if (store?.body == null) throw new Error("store called");
  assertEquals(store.body.p_user, "user-from-getuser", "p_user");
  assert(store.body.p_user !== "forged-user", "body user ignored");
  assertEquals(store.body.p_scope, ["read"], "scope");
  assertEquals(store.body.p_pepper_kid, "test", "pepper kid");
  assert(typeof store.body.p_token_hash === "string" && store.body.p_token_hash !== body.secret, "hash at rest");
  assertEquals(response.headers.get("access-control-allow-origin"), "https://flow-app-dx5.pages.dev", "app origin");
  assertEquals(response.headers.get("cache-control"), "no-store", "mint is not stored");
  assertEquals(store.authorization, "Bearer secret-key", "dictionary key");
});

Deno.test("mint passes the app's x-flow-company header as the company hint, and only an id (FLOW-601)", async () => {
  const company = "5EB3B1CA-B8B9-4322-9227-07D8E360AC82";
  const mint = async (header?: string) => {
    const calls: Call[] = [];
    const headers: Record<string, string> = {
      origin: "https://flow-app-dx5.pages.dev",
      authorization: "Bearer app-jwt",
      "content-type": "application/json",
    };
    if (header !== undefined) headers["x-flow-company"] = header;
    const response = await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp/mint", {
      method: "POST",
      headers,
      body: JSON.stringify({ scope: "read" }),
    }), deps(calls, { store_mcp_credential: "11111111-1111-4000-8000-000000000001" }));
    assertEquals(response.status, 200, "mint status");
    const store = calls.find((call) => call.url.endsWith("/store_mcp_credential"));
    if (store?.body == null) throw new Error("store called");
    return store.body;
  };
  assertEquals((await mint(company)).p_hint, company.toLowerCase(), "hint forwarded");
  assertEquals("p_hint" in await mint("not-an-id"), false, "a header that is not an id is dropped");
  assertEquals("p_hint" in await mint(), false, "no header, no hint");
});

Deno.test("a foreign origin cannot mint", async () => {
  const calls: Call[] = [];
  const response = await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp/mint", {
    method: "POST",
    headers: { origin: "https://evil.example", authorization: "Bearer app-jwt" },
    body: JSON.stringify({ scope: "read_write" }),
  }), deps(calls, {}));
  assertEquals(response.status, 403, "foreign origin");
  assertEquals(calls.length, 0, "no getUser");
});

Deno.test("tools/list returns the read and write tools and does not throttle a valid secret", async () => {
  const calls: Call[] = [];
  const token = `flow_mcp_${"a".repeat(43)}`;
  const hash = await hmacSecret(token, new TextEncoder().encode(pepperSecret));
  const response = await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "cf-connecting-ip": "203.0.113.5",
      "mcp-protocol-version": "2025-06-18",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  }), deps(calls, {
    lookup_mcp_credential: {
      found: true,
      id: "22222222-2222-4000-8000-000000000002",
      user_id: "user-1",
      company_id: "company-1",
      scope: ["read", "write"],
      expires_at: "2099-01-01T00:00:00.000Z",
      revoked_at: null,
    },
    bump_mcp_rate: { allowed: true, retry_after_seconds: 0 },
    touch_mcp_credential: null,
  }));
  assertEquals(response.status, 200, "tools/list");
  const body = await response.json();
  const names = (body.result.tools as { name: string }[]).map((tool) => tool.name);
  assertEquals(names, [
    "list_projects",
    "get_project",
    "get_project_categories",
    "list_project_groups",
    "get_project_group",
    "list_categories",
    "list_review",
    "get_expense",
    "search_expenses",
    "get_totals",
    "list_loans",
    "get_loan_schedule",
    "get_sync_status",
    "get_breakdown",
    "get_jev_status",
    "get_jev_accuracy",
    "get_profit_months",
    "get_cash_months",
    "get_cash_lines",
    "match_lines",
    "get_anomalies",
    "get_jev_suggestions",
    "get_missing_bills",
    "get_expected_months",
    "list_unpaid",
    "list_team",
    "assign_expense",
    "assign_expense_split",
    "assign_expenses",
    "set_expense_category",
    "create_project",
    "create_category",
    "create_projects",
    "create_categories",
    "sync_bank",
    "hide_category",
    "set_category_pnl",
    "set_overhead_project",
    "rename_company",
    "invite_member",
    "set_member_role",
    "remove_member",
    "add_loan",
    "update_loan",
    "attach_loan_payment",
    "set_loan_rate",
    "set_loan_index",
    "set_index_rate",
    "split_line",
    "set_line_pnl",
    "set_lines_pnl",
    "set_invoice_paid",
    "detach_loan_payment",
    "delete_loan",
    "reorder_loans",
    "set_project_investment",
    "set_category_rehab",
    "delete_category",
    "move_category_lines",
    "set_company_currency",
    "rename_category",
    "set_category_parent",
    "set_category_group",
    "create_project_group",
    "set_project_group",
    "set_jev_mode",
    "set_category_cash",
    "set_line_cash",
    "set_lines_cash",
    "set_cash_basis",
    "undo_jev_prefill",
    "undo",
    "undo_batch",
  ], "read and write tools");
  const lookup = calls.find((call) => call.url.endsWith("/lookup_mcp_credential"));
  assertEquals(lookup?.body?.p_token_hash, hash, "lookup hash");
  assertEquals(lookup?.body?.p_pepper_kid, "test", "lookup kid");
  assert(calls.every((call) => !call.url.endsWith("/note_auth_failure")), "valid token is not a failure");
  assertEquals(response.headers.get("x-flow-cf-connecting-ip"), "present", "header reached");
});

Deno.test("a bad secret with cf-connecting-ip is throttled, and a missing header is not", async () => {
  const withIp: Call[] = [];
  const denied = await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp", {
    method: "POST",
    headers: { authorization: "Bearer flow_mcp_bad", "cf-connecting-ip": "203.0.113.9" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
  }), deps(withIp, {
    lookup_mcp_credential: { found: false },
    note_auth_failure: { throttled: true, retry_after_seconds: 12 },
  }));
  assertEquals(denied.status, 429, "throttled");
  assert(withIp.some((call) => call.url.endsWith("/note_auth_failure")), "failure counted");

  const missing: Call[] = [];
  const open = await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp", {
    method: "POST",
    headers: { authorization: "Bearer nope" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
  }), deps(missing, {}));
  assertEquals(open.status, 401, "still unauthorized");
  assertEquals(missing.length, 0, "no unknown bucket");
  assertEquals(open.headers.get("x-flow-cf-connecting-ip"), "absent", "header absent");
});

Deno.test("a batch is rejected and ping returns an empty result", async () => {
  const calls: Call[] = [];
  const token = `flow_mcp_${"b".repeat(43)}`;
  const ok = {
    lookup_mcp_credential: {
      found: true,
      id: "33333333-3333-4000-8000-000000000003",
      user_id: "user-1",
      expires_at: "2099-01-01T00:00:00.000Z",
      revoked_at: null,
    },
    bump_mcp_rate: { allowed: true, retry_after_seconds: 0 },
    touch_mcp_credential: null,
  };
  const batch = await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "ping" }]),
  }), deps(calls, ok));
  assertEquals(batch.status, 400, "batch");
  const ping = await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "p", method: "ping" }),
  }), deps(calls, ok));
  const body = await ping.json();
  assertEquals(body.result, {}, "ping");
});

Deno.test("status preflight allows the shared request headers", async () => {
  const response = await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp/status", {
    method: "OPTIONS",
    headers: {
      origin: "https://flow-app-dx5.pages.dev",
      "access-control-request-method": "POST",
      "access-control-request-headers": "authorization, apikey, content-type, x-client-info",
    },
  }), deps([], {}));
  assertEquals(response.status, 204, "preflight");
  assertEquals(response.headers.get("access-control-allow-origin"), "https://flow-app-dx5.pages.dev", "echoed origin");
  assertEquals(response.headers.get("access-control-allow-headers"), corsAllowHeaders, "shared list");
  const allowed = new Set((response.headers.get("access-control-allow-headers") ?? "").split(",").map((part) => part.trim()));
  for (const name of ["authorization", "apikey", "content-type", "x-client-info"]) {
    assert(allowed.has(name), name);
  }
});

Deno.test("mint preflight allows only an app origin", async () => {
  const ok = await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp/mint", {
    method: "OPTIONS",
    headers: { origin: "http://127.0.0.1:43123" },
  }), deps([], {}));
  assertEquals(ok.status, 204, "preflight");
  assertEquals(ok.headers.get("access-control-allow-origin"), "http://127.0.0.1:43123", "echoed origin");
  const denied = await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp/mint", {
    method: "OPTIONS",
    headers: { origin: "https://evil.example" },
  }));
  assertEquals(denied.status, 403, "foreign preflight");
  assertEquals(denied.headers.get("access-control-allow-origin"), null, "no allow origin");
});

Deno.test("a valid token over the read limit is 429 and is not counted as a failed secret", async () => {
  const calls: Call[] = [];
  const token = `flow_mcp_${"c".repeat(43)}`;
  const response = await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "cf-connecting-ip": "203.0.113.4" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
  }), deps(calls, {
    lookup_mcp_credential: {
      found: true,
      id: "44444444-4444-4000-8000-000000000004",
      user_id: "user-1",
      expires_at: "2099-01-01T00:00:00.000Z",
      revoked_at: null,
    },
    bump_mcp_rate: { allowed: false, retry_after_seconds: 9 },
  }));
  assertEquals(response.status, 429, "limited");
  assert(calls.every((call) => !call.url.endsWith("/note_auth_failure")), "not a failed secret");
});

Deno.test("criterion 4 fails when cf-connecting-ip did not reach the function", () => {
  assertEquals(criterion4(null).ok, false, "missing");
  assertEquals(criterion4("").ok, false, "empty");
  assertEquals(criterion4("absent").ok, false, "absent");
  assert(criterion4(null).message.includes("criterion 4 failed"), "failure path");
  assertEquals(criterion4("present").ok, true, "present");
});

Deno.test("revoke and status use the getUser id, and a failed getUser calls no wrapper", async () => {
  const calls: Call[] = [];
  const revoked = await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp/revoke", {
    method: "POST",
    headers: {
      origin: "https://flow-app-dx5.pages.dev",
      authorization: "Bearer app-jwt",
      "content-type": "application/json",
    },
    body: JSON.stringify({ id: "11111111-1111-4000-8000-000000000001", user_id: "forged-user", p_user: "forged-user" }),
  }), deps(calls, { revoke_mcp_credential: { ok: true } }));
  assertEquals(revoked.status, 200, "revoke");
  const revoke = calls.find((call) => call.url.endsWith("/revoke_mcp_credential"));
  assertEquals(revoke?.body?.p_user, "user-from-getuser", "revoke user");

  const statusCalls: Call[] = [];
  const status = await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp/status", {
    method: "POST",
    headers: { origin: "https://flow-app-dx5.pages.dev", authorization: "Bearer app-jwt" },
  }), deps(statusCalls, { mcp_credential_status: { state: "empty" } }));
  assertEquals(status.status, 200, "status");
  const statusCall = statusCalls.find((call) => call.url.endsWith("/mcp_credential_status"));
  assertEquals(statusCall?.body?.p_user, "user-from-getuser", "status user");

  const failed: Call[] = [];
  const denied = await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp/revoke", {
    method: "POST",
    headers: { origin: "https://flow-app-dx5.pages.dev", authorization: "Bearer app-jwt" },
    body: JSON.stringify({ id: "11111111-1111-4000-8000-000000000001" }),
  }), deps(failed, {}, { userStatus: 401 }));
  assertEquals(denied.status, 401, "getUser failed");
  assert(failed.every((call) => call.url.endsWith("/user")), "no wrapper");
});

Deno.test("a revoked or expired token is 401, and a lookup error is not a failed secret", async () => {
  const token = `flow_mcp_${"d".repeat(43)}`;
  const revokedCalls: Call[] = [];
  const revoked = await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "cf-connecting-ip": "203.0.113.7" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
  }), deps(revokedCalls, {
    lookup_mcp_credential: {
      found: true,
      id: "55555555-5555-4000-8000-000000000005",
      revoked_at: "2020-01-01T00:00:00.000Z",
      expires_at: "2099-01-01T00:00:00.000Z",
    },
    note_auth_failure: { throttled: false, retry_after_seconds: 0 },
  }));
  assertEquals(revoked.status, 401, "revoked");

  const expiredCalls: Call[] = [];
  const expired = await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
  }), deps(expiredCalls, {
    lookup_mcp_credential: {
      found: true,
      id: "55555555-5555-4000-8000-000000000005",
      revoked_at: null,
      expires_at: "2000-01-01T00:00:00.000Z",
    },
    note_auth_failure: { throttled: false, retry_after_seconds: 0 },
  }));
  assertEquals(expired.status, 401, "expired");

  const broken: Call[] = [];
  const down = await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "cf-connecting-ip": "203.0.113.7" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
  }), deps(broken, {}, { statuses: { lookup_mcp_credential: 500 } }));
  assertEquals(down.status, 500, "lookup error");
  assert(broken.every((call) => !call.url.endsWith("/note_auth_failure")), "lookup error is not a failed secret");
});

Deno.test("a missing or short pepper is 500, and a previous kid still resolves the token", async () => {
  const missingEnv = { ...env };
  delete missingEnv.FLOW_MCP_PEPPER;
  const missingCalls: Call[] = [];
  const missing = await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp/mint", {
    method: "POST",
    headers: { origin: "https://flow-app-dx5.pages.dev", authorization: "Bearer app-jwt", "content-type": "application/json" },
    body: JSON.stringify({ scope: "read" }),
  }), deps(missingCalls, {}, { env: missingEnv }));
  assertEquals(missing.status, 500, "missing pepper");
  assert(missingCalls.every((call) => call.url.endsWith("/user")), "no store");

  const shortEnv = { ...env, FLOW_MCP_PEPPER: JSON.stringify({ kid: "test", secret: "p".repeat(31) }) };
  const short = await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp", {
    method: "POST",
    headers: { authorization: `Bearer flow_mcp_${"e".repeat(43)}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
  }), deps([], {}, { env: shortEnv }));
  assertEquals(short.status, 500, "short pepper");

  const token = `flow_mcp_${"f".repeat(43)}`;
  const oldHash = await hmacSecret(token, new TextEncoder().encode(previousSecret));
  const calls: Call[] = [];
  const kept = await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
  }), deps(calls, {
    lookup_mcp_credential: [
      { found: false },
      {
        found: true,
        id: "66666666-6666-4000-8000-000000000006",
        user_id: "user-1",
        expires_at: "2099-01-01T00:00:00.000Z",
        revoked_at: null,
      },
    ],
    bump_mcp_rate: { allowed: true, retry_after_seconds: 0 },
    touch_mcp_credential: null,
  }));
  assertEquals(kept.status, 200, "previous kid");
  const lookups = calls.filter((call) => call.url.endsWith("/lookup_mcp_credential"));
  assertEquals(lookups[1]?.body?.p_pepper_kid, "old", "second kid");
  assertEquals(lookups[1]?.body?.p_token_hash, oldHash, "old hash");
});

Deno.test("the rate limit fails closed when bump_mcp_rate errors", async () => {
  const calls: Call[] = [];
  const token = `flow_mcp_${"g".repeat(43)}`;
  const response = await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "cf-connecting-ip": "203.0.113.4" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
  }), deps(calls, {
    lookup_mcp_credential: {
      found: true,
      id: "77777777-7777-4000-8000-000000000007",
      user_id: "user-1",
      expires_at: "2099-01-01T00:00:00.000Z",
      revoked_at: null,
    },
  }, { statuses: { bump_mcp_rate: 500 } }));
  assertEquals(response.status, 503, "closed");
  assertEquals((await response.json()).error, "unavailable", "unavailable");
  assert(calls.every((call) => !call.url.endsWith("/note_auth_failure")), "not a failed secret");
  assert(calls.every((call) => !call.url.endsWith("/touch_mcp_credential")), "not touched");
});

Deno.test("production origins omit the dev hosts unless the env lists them", async () => {
  const bare = { ...env };
  delete bare.FLOW_MCP_APP_ORIGINS;
  const local = await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp/mint", {
    method: "OPTIONS",
    headers: { origin: "http://127.0.0.1:43123" },
  }), deps([], {}, { env: bare }));
  assertEquals(local.status, 403, "dev origin is not in production");
  const hosted = await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp/mint", {
    method: "OPTIONS",
    headers: { origin: "https://flow-app-dx5.pages.dev" },
  }), deps([], {}, { env: bare }));
  assertEquals(hosted.status, 204, "production origin");
});

Deno.test("a legacy service role key is not used, and a bad getUser body calls no wrapper", async () => {
  const legacyEnv = { ...env };
  delete legacyEnv.SUPABASE_SECRET_KEYS;
  legacyEnv.SUPABASE_SERVICE_ROLE_KEY = "legacy-service-role";
  const calls: Call[] = [];
  await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp/mint", {
    method: "POST",
    headers: { origin: "https://flow-app-dx5.pages.dev", authorization: "Bearer app-jwt", "content-type": "application/json" },
    body: JSON.stringify({ scope: "read" }),
  }), deps(calls, { store_mcp_credential: "11111111-1111-4000-8000-000000000001" }, { env: legacyEnv }));
  const store = calls.find((call) => call.url.endsWith("/store_mcp_credential"));
  assertEquals(store?.authorization.includes("legacy-service-role"), false, "legacy key ignored");

  const broken: Call[] = [];
  const response = await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp/status", {
    method: "POST",
    headers: { origin: "https://flow-app-dx5.pages.dev", authorization: "Bearer app-jwt" },
  }), deps(broken, {}, { userBody: "not-json" }));
  assertEquals(response.status, 401, "bad json");
  assert(broken.every((call) => call.url.endsWith("/user")), "no status wrapper");
});

Deno.test("an over-cap body is refused before the rate limit", async () => {
  const calls: Call[] = [];
  const token = `flow_mcp_${"e".repeat(43)}`;
  const hash = await hmacSecret(token, new TextEncoder().encode(pepperSecret));
  const response = await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: "x".repeat(65_537),
  }), deps(calls, {
    lookup_mcp_credential: {
      found: true,
      id: "55555555-5555-4000-8000-000000000005",
      user_id: "user-1",
      company_id: "company-1",
      scope: ["read", "write"],
      expires_at: "2099-01-01T00:00:00.000Z",
      revoked_at: null,
    },
  }));
  assertEquals(response.status, 400, "over cap");
  const payload = await response.json();
  assertEquals(payload.error, "validation", "validation");
  assertEquals(calls.some((call) => call.url.endsWith("bump_mcp_rate")), false, "rate limit not called");
  assertEquals(calls.some((call) => call.url.endsWith("lookup_mcp_credential") && call.body?.p_token_hash === hash), true, "the token was still checked");
});
