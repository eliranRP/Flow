import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test-render";
import { PnlReportScreen } from "./reports-screen";

const monthsRead = vi.hoisted(() => ({ refetch: vi.fn() }));

// FLOW-1102: the live month drill, with the by-month read failed. The retry must refetch that read.
vi.mock("../use-reports", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../use-reports")>();
  const { REPORTS_STATEMENT } = await import("../dev/reports-sample");
  return {
    ...actual,
    usePnl: () => ({ data: REPORTS_STATEMENT, failed: false, readAt: 0, refetch: () => undefined }),
    useCompanyMonths: () => ({ data: undefined, failed: true, readAt: 0, refetch: monthsRead.refetch }),
  };
});

beforeEach(() => {
  window.localStorage.clear();
  monthsRead.refetch.mockClear();
});

describe("the P&L month drill, live (FLOW-1102)", () => {
  it("a failed months read shows its retry, and the retry refetches the by-month read", async () => {
    renderWithProviders(<PnlReportScreen />, { route: "/reports/pnl?view=month&month=2026-10" });
    const line = (await screen.findByText("לא הצלחנו לטעון את החודשים.")).closest("[role=status]") as HTMLElement;
    fireEvent.click(within(line).getByRole("button", { name: "נסו שוב" }));
    expect(monthsRead.refetch).toHaveBeenCalledTimes(1);
  });
});
