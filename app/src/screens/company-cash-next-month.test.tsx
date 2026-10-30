import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { companyCashForecast, companyNextMonthForecast } from "../company-next-month";
import { HOME_NEXT_MONTH_SAMPLE, NEXT_MONTH_TODAY } from "../dev/home-next-month-sample";
import { renderWithProviders } from "../test-render";
import { CompanyCashCard, nothingExpected, thisMonthCashOut } from "./company-cash-next-month";

const reads = HOME_NEXT_MONTH_SAMPLE.next;
const FORECAST = companyCashForecast(companyNextMonthForecast({ currency: "USD", today: NEXT_MONTH_TODAY, recurring: reads.recurring, loans: reads.loans, categories: reads.categories, inputs: reads.inputs }));

describe("CompanyCashCard (FLOW-990)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds the card's place with its skeleton while the reads are out, after the skeleton's delay", () => {
    const { container } = renderWithProviders(<CompanyCashCard next={{ forecast: null, loading: true, categories: [] }} currency="USD" today={NEXT_MONTH_TODAY} thisMonthOut={null} />);
    expect(container.querySelector(".ui-fc-card")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(container.querySelector(".ui-fc-card[aria-hidden='true']")).not.toBeNull();
  });

  it("draws nothing when a read failed (no forecast) or nothing is expected", () => {
    const failed = renderWithProviders(<CompanyCashCard next={{ forecast: null, loading: false, categories: [] }} currency="USD" today={NEXT_MONTH_TODAY} thisMonthOut={0n} />);
    expect(failed.container.querySelector(".ui-fc-card")).toBeNull();
    const empty = { ...FORECAST, rows: [], parts: [], incomeMinor: 0n, expenseMinor: 0n, netMinor: 0n };
    expect(nothingExpected(null)).toBe(true);
    expect(nothingExpected(empty)).toBe(true);
    expect(nothingExpected(FORECAST)).toBe(false);
  });

  it("leaves the expense caption empty until this month's cash out is known, never \"מול $0\"", () => {
    const { container } = renderWithProviders(<CompanyCashCard next={{ forecast: FORECAST, loading: false, categories: [] }} currency="USD" today={NEXT_MONTH_TODAY} thisMonthOut={null} />);
    expect(container.textContent).not.toMatch(/מול/u);
    expect(thisMonthCashOut(null, NEXT_MONTH_TODAY, "USD")).toBeNull();
    expect(thisMonthCashOut(HOME_NEXT_MONTH_SAMPLE.cash, NEXT_MONTH_TODAY, "USD")).toBe(2_220_000n);
  });
});
