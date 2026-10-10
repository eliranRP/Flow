// Flow MCP handler tests: write rate hits, tool scopes, initialize and list_changed, and sync_bank calls.
import { handle, hmacSecret } from "./handler.ts";
import { decodeJwtPart, type SigningKey } from "./sign.ts";
import { assert, assertEquals, env, pepperSecret } from "./handler_test_support.ts";

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
    "set_line_recurring",
    "set_line_pace",
    "undo_jev_prefill",
    "undo",
    "undo_batch",
    "get_sync_status",
  ], "write token lists writes and its sync status");

  scope = ["read"];
  const readList = await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 6, method: "tools/list" }),
  }), localDeps);
  const readNames = ((await readList.json()).result.tools as { name: string }[]).map((tool) => tool.name);
  assertEquals(readNames.includes("assign_expense"), false, "read token hides writes");
  assertEquals(readNames.length, 33, "thirty-three reads");
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

Deno.test("get_sync_status takes the read bucket and a write-only token can call it", async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey) as SigningKey;
  jwk.kid = "sync-status-kid";
  jwk.alg = "ES256";
  const token = `flow_mcp_${"s".repeat(43)}`;
  const hash = await hmacSecret(token, new TextEncoder().encode(pepperSecret));
  const kinds: string[] = [];
  const called: string[] = [];
  const job = "44444444-4444-4000-8000-000000000004";
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
          id: "88888888-8888-4000-8000-000000000009",
          user_id: "aaaaaaaa-aaaa-4000-8000-00000000000b",
          company_id: "cccccccc-cccc-4000-8000-00000000000b",
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
      if (name === "mcp_sync_status") {
        called.push(String(body?.p_job_id));
        return Promise.resolve(new Response(JSON.stringify({
          ok: true,
          data: { job_id: job, state: "running", started_at: "2026-10-08T08:00:00Z", finished_at: null },
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
      id: 8,
      method: "tools/call",
      params: { name: "get_sync_status", arguments: { job_id: job } },
    }),
  }), localDeps);
  const payload = await response.json();
  assertEquals(response.status, 200, "status call succeeds");
  assertEquals(payload.result.isError, false, "a write-only token reads its sync status");
  assertEquals(called, [job], "the status read reaches mcp_sync_status");
  assertEquals(kinds, ["read"], "polling takes the read bucket, not the write bucket");
});

Deno.test("a 30-row company setup is two write rate hits", async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey) as SigningKey;
  jwk.kid = "setup-kid";
  jwk.alg = "ES256";
  const token = `flow_mcp_${"g".repeat(43)}`;
  const hash = await hmacSecret(token, new TextEncoder().encode(pepperSecret));
  const kinds: string[] = [];
  const rows: Record<string, number> = {};
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
          id: "88888888-8888-4000-8000-000000000009",
          user_id: "aaaaaaaa-aaaa-4000-8000-00000000000b",
          company_id: "cccccccc-cccc-4000-8000-00000000000b",
          scope: ["write"],
          expires_at: "2099-01-01T00:00:00.000Z",
          revoked_at: null,
        })));
      }
      if (name === "bump_mcp_rate") {
        kinds.push(String(body?.p_kind));
        // The write bucket allows 20 a minute; a call per row would pass it.
        const writes = kinds.filter((kind) => kind === "write").length;
        return Promise.resolve(new Response(JSON.stringify({ allowed: writes <= 20, retry_after_seconds: 30 })));
      }
      if (name === "touch_mcp_credential") return Promise.resolve(new Response("null"));
      if (name === "mcp_create_projects" || name === "mcp_create_categories") {
        const items = Array.isArray(body?.p_items) ? body.p_items : [];
        rows[name] = items.length;
        return Promise.resolve(new Response(JSON.stringify({
          ok: true,
          data: { batch_key: "33333333-3333-4000-8000-000000000004", ok_count: items.length, error_count: 0, results: [] },
        })));
      }
      return Promise.resolve(new Response("{}", { status: 500 }));
    },
  };
  const call = (id: number, name: string, items: unknown[]) =>
    handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name, arguments: { idempotency_key: `setup-${id}`, items } },
      }),
    }), localDeps);
  const projects = await call(1, "create_projects", Array.from({ length: 15 }, (_, i) => ({ name: `Site ${i + 1}` })));
  const categories = await call(
    2,
    "create_categories",
    Array.from({ length: 15 }, (_, i) => ({ name: `Cost ${i + 1}`, kind: "expense" })),
  );
  for (const response of [projects, categories]) {
    assertEquals(response.status, 200, "no 429");
    assertEquals((await response.json()).result.isError, false, "setup batch result");
  }
  assertEquals(kinds, ["write", "write"], "one write bucket hit per batch");
  assertEquals(rows, { mcp_create_projects: 15, mcp_create_categories: 15 }, "every row reached the database");
});

Deno.test("initialize stamps the tool list, and a stale session hears list_changed", async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey) as SigningKey;
  jwk.kid = "list-changed-kid";
  jwk.alg = "ES256";
  const token = `flow_mcp_${"h".repeat(43)}`;
  const localEnv: Record<string, string> = { ...env, FLOW_MCP_SIGNING_KEY: JSON.stringify(jwk) };
  const localDeps = {
    env: (name: string) => localEnv[name],
    fetch: (input: string) => {
      const name = input.split("/").pop() ?? "";
      if (name === "lookup_mcp_credential") {
        return Promise.resolve(new Response(JSON.stringify({
          found: true,
          id: "88888888-8888-4000-8000-00000000000a",
          user_id: "aaaaaaaa-aaaa-4000-8000-00000000000c",
          company_id: "cccccccc-cccc-4000-8000-00000000000c",
          scope: ["write"],
          expires_at: "2099-01-01T00:00:00.000Z",
          revoked_at: null,
        })));
      }
      if (name === "bump_mcp_rate") {
        return Promise.resolve(new Response(JSON.stringify({ allowed: true, retry_after_seconds: 0 })));
      }
      if (name === "touch_mcp_credential") return Promise.resolve(new Response("null"));
      return Promise.resolve(new Response("{}", { status: 500 }));
    },
  };
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }), localDeps);
  const init = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  assertEquals((await init.json()).result.capabilities, { tools: { listChanged: true } }, "capability");
  const session = init.headers.get("mcp-session-id") ?? "";
  assert(/^[0-9a-f-]{36}\.[0-9a-f]{16}$/.test(session), `session id shape: ${session}`);
  const again = await post({ jsonrpc: "2.0", id: 2, method: "initialize", params: {} });
  const second = again.headers.get("mcp-session-id") ?? "";
  assert(second !== session, "each session id is new");
  assertEquals(second.split(".")[1], session.split(".")[1], "same tools, same stamp");

  // A validation refusal needs no database call, so it shows the framing alone.
  const call = { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "create_projects", arguments: {} } };
  const stream = "application/json, text/event-stream";
  const current = await post(call, { "mcp-session-id": session, accept: stream });
  assertEquals(current.headers.get("content-type"), "application/json", "a current session gets JSON");
  assertEquals((await current.json()).result.isError, true, "the refusal is the reply");

  const stale = `${session.split(".")[0]}.0000000000000000`;
  const notified = await post(call, { "mcp-session-id": stale, accept: stream });
  assertEquals(notified.status, 200, "stream status");
  assertEquals(notified.headers.get("content-type"), "text/event-stream", "a stale session gets a stream");
  const events = (await notified.text()).split("\n\n").filter((part) => part.length > 0);
  assertEquals(events.length, 2, "notification then reply");
  assertEquals(JSON.parse(events[0].replace("event: message\ndata: ", "")), {
    jsonrpc: "2.0",
    method: "notifications/tools/list_changed",
  }, "list_changed first");
  const reply = JSON.parse(events[1].replace("event: message\ndata: ", ""));
  assertEquals([reply.id, reply.result.isError], [3, true], "then the same reply");

  const noStream = await post(call, { "mcp-session-id": stale, accept: "application/json" });
  assertEquals(noStream.headers.get("content-type"), "application/json", "no stream accepted, plain JSON");
  const noSession = await post(call, { accept: stream });
  assertEquals(noSession.headers.get("content-type"), "application/json", "no session id, plain JSON");

  // Without a signing key tools/list is empty, so the stamp differs and the key's arrival is announced.
  const keyless = { ...localDeps, env: (name: string) => name === "FLOW_MCP_SIGNING_KEY" ? undefined : localEnv[name] };
  const bare = await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "initialize", params: {} }),
  }), keyless);
  const bareSession = bare.headers.get("mcp-session-id") ?? "";
  assert(bareSession.split(".")[1] !== session.split(".")[1], "an empty list has its own stamp");
  const afterKey = await post(call, { "mcp-session-id": bareSession, accept: stream });
  assertEquals(afterKey.headers.get("content-type"), "text/event-stream", "the key's arrival is announced");
});

const SYNC_JOB = "abababab-abab-4000-8000-0000000000ab";

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
        return Promise.resolve(new Response(JSON.stringify({ ok: true, data: { state: "proceed", job_id: SYNC_JOB } })));
      }
      if (rpcName === "mcp_sync_bank_finish") {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, data: { job_id: SYNC_JOB, state: "done" } })));
      }
      if (rpcName === "mcp_sync_status") {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, data: { job_id: SYNC_JOB, state: "running" } })));
      }
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
    p_job_id: SYNC_JOB,
    p_response: { ok: true, data: { added: 1, duplicates: 0, removed: 0, newest_date: "2026-09-10" } },
  }, "finish stores the mapped counts");
});

Deno.test("sync_bank answers before the pull ends and signs a fresh JWT for the finish", async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey) as SigningKey;
  jwk.kid = "sync-bg-kid";
  jwk.alg = "ES256";
  const token = `flow_mcp_${"b".repeat(43)}`;
  const calls: { url: string; authorization: string; body: Record<string, unknown> | null }[] = [];
  let releasePull: () => void = () => {};
  const pullGate = new Promise<void>((resolve) => {
    releasePull = resolve;
  });
  const deferred: Promise<unknown>[] = [];
  const localEnv: Record<string, string> = { ...env, FLOW_MCP_SIGNING_KEY: JSON.stringify(jwk) };
  const realNow = Date.now;
  let clock = realNow();
  Date.now = () => clock;
  try {
    const localDeps = {
      env: (name: string) => localEnv[name],
      waitUntil: (work: Promise<unknown>) => {
        deferred.push(work);
      },
      fetch: async (input: string, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
        calls.push({ url: input, authorization: headers.get("authorization") ?? "", body });
        if (input.includes("/lookup_mcp_credential")) {
          return new Response(JSON.stringify({
            found: true,
            id: "99999999-9999-4000-8000-00000000000b",
            user_id: "aaaaaaaa-aaaa-4000-8000-00000000000b",
            company_id: "cccccccc-cccc-4000-8000-00000000000b",
            scope: ["write"],
            expires_at: "2099-01-01T00:00:00.000Z",
            revoked_at: null,
          }));
        }
        if (input.includes("/bump_mcp_rate")) return new Response(JSON.stringify({ allowed: true, retry_after_seconds: 0 }));
        if (input.includes("/touch_mcp_credential")) return new Response("null");
        if (input.endsWith("/mcp_sync_bank_begin")) {
          return new Response(JSON.stringify({ ok: true, data: { state: "proceed", job_id: SYNC_JOB } }));
        }
        if (input.endsWith("/mcp_sync_bank_finish")) {
          return new Response(JSON.stringify({ ok: true, data: { job_id: SYNC_JOB, state: "done" } }));
        }
        if (input.includes("/functions/v1/mercury-sync")) {
          await pullGate;
          clock += 90_000;
          return new Response(JSON.stringify({ ok: true, inserted: 0, updated: 2, removed: 0, newest_date: null }));
        }
        return new Response("{}", { status: 500 });
      },
    };
    const response = await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: { name: "sync_bank", arguments: { idempotency_key: "sync-bg" } },
      }),
    }), localDeps);
    const payload = await response.json();
    assertEquals(payload.result.structuredContent, { ok: true, data: { job_id: SYNC_JOB, state: "running" } }, "answers at once");
    assertEquals(calls.some((call) => call.url.endsWith("/mcp_sync_bank_finish")), false, "finish waits for the pull");
    assertEquals(deferred.length, 1, "the pull runs in the background");
    releasePull();
    await Promise.all(deferred);
    const begin = calls.find((call) => call.url.endsWith("/mcp_sync_bank_begin"));
    const finish = calls.find((call) => call.url.endsWith("/mcp_sync_bank_finish"));
    if (!begin || !finish) throw new Error("begin or finish missing");
    assert(finish.authorization !== begin.authorization, "finish has a fresh JWT");
    const claimsOf = (authorization: string) => decodeJwtPart(authorization.replace("Bearer ", "").split(".")[1] ?? "");
    const finishClaims = claimsOf(finish.authorization);
    assert(Number(finishClaims.exp) * 1000 > clock, "finish JWT is not expired at finish time");
    assertEquals(finishClaims.mcp_tid, claimsOf(begin.authorization).mcp_tid, "same token id");
    assertEquals(finish.body, {
      p_job_id: SYNC_JOB,
      p_response: { ok: true, data: { added: 0, duplicates: 2, removed: 0, newest_date: null } },
    }, "finish stores the counts");
  } finally {
    Date.now = realNow;
  }
});
