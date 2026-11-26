import { hashKey, QueryClient } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSetForecastItem } from "./forecast-month";
import { KEPT_VERSION, flushKeptReads, resetKeptReadsForTests } from "./kept-reads";
import type { KeptRow, KeptStore } from "./kept-store";
import { renderWithProviders } from "./test-render";

// FLOW-1323: with the patch modules not loaded (Home: nothing has opened the company's צפי or a project), a skip of one month drops
// only the kept answers that include that month, in memory and on the device. Invented keys only.
const rpc = vi.hoisted(() => ({ fail: false }));
vi.mock("./lib/supabase", () => ({
  getSupabase: () => ({ rpc: () => Promise.resolve({ data: null, error: rpc.fail ? { message: "refused" } : null }) }),
}));

const TODAY = "2026-11-24";
const MONTH = "2026-12";
const ROWS_M = ["month-forecast", "off", "company", "rows", TODAY, MONTH];
const ROWS_OTHER = ["month-forecast", "off", "company", "rows", TODAY, "2027-01"];
const TOTALS_M = ["month-forecast", "off", "company", "totals", TODAY, MONTH];
const TOTALS_YEAR = ["month-forecast", "off", "company", "totals", TODAY, `${MONTH},2027-01`];
const TOTALS_LATER = ["month-forecast", "off", "company", "totals", TODAY, "2027-01,2027-02"];
const PROJECT_M = ["month-forecast", "off", "project", "p1", MONTH, TODAY, "company"];
const PROJECT_OTHER = ["month-forecast", "off", "project", "p1", "2027-01", TODAY, "company"];
const ANSWER_M = ["month-forecast", "off", "answer", MONTH];
const OVERRIDES_M = ["month-forecast", "off", "overrides", MONTH];
const ANSWER_OTHER = ["month-forecast", "off", "answer", "2027-01"];
const KEPT = [TOTALS_M, TOTALS_YEAR, TOTALS_LATER, PROJECT_M, PROJECT_OTHER];
const ALL = [ROWS_M, ROWS_OTHER, TOTALS_M, TOTALS_YEAR, TOTALS_LATER, PROJECT_M, PROJECT_OTHER];

function memoryStore(rows: KeptRow[]): KeptStore & { left: () => string[] } {
  const held = new Map(rows.map((row) => [row.id, row]));
  return {
    all: () => Promise.resolve([...held.values()]),
    ids: () => Promise.resolve([...held.keys()]),
    put: (next) => { for (const row of next) held.set(row.id, row); return Promise.resolve(); },
    remove: (ids) => { for (const id of ids) held.delete(id); return Promise.resolve(); },
    clear: () => { held.clear(); return Promise.resolve(); },
    left: () => [...held.keys()].sort(),
  };
}

const keptRow = (key: readonly unknown[]): KeptRow => ({ id: hashKey(key), owner: "u|c", version: KEPT_VERSION, at: 1, size: 10, key: JSON.stringify(key), data: {} });

function Skip() {
  const set = useSetForecastItem(MONTH);
  return <button type="button" onClick={() => { set.mutate({ key: "party:expense:power:USD", patch: { moved_out: true }, undo: false, prior: null }); }}>skip</button>;
}

function seeded() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const key of ALL) client.setQueryData(key, { held: true });
  return client;
}
const held = (client: QueryClient, key: readonly unknown[]) => client.getQueryData(key) !== undefined;

beforeEach(() => {
  rpc.fail = false;
});

describe("a skip of one month drops only the answers that include it (FLOW-1323)", () => {
  it("leaves the kept answers of other months in memory and on the device; drops the month's, in both", async () => {
    const store = memoryStore(KEPT.map(keptRow));
    resetKeptReadsForTests(store);
    const client = seeded();
    renderWithProviders(<Skip />, { client });
    fireEvent.click(screen.getByRole("button", { name: "skip" }));
    await waitFor(() => { expect(client.isMutating()).toBe(0); });
    await flushKeptReads();
    // In memory: the month's rows, the totals that include it and its project forecast are gone; the others stay.
    expect([ROWS_M, TOTALS_M, TOTALS_YEAR, PROJECT_M].map((key) => held(client, key))).toEqual([false, false, false, false]);
    expect([ROWS_OTHER, TOTALS_LATER, PROJECT_OTHER].map((key) => held(client, key))).toEqual([true, true, true]);
    // On the device: the kept rows of the dropped answers go too, so a cold start does not put them back.
    expect(store.left()).toEqual([TOTALS_LATER, PROJECT_OTHER].map((key) => hashKey(key)).sort());
  });

  it("after a refused write drops every inactive company and project forecast and their kept rows, as before", async () => {
    rpc.fail = true;
    const store = memoryStore(KEPT.map(keptRow));
    resetKeptReadsForTests(store);
    const client = seeded();
    renderWithProviders(<Skip />, { client });
    fireEvent.click(screen.getByRole("button", { name: "skip" }));
    await waitFor(() => { expect(client.isMutating()).toBe(0); });
    await waitFor(() => { expect(ALL.some((key) => held(client, key))).toBe(false); });
    await flushKeptReads();
    await waitFor(() => { expect(store.left()).toEqual([]); });
  });

  // FLOW-1341: a skip from the project page holds no month answer in memory, but the device's kept copies of it (Home's forecast row, the month's skips) are as stale.
  it("deletes the device's kept answer and overrides of the month (none held by a screen) and leaves another month's", async () => {
    const store = memoryStore([ANSWER_M, OVERRIDES_M, ANSWER_OTHER].map(keptRow));
    resetKeptReadsForTests(store);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithProviders(<Skip />, { client });
    fireEvent.click(screen.getByRole("button", { name: "skip" }));
    await waitFor(() => { expect(client.isMutating()).toBe(0); });
    await flushKeptReads();
    expect(store.left()).toEqual([hashKey(ANSWER_OTHER)]);
  });
});
