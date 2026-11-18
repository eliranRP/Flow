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
  const currency: { data: string | undefined; isError: boolean } = { data: "USD", isError: false };
  const overhead: OverheadRead = { project: { id: "p0", name: "משרד" }, failed: false };
  return { ownEnabled: [] as boolean[], companyEnabled: [] as boolean[], own: { failed: false, paused: false }, companyCurrency: [] as string[], currency, overhead, company: { pending: false, failed: false, paused: false } };
});

vi.mock("./overhead-project", () => ({
  useOverheadProject: () => ({ ...reads.overhead, refetch: () => undefined }),
}));

vi.mock("./company-currency", () => ({
  useCompanyCurrencyQuery: () => ({ ...reads.currency, refetch: () => Promise.resolve() }),
}));

vi.mock("./company-next-month-query", () => ({
  useCompanyNextMonth: (currency: string, _today: string, enabled: boolean) => (reads.companyCurrency.push(currency), reads.companyEnabled.push(enabled), {
    forecast: null, input: enabled && !reads.company.pending ? INPUT : null, rest: null, categories: [], ...reads.company, refetch: () => Promise.resolve(),
  }),
}));

vi.mock("./project-next-month-query", () => ({
  useNextMonthForecast: (_id: string, _currency: string, _sample: unknown, enabled: boolean) => {
    reads.ownEnabled.push(enabled);
    return { forecast: "own", month: "2026-11", today: NEXT_MONTH_TODAY, edits: [], recurring: [], categoryMonths: null, categories: [], pending: false, ...reads.own, refetch: () => undefined };
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

  it("reads the general costs in the company's currency, whatever the overhead project's own currency", () => {
    reads.companyCurrency.length = 0;
    const { result } = renderHook(() => useProjectNextMonth(OVERHEAD, "ILS"));
    expect(reads.companyCurrency.every((currency) => currency === "USD")).toBe(true);
    expect(result.current.currency).toBe("USD");
    expect(result.current.forecast).toEqual(companyGeneralForecast(INPUT));
    // Any other project keeps its own currency.
    expect(renderHook(() => useProjectNextMonth("p1", "ILS")).result.current.currency).toBe("ILS");
  });

  it("waits for the company's currency, and fails rather than guess it", () => {
    reads.currency = { data: undefined, isError: false };
    const waiting = renderHook(() => useProjectNextMonth(OVERHEAD, "ILS")).result.current;
    expect(waiting.pending).toBe(true);
    expect(waiting.forecast).toBeNull();
    reads.currency = { data: undefined, isError: true };
    const failed = renderHook(() => useProjectNextMonth(OVERHEAD, "ILS")).result.current;
    expect(failed.failed).toBe(true);
    expect(failed.pending).toBe(false);
    reads.currency = { data: "USD", isError: false };
  });

  describe("FLOW-1229: the page's overhead hint starts reads early and decides nothing shown", () => {
    const pending = { project: undefined, failed: false } as const;
    const isOverhead = { project: { id: "p0", name: "משרד" }, failed: false } as const;
    const startsFor = (id: string, hint?: boolean) => {
      reads.ownEnabled.length = 0;
      reads.companyEnabled.length = 0;
      const { result } = renderHook(() => useProjectNextMonth(id, "USD", undefined, true, undefined, false, hint));
      return { result, own: reads.ownEnabled.at(-1), company: reads.companyEnabled.at(-1) };
    };

    it("a false hint starts the project's own reads while the company read is out, and the row stays loading", () => {
      reads.overhead = pending;
      const started = startsFor("p1", false);
      expect(started.own).toBe(true);
      expect(started.company).toBe(false);
      expect(started.result.current.forecast).toBeNull();
      expect(started.result.current.pending).toBe(true);
    });

    it("a true hint starts the company's reads while the company read is out, and the row stays loading", () => {
      reads.overhead = pending;
      const started = startsFor(OVERHEAD, true);
      expect(started.own).toBe(false);
      expect(started.company).toBe(true);
      expect(started.result.current.forecast).toBeNull();
      expect(started.result.current.pending).toBe(true);
    });

    it("no hint starts nothing until the company read answers, as before", () => {
      reads.overhead = pending;
      const started = startsFor("p1");
      expect(started.own).toBe(false);
      expect(started.company).toBe(false);
    });

    it("a stale not-overhead hint shows the company forecast once the answer says overhead, never the project's own figure before", () => {
      reads.overhead = pending;
      const { result, rerender } = renderHook(() => useProjectNextMonth(OVERHEAD, "USD", undefined, true, undefined, false, false));
      expect(result.current.forecast).toBeNull();
      expect(result.current.pending).toBe(true);
      reads.overhead = isOverhead;
      rerender();
      expect(result.current.forecast).toEqual(companyGeneralForecast(INPUT));
      expect(result.current.forecast).not.toBe("own");
      // The own reads the stale hint started are off again, and the company's are on.
      expect(reads.ownEnabled.at(-1)).toBe(false);
      expect(reads.companyEnabled.at(-1)).toBe(true);
    });

    it("while the answer is out, the early own reads' failure and pause are not reported: the row stays loading", () => {
      reads.overhead = pending;
      for (const state of [{ failed: true, paused: false }, { failed: false, paused: true }]) {
        reads.own = state;
        const { result } = startsFor("p1", false);
        expect(result.current.pending).toBe(true);
        expect(result.current.failed).toBe(false);
        expect(result.current.paused).toBe(false);
        expect(result.current.forecast).toBeNull();
      }
      reads.own = { failed: false, paused: false };
    });

    it("a shared read already in a cached error shows it when the overhead answer lands, not while it is out", () => {
      // The mocked own forecast stands for the reads it shares (the overrides, the company's categories).
      reads.own = { failed: true, paused: false };
      reads.overhead = pending;
      const { result, rerender } = renderHook(() => useProjectNextMonth("p1", "USD", undefined, true, undefined, false, false));
      expect(result.current.pending).toBe(true);
      expect(result.current.failed).toBe(false);
      reads.overhead = { project: null, failed: false };
      rerender();
      expect(result.current.failed).toBe(true);
      expect(result.current.pending).toBe(false);
      reads.own = { failed: false, paused: false };
    });

    it("a failed company read falls back to the project's own forecast whatever the hint, starting its reads then", () => {
      reads.overhead = { project: undefined, failed: true };
      expect(startsFor(OVERHEAD, true).result.current.forecast).toBe("own");
      expect(reads.ownEnabled.at(-1)).toBe(true);
      expect(startsFor(OVERHEAD, false).result.current.forecast).toBe("own");
    });

    it("the company read's answer decides, whatever the hint", () => {
      reads.overhead = { project: null, failed: false };
      expect(startsFor("p1", true).result.current.forecast).toBe("own");
      reads.overhead = isOverhead;
    });
  });

  it("gives any other project its own forecast", () => {
    reads.ownEnabled.length = 0;
    const { result } = renderHook(() => useProjectNextMonth("p1", "USD"));
    expect(result.current.forecast).toBe("own");
    expect(reads.ownEnabled.at(-1)).toBe(true);
  });
});
