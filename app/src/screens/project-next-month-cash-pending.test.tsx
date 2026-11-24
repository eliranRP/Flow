import { formatAmountText } from "@flow/shared";
import { Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JUNIPER_NEXT } from "../dev/project-next-month-sample";
import { JUNIPER_PROFIT } from "../dev/project-profit-sample";
import { cashForecast } from "../project-next-month";
import { renderWithProviders } from "../test-render";
import { ProjectNextMonthScreen } from "./project-next-month-screen";

// FLOW-1315 (r2): after a removal of a loan's row the loans' cash is unknown until the read after the write: no amount that holds it
// (the cash figure, the cash expense, the "not in profit" line) is drawn, not even the old value.
const pending = vi.hoisted(() => ({ on: false }));
const KEPT_OUT = 4_000_000n;
const seen: { forecast: ReturnType<typeof import("../project-next-month").cashForecast> | null } = vi.hoisted(() => ({ forecast: null }));
vi.mock("../next-month-for-project", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../next-month-for-project")>();
  return {
    ...actual,
    useProjectNextMonth: (...args: Parameters<typeof actual.useProjectNextMonth>) => {
      const result = actual.useProjectNextMonth(...args);
      seen.forecast = result.forecast == null ? null : { ...result.forecast, cashOnlyMinor: KEPT_OUT };
      return { ...result, cashPending: pending.on, forecast: result.forecast == null ? null : { ...result.forecast, cashOnlyMinor: KEPT_OUT } };
    },
  };
});

afterEach(() => { pending.on = false; });

function renderNext() {
  return renderWithProviders(
    <Routes>
      <Route path="/projects/:projectId/profit/next" element={<ProjectNextMonthScreen sample={{ ...JUNIPER_PROFIT, next: JUNIPER_NEXT }} />} />
    </Routes>,
    { route: "/projects/juniper-ct/profit/next" },
  );
}

describe("the צפי page while the loans' cash is pending (FLOW-1315)", () => {
  it("draws no amount that holds the cash, and draws them when it is known", () => {
    // The amounts that hold the loans' cash, from the forecast the page draws: the kept-out line, the cash expense and the cash net.
    const known = renderNext();
    const cash = cashForecast(seen.forecast as NonNullable<typeof seen.forecast>);
    const amounts = [formatAmountText(KEPT_OUT, "USD"), formatAmountText(cash.expenseMinor, "USD")];
    for (const amount of amounts) expect(known.container.textContent, amount).toContain(amount);
    known.unmount();
    pending.on = true;
    const { container } = renderNext();
    for (const amount of amounts) expect(container.textContent, amount).not.toContain(amount);
    expect(container.querySelectorAll(".ui-skeleton-bar").length).toBeGreaterThan(0);
    // The profit's own figures are still drawn.
    expect(container.textContent).toContain(formatAmountText(cash.incomeMinor, "USD"));
  });
});
