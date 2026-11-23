import type { ForecastOverrideRow, MissingBill } from "@flow/shared";
import { onlineManager, QueryClient } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "./test-render";
import { forecastKeyOf, lateIsSkipped, scheduleForecastKey, skippedKeys, useForecastSkip, useLateBillsQuery, withoutSkippedLate } from "./forecast-skip";
import { lateItemName, lateTarget } from "./forecast";
import { attentionRows } from "./screens/attention-rows";
import { futureForecastKey, projectRowForecastKey } from "./forecast-future-keys";
import type { ScheduleRow } from "./recurring-schedule";

// The write fails: its onError runs, as useWrite's does after the server refuses.
const writes = vi.hoisted(() => ({ fail: true }));
vi.mock("./forecast-month", async (original) => ({
  ...(await original<typeof import("./forecast-month")>()),
  useSetForecastItem: () => ({
    isPending: false,
    mutate: (_payload: unknown, options?: { onError?: () => void }) => {
      if (writes.fail) options?.onError?.();
    },
  }),
}));

// The reads behind the late list: each answer is set by the test (FLOW-1254).
const reads = vi.hoisted(() => ({
  impl: (_name: string): Promise<{ data: unknown; error: { message: string } | null }> => Promise.resolve({ data: [], error: null }),
}));
vi.mock("./lib/supabase", () => ({ getSupabase: () => ({ rpc: (name: string) => reads.impl(name) }) }));

// One read: a new array each render would be a new read, which drops the page's answers.
const READ: ForecastOverrideRow[] = [];

function Probe() {
  const skip = useForecastSkip("2026-11", "נובמבר", READ);
  return (
    <button type="button" onClick={() => { skip.set("party:expense:power:USD", true, "Brightline Power"); }}>
      {skip.skipped.has("party:expense:power:USD") ? "out" : "in"}
    </button>
  );
}

// FLOW-1079: the forecast item a schedule row is, and the month's items taken out.
describe("forecast skip keys", () => {
  const row = { direction: "expense" as const, party_id: "power", currency: "USD", project_id: "p1" };

  it("keys a charge as the month forecast does, with its project only when the party is split", () => {
    expect(forecastKeyOf(row, false)).toBe("party:expense:power:USD");
    expect(forecastKeyOf(row, true)).toBe("party:expense:power:USD:p1");
    expect(forecastKeyOf({ ...row, project_id: null }, true)).toBe("party:expense:power:USD:none");
  });

  it("reads the items moved out of the month, not the ones only changed", () => {
    const keys = skippedKeys([
      { item_key: "party:expense:power:USD", amount_minor: null, due_on: null, moved_out: true },
      { item_key: "party:income:rent:USD", amount_minor: 90_000, due_on: null, moved_out: false },
    ]);
    expect([...keys]).toEqual(["party:expense:power:USD"]);
  });
});

// FLOW-1079 r1: a failed write takes the answer back, so the row returns to where the forecast counts it.
describe("forecast skip keys by screen (FLOW-1081)", () => {
  const charge = (party: string, project: string | null, currency = "USD") => ({ direction: "expense", party_id: party, currency, project_id: project }) as unknown as ScheduleRow;
  const power = charge("power", "p1");
  const hoa = charge("hoa", "p1");
  const fx = charge("fx", null, "EUR");
  const schedule = [power, charge("power", "p2"), hoa, fx];

  it("keys a schedule row split only when its party has another charge in the currency, and not at all in another currency", () => {
    expect(scheduleForecastKey(schedule, power, "USD")).toBe("party:expense:power:USD:p1");
    expect(scheduleForecastKey(schedule, hoa, "USD")).toBe("party:expense:hoa:USD");
    expect(scheduleForecastKey(schedule, fx, "USD")).toBeUndefined();
  });

  it("keys a project page's row by the page's project, and the general page's by the party's own charge", () => {
    expect(projectRowForecastKey("rec:expense:power", schedule, "p2", false, "USD")).toBe("party:expense:power:USD:p2");
    expect(projectRowForecastKey("rec:expense:hoa", schedule, "p1", false, "USD")).toBe("party:expense:hoa:USD");
    expect(projectRowForecastKey("rec:expense:power", [charge("power", null), charge("power", "p1")], "overhead", true, "USD")).toBe("party:expense:power:USD:none");
    expect(projectRowForecastKey("bill:1", schedule, "p1", false, "USD")).toBeUndefined();
  });

  it("keys a month to come's row as this month does when the forecast names its split parties (FLOW-1096)", () => {
    const part = (keys: string[]) => ({ forecast: { rows: keys.map((key) => ({ key })), removed: [], skipped: [] } });
    // The party has two charges, but only one is due this month: still split, as the month forecast and the project's צפי page key it.
    const keyOf = futureForecastKey({ parts: [part(["rec:expense:power"])], splitKeys: new Set(["party:expense:power:USD"]) } as never, "USD");
    expect(keyOf("rec:expense:power", "p2")).toBe("party:expense:power:USD:p2");
    expect(keyOf("rec:expense:hoa", "p1")).toBe("party:expense:hoa:USD");
  });
});

describe("useForecastSkip", () => {
  it("puts the charge back when the write fails", () => {
    renderWithProviders(<Probe />);
    act(() => { fireEvent.click(screen.getByRole("button", { name: "in" })); });
    expect(screen.getByRole("button", { name: "in" })).toBeInTheDocument();
  });

  it("keeps the answer while the write goes through", () => {
    writes.fail = false;
    renderWithProviders(<Probe />);
    act(() => { fireEvent.click(screen.getByRole("button", { name: "in" })); });
    expect(screen.getByRole("button", { name: "out" })).toBeInTheDocument();
    writes.fail = true;
  });
});

describe("a late charge taken out of this month (FLOW-1248)", () => {
  const bill = (extra: Partial<MissingBill> = {}) => ({ direction: "income" as const, party_id: "tenant", currency: "USD", project_id: "p1", ...extra });
  const split = new Set(["party:income:tenant:USD:p1"]);
  const whole = new Set(["party:income:tenant:USD"]);

  it("is skipped by the split key of its project, and by the party's own key", () => {
    expect(lateIsSkipped(bill(), split, "USD")).toBe(true);
    expect(lateIsSkipped(bill(), whole, "USD")).toBe(true);
  });

  it("is not skipped for another project of a split party, another party, or another direction", () => {
    expect(lateIsSkipped(bill({ project_id: "p2" }), split, "USD")).toBe(false);
    expect(lateIsSkipped(bill({ party_id: "other" }), split, "USD")).toBe(false);
    expect(lateIsSkipped(bill({ direction: "expense" }), split, "USD")).toBe(false);
  });

  it("keys a charge with no project as :none, and reads a missing direction as an expense", () => {
    expect(lateIsSkipped(bill({ project_id: null }), new Set(["party:income:tenant:USD:none"]), "USD")).toBe(true);
    expect(lateIsSkipped(bill({ direction: undefined }), new Set(["party:expense:tenant:USD"]), "USD")).toBe(true);
  });

  it("stays late in another currency than the forecast's, and with no party id", () => {
    expect(lateIsSkipped(bill({ currency: "ILS" }), new Set(["party:income:tenant:ILS"]), "USD")).toBe(false);
    expect(lateIsSkipped(bill({ party_id: undefined }), whole, "USD")).toBe(false);
  });

  it("filters a list, and keeps all of it with no skips known", () => {
    const rows = [bill(), bill({ party_id: "other" })] as MissingBill[];
    expect(withoutSkippedLate(rows, split, "USD").map((row) => row.party_id)).toEqual(["other"]);
    expect(withoutSkippedLate(rows, undefined, "USD")).toHaveLength(2);
    expect(withoutSkippedLate(rows, new Set(), "USD")).toHaveLength(2);
  });
});

// FLOW-1254, FLOW-1249, FLOW-1259: the late list waits for the month's skips, falls back to the whole list when that read fails, and is not held by a read that will not run.
describe("useLateBillsQuery (FLOW-1254)", () => {
  const month = new Date().toISOString().slice(0, 7);
  const late = (party: string, name: string) => ({
    supplier_id: party, supplier_name: name, party_id: party, party_name: name, direction: "expense", currency: "ILS",
    typical_amount_minor: 10_000, typical_day: 5, expected_by: `${month}-05`, months_seen: 3, project_id: null,
  });
  const LATE = [late("s-a", "ספק א"), late("s-b", "ספק ב")];
  const reply = (overrides: () => Promise<{ data: unknown; error: { message: string } | null }>) => {
    reads.impl = (name) => {
      if (name === "missing_bills") return Promise.resolve({ data: LATE, error: null });
      if (name === "mcp_company_loan_currency") return Promise.resolve({ data: "ILS", error: null });
      if (name === "forecast_overrides_for") return overrides();
      return Promise.resolve({ data: [], error: null });
    };
  };
  const skipA = { item_key: "party:expense:s-a:ILS", amount_minor: null, due_on: null, moved_out: true };

  function Late({ active = true }: { active?: boolean }) {
    const { data } = useLateBillsQuery(active);
    return <p data-testid="late">{data == null ? "none" : data.map((bill) => bill.party_id).join(",")}</p>;
  }
  const shown = () => screen.getByTestId("late").textContent;

  it("gives no list while the overrides are pending, then the filtered list once they land", async () => {
    let land: (rows: unknown) => void = () => undefined;
    reply(() => new Promise((resolve) => { land = (rows) => { resolve({ data: rows, error: null }); }; }));
    renderWithProviders(<Late />);
    // The bills are in, the overrides are not: nothing draws.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(shown()).toBe("none");
    await act(async () => { land([skipA]); await Promise.resolve(); });
    await waitFor(() => { expect(shown()).toBe("s-b"); });
  });

  it("gives every late item when the overrides read fails", async () => {
    reply(() => Promise.resolve({ data: null, error: { message: "down" } }));
    renderWithProviders(<Late />);
    await waitFor(() => { expect(shown()).toBe("s-a,s-b"); });
  });

  it("reads neither the bills nor the overrides while it is not active (another month, FLOW-1252)", async () => {
    const names: string[] = [];
    reads.impl = (name) => { names.push(name); return Promise.resolve({ data: [], error: null }); };
    renderWithProviders(<Late active={false} />);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(shown()).toBe("none");
    expect(names).not.toContain("missing_bills");
    expect(names).not.toContain("forecast_overrides_for");
  });

  describe("offline and a cold currency", () => {
    afterEach(() => { onlineManager.setOnline(true); });
    const seeded = (skips: unknown[]) => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      client.setQueryData(["missing-bills", "off"], LATE);
      if (skips.length > 0) client.setQueryData(["month-forecast", "off", "overrides", month], skips);
      return client;
    };

    it("draws the cached whole list offline, when the overrides read is paused and never ran", async () => {
      onlineManager.setOnline(false);
      renderWithProviders(<Late />, { client: seeded([]) });
      await waitFor(() => { expect(shown()).toBe("s-a,s-b"); });
    });

    it("holds the list while a cold currency read runs, with skips present, and filters once it lands", async () => {
      let land: (currency: string) => void = () => undefined;
      reads.impl = (name) => {
        if (name === "mcp_company_loan_currency") return new Promise((resolve) => { land = (value) => { resolve({ data: value, error: null }); }; });
        return Promise.resolve({ data: name === "missing_bills" ? LATE : name === "forecast_overrides_for" ? [skipA] : [], error: null });
      };
      window.localStorage.clear();
      renderWithProviders(<Late />, { client: seeded([skipA]) });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
      expect(shown()).toBe("none");
      await act(async () => { land("ILS"); await Promise.resolve(); });
      await waitFor(() => { expect(shown()).toBe("s-b"); });
    });

    it("draws the list when the cold currency read is paused offline", async () => {
      onlineManager.setOnline(false);
      window.localStorage.clear();
      renderWithProviders(<Late />, { client: seeded([skipA]) });
      await waitFor(() => { expect(shown()).toBe("s-b"); });
    });
  });

  it("drops an item an override moves out, and names the other one on its row (the 2 to 1 case)", async () => {
    reply(() => Promise.resolve({ data: [skipA], error: null }));
    function Row() {
      const { data } = useLateBillsQuery();
      const rows = data == null ? [] : attentionRows({
        pending: 0, unpaidCount: 0, unpaidGross: 0n, missingCount: data.length, missingName: lateItemName(data, false), missingTarget: lateTarget(data, false), search: "",
      });
      return <>{rows.map((row) => <a key={row.id} href={row.to}>{row.title}</a>)}</>;
    }
    renderWithProviders(<Row />);
    const link = await screen.findByRole("link", { name: "החשבון של ספק ב לא הגיע" });
    expect(link).toHaveAttribute("href", "/recurring/expense/s-b");
  });
});
