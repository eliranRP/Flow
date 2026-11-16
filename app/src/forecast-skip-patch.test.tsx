import { QueryClient } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCompanyNextMonth } from "./company-next-month-query";
import { priorPatch, useResetForecastMonth, useRestoreForecast, useSetForecastItem } from "./forecast-month";
import { QUERY_STALE_MS } from "./query-client";
import { FORECAST_EDITS_KEY } from "./project-next-month-query";
import { renderWithProviders } from "./test-render";

// FLOW-1214: a skip, reset or undo patches `skips` in the cached company_next_month_inputs answers at once, with no read,
// so the month's total follows the tap. A failed write puts the patch back, and the inactive answers are still dropped.
// Invented answers only: "today" is 2026-01-15, so next month is February, and the charge is a recurring power bill.
type Answer = { data: unknown; error: unknown };
type CachedInputs = { skips: Record<string, string[]> };
type Rpc = {
  calls: Array<{ name: string; args: unknown }>;
  answers: Record<string, unknown>;
  /** The answer a month-forecast write waits for: a test replaces it to hold the write, or to refuse it. */
  write: () => Promise<Answer>;
};
const rpc = vi.hoisted((): Rpc => ({
  calls: [],
  answers: {},
  write: () => Promise.resolve({ data: null, error: null }),
}));

vi.mock("./lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args?: unknown) => {
      rpc.calls.push({ name, args });
      if (name === "set_forecast_item" || name === "reset_forecast_month") return rpc.write();
      return Promise.resolve({ data: rpc.answers[name] ?? null, error: null });
    },
    from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }),
  }),
}));
vi.mock("./wait-for-session", () => ({ waitForAccessToken: () => Promise.resolve() }));

const today = "2026-01-15";
const NEXT = "2026-02";
const POWER = "party:expense:power:ILS";
const power = {
  direction: "expense",
  party_id: "power",
  name: "Example Power",
  currency: "ILS",
  typical_amount_minor: -18_600,
  typical_day: 5,
  months_seen: 6,
  seen_this_month: true,
  project_id: null,
  category_id: null,
  pace: "month",
  next_due_month: NEXT,
  pays_loan: false,
};
const inputs = { month: NEXT, overhead_project_id: null, projects: [], general: [], edits: [] };
/** The slim answer next month's card reads, the one the skip patches. */
const activeKey = [FORECAST_EDITS_KEY, "off", "company", today, false];
const INPUT_CALL = "company_next_month_inputs";

function Harness() {
  const month = useCompanyNextMonth("ILS", today, true);
  const set = useSetForecastItem(NEXT);
  const reset = useResetForecastMonth(NEXT);
  const restore = useRestoreForecast(NEXT);
  return (
    <>
      <p data-testid="total">{month.forecast == null ? "loading" : String(month.forecast.expenseMinor)}</p>
      <button type="button" onClick={() => { set.mutate({ key: POWER, patch: { moved_out: true }, undo: false, prior: null }); }}>skip</button>
      <button type="button" onClick={() => { set.mutate({ key: POWER, patch: priorPatch(null), undo: true, prior: null }); }}>undo</button>
      <button type="button" onClick={() => { reset.mutate(undefined); }}>reset</button>
      <button type="button" onClick={() => { restore.mutate([{ item_key: POWER, amount_minor: null, due_on: null, moved_out: true }]); }}>restore</button>
    </>
  );
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: QUERY_STALE_MS } } });
}

function calls(name: string) {
  return rpc.calls.filter((call) => call.name === name);
}

function total() {
  return screen.getByTestId("total").textContent;
}

function skipsOf(client: QueryClient, key: readonly unknown[] = activeKey) {
  return client.getQueryData<CachedInputs>(key)?.skips;
}

beforeEach(() => {
  rpc.calls.length = 0;
  rpc.write = () => Promise.resolve({ data: null, error: null });
  rpc.answers = {
    expected_months: { today, project_id: null, recurring: [power] },
    list_categories: [],
    forecast_overrides_for: [],
    company_next_month_inputs: { ...inputs, skips: {} },
  };
});

describe("a skip, reset or undo patches the cached skips (FLOW-1214)", () => {
  it("the month's total changes on the tap, while the write is still in flight", async () => {
    let answer: (value: Answer) => void = () => undefined;
    rpc.write = () => new Promise<Answer>((resolve) => { answer = resolve; });
    const client = newClient();
    renderWithProviders(<Harness />, { route: "/", client });
    await waitFor(() => { expect(total()).toBe("18600"); });
    fireEvent.click(screen.getByRole("button", { name: "skip" }));
    await waitFor(() => { expect(total()).toBe("0"); });
    expect(client.isMutating()).toBe(1);
    expect(calls("set_forecast_item")).toHaveLength(1);
    answer({ data: null, error: null });
    await waitFor(() => { expect(client.isMutating()).toBe(0); });
    expect(total()).toBe("0");
    expect(skipsOf(client)?.[NEXT]).toEqual([POWER]);
  });

  it("a skip, its undo and a reset send no company_next_month_inputs request", async () => {
    const client = newClient();
    renderWithProviders(<Harness />, { route: "/", client });
    await waitFor(() => { expect(total()).toBe("18600"); });
    expect(calls(INPUT_CALL)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "skip" }));
    await waitFor(() => { expect(total()).toBe("0"); });
    await waitFor(() => { expect(client.isMutating()).toBe(0); });
    fireEvent.click(screen.getByRole("button", { name: "undo" }));
    await waitFor(() => { expect(total()).toBe("18600"); });
    await waitFor(() => { expect(client.isMutating()).toBe(0); });
    fireEvent.click(screen.getByRole("button", { name: "reset" }));
    await waitFor(() => { expect(calls("reset_forecast_month")).toHaveLength(1); });
    await waitFor(() => { expect(client.isMutating()).toBe(0); });
    expect(calls("set_forecast_item")).toHaveLength(2);
    expect(calls(INPUT_CALL)).toHaveLength(1);
  });

  it("a failed write puts the month's total back, and the answer's skips with it", async () => {
    let refuse: () => void = () => undefined;
    rpc.write = () => new Promise<Answer>((resolve) => { refuse = () => { resolve({ data: null, error: { message: "refused" } }); }; });
    const client = newClient();
    renderWithProviders(<Harness />, { route: "/", client });
    await waitFor(() => { expect(total()).toBe("18600"); });
    fireEvent.click(screen.getByRole("button", { name: "skip" }));
    await waitFor(() => { expect(total()).toBe("0"); });
    refuse();
    await waitFor(() => { expect(total()).toBe("18600"); });
    await waitFor(() => { expect(client.isMutating()).toBe(0); });
    expect(skipsOf(client)?.[NEXT]).toEqual([]);
    expect(calls(INPUT_CALL)).toHaveLength(1);
    await screen.findByText("לא הצלחנו לעדכן את הצפי");
  });

  it("drops an inactive company inputs answer, as before, and patches the active one", async () => {
    const client = newClient();
    const inactive = [FORECAST_EDITS_KEY, "off", "company", "2025-12-20", true];
    client.setQueryData(inactive, { ...inputs, skips: { [NEXT]: [] } });
    renderWithProviders(<Harness />, { route: "/", client });
    await waitFor(() => { expect(total()).toBe("18600"); });
    fireEvent.click(screen.getByRole("button", { name: "skip" }));
    await waitFor(() => { expect(total()).toBe("0"); });
    await waitFor(() => { expect(client.isMutating()).toBe(0); });
    await waitFor(() => { expect(client.getQueryData(inactive)).toBeUndefined(); });
    expect(skipsOf(client)?.[NEXT]).toEqual([POWER]);
    expect(calls(INPUT_CALL)).toHaveLength(1);
  });

  it("a reset clears that month's skips and keeps the other months', and the undo of the reset puts them back", async () => {
    rpc.answers.company_next_month_inputs = { ...inputs, skips: { [NEXT]: [POWER], "2026-03": [POWER] } };
    const client = newClient();
    renderWithProviders(<Harness />, { route: "/", client });
    await waitFor(() => { expect(total()).toBe("0"); });
    fireEvent.click(screen.getByRole("button", { name: "reset" }));
    await waitFor(() => { expect(total()).toBe("18600"); });
    await waitFor(() => { expect(client.isMutating()).toBe(0); });
    expect(calls("reset_forecast_month").map((call) => call.args)).toEqual([{ p_month: NEXT }]);
    expect(skipsOf(client)).toEqual({ [NEXT]: [], "2026-03": [POWER] });
    fireEvent.click(screen.getByRole("button", { name: "restore" }));
    await waitFor(() => { expect(total()).toBe("0"); });
    await waitFor(() => { expect(client.isMutating()).toBe(0); });
    expect(skipsOf(client)).toEqual({ [NEXT]: [POWER], "2026-03": [POWER] });
    expect(calls(INPUT_CALL)).toHaveLength(1);
  });
});
