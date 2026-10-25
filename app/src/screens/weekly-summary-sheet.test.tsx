// FLOW-517: the weekly summary sheet's states. Invented figures only; amounts are cents.
import type { WeeklySummary } from "@flow/shared";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { WeeklySummarySheet, type WeeklySummaryState } from "./weekly-summary-sheet";

const SUMMARY: WeeklySummary = {
  week_start: "2026-10-04",
  currency: "USD",
  lines: 23,
  auto_approved: 16,
  week_waiting: 7,
  waiting: 7,
  in_minor: 1_432_000n,
  out_minor: 2_190_500n,
  profit_minor: -121_000n,
  kept_out_minor: -637_500n,
  prev_profit_minor: -205_000n,
  alert: { project_id: "c0ffee00-3333-4000-8000-000000000001", name: "Example Ridge", spent_minor: 5_824_000n, budget_minor: 5_200_000n },
  more_over_budget: 2,
};

function show(state: WeeklySummaryState, onOpenChange: (open: boolean) => void = () => undefined, onRetry?: () => void) {
  return render(
    <MemoryRouter>
      <WeeklySummarySheet open onOpenChange={onOpenChange} weekStart="2026-10-04" state={state} search="?x=1" onRetry={onRetry} />
    </MemoryRouter>,
  );
}

describe("WeeklySummarySheet", () => {
  it("names the week, the profit, the totals, the alert and the review button", () => {
    show({ kind: "ready", summary: SUMMARY });
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByText("סיכום שבועי")).toBeInTheDocument();
    expect(within(sheet).getByText("ראשון 4 עד שבת 10 באוקטובר")).toBeInTheDocument();
    expect(within(sheet).getByText("−$1,210")).toBeInTheDocument();
    expect(within(sheet).getByText("כולל 7 שעוד מחכות לאישור")).toBeInTheDocument();
    expect(within(sheet).getByText("+$14,320")).toBeInTheDocument();
    expect(within(sheet).getByText("לא נספר ברווח")).toBeInTheDocument();
    expect(within(sheet).getByText("Example Ridge עבר את התקציב")).toBeInTheDocument();
    expect(within(sheet).getByText("ועוד 2 פרויקטים מעל התקציב")).toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: /Example Ridge/ })).toHaveAttribute("href", "/projects/c0ffee00-3333-4000-8000-000000000001?x=1");
    expect(within(sheet).getByText("23 תנועות נכנסו השבוע · 16 אושרו אוטומטית")).toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: "לאישור 7 פריטים · כ־2 דקות" })).toHaveAttribute("href", "/review?x=1");
  });

  it("colours the change pill by whether profit got better", () => {
    const { unmount } = show({ kind: "ready", summary: SUMMARY });
    expect(screen.getByLabelText("עלייה של $840 מול השבוע הקודם")).toHaveAttribute("data-tone", "helps");
    unmount();
    show({ kind: "ready", summary: { ...SUMMARY, profit_minor: -224_000n } });
    expect(screen.getByLabelText("ירידה של $190 מול השבוע הקודם")).toHaveAttribute("data-tone", "hurts");
  });

  it("says everything is approved when nothing waits, and leaves out an alert that is not there", () => {
    show({ kind: "ready", summary: { ...SUMMARY, lines: 1, auto_approved: 1, week_waiting: 0, waiting: 0, kept_out_minor: 0n, alert: null } });
    expect(screen.getByText("הכול מאושר")).toBeInTheDocument();
    expect(screen.getByText("תנועה אחת נכנסה השבוע · אושרה אוטומטית")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /לאישור/ })).toBeNull();
    expect(screen.queryByText(/עבר את התקציב/)).toBeNull();
    expect(screen.queryByText("לא נספר ברווח")).toBeNull();
    expect(screen.queryByText(/שעוד מחכ/)).toBeNull();
  });

  it("shows the empty state and the bank connection for a week with no lines", () => {
    show({ kind: "ready", summary: { ...SUMMARY, lines: 0, auto_approved: 0, week_waiting: 0, waiting: 0, in_minor: 0n, out_minor: 0n, profit_minor: 0n, kept_out_minor: 0n, alert: null } });
    expect(screen.getByText("לא נכנסו תנועות השבוע")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "בדיקת החיבור לבנק" })).toHaveAttribute("href", "/settings/connections?x=1");
    expect(screen.queryByText(/מול השבוע הקודם/)).toBeNull();
    expect(screen.queryByText("נכנס")).toBeNull();
  });

  it("offers a retry when the read failed", () => {
    const onRetry = vi.fn();
    show({ kind: "error", offline: false }, () => undefined, onRetry);
    fireEvent.click(screen.getByRole("button", { name: "נסו שוב" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("closes from ✕", async () => {
    const onOpenChange = vi.fn();
    show({ kind: "ready", summary: SUMMARY }, onOpenChange);
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
