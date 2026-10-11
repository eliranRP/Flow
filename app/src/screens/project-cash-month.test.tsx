import { fireEvent, screen } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { CashMonths } from "@flow/shared";
import { cashTitle } from "../cash";
import { shiftMonthKey } from "../period";
import { renderWithProviders } from "../test-render";
import { israelToday } from "../ui/date-math";
import { ProjectCashMonthScreen } from "./project-cash-screens";

const current = israelToday().slice(0, 7);

function row(inMinor: bigint, outMinor: bigint) {
  return {
    currency: "USD",
    in_minor: inMinor,
    out_minor: outMinor,
    net_minor: inMinor - outMinor,
    profit_minor: inMinor - outMinor,
    excluded_count: 0,
    excluded_in_minor: 0n,
    excluded_out_minor: 0n,
    not_in_profit_categories: [],
  };
}

// Invented figures: the project's read holds this month and the two before it.
const sample: NonNullable<CashMonths> = {
  basis: "paid",
  base_currency: "USD",
  months: [row(300_000n, 100_000n), row(200_000n, 50_000n), row(100_000n, 40_000n)].map((byCurrency, back) => ({
    month: `${shiftMonthKey(current, -back)}-01`,
    by_currency: [byCurrency],
  })),
};

function wrap(month: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/projects/:projectId/cash/:month" element={<ProjectCashMonthScreen sample={sample} projectName="בית לדוגמה" />} />
      <Route path="/projects/:projectId" element={<p>פרויקט</p>} />
    </Routes>,
    { route: `/projects/p-1/cash/${month}` },
  );
}

describe("Project month page (FLOW-422)", () => {
  it("steps months like Home's, only within the months the project's read holds", () => {
    wrap(shiftMonthKey(current, -2));
    // Back names the project it returns to (design lead).
    expect(screen.getByText("בית לדוגמה")).toBeInTheDocument();
    // The oldest month keeps the earlier step's empty slot; its later step opens the next month in place.
    expect(screen.getAllByRole("button", { name: /^תזרים / })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /^תזרים / }));
    expect(screen.getAllByText("$1,500").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /^תזרים / })).toHaveLength(2);
    // This month has no later step.
    fireEvent.click(screen.getByRole("button", { name: cashTitle(current) }));
    expect(screen.getAllByText("$2,000").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /^תזרים / })).toHaveLength(1);
  });
});
