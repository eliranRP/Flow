import { assertEquals } from "jsr:@std/assert@1";
import { replaceKey } from "../../../functions/_shared/connectors/mercury/replace_key.ts";

// FLOW-1163: a new key resets the cursor and the account choice in the same call as the store. CI
// deploys mercury-connect before the migration, so while the RPC has no p_reset the old two calls run.
// Invented ids only.

type Args = Record<string, unknown>;
const KEPT = { sync_account_ids: ["acct-a"], skip_account_ids: [], account_from: {} };
const MISSING = { error: { code: "PGRST202", message: "Could not find the function in the schema cache" } };

/** An RPC of the new schema (takes p_reset), or of the one before the migration (does not). */
function rpc(takesReset: boolean, failStore = false) {
  const calls: Args[] = [];
  return {
    calls,
    call: (args: Args) => {
      calls.push(args);
      if (!takesReset && "p_reset" in args) return Promise.resolve(MISSING);
      return Promise.resolve({ error: failStore ? { code: "XX000", message: "store failed" } : null });
    },
  };
}

function clearer(error: { code: string; message: string } | null = null) {
  const log: string[] = [];
  return { log, clear: () => (log.push("clear"), Promise.resolve({ error })) };
}

Deno.test("with the migration, the reset and the store are one call and nothing is cleared apart", async () => {
  const db = rpc(true);
  const c = clearer();
  const out = await replaceKey(db.call, c.clear, { p_company: "company-1" }, 2, false, { kept: KEPT });
  assertEquals(out.result.error, null);
  assertEquals(db.calls, [{ p_company: "company-1", p_slot: 2, p_reset: true, p_kept: KEPT }]);
  assertEquals(c.log, []);
});

Deno.test("a reset with no kept choices sends p_reset alone", async () => {
  const db = rpc(true);
  await replaceKey(db.call, clearer().clear, { p_company: "company-1" }, 1, false, { kept: null });
  assertEquals(db.calls, [{ p_company: "company-1", p_slot: 1, p_reset: true }]);
});

Deno.test("a failing store is the call's own error, and no second try clears anything", async () => {
  const db = rpc(true, true);
  const c = clearer();
  const out = await replaceKey(db.call, c.clear, { p_company: "company-1" }, 1, false, { kept: null });
  assertEquals(out.result.error?.code, "XX000");
  assertEquals(db.calls.length, 1);
  assertEquals(c.log, []);
});

Deno.test("before the migration (no p_reset) the old two calls run: clear, then store", async () => {
  const db = rpc(false);
  const c = clearer();
  const out = await replaceKey(db.call, c.clear, { p_company: "company-1" }, 1, false, { kept: KEPT });
  assertEquals(out.result.error, null);
  assertEquals(out.legacy, false);
  assertEquals(c.log, ["clear"]);
  assertEquals(db.calls, [
    { p_company: "company-1", p_slot: 1, p_reset: true, p_kept: KEPT },
    { p_company: "company-1", p_slot: 1 },
  ]);
});

Deno.test("before the migration a failed clear stops the connect, and the key is not stored", async () => {
  const db = rpc(false);
  const c = clearer({ code: "XX000", message: "clear failed" });
  const out = await replaceKey(db.call, c.clear, { p_company: "company-1" }, 1, false, { kept: null });
  assertEquals(out.result.error?.code, "XX000");
  assertEquals(db.calls.length, 1);
});

Deno.test("the schema before FLOW-938 never sees p_reset: clear, then the call without p_slot", async () => {
  const db = rpc(false);
  const c = clearer();
  const out = await replaceKey(db.call, c.clear, { p_company: "company-1" }, 1, true, { kept: null });
  assertEquals([out.result.error, out.legacy], [null, true]);
  assertEquals(c.log, ["clear"]);
  assertEquals(db.calls, [{ p_company: "company-1" }]);
});

Deno.test("with no reset it is the plain call, as before", async () => {
  const db = rpc(true);
  const c = clearer();
  const out = await replaceKey(db.call, c.clear, { p_company: "company-1" }, 3, false, null);
  assertEquals(out.result.error, null);
  assertEquals(db.calls, [{ p_company: "company-1", p_slot: 3 }]);
  assertEquals(c.log, []);
});
