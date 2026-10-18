import { type ExpectedMonths as ExpectedMonthsData } from "@flow/shared";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { chargeChangeViews, openMonthDue } from "./forecast";
import { monthForecastBoardSample, SAMPLE_RECURRING_CHANGES, SAMPLE_RECURRING_THIS_MONTH } from "./forecast-sample";
import { attentionRows } from "./screens/HomeScreen";
import { forecastMinor } from "./home-month";
import { nextMonth } from "./forecast-month";

// --- forecast.test.tsx

describe("the קבועים screen (FLOW-415, b-2)", () => {
  it("opens one change's payment, and shares one row for two or more that opens הגיעו החודש", () => {
    const one = chargeChangeViews(SAMPLE_RECURRING_CHANGES, "");
    expect(attentionRows({ pending: 0, unpaidCount: 0, unpaidGross: 0n, changes: one, search: "" }).map((row) => row.to)).toEqual(["/transactions/t-power-oct"]);
    const two = chargeChangeViews(SAMPLE_RECURRING_THIS_MONTH.slice(0, 2), "?preview=1");
    const [row] = attentionRows({ pending: 0, unpaidCount: 0, unpaidGross: 0n, changes: two, search: "?preview=1" });
    expect(row?.id).toBe("changes");
    expect(row?.to).toBe("/missing-bills?preview=1#arrived");
    const { container } = render(<MemoryRouter><span>{row?.title}</span></MemoryRouter>);
    expect(container.textContent).toBe("2 חיובים קבועים השתנו");
    // All drops: the down arrow; an empty party name falls back to the supplier's.
    const drops = chargeChangeViews(
      SAMPLE_RECURRING_THIS_MONTH.slice(0, 2).map((change) => ({ ...change, change_percent: -30, party_name: "", category_name: null })),
      "",
    );
    expect(drops.map((change) => change.title)).toEqual(["אור חשמל ירד", "ארנונה עירונית ירד"]);
    const [dropRow] = attentionRows({ pending: 0, unpaidCount: 0, unpaidGross: 0n, changes: drops, search: "" });
    const icon = render(<MemoryRouter><span>{dropRow?.icon}</span></MemoryRouter>);
    const upIcon = render(<MemoryRouter><span>{row?.icon}</span></MemoryRouter>);
    expect(icon.container.innerHTML).not.toBe(upIcon.container.innerHTML);
  });

});

describe("openMonthDue (FLOW-364)", () => {
  it("reads the open month's recurring money still due in one currency, or 0", () => {
    const data = {
      today: "2026-10-11",
      project_id: null,
      months: [
        { month: "2026-10", open: true, by_currency: [{ currency: "ILS", income_minor: 12_000n, expense_minor: 31_500n }] },
        { month: "2026-11", open: false, by_currency: [{ currency: "ILS", income_minor: 1n, expense_minor: 2n }] },
      ],
      recurring: [],
    } as unknown as ExpectedMonthsData;
    expect(openMonthDue(data, "ILS")).toEqual({ income: 12_000n, expense: 31_500n });
    expect(openMonthDue(data, "USD")).toEqual({ income: 0n, expense: 0n });
    expect(openMonthDue(null, "ILS")).toEqual({ income: 0n, expense: 0n });
  });

  it("takes the server's negative expense as a positive amount, so the forecast subtracts it once", () => {
    const data = {
      today: "2026-10-11",
      project_id: null,
      months: [{ month: "2026-10", open: true, by_currency: [{ currency: "ILS", income_minor: 0n, expense_minor: -283_000n }] }],
      recurring: [],
    } as unknown as ExpectedMonthsData;
    expect(openMonthDue(data, "ILS")).toEqual({ income: 0n, expense: 283_000n });
    expect(forecastMinor(-100_000n, 0n, openMonthDue(data, "ILS").expense, 0n).minor).toBe(-383_000n);
  });
});

describe("the month forecast's board samples (FLOW-141b)", () => {
  it("moves the largest invoice out in the changed state: one moved item, the income without it", () => {
    const { build } = monthForecastBoardSample("changed").data;
    expect(build.changed).toBe(1);
    expect(build.moved).toHaveLength(1);
    expect(build.incomeTotal).toBe(725_000n);
    expect(build.expenseTotal).toBe(830_000n);
  });

  it("has nothing left to arrive in the empty state", () => {
    const { build } = monthForecastBoardSample("empty").data;
    expect(build.income).toHaveLength(0);
    expect(build.expense).toHaveLength(0);
    expect(build.small).toHaveLength(0);
    expect(build.moved).toHaveLength(0);
  });
});
// --- forecast-month.test.ts

describe("nextMonth (FLOW-141b)", () => {
  it("steps to the following month", () => {
    expect(nextMonth("2026-10")).toBe("2026-11");
  });

  it("rolls December into January of the next year", () => {
    expect(nextMonth("2026-12")).toBe("2027-01");
  });
});