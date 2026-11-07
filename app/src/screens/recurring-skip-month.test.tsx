import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RECURRING_FIXTURE } from "../recurring-sample";
import type { ScheduleRow } from "../recurring-schedule";
import { renderWithProviders } from "../test-render";
import { ChargeSkipMonth, skipMonthOf } from "./recurring-skip-month";

const rpc = vi.hoisted(() => ({
  calls: [] as string[],
  impl: (_name: string): Promise<{ data: unknown; error: { message: string } | null }> => Promise.resolve({ data: [], error: null }),
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string) => {
      rpc.calls.push(name);
      return rpc.impl(name);
    },
  }),
}));

afterEach(() => {
  rpc.calls = [];
  rpc.impl = () => Promise.resolve({ data: [], error: null });
});

// FLOW-1079 (concept B): the charge page's "לא צפוי ב<month>" switch, on a dev sample (no write).
const soon = RECURRING_FIXTURE.find((row) => row.party_id === "insurance") as ScheduleRow;
const arrived = RECURRING_FIXTURE.find((row) => row.party_id === "water") as ScheduleRow;

describe("the charge page's skip switch", () => {
  it("takes a charge still expected out of this month only, and names the next month", () => {
    renderWithProviders(<ChargeSkipMonth row={soon} split={false} live={false} today="2026-11-06" disabled={false} blocked={() => false} />);
    const toggle = screen.getByRole("switch", { name: "לא צפוי בנובמבר" });
    expect(toggle).not.toBeChecked();
    expect(screen.getByText("מוציא רק את נובמבר מהצפי. שאר החודשים נשארים.")).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toBeChecked();
    expect(screen.getByText("לא נספר בצפי של נובמבר. בשאר החודשים הוא צפוי כרגיל.")).toBeInTheDocument();
  });

  it("once the charge arrived, offers its next month, while the forecast reaches it", () => {
    renderWithProviders(<ChargeSkipMonth row={{ ...arrived, next_due_month: "2026-12" }} split={false} live={false} today="2026-11-06" disabled={false} blocked={() => false} />);
    expect(screen.getByRole("switch", { name: "לא צפוי בדצמבר" })).toBeInTheDocument();
  });

  it("names the month the charge is next expected in, and none past the forecast", () => {
    expect(skipMonthOf({ state: "soon", next_due_month: "2026-11" }, "2026-11-06")).toBe("2026-11");
    expect(skipMonthOf({ state: "later", next_due_month: "2027-02" }, "2026-11-06")).toBe("2027-02");
    expect(skipMonthOf({ state: "later", next_due_month: "2028-01" }, "2026-11-06")).toBeNull();
    expect(skipMonthOf({ state: "arrived", next_due_month: "" }, "2026-11-06")).toBeNull();
  });

  // FLOW-1087: a failed forecast read says why the switch waits, and offers a retry.
  it("says a failed forecast read with a retry, and turns the switch on once the retry reads it", async () => {
    rpc.impl = () => Promise.resolve({ data: null, error: { message: "boom" } });
    renderWithProviders(<ChargeSkipMonth row={soon} split={false} live today="2026-11-06" disabled={false} blocked={() => false} />);
    const toggle = screen.getByRole("switch", { name: "לא צפוי בנובמבר" });
    expect(toggle).toBeDisabled();
    expect(await screen.findByText("לא הצלחנו לטעון את הצפי.")).toBeInTheDocument();
    expect(toggle).toHaveAccessibleDescription("לא הצלחנו לטעון את הצפי.");
    rpc.impl = () => Promise.resolve({ data: [], error: null });
    fireEvent.click(screen.getByRole("button", { name: "נסו שוב" }));
    await waitFor(() => { expect(toggle).toBeEnabled(); });
    expect(rpc.calls.filter((name) => name === "forecast_overrides_for")).toHaveLength(2);
    expect(screen.queryByText("לא הצלחנו לטעון את הצפי.")).toBeNull();
    expect(screen.queryByRole("button", { name: "נסו שוב" })).toBeNull();
  });

  it("waits for the forecast with no failure line while it is read", () => {
    rpc.impl = () => new Promise(() => undefined);
    renderWithProviders(<ChargeSkipMonth row={soon} split={false} live today="2026-11-06" disabled={false} blocked={() => false} />);
    expect(screen.getByRole("switch", { name: "לא צפוי בנובמבר" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "נסו שוב" })).toBeNull();
  });
});
