// Flow MCP handler tests: the JWT signer and company isolation (each token reads only its own company).
import { handle, hmacSecret } from "./handler.ts";
import { decodeJwtPart, signUserJwt, type SigningKey } from "./sign.ts";
import { assert, assertEquals, type Call, deps, env, pepperSecret } from "./handler_test_support.ts";

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
  assertEquals(dashboardCalls[0]?.body, { p_from: null, p_to: null, p_basis: "invoiced" }, "no company argument");
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
      if (name === "get_line_split") return Promise.resolve(new Response("null"));
      if (name === "get_loan_split") return Promise.resolve(new Response("null"));
      if (name === "get_line_meta") return Promise.resolve(new Response("[]"));
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
  assertEquals(seen.some((call) => call.name === "get_loan_split" && call.sub === userB), false, "token A did not read a loan split as user B");
});

Deno.test("get_project reads only the token company's project", async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey) as SigningKey;
  jwk.kid = "mcp-project-kid";
  jwk.alg = "ES256";
  const userA = "aaaaaaaa-aaaa-4000-8000-00000000000a";
  const userB = "bbbbbbbb-bbbb-4000-8000-00000000000b";
  const companyA = "cccccccc-cccc-4000-8000-00000000000a";
  const companyB = "dddddddd-dddd-4000-8000-00000000000b";
  const projectA = "8c1a0b2e-aaaa-4000-8000-00000000000a";
  const projectB = "8c1a0b2e-bbbb-4000-8000-00000000000b";
  const owner: Record<string, string> = { [projectA]: userA, [projectB]: userB };
  const localEnv: Record<string, string> = { ...env, FLOW_MCP_SIGNING_KEY: JSON.stringify(jwk) };
  const tokenA = `flow_mcp_${"a".repeat(43)}`;
  const tokenB = `flow_mcp_${"b".repeat(43)}`;
  const hashA = await hmacSecret(tokenA, new TextEncoder().encode(pepperSecret));
  const hashB = await hmacSecret(tokenB, new TextEncoder().encode(pepperSecret));
  const seen: { name: string; sub: string; body: Record<string, unknown> | null }[] = [];
  const kinds: string[] = [];
  const localDeps = {
    env: (name: string) => localEnv[name],
    fetch: (input: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
      const name = input.split("/").pop() ?? "";
      if (name === "lookup_mcp_credential") {
        const user = body?.p_token_hash === hashA ? userA : body?.p_token_hash === hashB ? userB : "";
        if (!user) return Promise.resolve(new Response(JSON.stringify({ found: false })));
        return Promise.resolve(new Response(JSON.stringify({
          found: true,
          id: user,
          user_id: user,
          company_id: user === userA ? companyA : companyB,
          scope: ["read"],
          expires_at: "2099-01-01T00:00:00.000Z",
          revoked_at: null,
        })));
      }
      if (name === "bump_mcp_rate") {
        kinds.push(String(body?.p_kind));
        return Promise.resolve(new Response(JSON.stringify({ allowed: true, retry_after_seconds: 0 })));
      }
      if (name === "touch_mcp_credential") return Promise.resolve(new Response("null"));
      const authorization = headers.get("authorization") ?? "";
      const payload = decodeJwtPart(authorization.replace(/^Bearer\s+/i, "").split(".")[1] ?? "");
      const sub = String(payload.sub);
      seen.push({ name, sub, body });
      if (name === "get_project") {
        // Like the RPC under RLS: a project outside the caller's company is null.
        const id = String(body?.p_id);
        if (owner[id] !== sub) return Promise.resolve(new Response("null"));
        return Promise.resolve(new Response(JSON.stringify({
          id,
          name: sub === userA ? "Example Alpha" : "Example Beta",
          by_currency: [],
          categories_by_currency: [],
          transactions: [],
        })));
      }
      return Promise.resolve(new Response("{}", { status: 500 }));
    },
  };
  async function call(token: string, args: Record<string, unknown>) {
    const response = await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_project", arguments: args } }),
    }), localDeps);
    assertEquals(response.status, 200, "a tool result, not an HTTP error");
    return (await response.json()).result;
  }
  const ownA = await call(tokenA, { id: projectA });
  assertEquals(ownA.isError, false, "user A reads their own project");
  assertEquals(ownA.structuredContent.data.name, "Example Alpha", "user A project");
  assertEquals(ownA.structuredContent.data.basis, "invoiced", "default basis");
  const ownB = await call(tokenB, { id: projectB, basis: "cash" });
  assertEquals(ownB.isError, false, "user B reads their own project");
  assertEquals(ownB.structuredContent.data.name, "Example Beta", "user B project");

  const crossed = await call(tokenA, { id: projectB });
  assertEquals(crossed.isError, true, "the other company's project is refused");
  assertEquals(crossed.structuredContent.error, { code: "not_found", message: "not found" }, "not found, nothing leaked");
  assertEquals(crossed.structuredContent.data, undefined, "no data");
  const crossedCall = seen[seen.length - 1];
  assertEquals(crossedCall?.sub, userA, "signed as user A, not the project owner");
  assertEquals(crossedCall?.body, { p_id: projectB, p_basis: "invoiced" }, "no company argument");

  const before = seen.length;
  const forged = await call(tokenA, { id: projectB, company_id: companyB });
  assertEquals(forged.structuredContent.error.code, "validation", "forged company is refused");
  assertEquals(seen.length, before, "the forged call did not read");
  assertEquals(kinds.every((kind) => kind === "read"), true, "get_project uses the read bucket");
  assertEquals(kinds.length, 4, "every call counted");
});
