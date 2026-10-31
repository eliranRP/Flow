import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { companyGeneralForecast, type CompanyForecastInput } from "./company-next-month";
import { COMPANY_NEXT_READS } from "./dev/company-next-month-sample";
import { NEXT_MONTH_TODAY } from "./dev/home-next-month-sample";
import { useProjectNextMonth } from "./next-month-for-project";

const OVERHEAD = "p0";
const INPUT: CompanyForecastInput = { currency: "USD", today: NEXT_MONTH_TODAY, recurring: COMPANY_NEXT_READS.recurring, loans: COMPANY_NEXT_READS.loans, categories: COMPANY_NEXT_READS.categories, inputs: { ...COMPANY_NEXT_READS.inputs, overhead_project_id: OVERHEAD } };

const reads = vi.hoisted(() => ({ ownEnabled: [] as boolean[] }));

vi.mock("./overhead-project", () => ({
  useOverheadProject: () => ({ project: { id: "p0", name: "משרד" }, failed: false, refetch: () => undefined }),
}));

vi.mock("./company-next-month-query", () => ({
  useCompanyNextMonth: (_currency: string, _today: string, enabled: boolean) => ({
    forecast: null, input: enabled ? INPUT : null, rest: null, categories: [], pending: false, failed: false, paused: false, refetch: () => Promise.resolve(),
  }),
}));

vi.mock("./project-next-month-query", () => ({
  useNextMonthForecast: (_id: string, _currency: string, _sample: unknown, enabled: boolean) => {
    reads.ownEnabled.push(enabled);
    return { forecast: "own", month: "2026-11", today: NEXT_MONTH_TODAY, edits: [], recurring: [], categoryMonths: null, categories: [], pending: false, failed: false, paused: false, refetch: () => undefined };
  },
}));

describe("useProjectNextMonth (FLOW-1002)", () => {
  it("gives the overhead project the general costs, the same part the company's צפי page shows under כללי", () => {
    reads.ownEnabled.length = 0;
    const { result } = renderHook(() => useProjectNextMonth(OVERHEAD, "USD"));
    const general = companyGeneralForecast(INPUT);
    expect(general.rows.length > 0).toBe(true);
    expect(result.current.forecast).toEqual(general);
    // Its own project read stays off: the general costs come from the company's reads.
    expect(reads.ownEnabled.every((enabled) => !enabled)).toBe(true);
    // The edit page's category sheet sees the general charges as the overhead project's.
    expect(result.current.recurring.length > 0 && result.current.recurring.every((party) => party.project_id === OVERHEAD)).toBe(true);
  });

  it("gives any other project its own forecast", () => {
    reads.ownEnabled.length = 0;
    const { result } = renderHook(() => useProjectNextMonth("p1", "USD"));
    expect(result.current.forecast).toBe("own");
    expect(reads.ownEnabled.at(-1)).toBe(true);
  });
});
