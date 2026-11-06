import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RECURRING_FIXTURE } from "../recurring-sample";
import type { ScheduleRow } from "../recurring-schedule";
import { renderWithProviders } from "../test-render";
import { ChargeSkipMonth, skipMonthOf } from "./recurring-skip-month";

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
});
