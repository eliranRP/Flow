import { criterion4, handle, hmacSecret } from "./handler.ts";
import { decodeJwtPart, signUserJwt, type SigningKey } from "./sign.ts";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown, message: string): void {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${message}: ${left} !== ${right}`);
}

const pepper = '{"kid":"test","secret":"pepper-test-secret"}';
const env: Record<string, string> = {
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SECRET_KEYS: '{"default":"secret-key"}',
  SUPABASE_PUBLISHABLE_KEYS: '{"default":"publishable-key"}',
  FLOW_MCP_PEPPER: pepper,
};

type Call = { url: string; body: Record<string, unknown> | null };

function deps(calls: Call[], routes: Record<string, unknown>) {
  return {
    env: (name: string) => env[name],
    fetch: (input: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
      calls.push({ url: input, body });
      const name = input.split("/").pop() ?? "";
      const payload = routes[name];
      if (name === "user") {
        return Promise.resolve(new Response(JSON.stringify({ id: "user-from-getuser" }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify(payload ?? {}), { status: 200 }));
    },
  };
}

Deno.test("GET is 405 and a present Origin on the MCP route is 403", async () => {
  const get = await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp", { method: "GET" }));
  assertEquals(get.status, 405, "GET");
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
  assert(typeof store.body.p_token_hash === "string" && store.body.p_token_hash !== body.secret, "hash at rest");
  assertEquals(response.headers.get("access-control-allow-origin"), "https://flow-app-dx5.pages.dev", "app origin");
});

Deno.test("a foreign origin cannot mint, and a failed clipboard path is not this route", async () => {
  const calls: Call[] = [];
  const response = await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp/mint", {
    method: "POST",
    headers: { origin: "https://evil.example", authorization: "Bearer app-jwt" },
    body: JSON.stringify({ scope: "read_write" }),
  }), deps(calls, {}));
  assertEquals(response.status, 403, "foreign origin");
  assertEquals(calls.length, 0, "no getUser");
});

Deno.test("tools/list is empty for a valid secret and does not throttle that secret", async () => {
  const calls: Call[] = [];
  const token = `flow_mcp_${"a".repeat(43)}`;
  const hash = await hmacSecret(token, new TextEncoder().encode("pepper-test-secret"));
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
      expires_at: "2099-01-01T00:00:00.000Z",
      revoked_at: null,
    },
    bump_mcp_rate: { allowed: true, retry_after_seconds: 0 },
    touch_mcp_credential: null,
  }));
  assertEquals(response.status, 200, "tools/list");
  const body = await response.json();
  assertEquals(body.result, { tools: [] }, "empty tools");
  const lookup = calls.find((call) => call.url.endsWith("/lookup_mcp_credential"));
  assertEquals(lookup?.body?.p_token_hash, hash, "lookup hash");
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

Deno.test("mint preflight allows only an app origin", async () => {
  const ok = await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp/mint", {
    method: "OPTIONS",
    headers: { origin: "http://127.0.0.1:43123" },
  }));
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

Deno.test("the signer sets role authenticated, a 60 second exp, and kid, and never a service role", async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey) as SigningKey;
  jwk.kid = "mcp-test-kid";
  jwk.alg = "ES256";
  const token = await signUserJwt(jwk, {
    issuer: "http://127.0.0.1:54321/auth/v1",
    sub: "user-1",
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
});
