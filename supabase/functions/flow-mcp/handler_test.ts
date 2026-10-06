import { corsAllowHeaders } from "../_shared/http.ts";
import { handle, hmacSecret } from "./handler.ts";
import { criterion4 } from "../../../scripts/mcp-signing-spike.mjs";
import { decodeJwtPart, signUserJwt, type SigningKey } from "./sign.ts";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown, message: string): void {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${message}: ${left} !== ${right}`);
}

const pepperSecret = "p".repeat(32);
const previousSecret = "q".repeat(32);
const pepper = JSON.stringify({
  kid: "test",
  secret: pepperSecret,
  previous: [{ kid: "old", secret: previousSecret }],
});
const env: Record<string, string> = {
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SECRET_KEYS: '{"default":"secret-key"}',
  SUPABASE_PUBLISHABLE_KEYS: '{"default":"publishable-key"}',
  FLOW_MCP_PEPPER: pepper,
  FLOW_MCP_SIGNING_KEY: JSON.stringify({ kty: "EC", crv: "P-256", alg: "ES256", kid: "list-kid", d: "aa", x: "bb", y: "cc" }),
  FLOW_MCP_APP_ORIGINS: "http://127.0.0.1:43123,http://localhost:43123,https://flow-app-dx5.pages.dev",
};

type Call = { url: string; body: Record<string, unknown> | null; authorization: string };

function deps(
  calls: Call[],
  routes: Record<string, unknown>,
  options?: {
    userStatus?: number;
    userBody?: string;
    statuses?: Record<string, number>;
    env?: Record<string, string>;
  },
) {
  const source = options?.env ?? env;
  return {
    env: (name: string) => source[name],
    fetch: (input: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
      const headers = new Headers(init?.headers);
      calls.push({ url: input, body, authorization: headers.get("authorization") ?? "" });
      const name = input.split("/").pop() ?? "";
      if (name === "user") {
        const status = options?.userStatus ?? 200;
        const text = options?.userBody ?? JSON.stringify({ id: "user-from-getuser" });
        return Promise.resolve(new Response(text, { status }));
      }
      const status = options?.statuses?.[name] ?? 200;
      const payload = routes[name];
      const json = Array.isArray(payload) ? payload.shift() : payload;
      return Promise.resolve(new Response(JSON.stringify(json ?? {}), { status }));
    },
  };
}

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
    "list_categories",
    "list_review",
    "get_expense",
    "search_expenses",
    "get_totals",
    "assign_expense",
    "assign_expenses",
    "set_expense_category",
    "create_project",
    "create_category",
    "sync_bank",
    "hide_category",
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

Deno.test("the signer sets role authenticated, a 60 second exp, and kid, and never a service role", async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey) as SigningKey;
  jwk.kid = "mcp-test-kid";
  jwk.alg = "ES256";
  const token = await signUserJwt(jwk, {
    issuer: "http://127.0.0.1:54321/auth/v1",
    sub: "user-1",
    companyId: "company-1",
    scope: ["read"],
    mcpTid: "token-1",
    jti: "jti-1",
    now: 1_700_000_000,
  });
  const [headerPart, payloadPart, signaturePart] = token.split(".");
  assert(headerPart != null && payloadPart != null && signaturePart != null, "three parts");
  const header = decodeJwtPart(headerPart);
  const payload = decodeJwtPart(payloadPart);
  assertEquals(header.alg, "ES256", "alg");
  assertEquals(header.kid, "mcp-test-kid", "kid");
  assertEquals(payload.role, "authenticated", "role");
  assertEquals(payload.aud, "authenticated", "aud");
  assertEquals(payload.exp, 1_700_000_060, "exp");
  assertEquals(payload.mcp_tid, "token-1", "mcp_tid");
  assert(payload.role !== "service_role", "not service role");
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const signingInput = new TextEncoder().encode(`${headerPart}.${payloadPart}`);
  const padded = signaturePart.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (signaturePart.length % 4)) % 4);
  const signature = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  const valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, signature, signingInput);
  assert(valid, "signature verifies");
  assertEquals(payload.company_id, "company-1", "company");
  assertEquals(payload.scope, ["read"], "scope");
});

Deno.test("each user's token signs that user's row, and cannot read the other company", async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey) as SigningKey & { sub?: string };
  jwk.kid = "standby-kid";
  jwk.alg = "ES256";
  jwk.sub = "not-a-user";
  const userA = "aaaaaaaa-aaaa-4000-8000-00000000000a";
  const userB = "bbbbbbbb-bbbb-4000-8000-00000000000b";
  const companyA = "cccccccc-cccc-4000-8000-00000000000a";
  const companyB = "dddddddd-dddd-4000-8000-00000000000b";
  const tokenA = `flow_mcp_${"a".repeat(43)}`;
  const tokenB = `flow_mcp_${"b".repeat(43)}`;
  const hashA = await hmacSecret(tokenA, new TextEncoder().encode(pepperSecret));
  const hashB = await hmacSecret(tokenB, new TextEncoder().encode(pepperSecret));
  const rows: Record<string, Record<string, unknown>> = {
    [hashA]: {
      found: true,
      id: "11111111-1111-4000-8000-0000000000a1",
      user_id: userA,
      company_id: companyA,
      scope: ["read"],
      expires_at: "2099-01-01T00:00:00.000Z",
      revoked_at: null,
    },
    [hashB]: {
      found: true,
      id: "22222222-2222-4000-8000-0000000000b2",
      user_id: userB,
      company_id: companyB,
      scope: ["read", "write"],
      expires_at: "2099-01-01T00:00:00.000Z",
      revoked_at: null,
    },
  };
  const dashboardCalls: { sub: string; company: string; scope: unknown; body: Record<string, unknown> | null; apikey: string }[] = [];
  const localEnv: Record<string, string> = {
    ...env,
    FLOW_MCP_SIGNING_KEY: JSON.stringify(jwk),
    FLOW_JWT_LEGACY: "legacy-must-not-be-used",
  };
  const localDeps = {
    env: (name: string) => localEnv[name],
    fetch: (input: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
      const name = input.split("/").pop() ?? "";
      if (name === "lookup_mcp_credential") {
        const hash = typeof body?.p_token_hash === "string" ? body.p_token_hash : "";
        return Promise.resolve(new Response(JSON.stringify(rows[hash] ?? { found: false }), { status: 200 }));
      }
      if (name === "bump_mcp_rate") {
        return Promise.resolve(new Response(JSON.stringify({ allowed: true, retry_after_seconds: 0 }), { status: 200 }));
      }
      if (name === "touch_mcp_credential") return Promise.resolve(new Response("null", { status: 200 }));
      if (name === "get_dashboard") {
        const authorization = headers.get("authorization") ?? "";
        const part = authorization.replace(/^Bearer\s+/i, "").split(".")[1] ?? "";
        const payload = decodeJwtPart(part);
        dashboardCalls.push({
          sub: String(payload.sub),
          company: String(payload.company_id),
          scope: payload.scope,
          body,
          apikey: headers.get("apikey") ?? "",
        });
        const company = payload.sub === userA ? companyA : payload.sub === userB ? companyB : "wrong";
        return Promise.resolve(new Response(JSON.stringify({
          company_id: company,
          name: company,
          basis: "cash",
          from: null,
          to: null,
          income_agorot: 0,
          direct_agorot: 0,
          shared_agorot: 0,
          overhead_agorot: 0,
          expense_agorot: 0,
          net_profit_agorot: 0,
          active_projects: 0,
          review_count: 0,
          projects: [],
        }), { status: 200 }));
      }
      return Promise.resolve(new Response("{}", { status: 500 }));
    },
  };

  async function totals(token: string, extra?: Record<string, unknown>) {
    return await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "get_totals", arguments: extra ?? {} },
      }),
    }), localDeps);
  }

  const first = await totals(tokenA);
  assertEquals(first.status, 200, "user A call");
  const firstBody = await first.json();
  assertEquals(firstBody.result.structuredContent.data.company_id, companyA, "user A company");
  assertEquals(dashboardCalls[0]?.sub, userA, "pass sub is user A");
  assertEquals(dashboardCalls[0]?.company, companyA, "pass company is user A");
  assertEquals(dashboardCalls[0]?.scope, ["read"], "pass scope is the token scope");
  assertEquals(dashboardCalls[0]?.sub === "not-a-user", false, "the signing key has no user");
  assertEquals(dashboardCalls[0]?.body, { p_from: null, p_to: null, p_basis: "cash" }, "no company argument");
  assertEquals(dashboardCalls[0]?.apikey, "publishable-key", "publishable key");

  const second = await totals(tokenB);
  const secondBody = await second.json();
  assertEquals(secondBody.result.structuredContent.data.company_id, companyB, "user B company");
  assertEquals(dashboardCalls[1]?.sub, userB, "pass sub is user B");
  assertEquals(dashboardCalls[1]?.company, companyB, "pass company is user B");
  assert(firstBody.result.structuredContent.data.company_id !== secondBody.result.structuredContent.data.company_id, "different companies");

  const forged = await totals(tokenA, { company_id: companyB, user_id: userB, sub: userB, scope: ["read", "write"] });
  const forgedBody = await forged.json();
  assertEquals(forgedBody.result.isError, true, "forged identity is refused");
  assertEquals(forgedBody.result.structuredContent.error.code, "validation", "validation");
  assertEquals(dashboardCalls.length, 2, "the forged call did not read");

  delete localEnv.FLOW_MCP_SIGNING_KEY;
  const missing = await totals(tokenA);
  assertEquals(missing.status, 200, "missing key is a tool error");
  const missingBody = await missing.json();
  assertEquals(missingBody.result.isError, true, "isError");
  assertEquals(missingBody.result.structuredContent.error.code, "unavailable", "no legacy fallback");
  assertEquals(missingBody.error, undefined, "not an HTTP error body");
});

Deno.test("tools stay hidden without a signing key, and a token without read is refused", async () => {
  const token = `flow_mcp_${"c".repeat(43)}`;
  const row = {
    found: true,
    id: "88888888-8888-4000-8000-000000000008",
    user_id: "user-1",
    company_id: "company-1",
    scope: ["read"],
    expires_at: "2099-01-01T00:00:00.000Z",
    revoked_at: null,
  };
  const bare = { ...env };
  delete bare.FLOW_MCP_SIGNING_KEY;
  const listed = await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  }), deps([], {
    lookup_mcp_credential: row,
    bump_mcp_rate: { allowed: true, retry_after_seconds: 0 },
    touch_mcp_credential: null,
  }, { env: bare }));
  const listedBody = await listed.json();
  assertEquals(listedBody.result.tools, [], "hidden without the key");

  const writeOnly = { ...row, scope: ["write"] };
  const calls: Call[] = [];
  const refused = await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "list_categories", arguments: {} },
    }),
  }), deps(calls, {
    lookup_mcp_credential: writeOnly,
    bump_mcp_rate: { allowed: true, retry_after_seconds: 0 },
    touch_mcp_credential: null,
  }, { env }));
  const refusedBody = await refused.json();
  assertEquals(refused.status, 200, "refused token");
  assertEquals(refusedBody.result.isError, true, "isError");
  assertEquals(refusedBody.result.structuredContent.error.code, "forbidden", "no read scope");
  assert(calls.every((call) => !call.url.endsWith("/list_categories")), "no ledger read");
});

Deno.test("get_expense and list_review stay inside the token company", async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey) as SigningKey;
  jwk.kid = "mcp-iso-kid";
  jwk.alg = "ES256";
  const userA = "aaaaaaaa-aaaa-4000-8000-00000000000a";
  const userB = "bbbbbbbb-bbbb-4000-8000-00000000000b";
  const companyA = "cccccccc-cccc-4000-8000-00000000000a";
  const companyB = "dddddddd-dddd-4000-8000-00000000000b";
  const expenseA = "11111111-1111-4000-8000-00000000000a";
  const expenseB = "11111111-1111-4000-8000-00000000000b";
  const localEnv: Record<string, string> = { ...env, FLOW_MCP_SIGNING_KEY: JSON.stringify(jwk) };
  const tokenA = `flow_mcp_${"a".repeat(43)}`;
  const tokenB = `flow_mcp_${"b".repeat(43)}`;
  const hashA = await hmacSecret(tokenA, new TextEncoder().encode(pepperSecret));
  const hashB = await hmacSecret(tokenB, new TextEncoder().encode(pepperSecret));
  const seen: { name: string; sub: string }[] = [];
  const localDeps = {
    env: (name: string) => localEnv[name],
    fetch: (input: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const name = input.split("/").pop() ?? "";
      if (name === "lookup_mcp_credential") {
        const body = JSON.parse(String(init?.body)) as { p_token_hash?: string };
        const user = body.p_token_hash === hashA ? userA : body.p_token_hash === hashB ? userB : "";
        if (!user) return Promise.resolve(new Response(JSON.stringify({ found: false })));
        const company = user === userA ? companyA : companyB;
        const scope = user === userA ? ["read"] : ["read", "write"];
        return Promise.resolve(new Response(JSON.stringify({
          found: true,
          id: user,
          user_id: user,
          company_id: company,
          scope,
          expires_at: "2099-01-01T00:00:00.000Z",
          revoked_at: null,
        })));
      }
      if (name === "bump_mcp_rate") {
        return Promise.resolve(new Response(JSON.stringify({ allowed: true, retry_after_seconds: 0 })));
      }
      if (name === "touch_mcp_credential") return Promise.resolve(new Response("null"));
      const authorization = headers.get("authorization") ?? "";
      const payloadPart = authorization.replace(/^Bearer\s+/i, "").split(".")[1] ?? "";
      const payload = decodeJwtPart(payloadPart);
      const sub = String(payload.sub);
      seen.push({ name, sub });
      if (name === "list_review") {
        const description = sub === userA ? "אלפא" : "ביתא";
        const id = sub === userA ? expenseA : expenseB;
        return Promise.resolve(new Response(JSON.stringify([{ id: "review", transaction_id: id, description }])));
      }
      if (name === "get_transaction") {
        const id = sub === userA ? expenseA : expenseB;
        return Promise.resolve(new Response(JSON.stringify({ id, description: sub === userA ? "אלפא" : "ביתא" })));
      }
      return Promise.resolve(new Response("{}", { status: 500 }));
    },
  };
  async function call(token: string, tool: string, args: Record<string, unknown>) {
    return await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } }),
    }), localDeps);
  }
  const reviewA = await (await call(tokenA, "list_review", {})).json();
  const reviewB = await (await call(tokenB, "list_review", {})).json();
  assertEquals(reviewA.result.structuredContent.data.reviews[0].description, "אלפא", "user A review");
  assertEquals(reviewB.result.structuredContent.data.reviews[0].description, "ביתא", "user B review");
  assert(reviewA.result.structuredContent.data.reviews[0].description !== reviewB.result.structuredContent.data.reviews[0].description, "reviews differ");
  const expense = await (await call(tokenA, "get_expense", { transaction_id: expenseB })).json();
  assertEquals(expense.result.structuredContent.data.description, "אלפא", "user A expense ignores the other id's company");
  assertEquals(expense.result.structuredContent.data.id, expenseA, "user A expense id");
  assertEquals(seen.some((call) => call.name === "get_transaction" && call.sub === userB), false, "token A did not read as user B");
});

Deno.test("a write tool counts as a write, and a read-only token cannot call it", async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey) as SigningKey;
  jwk.kid = "write-kid";
  jwk.alg = "ES256";
  const token = `flow_mcp_${"d".repeat(43)}`;
  const hash = await hmacSecret(token, new TextEncoder().encode(pepperSecret));
  const txn = "22222222-2222-4000-8000-000000000020";
  const project = "8c1a0b2e-1111-4000-8000-000000000001";
  const category = "c0ffee00-1111-4000-8000-0000000000a1";
  const kinds: string[] = [];
  const ledger: string[] = [];
  const localEnv: Record<string, string> = { ...env, FLOW_MCP_SIGNING_KEY: JSON.stringify(jwk) };
  let scope = ["read", "write"];
  const localDeps = {
    env: (name: string) => localEnv[name],
    fetch: (input: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
      const name = input.split("/").pop() ?? "";
      if (name === "lookup_mcp_credential") {
        const asked = typeof body?.p_token_hash === "string" ? body.p_token_hash : "";
        if (asked !== hash) return Promise.resolve(new Response(JSON.stringify({ found: false })));
        return Promise.resolve(new Response(JSON.stringify({
          found: true,
          id: "88888888-8888-4000-8000-000000000008",
          user_id: "aaaaaaaa-aaaa-4000-8000-00000000000a",
          company_id: "cccccccc-cccc-4000-8000-00000000000a",
          scope,
          expires_at: "2099-01-01T00:00:00.000Z",
          revoked_at: null,
        })));
      }
      if (name === "bump_mcp_rate") {
        kinds.push(String(body?.p_kind));
        return Promise.resolve(new Response(JSON.stringify({ allowed: true, retry_after_seconds: 0 })));
      }
      if (name === "touch_mcp_credential") return Promise.resolve(new Response("null"));
      ledger.push(name);
      if (name === "mcp_assign_expense") {
        return Promise.resolve(new Response(JSON.stringify({
          ok: true,
          data: { undo_kind: "reassign", id: "33333333-3333-4000-8000-000000000033", closed_review: false },
        })));
      }
      if (name === "list_categories") return Promise.resolve(new Response(JSON.stringify([])));
      return Promise.resolve(new Response("{}", { status: 500 }));
    },
  };
  async function call(tool: string, args: Record<string, unknown>) {
    return await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: tool, arguments: args } }),
    }), localDeps);
  }
  const assigned = await call("assign_expense", {
    idempotency_key: "assign-20",
    transaction_id: txn,
    project_id: project,
    category_id: category,
  });
  const assignedBody = await assigned.json();
  assertEquals(assigned.status, 200, "write is not an HTTP error");
  assertEquals(assignedBody.result.isError, false, "assign succeeded");
  assertEquals(assignedBody.result.structuredContent.data.closed_review, false, "no review");
  assertEquals(kinds[0], "write", "assign uses the write bucket");
  assert(ledger.includes("mcp_assign_expense"), "wrapper was called");

  const listed = await call("list_categories", {});
  assertEquals((await listed.json()).result.isError, false, "read still works");
  assertEquals(kinds[1], "read", "a read stays on the read bucket");

  scope = ["read"];
  kinds.length = 0;
  ledger.length = 0;
  const denied = await call("assign_expense", {
    idempotency_key: "assign-20",
    transaction_id: txn,
    project_id: project,
    category_id: category,
  });
  const deniedBody = await denied.json();
  assertEquals(denied.status, 200, "forbidden is a tool result");
  assertEquals(deniedBody.result.isError, true, "isError");
  assertEquals(deniedBody.result.structuredContent.error.code, "forbidden", "read token cannot write");
  assertEquals(ledger.includes("mcp_assign_expense"), false, "the wrapper was not called");
  assertEquals(kinds, ["write"], "a read-only write attempt still uses the write bucket");

  scope = ["write"];
  const writeList = await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/list" }),
  }), localDeps);
  const writeNames = ((await writeList.json()).result.tools as { name: string }[]).map((tool) => tool.name);
  assertEquals(writeNames, [
    "assign_expense",
    "assign_expenses",
    "set_expense_category",
    "create_project",
    "create_category",
    "sync_bank",
    "hide_category",
    "undo",
    "undo_batch",
  ], "write token lists writes only");

  scope = ["read"];
  const readList = await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 6, method: "tools/list" }),
  }), localDeps);
  const readNames = ((await readList.json()).result.tools as { name: string }[]).map((tool) => tool.name);
  assertEquals(readNames.includes("assign_expense"), false, "read token hides writes");
  assertEquals(readNames.length, 6, "six reads");
});

Deno.test("assign_expenses is one write rate hit for many rows", async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey) as SigningKey;
  jwk.kid = "batch-kid";
  jwk.alg = "ES256";
  const token = `flow_mcp_${"e".repeat(43)}`;
  const hash = await hmacSecret(token, new TextEncoder().encode(pepperSecret));
  const kinds: string[] = [];
  const txn = "22222222-2222-4000-8000-000000000020";
  const txn2 = "22222222-2222-4000-8000-000000000021";
  const project = "8c1a0b2e-1111-4000-8000-000000000001";
  const category = "c0ffee00-1111-4000-8000-0000000000a1";
  const localEnv: Record<string, string> = { ...env, FLOW_MCP_SIGNING_KEY: JSON.stringify(jwk) };
  const localDeps = {
    env: (name: string) => localEnv[name],
    fetch: (input: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
      const name = input.split("/").pop() ?? "";
      if (name === "lookup_mcp_credential") {
        const asked = typeof body?.p_token_hash === "string" ? body.p_token_hash : "";
        if (asked !== hash) return Promise.resolve(new Response(JSON.stringify({ found: false })));
        return Promise.resolve(new Response(JSON.stringify({
          found: true,
          id: "88888888-8888-4000-8000-000000000008",
          user_id: "aaaaaaaa-aaaa-4000-8000-00000000000a",
          company_id: "cccccccc-cccc-4000-8000-00000000000a",
          scope: ["write"],
          expires_at: "2099-01-01T00:00:00.000Z",
          revoked_at: null,
        })));
      }
      if (name === "bump_mcp_rate") {
        kinds.push(String(body?.p_kind));
        return Promise.resolve(new Response(JSON.stringify({ allowed: true, retry_after_seconds: 0 })));
      }
      if (name === "touch_mcp_credential") return Promise.resolve(new Response("null"));
      if (name === "mcp_assign_expenses") {
        return Promise.resolve(new Response(JSON.stringify({
          ok: true,
          data: {
            batch_key: "33333333-3333-4000-8000-000000000003",
            ok_count: 2,
            error_count: 0,
            results: [],
          },
        })));
      }
      return Promise.resolve(new Response("{}", { status: 500 }));
    },
  };
  const response = await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "assign_expenses",
        arguments: {
          idempotency_key: "batch-rate",
          items: [
            { transaction_id: txn, project_id: project, category_id: category },
            { transaction_id: txn2, category_id: category },
          ],
        },
      },
    }),
  }), localDeps);
  const payload = await response.json();
  assertEquals(response.status, 200, "batch call succeeds");
  assertEquals(payload.result.isError, false, "batch tool result");
  assertEquals(kinds, ["write"], "one write bucket hit for the whole batch");
});

Deno.test("sync_bank POSTs mercury-sync with the signed JWT and publishable apikey", async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey) as SigningKey;
  jwk.kid = "sync-kid";
  jwk.alg = "ES256";
  const token = `flow_mcp_${"s".repeat(43)}`;
  const hash = await hmacSecret(token, new TextEncoder().encode(pepperSecret));
  const calls: { url: string; authorization: string; apikey: string; body: Record<string, unknown> | null }[] = [];
  const localEnv: Record<string, string> = { ...env, FLOW_MCP_SIGNING_KEY: JSON.stringify(jwk) };
  const localDeps = {
    env: (name: string) => localEnv[name],
    fetch: (input: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
      calls.push({
        url: input,
        authorization: headers.get("authorization") ?? "",
        apikey: headers.get("apikey") ?? "",
        body,
      });
      if (input.includes("/lookup_mcp_credential")) {
        return Promise.resolve(new Response(JSON.stringify({
          found: true,
          id: "99999999-9999-4000-8000-000000000009",
          user_id: "aaaaaaaa-aaaa-4000-8000-00000000000a",
          company_id: "cccccccc-cccc-4000-8000-00000000000a",
          scope: ["write"],
          expires_at: "2099-01-01T00:00:00.000Z",
          revoked_at: null,
        })));
      }
      if (input.includes("/bump_mcp_rate")) {
        return Promise.resolve(new Response(JSON.stringify({ allowed: true, retry_after_seconds: 0 })));
      }
      if (input.includes("/touch_mcp_credential")) return Promise.resolve(new Response("null"));
      const rpcName = input.split("/").pop() ?? "";
      if (rpcName === "mcp_sync_bank_begin") {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, data: { state: "proceed" } })));
      }
      if (rpcName === "mcp_sync_bank_finish") return Promise.resolve(new Response("null"));
      if (input.includes("/functions/v1/mercury-sync")) {
        return Promise.resolve(new Response(JSON.stringify({
          ok: true,
          lines: 1,
          inserted: 1,
          updated: 0,
          removed: 0,
          newest_date: "2026-09-10",
        })));
      }
      return Promise.resolve(new Response("{}", { status: 500 }));
    },
  };
  const response = await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: { name: "sync_bank", arguments: { idempotency_key: "sync-handler" } },
    }),
  }), localDeps);
  const payload = await response.json();
  assertEquals(payload.result.isError, false, "sync succeeded");
  const mercury = calls.find((call) => call.url.endsWith("/functions/v1/mercury-sync"));
  if (!mercury) throw new Error("mercury-sync not called");
  assertEquals(mercury.apikey, "publishable-key", "publishable apikey");
  const begin = calls.find((call) => call.url.endsWith("/mcp_sync_bank_begin"));
  if (!begin) throw new Error("mcp_sync_bank_begin not called");
  assertEquals(mercury.authorization.split(".").length, 3, "signed jwt");
  assertEquals(mercury.authorization, begin.authorization, "same signed jwt as the RPCs");
  assertEquals(mercury.authorization.includes("publishable-key"), false, "never the publishable key");
  assertEquals(mercury.authorization.includes("secret-key"), false, "never the service secret");
  assertEquals(mercury.body, { force: true }, "force pull");
  const finish = calls.find((call) => call.url.endsWith("/mcp_sync_bank_finish"));
  if (!finish) throw new Error("mcp_sync_bank_finish not called");
  assertEquals(finish.body, {
    p_idempotency_key: "sync-handler",
    p_response: { ok: true, data: { added: 1, duplicates: 0, removed: 0, newest_date: "2026-09-10" } },
  }, "finish stores the mapped counts");
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
