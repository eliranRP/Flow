import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NEXT_MONTH_PROJECTS } from "../dev/home-next-month-sample";
import { renderWithProviders } from "../test-render";
import { CompanyNextMonthScreen } from "./company-next-month-screen";

// FLOW-1000 r2: a failed forecast read and its נסו שוב, with the reads stubbed.
const reads = vi.hoisted(() => ({ forecastRefetch: vi.fn(() => Promise.resolve()), listRefetch: vi.fn(() => Promise.resolve()) }));

vi.mock("../company-next-month-query", () => ({
  useCompanyNextMonth: () => ({ forecast: null, rest: null, categories: [], pending: false, failed: true, paused: false, refetch: reads.forecastRefetch }),
}));

vi.mock("../project-cash", () => ({
  useProjectsCashMonth: () => ({ data: NEXT_MONTH_PROJECTS, isPending: false, isError: false, isPaused: false, refetch: reads.listRefetch }),
}));

describe("CompanyNextMonthScreen retry (FLOW-1000)", () => {
  it("shows the failure when a forecast read fails, and נסו שוב reads the forecast again", () => {
    renderWithProviders(<CompanyNextMonthScreen />, { route: "/forecast/next" });
    expect(screen.queryByText("אין תנועות צפויות בחודש הבא.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "נסו שוב" }));
    expect(reads.forecastRefetch).toHaveBeenCalledTimes(1);
    expect(reads.listRefetch).toHaveBeenCalledTimes(1);
  });
});
