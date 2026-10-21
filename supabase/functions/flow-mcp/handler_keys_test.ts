// Flow MCP handler tests for several keys (FLOW-939): a key's name and assistant on mint, the
// key cap, undoing a revoke, and the key list for the company the app shows.
import { handle } from "./handler.ts";
import { assert, assertEquals, type Call, deps } from "./handler_test_support.ts";

const APP = "https://flow-app-dx5.pages.dev";
const KEY_ID = "11111111-1111-4000-8000-000000000001";
const COMPANY = "22222222-2222-4000-8000-000000000002";

function appPost(route: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://127.0.0.1:54321/functions/v1/flow-mcp/${route}`, {
    method: "POST",
    headers: { origin: APP, authorization: "Bearer app-jwt", "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

Deno.test("mint stores the key's trimmed name and assistant, and returns them with the secret once", async () => {
  const calls: Call[] = [];
  const response = await handle(
    appPost("mint", { scope: "read", name: "  Claude במחשב העבודה ", client: "claude-code" }),
    deps(calls, { store_mcp_credential: KEY_ID }),
  );
  assertEquals(response.status, 200, "mint status");
  const body = await response.json();
  assertEquals(body.name, "Claude במחשב העבודה", "name back");
  assertEquals(body.client, "claude-code", "client back");
  const store = calls.find((call) => call.url.endsWith("/store_mcp_credential"));
  if (store?.body == null) throw new Error("store called");
  assertEquals(store.body.p_name, "Claude במחשב העבודה", "trimmed name");
  assertEquals(store.body.p_client, "claude-code", "client");
  assert(store.body.p_token_hash !== body.secret, "only the hash is stored");
  assert(!JSON.stringify(store.body).includes(body.secret), "the secret never reaches the database");
});

Deno.test("mint without a name or assistant sends neither, so the database default stands", async () => {
  const calls: Call[] = [];
  const response = await handle(appPost("mint", { scope: "read_write", name: "   " }), deps(calls, { store_mcp_credential: KEY_ID }));
  assertEquals(response.status, 200, "mint status");
  const store = calls.find((call) => call.url.endsWith("/store_mcp_credential"));
  if (store?.body == null) throw new Error("store called");
  assertEquals("p_name" in store.body, false, "no name");
  assertEquals("p_client" in store.body, false, "no client");
});

Deno.test("mint refuses a long name or an unknown assistant before it makes a secret", async () => {
  for (const body of [
    { scope: "read", name: "א".repeat(61) },
    { scope: "read", name: 7 },
    { scope: "read", client: "copilot" },
  ]) {
    const calls: Call[] = [];
    const response = await handle(appPost("mint", body), deps(calls, { store_mcp_credential: KEY_ID }));
    assertEquals(response.status, 400, `refused ${JSON.stringify(body).slice(0, 40)}`);
    assert(!calls.some((call) => call.url.endsWith("/store_mcp_credential")), "nothing stored");
  }
  const calls: Call[] = [];
  const sixty = await handle(appPost("mint", { scope: "read", name: "א".repeat(60) }), deps(calls, { store_mcp_credential: KEY_ID }));
  assertEquals(sixty.status, 200, "sixty characters is the limit");
});

Deno.test("a mint over the key cap is 409 too_many", async () => {
  const calls: Call[] = [];
  const response = await handle(
    appPost("mint", { scope: "read" }),
    deps(calls, { store_mcp_credential: { message: "too many keys" } }, { statuses: { store_mcp_credential: 400 } }),
  );
  assertEquals(response.status, 409, "cap");
  assertEquals((await response.json()).error, "too_many", "error");
});

Deno.test("restore undoes one revoke as the getUser id, and a stale or foreign id is 404", async () => {
  const calls: Call[] = [];
  const restored = await handle(
    appPost("restore", { id: KEY_ID, p_user: "forged-user" }),
    deps(calls, { restore_mcp_credential: { ok: true } }),
  );
  assertEquals(restored.status, 200, "restored");
  assertEquals(restored.headers.get("access-control-allow-origin"), APP, "app origin");
  const call = calls.find((item) => item.url.endsWith("/restore_mcp_credential"));
  assertEquals(call?.body, { p_user: "user-from-getuser", p_id: KEY_ID }, "restore args");

  const gone = await handle(appPost("restore", { id: KEY_ID }), deps([], { restore_mcp_credential: { ok: false, error: "not_found" } }));
  assertEquals(gone.status, 404, "past the window");
  const full = await handle(appPost("restore", { id: KEY_ID }), deps([], { restore_mcp_credential: { ok: false, error: "too_many" } }));
  assertEquals(full.status, 409, "no room");
  const bad = await handle(appPost("restore", { id: "nope" }), deps([], {}));
  assertEquals(bad.status, 400, "validation");
  const foreign = await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp/restore", {
    method: "POST",
    headers: { origin: "https://evil.example.com", authorization: "Bearer app-jwt" },
    body: JSON.stringify({ id: KEY_ID }),
  }), deps([], {}));
  assertEquals(foreign.status, 403, "foreign origin");
});

Deno.test("status passes the app's company as the hint and returns the key list", async () => {
  const calls: Call[] = [];
  const keys = [{ id: KEY_ID, name: "Claude Code · מפתח 1", client: "claude-code", scope: ["read"], expired: false }];
  const response = await handle(
    appPost("status", {}, { "x-flow-company": COMPANY }),
    deps(calls, { mcp_credential_status: { state: "connected", keys } }),
  );
  assertEquals(response.status, 200, "status");
  assertEquals((await response.json()).keys, keys, "keys");
  const call = calls.find((item) => item.url.endsWith("/mcp_credential_status"));
  assertEquals(call?.body, { p_user: "user-from-getuser", p_hint: COMPANY }, "hint");

  const plain: Call[] = [];
  await handle(appPost("status", {}), deps(plain, { mcp_credential_status: { state: "empty", keys: [] } }));
  assertEquals(plain.find((item) => item.url.endsWith("/mcp_credential_status"))?.body, { p_user: "user-from-getuser" }, "no hint");
});
