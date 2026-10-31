import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { companyGeneralForecast, companyNextMonthForecast, type CompanyForecastInput } from "./company-next-month";
import { COMPANY_NEXT_READS } from "./dev/company-next-month-sample";
import { NEXT_MONTH_TODAY } from "./dev/home-next-month-sample";
import { useProjectNextMonth } from "./next-month-for-project";

const OVERHEAD = "p0";
const INPUT: CompanyForecastInput = { currency: "USD", today: NEXT_MONTH_TODAY, recurring: COMPANY_NEXT_READS.recurring, loans: COMPANY_NEXT_READS.loans, categories: COMPANY_NEXT_READS.categories, inputs: { ...COMPANY_NEXT_READS.inputs, overhead_project_id: OVERHEAD } };

type OverheadRead = { project: { id: string; name: string } | null | undefined; failed: boolean };

const reads = vi.hoisted(() => {
  const overhead: OverheadRead = { project: { id: "p0", name: "משרד" }, failed: false };
  return { ownEnabled: [] as boolean[], overhead, company: { pending: false, failed: false, paused: false } };
});

vi.mock("./overhead-project", () => ({
  useOverheadProject: () => ({ ...reads.overhead, refetch: () => undefined }),
}));

vi.mock("./company-next-month-query", () => ({
  useCompanyNextMonth: (_currency: string, _today: string, enabled: boolean) => ({
    forecast: null, input: enabled && !reads.company.pending ? INPUT : null, rest: null, categories: [], ...reads.company, refetch: () => Promise.resolve(),
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
    // The general part is the company's כללי: the same rows the company forecast lists with no project.
    expect(general.rows.map((row) => row.key)).toEqual(companyNextMonthForecast(INPUT).rows.filter((row) => row.projectId == null).map((row) => row.key));
    expect(result.current.forecast).toEqual(general);
    // Its own project read stays off: the general costs come from the company's reads.
    expect(reads.ownEnabled.every((enabled) => !enabled)).toBe(true);
    // The edit page's category sheet sees the general charges as the overhead project's.
    expect(result.current.recurring.length > 0 && result.current.recurring.every((party) => party.project_id === OVERHEAD)).toBe(true);
  });

  it("gives the edit page's history the six months before this one", () => {
    const { result } = renderHook(() => useProjectNextMonth(OVERHEAD, "USD"));
    expect(result.current.categoryMonths?.months).toEqual(["2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01"]);
  });

  it("waits while the overhead project is unknown, and passes the company reads' states through", () => {
    reads.overhead = { project: undefined, failed: false };
    const waiting = renderHook(() => useProjectNextMonth(OVERHEAD, "USD"));
    expect(waiting.result.current.pending).toBe(true);
    expect(waiting.result.current.forecast).toBeNull();
    reads.overhead = { project: { id: "p0", name: "משרד" }, failed: false };
    reads.company = { pending: true, failed: false, paused: false };
    expect(renderHook(() => useProjectNextMonth(OVERHEAD, "USD")).result.current.pending).toBe(true);
    reads.company = { pending: false, failed: true, paused: false };
    expect(renderHook(() => useProjectNextMonth(OVERHEAD, "USD")).result.current.failed).toBe(true);
    reads.company = { pending: false, failed: false, paused: true };
    expect(renderHook(() => useProjectNextMonth(OVERHEAD, "USD")).result.current.paused).toBe(true);
    reads.company = { pending: false, failed: false, paused: false };
  });

  it("falls back to each project's own forecast when the overhead read fails, or the company has none", () => {
    reads.overhead = { project: undefined, failed: true };
    expect(renderHook(() => useProjectNextMonth(OVERHEAD, "USD")).result.current.forecast).toBe("own");
    reads.overhead = { project: null, failed: false };
    expect(renderHook(() => useProjectNextMonth(OVERHEAD, "USD")).result.current.forecast).toBe("own");
    reads.overhead = { project: { id: "p0", name: "משרד" }, failed: false };
  });

  it("gives any other project its own forecast", () => {
    reads.ownEnabled.length = 0;
    const { result } = renderHook(() => useProjectNextMonth("p1", "USD"));
    expect(result.current.forecast).toBe("own");
    expect(reads.ownEnabled.at(-1)).toBe(true);
  });
});
