import { assertEquals } from "jsr:@std/assert@1";
import {
  MERCURY_MAX_CONNECTIONS,
  chooseSlot,
  keptChoices,
  readConnectionScope,
  runScope,
  storedLabels,
  storedLinesFilter,
  syncedIds,
  withinAccountStart,
  type MercuryConnectionScope,
} from "../../../functions/_shared/connectors/mercury/scope.ts";
import type { CanonicalLine } from "../../../functions/_shared/connectors/types.ts";

// FLOW-938: several Mercury connections per company, each syncing the accounts the owner chose.
// Invented ids only.

function connection(slot: number, accountIds: string[], extra: Partial<MercuryConnectionScope> = {}): MercuryConnectionScope {
  return { slot, accountIds, chosen: true, syncAccountIds: null, skipAccountIds: [], importFrom: null, accountFrom: {}, ...extra };
}

Deno.test("a stored row reads defensively: bad ids, dates and slots fall away", () => {
  const read = readConnectionScope({
    slot: 2,
    account_labels: [{ id: "acct-a", label: "Checking" }, { label: "no id" }, "junk", { id: "acct-a" }],
    accounts_chosen_at: "2026-10-01T00:00:00Z",
    sync_account_ids: ["acct-a", "", 7],
    skip_account_ids: ["acct-z", null],
    import_from: "2026-01-01",
    account_from: { "acct-b": "2026-05-01", "acct-c": "soon" },
  });
  assertEquals(read, {
    slot: 2,
    accountIds: ["acct-a"],
    chosen: true,
    syncAccountIds: ["acct-a"],
    skipAccountIds: ["acct-z"],
    importFrom: "2026-01-01",
    accountFrom: { "acct-b": "2026-05-01" },
  });
  const fresh = readConnectionScope({ slot: "x", account_labels: null, accounts_chosen_at: null, sync_account_ids: null });
  assertEquals([fresh.slot, fresh.chosen, fresh.syncAccountIds, fresh.importFrom], [1, false, null, null]);
});

Deno.test("a row from the schema before FLOW-938 (no slot, no accounts_chosen_at) is slot 1 and syncs every account", () => {
  const legacy = readConnectionScope({ account_labels: [{ id: "acct-a" }, { id: "acct-b" }], import_from: "2026-01-01" });
  assertEquals([legacy.slot, legacy.chosen, legacy.syncAccountIds, legacy.skipAccountIds], [1, true, null, []]);
  assertEquals(syncedIds(legacy), ["acct-a", "acct-b"]);
});

Deno.test("nothing syncs before the owner chooses; a list from before FLOW-938 syncs every account", () => {
  assertEquals(syncedIds(connection(1, ["a", "b"], { chosen: false, syncAccountIds: ["a"] })), []);
  assertEquals(syncedIds(connection(1, ["a", "b"])), ["a", "b"]);
  assertEquals(syncedIds(connection(1, ["a", "b"], { syncAccountIds: ["b"] })), ["b"]);
});

Deno.test("a run's scope: its synced accounts, every connection's synced accounts, and the ones no one syncs", () => {
  const first = connection(1, ["chk", "sav", "tre"], { syncAccountIds: ["chk", "sav"] });
  const second = connection(2, ["ops", "card"], { syncAccountIds: ["ops"] });
  const waiting = connection(3, ["new"], { chosen: false });
  assertEquals(runScope(first, [first, second, waiting]), {
    synced: ["chk", "sav"],
    own: ["chk", "sav", "ops"],
    outside: ["tre", "card", "new"],
  });
});

function line(id: string, account: string | null, day: string): CanonicalLine {
  return { external_id: id, source_account_id: account, doc_date: day } as unknown as CanonicalLine;
}

Deno.test("an account added later reads from its own start; the others keep the connection's", () => {
  const lines = [line("1", "late", "2026-09-30"), line("2", "late", "2026-10-01"), line("3", "early", "2025-01-01"), line("4", null, "2025-01-01")];
  assertEquals(withinAccountStart(lines, { late: "2026-10-01" }).map((kept) => kept.external_id), ["2", "3", "4"]);
});

Deno.test("the stored lines of a connection: its accounts, and lines with no account for one of them", () => {
  assertEquals(storedLinesFilter(["a-1", "b_2"], false), "provider_meta->>account_id.in.(a-1,b_2)");
  assertEquals(storedLinesFilter(["a-1", "bad,id", "x)y"], true), "provider_meta->>account_id.in.(a-1),provider_meta->>account_id.is.null");
  assertEquals(storedLinesFilter([], true), "provider_meta->>account_id.is.null");
  assertEquals(storedLinesFilter(["bad id"], false), null);
});

Deno.test("stored labels keep id, label, last 4, kind and balance only", () => {
  const extra = { id: "a", label: "Checking", last4: "4821", kind: "checking", balance_cents: 4821000, accountNumber: "x" };
  assertEquals(storedLabels([extra, { id: "b", label: "Card", balance_cents: 0 }]), [
    { id: "a", label: "Checking", last4: "4821", kind: "checking", balance_cents: 4821000 },
    { id: "b", label: "Card", balance_cents: 0 },
  ]);
});

Deno.test("a key for the same organisation replaces that connection's key; another is a new connection", () => {
  const existing = [connection(1, ["acct-a", "acct-b"]), connection(3, ["acct-x"])];
  assertEquals(chooseSlot(existing, ["acct-b", "acct-a"], null), { kind: "replace", slot: 1, accountsChanged: false, reset: false });
  assertEquals(chooseSlot(existing, ["acct-a", "acct-b", "acct-c"], null), { kind: "replace", slot: 1, accountsChanged: true, reset: false });
  assertEquals(chooseSlot(existing, ["acct-q"], null), { kind: "add", slot: 2 });
  assertEquals(chooseSlot([], ["acct-q"], null), { kind: "add", slot: 1 });
  assertEquals(chooseSlot(existing, ["acct-a", "acct-x"], null), { kind: "refused", code: "already_connected" });
});

Deno.test("replacing slot N: its own accounts or new ones, never another connection's", () => {
  const existing = [connection(1, ["acct-a"]), connection(2, ["acct-x"])];
  assertEquals(chooseSlot(existing, ["acct-a"], 1), { kind: "replace", slot: 1, accountsChanged: false, reset: false });
  assertEquals(chooseSlot(existing, ["acct-new"], 1), { kind: "replace", slot: 1, accountsChanged: true, reset: true });
  assertEquals(chooseSlot(existing, ["acct-x"], 1), { kind: "refused", code: "already_connected" });
  assertEquals(chooseSlot(existing, ["acct-a"], 5), { kind: "refused", code: "not_found" });
  assertEquals(chooseSlot([connection(1, [])], ["acct-a"], 1), { kind: "replace", slot: 1, accountsChanged: true, reset: true });
});

Deno.test("a rotated key of the same organisation keeps the owner's choices; closed accounts drop out", () => {
  const before = connection(1, ["chk", "sav", "card", "old"], {
    syncAccountIds: ["chk", "old"],
    skipAccountIds: ["sav", "card"],
    importFrom: "2026-01-01",
    accountFrom: { old: "2026-03-01", chk: "2026-02-01" },
  });
  // "old" was closed, "fresh" was opened: the choices stay, "fresh" is offered as a new account.
  const after = ["chk", "sav", "card", "fresh"];
  assertEquals(chooseSlot([before], after, null), { kind: "replace", slot: 1, accountsChanged: true, reset: false });
  assertEquals(chooseSlot([before], after, 1), { kind: "replace", slot: 1, accountsChanged: true, reset: false });
  assertEquals(keptChoices(before, after), {
    sync_account_ids: ["chk"],
    skip_account_ids: ["sav", "card"],
    account_from: { chk: "2026-02-01" },
  });
  // Every synced account closed: the accounts are chosen again.
  assertEquals(keptChoices(before, ["sav", "card"]), null);
  assertEquals(chooseSlot([before], ["sav", "card"], null), { kind: "replace", slot: 1, accountsChanged: true, reset: true });
  // A list from before FLOW-938 (every account) stays every account.
  assertEquals(keptChoices(connection(1, ["chk", "old"]), ["chk"]), { sync_account_ids: null, skip_account_ids: [], account_from: {} });
});

Deno.test("at most nine connections", () => {
  const full = Array.from({ length: MERCURY_MAX_CONNECTIONS }, (_, index) => connection(index + 1, [`acct-${String(index)}`]));
  assertEquals(chooseSlot(full, ["acct-new"], null), { kind: "refused", code: "too_many_connections" });
});
