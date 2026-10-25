// FLOW-956: the weekly summary card on Home. Invented figures only; amounts are cents.
import type { WeeklySummary } from "@flow/shared";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { weeklyCardHidden } from "../weekly-card";
import { WeeklySummaryCard, WeeklySummaryCardSlot } from "./weekly-summary-card";

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
  alert: null,
  more_over_budget: 0,
};

const query = vi.hoisted(() => ({ data: undefined as WeeklySummary | undefined }));
vi.mock("../use-weekly-summary", () => ({ useWeeklySummaryQuery: () => ({ data: query.data }) }));

function Where() {
  return <p data-testid="where">{useLocation().search}</p>;
}

function slot() {
  return render(
    <MemoryRouter initialEntries={["/?month=2026-10"]}>
      <Routes>
        <Route path="/" element={<><WeeklySummaryCardSlot weekStart="2026-10-04" /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("WeeklySummaryCard", () => {
  it("names the week, the profit and what waits", () => {
    render(<WeeklySummaryCard summary={SUMMARY} weekStart="2026-10-04" onOpen={() => undefined} onHide={() => undefined} />);
    expect(screen.getByText("הסיכום השבועי מוכן")).toBeInTheDocument();
    expect(screen.getByText("ראשון 4 עד שבת 10 באוקטובר")).toBeInTheDocument();
    expect(screen.getByText("−$1,210")).toBeInTheDocument();
    expect(screen.getByText("7 מחכות לאישור")).toBeInTheDocument();
  });

  it("says all approved, or no lines with $0", () => {
    const { unmount } = render(<WeeklySummaryCard summary={{ ...SUMMARY, lines: 1, waiting: 0, profit_minor: 185_000n }} weekStart="2026-10-04" onOpen={() => undefined} onHide={() => undefined} />);
    expect(screen.getByText("הכול מאושר")).toBeInTheDocument();
    unmount();
    render(<WeeklySummaryCard summary={{ ...SUMMARY, lines: 0, waiting: 0, profit_minor: 0n }} weekStart="2026-10-04" onOpen={() => undefined} onHide={() => undefined} />);
    expect(screen.getByText("לא נכנסו תנועות")).toBeInTheDocument();
    expect(screen.getByText("$0").closest("[data-tone]")).toHaveAttribute("data-tone", "zero");
  });
});

describe("WeeklySummaryCardSlot", () => {
  beforeEach(() => {
    localStorage.clear();
    query.data = SUMMARY;
  });

  it("shows nothing until the week's figures arrive", () => {
    query.data = undefined;
    slot();
    expect(screen.queryByText("הסיכום השבועי מוכן")).toBeNull();
  });

  it("opens the week's sheet on a tap, keeping the rest of the address", () => {
    slot();
    fireEvent.click(screen.getByRole("button", { name: /הסיכום השבועי מוכן/ }));
    expect(screen.getByTestId("where")).toHaveTextContent("?month=2026-10&week=2026-10-04");
  });

  it("✕ hides the week's card on this phone", () => {
    vi.useFakeTimers();
    try {
      slot();
      fireEvent.click(screen.getByRole("button", { name: "הסתרת הסיכום עד השבוע הבא" }));
      expect(weeklyCardHidden("2026-10-04")).toBe(true);
      act(() => {
        vi.advanceTimersByTime(220);
      });
    } finally {
      vi.useRealTimers();
    }
    expect(screen.queryByText("הסיכום השבועי מוכן")).toBeNull();
  });
});
