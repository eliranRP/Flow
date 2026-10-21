import { assertEquals } from "jsr:@std/assert@1";
import {
  isLegacyRow,
  isMissingFunction,
  legacyPatch,
  rpcWithSlot,
} from "../../../functions/_shared/connectors/mercury/legacy.ts";
import { planConnectorSync } from "../../../functions/_shared/connectors/engine.ts";
import { readConnectionScope, runScope } from "../../../functions/_shared/connectors/mercury/scope.ts";
import type { ConnectorPort, ConnectorSession, NormalizeContext } from "../../../functions/_shared/connectors/types.ts";

// FLOW-938: CI deploys mercury-sync and mercury-connect before the migration is pushed. On the old
// schema they must behave as the single connection did. Invented ids only.

// A connector_connections row as select("*") returned it before the migration.
const OLD_ROW = {
  company_id: "company-1",
  provider: "mercury",
  account_labels: [{ id: "acct-a", label: "Checking" }],
  import_from: "2026-01-01",
  sync_cursor: "2026-10-01T00:00:00.000Z",
};

Deno.test("a row without slot or accounts_chosen_at is the old schema", () => {
  assertEquals(isLegacyRow(OLD_ROW), true);
  assertEquals(isLegacyRow({ ...OLD_ROW, slot: 1, accounts_chosen_at: null }), false);
  assertEquals(isLegacyRow({ ...OLD_ROW, slot: 1 }), true);
  assertEquals(isLegacyRow(null), false);
});

Deno.test("PostgREST's and Postgres' missing function answers mean the old schema", () => {
  assertEquals(isMissingFunction({ code: "PGRST202", message: "Could not find the function" }), true);
  assertEquals(isMissingFunction({ code: "42883" }), true);
  assertEquals(isMissingFunction({ code: "P0001", message: "sync_cursor_conflict" }), false);
  assertEquals(isMissingFunction(null), false);
  assertEquals(isMissingFunction({ code: "PGRST204", message: "Could not find the column" }), false);
});

Deno.test("on the old schema a patch leaves out the columns FLOW-938 adds", () => {
  const patch = { sync_cursor: null, org_label: "Org", accounts_chosen_at: null, account_labels: [], slot: 2 };
  assertEquals(legacyPatch(patch, true), { sync_cursor: null, account_labels: [] });
  assertEquals(legacyPatch(patch, false), patch);
});

/** An RPC endpoint as the old schema serves it: the function takes no p_slot. */
function oldSchemaRpc() {
  const calls: Record<string, unknown>[] = [];
  const call = (args: Record<string, unknown>) => {
    calls.push(args);
    return Promise.resolve("p_slot" in args
      ? { data: null, error: { code: "PGRST202", message: "Could not find the function public.upsert_connector_lines" } }
      : { data: { inserted: 1 }, error: null });
  };
  return { call, calls };
}

Deno.test("a known old schema calls the RPC without p_slot", async () => {
  const rpc = oldSchemaRpc();
  const { result, legacy } = await rpcWithSlot(rpc.call, { p_company: "company-1" }, 1, true);
  assertEquals([result.error, legacy], [null, true]);
  assertEquals(rpc.calls, [{ p_company: "company-1" }]);
});

Deno.test("an unknown schema that has no p_slot gets the call again without it", async () => {
  const rpc = oldSchemaRpc();
  const { result, legacy } = await rpcWithSlot(rpc.call, { p_company: "company-1" }, 1, false);
  assertEquals([result.error, legacy], [null, true]);
  assertEquals(rpc.calls, [{ p_company: "company-1", p_slot: 1 }, { p_company: "company-1" }]);
});

Deno.test("on the new schema p_slot is sent once, and any other error is not retried without it", async () => {
  const calls: Record<string, unknown>[] = [];
  const conflict = await rpcWithSlot((args) => {
    calls.push(args);
    return Promise.resolve({ error: { code: "P0001", message: "sync_cursor_conflict" } });
  }, { p_company: "company-1" }, 3, false);
  assertEquals(conflict.legacy, false);
  assertEquals(conflict.result.error?.message, "sync_cursor_conflict");
  assertEquals(calls, [{ p_company: "company-1", p_slot: 3 }]);
});

Deno.test("an old-schema row syncs every account the key lists, a newly opened one too", async () => {
  const scope = readConnectionScope(OLD_ROW);
  assertEquals([scope.slot, scope.chosen, scope.syncAccountIds], [1, true, null]);
  assertEquals(runScope(scope, [scope]), { synced: ["acct-a"], own: ["acct-a"], outside: [] });
  // mercury-sync passes no accountScope on the old schema, so "acct-b" (opened since) syncs as before.
  const seen: NormalizeContext[] = [];
  const port: ConnectorPort = {
    capabilities: { listing: "window", removal: "status", currencies: ["USD"], hasPending: true },
    allowlist: [],
    validate: () => Promise.resolve({ ok: true, accounts: [{ id: "acct-a", label: "A" }, { id: "acct-b", label: "B" }] }),
    fetchSince: () => Promise.resolve({ lines: [], removedIds: [], nextCursor: null, complete: true }),
    normalize: (_raw, ctx) => {
      seen.push(ctx);
      return { ok: false, skip: "not_a_line" };
    },
    classifyError: () => ({ class: "rejected", retry_after: null }),
    redact: (value) => value,
  };
  const plan = await planConnectorSync({
    port,
    session: { provider: "mercury" } as ConnectorSession,
    cursor: null,
    importFrom: null,
    lookbackDays: 30,
    ownCounterpartyIds: [],
    vatRateBp: 0,
    exemptSupplierNames: [],
    exemptSupplierIds: [],
    stored: [],
    now: () => new Date("2026-10-21T00:00:00Z"),
  });
  assertEquals(plan.ok && plan.ownAccountIds, ["acct-a", "acct-b"]);
});
