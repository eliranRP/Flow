import type { MercuryStatus } from "@flow/shared";
import { describe, expect, it } from "vitest";
import { MERCURY_NONE, mercuryAccounts, mercuryState } from "./mercury-state";
import {
  accountName,
  balanceText,
  connectionName,
  defaultSelection,
  fromOptions,
  fromRow,
  fromValue,
  newAccounts,
  syncButtonLabel,
  syncedSummary,
} from "./mercury-connections";

// FLOW-938. Invented names, ids and balances only.
/** The one connection of a single row, or a failed test. */
function only(rows: MercuryStatus[]) {
  const [connection] = mercuryState(rows).connections;
  if (!connection) throw new Error("no connection");
  return connection;
}

function row(partial: Partial<MercuryStatus> = {}): MercuryStatus {
  return {
    company_id: "company-1",
    provider: "mercury",
    connected: true,
    last_sync_at: null,
    last_error: null,
    next_attempt_at: null,
    import_from: null,
    account_labels: [
      { id: "a", label: "Checking", last4: "4821", kind: "checking", balance_cents: 4_821_000 },
      { id: "b", label: "Treasury", last4: "5520", kind: "treasury" },
      { id: "c", label: "IO Credit ••7710", last4: "7710", kind: "credit", balance_cents: -418_250 },
    ],
    skip_count: 0,
    syncing: false,
    slot: 1,
    org_label: "Cedar Lane Homes LLC",
    accounts_chosen: true,
    sync_account_ids: ["a", "c"],
    skip_account_ids: ["b"],
    ...partial,
  };
}

const NOW = new Date("2026-10-20T09:00:00.000Z");

describe("Mercury connections (FLOW-938)", () => {
  it("reads labels defensively: kinds, last 4 and balances, duplicates and junk dropped", () => {
    expect(mercuryAccounts([{ id: "x", label: " Ops ", kind: "brokerage", last4: "12" }, { id: "x" }, "junk", { label: "no id" }])).toEqual([
      { id: "x", name: "Ops", last4: null, kind: "other", balanceCents: null },
    ]);
    expect(mercuryAccounts(null)).toEqual([]);
  });

  it("sums the connections up for the other screens: connected, a broken key, the newest sync, syncing", () => {
    expect(mercuryState([])).toBe(MERCURY_NONE);
    const state = mercuryState([
      row({ slot: 2, last_error: "auth", last_sync_at: "2026-10-19T06:00:00.000Z" }),
      row({ last_sync_at: "2026-10-20T06:00:00.000Z", syncing: true }),
    ]);
    expect(state.connections.map((connection) => connection.slot)).toEqual([1, 2]);
    expect([state.connected, state.last_error, state.last_sync_at, state.syncing]).toEqual([true, "auth", "2026-10-20T06:00:00.000Z", true]);
    expect(mercuryState([row({ accounts_chosen: false })]).connected).toBe(false);
  });

  it("a connection from before FLOW-938 (no list) syncs every account; one not chosen syncs none", () => {
    const [legacy] = mercuryState([row({ sync_account_ids: null })]).connections;
    expect(legacy?.synced).toEqual(["a", "b", "c"]);
    const waiting = only([row({ accounts_chosen: false })]);
    expect(waiting.synced).toEqual([]);
    expect(newAccounts(waiting)).toEqual([]);
  });

  it("names accounts with their last 4 once, and connections by their organisation", () => {
    const connection = only([row()]);
    expect(connection.accounts.map(accountName)).toEqual(["Checking ••4821", "Treasury ••5520", "IO Credit ••7710"]);
    expect(connectionName(connection)).toBe("Cedar Lane Homes LLC");
    expect(connectionName(only([row({ org_label: null })]))).toBe("Checking ••4821");
  });

  it("checks everything but treasury at connect time, and counts the synced accounts", () => {
    const connection = only([row()]);
    expect(defaultSelection(connection.accounts)).toEqual(["a", "c"]);
    expect(syncedSummary(connection)).toEqual({ names: "Checking ••4821 · IO Credit ••7710", count: "2 מתוך 3" });
  });

  it("offers an account that is neither synced nor left out", () => {
    const connection = only([row({ account_labels: [...(row().account_labels as unknown[]), { id: "d", label: "Checking", last4: "6610", kind: "checking" }] })]);
    expect(newAccounts(connection).map((account) => account.id)).toEqual(["d"]);
  });

  it("words the button and the balance", () => {
    expect([syncButtonLabel(0, false), syncButtonLabel(1, false), syncButtonLabel(4, false), syncButtonLabel(3, true)]).toEqual([
      "בחרו לפחות חשבון אחד", "סנכרון חשבון אחד", "סנכרון 4 חשבונות", "שמירה",
    ]);
    expect([balanceText(4_821_049), balanceText(-418_250), balanceText(null)]).toEqual(["$48,210", "−$4,183", ""]);
  });

  it("turns the date choice into the server's p_from, never after today", () => {
    expect(fromValue("start", "2026-06-01", NOW)).toBe("start");
    expect(fromValue("year", "2026-06-01", NOW)).toBe("2026-01-01");
    expect(fromValue("month", "2026-06-01", NOW)).toBe("2026-10-01");
    expect(fromValue("today", "2026-06-01", NOW)).toBe("2026-10-20");
    expect(fromValue("date", "2026-06-01", NOW)).toBe("2026-06-01");
    expect(fromValue("date", "2027-01-01", NOW)).toBe("2026-10-20");
  });

  it("lists the sheet's choices; editing adds מהיום first, and Mercury's history starts 24 months back", () => {
    expect(fromOptions(false, "2026-06-01", NOW).map((option) => option.label)).toEqual(["מההתחלה", "מתחילת השנה", "מתחילת החודש", "מתאריך"]);
    expect(fromOptions(true, "2026-06-01", NOW)[0]?.value).toBe("today");
    expect(fromOptions(false, "2026-06-01", NOW)[0]?.note).toContain("נובמבר 2024");
    expect(fromRow("start", "2026-06-01", NOW)).toEqual({ label: "מההתחלה", note: "בפעם הראשונה זה לוקח כמה דקות" });
    expect(fromRow("date", "2026-06-01", NOW)).toEqual({ label: "מתאריך", note: "מ־01/06/2026" });
  });
});
