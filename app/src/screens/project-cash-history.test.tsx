import type { MissingBill, RecurringChange } from "@flow/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_MISSING_BILLS, SAMPLE_MISSING_INCOME, SAMPLE_RECURRING_CHANGES } from "../forecast-sample";
import { israelToday } from "../ui/date-math";
import { BooksProvider } from "../use-books";
import { projectAttentionRows } from "./project-attention";
import { ProjectCashMonthScreen } from "./project-cash-screens";
import { ProjectCashHistoryScreen, ProjectCashYearScreen } from "./project-cash-history";

const rpc = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; args: unknown }>,
  impl: (_name: string, _args?: unknown): Promise<{ data: unknown; error: { message: string } | null }> =>
    Promise.resolve({ data: null, error: null }),
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args?: unknown) => {
      rpc.calls.push({ name, args });
      return rpc.impl(name, args);
    },
  }),
}));

const thisYear = Number(israelToday().slice(0, 4));
const lastYear = thisYear - 1;
const total = (inMinor: number, outMinor: number) => ({ currency: "ILS", in_minor: inMinor, out_minor: outMinor, net_minor: inMinor - outMinor });

// Invented figures only.
const years = {
  project_name: "Cedar Ave 410",
  basis: "paid",
  base_currency: "ILS",
  this_month: `${israelToday().slice(0, 7)}-01`,
  first_month: `${String(lastYear)}-03-01`,
  by_currency: [total(900_000, 400_000)],
  years: [
    { year: thisYear, by_currency: [total(500_000, 100_000)] },
    { year: lastYear, by_currency: [total(400_000, 300_000)] },
  ],
};

function monthRow(month: string, inMinor: number, outMinor: number) {
  return {
    month,
    by_currency: [{ ...total(inMinor, outMinor), profit_minor: 0, excluded_count: 0, excluded_in_minor: 0, excluded_out_minor: 0 }],
  };
}

const yearMonths = {
  basis: "paid",
  base_currency: "ILS",
  months: [monthRow(`${String(lastYear)}-12-01`, 300_000, 100_000), monthRow(`${String(lastYear)}-03-01`, 100_000, 200_000), monthRow(`${String(lastYear)}-02-01`, 0, 0)],
};

const recent = { basis: "paid", base_currency: "ILS", months: [monthRow(`${israelToday().slice(0, 7)}-01`, 0, 0)] };

function wrap(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BooksProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/projects/:projectId/cash/history" element={<ProjectCashHistoryScreen />} />
            <Route path="/projects/:projectId/cash/year/:year" element={<ProjectCashYearScreen />} />
            <Route path="/projects/:projectId/cash/:month" element={<ProjectCashMonthScreen />} />
            <Route path="/projects/:projectId" element={<p>פרויקט</p>} />
          </Routes>
        </MemoryRouter>
      </BooksProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  rpc.calls = [];
  rpc.impl = (name) => {
    if (name === "project_cash_years") return Promise.resolve({ data: years, error: null });
    if (name === "project_cash_year_months") return Promise.resolve({ data: yearMonths, error: null });
    if (name === "project_cash_months") return Promise.resolve({ data: recent, error: null });
    return Promise.resolve({ data: null, error: null });
  };
});

describe("Project cash history (the project page like Home)", () => {
  it("shows the project's net since its first month, then a row per year opening the project's year", async () => {
    wrap("/projects/p1/cash/history");
    expect(await screen.findByText(`תזרים מאז מרץ ${String(lastYear)}`)).toBeInTheDocument();
    expect(screen.getByText("Cedar Ave 410")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: `תזרים ${String(lastYear)} ₪1,000` })).toHaveAttribute("href", `/projects/p1/cash/year/${String(lastYear)}`);
    expect(rpc.calls).toEqual([{ name: "project_cash_years", args: { p_project: "p1" } }]);
  });

  it("shows a year's months from the first cash month, each opening the project's month", async () => {
    wrap(`/projects/p1/cash/year/${String(lastYear)}`);
    expect(await screen.findByRole("link", { name: `תזרים מרץ ${String(lastYear)} −₪1,000` })).toHaveAttribute("href", `/projects/p1/cash/${String(lastYear)}-03`);
    expect(rpc.calls.find((c) => c.name === "project_cash_year_months")?.args).toEqual({ p_project: "p1", p_year: lastYear });
    expect(screen.getByText("Cedar Ave 410")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^תזרים פברואר/ })).toBeNull();
  });

  it("sends a year after this one to the history without a year read", async () => {
    wrap(`/projects/p1/cash/year/${String(thisYear + 1)}`);
    expect(await screen.findByText(`תזרים מאז מרץ ${String(lastYear)}`)).toBeInTheDocument();
    expect(rpc.calls.some((c) => c.name === "project_cash_year_months")).toBe(false);
  });

  it("opens an older month from its year's months", async () => {
    wrap(`/projects/p1/cash/${String(lastYear)}-03`);
    expect(await screen.findByLabelText(/^נכנס ב/)).toBeInTheDocument();
    expect(rpc.calls.find((c) => c.name === "project_cash_year_months")?.args).toEqual({ p_project: "p1", p_year: lastYear });
  });

  it("sends a signed-out read back to the project", async () => {
    rpc.impl = () => Promise.resolve({ data: null, error: null });
    wrap("/projects/p1/cash/history");
    expect(await screen.findByText("פרויקט")).toBeInTheDocument();
  });
});

describe("projectAttentionRows", () => {
  const late: MissingBill[] = [...SAMPLE_MISSING_BILLS, SAMPLE_MISSING_INCOME];
  const changes: RecurringChange[] = SAMPLE_RECURRING_CHANGES;

  it("counts only the project's alerts, and the review row opens the project's queue", () => {
    const rows = projectAttentionRows({ projectId: "p1", pending: 2, late, changes, search: "" });
    expect(rows.map((row) => row.id)).toEqual(["review", "missing", "missing-income", "change:t-power-oct"]);
    expect(rows[0]?.to).toBe("/review?project=p1");
    expect(rows[1]?.title).toBe("חשבון אחד לא הגיע");
  });

  it("shows nothing for a project with no alerts", () => {
    expect(projectAttentionRows({ projectId: "p9", pending: 0, late, changes, search: "" })).toEqual([]);
  });
});
