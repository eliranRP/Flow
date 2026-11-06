import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RECURRING_FIXTURE } from "../recurring-sample";
import type { ScheduleRow } from "../recurring-schedule";
import { renderWithProviders } from "../test-render";
import { ChargeSkipMonth } from "./recurring-skip-month";

// FLOW-1079 (concept B): the charge page's "לא צפוי ב<month>" switch, on a dev sample (no write).
const soon = RECURRING_FIXTURE.find((row) => row.party_id === "insurance") as ScheduleRow;
const arrived = RECURRING_FIXTURE.find((row) => row.party_id === "water") as ScheduleRow;

describe("the charge page's skip switch", () => {
  it("takes a charge still expected out of this month only, and names the next month", () => {
    renderWithProviders(<ChargeSkipMonth row={soon} split={false} live={false} today="2026-11-06" disabled={false} blocked={() => false} />);
    const toggle = screen.getByRole("switch", { name: "לא צפוי בנובמבר" });
    expect(toggle).not.toBeChecked();
    expect(screen.getByText("מוציא רק את נובמבר מהצפי. דצמבר נשאר כרגיל.")).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toBeChecked();
    expect(screen.getByText("לא נספר בצפי של נובמבר. בדצמבר הוא צפוי שוב.")).toBeInTheDocument();
  });

  it("is not there once the charge arrived", () => {
    renderWithProviders(<ChargeSkipMonth row={arrived} split={false} live={false} today="2026-11-06" disabled={false} blocked={() => false} />);
    expect(screen.queryByRole("switch")).toBeNull();
  });
});
