import type { ProfitMonths, ProjectDetail, UnpaidRow } from "@flow/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { allTime, presetPeriod, stepPeriod, type PeriodChoice } from "../period";
import { PeriodBar } from "../ui/period-bar";
import { ToastProvider } from "../ui/toast";
import { BooksProvider } from "../use-books";
import { ProjectDetailScreen, UnpaidScreen } from "./flow-screens";
import { projectStateLine } from "./project-detail-screen";
import { ProfitMonthsScreen } from "./profit-months";

const months = vi.hoisted(() => ({ periods: [] as unknown[] }));

vi.mock("../use-books", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../use-books")>();
  return {
    ...actual,
    useProfitMonthsQuery: (projectId: string, period: unknown) => {
      months.periods.push({ projectId, period });
      return actual.useProfitMonthsQuery(projectId, period as PeriodChoice);
    },
  };
});

function wrap(children: React.ReactNode, entry = "/") {
  const client = new QueryClient();
  return (
    <QueryClientProvider client={client}>
      <BooksProvider>
        <ToastProvider>
          <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>
        </ToastProvider>
      </BooksProvider>
    </QueryClientProvider>
  );
}

function BarHarness({ start, toDateHint }: { start: PeriodChoice; toDateHint?: boolean }) {
  const [period, setPeriod] = useState(start);
  return <PeriodBar period={period} onChange={setPeriod} toDateHint={toDateHint} />;
}

describe("FLOW-335 period bar", () => {
  it("carries the ▼ after the label, which opens the period sheet", () => {
    render(wrap(<BarHarness start={presetPeriod("months3")} />));
    const label = screen.getByRole("button", { name: /בחירת תקופה/ });
    expect(label).toHaveAttribute("aria-haspopup", "dialog");
    expect(label.querySelector(".ui-pbar-caret svg")).not.toBeNull();
    expect(within(label).getByText("עד היום")).toBeInTheDocument();
  });

  it("says חזרה להיום on a stepped-back window, and the selected preset is named for it", () => {
    render(wrap(<BarHarness start={stepPeriod(presetPeriod("months3"), -1) ?? presetPeriod("months3")} />));
    const label = screen.getByRole("button", { name: /בחירת תקופה/ });
    expect(within(label).getByText("חזרה להיום")).toBeInTheDocument();
    const preset = screen.getByRole("radio", { name: "3 חודשים, חזרה להיום" });
    fireEvent.click(preset);
    // Back on the current window: the preset keeps its plain name and the hint reads עד היום.
    expect(screen.getByRole("radio", { name: "3 חודשים" })).toHaveAttribute("aria-checked", "true");
    expect(within(screen.getByRole("button", { name: /בחירת תקופה/ })).getByText("עד היום")).toBeInTheDocument();
  });

  it("leaves עד היום out where the band asks for it (the project band)", () => {
    render(wrap(<BarHarness start={presetPeriod("months3")} toDateHint={false} />));
    expect(screen.queryByText("עד היום")).not.toBeInTheDocument();
  });
});

function project(overrides: Partial<NonNullable<ProjectDetail>> = {}): NonNullable<ProjectDetail> {
  return {
    id: "p1",
    name: "פרויקט לדוגמה",
    status: "active",
    state_label: "פעיל",
    budget_agorot: null,
    income_agorot: 100_000n,
    direct_agorot: 40_000n,
    shared_agorot: 0n,
    profit_agorot: 60_000n,
    categories: [{ id: "c1", name: "חומרים", amount_agorot: 40_000n }],
    pending_count: 0,
    pending_agorot: 0n,
    transactions: [{ id: "t1", description: "שורה לדוגמה", doc_date: "2026-09-12", amount_net: -40_000n, direction: "expense", category: "חומרים" }],
    ...overrides,
  };
}

describe("FLOW-335 project band", () => {
  it("drops פעיל under the name, and keeps another state", () => {
    expect(projectStateLine({ status: "active", state_label: "פעיל" })).toBeNull();
    expect(projectStateLine({ status: "active", state_label: null })).toBeNull();
    expect(projectStateLine({ status: "finished", state_label: null })).toBe("הסתיים");
    render(wrap(<ProjectDetailScreen sample={project()} section="profit" />, "/projects/p1"));
    expect(screen.queryByText("פעיל")).not.toBeInTheDocument();
  });

  it("keeps the overhead switch in the ⋯ menu, and לפי חודש is a plain row with a chevron (FLOW-340 C, FLOW-438 cash row)", () => {
    render(wrap(<ProjectDetailScreen sample={project()} section="profit" />, "/projects/p1?period=month&at=2026-09"));
    const row = screen.getByRole("link", { name: /לפי חודש/ });
    expect(row).toHaveClass("ui-flow-line");
    expect(row.querySelector(".ui-flow-chevron")).not.toBeNull();
    expect(row.closest(".ui-banner")).toBeNull();
    expect(screen.queryByRole("switch", { name: /רווח אחרי הוצאות כלליות/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "עוד" }));
    expect(screen.getByRole("switch", { name: /רווח אחרי הוצאות כלליות/ })).toBeInTheDocument();
  });
});

describe("FLOW-337 by month is the whole project", () => {
  it("the project's row shows for a one-month period and reads the months with no dates", () => {
    months.periods.length = 0;
    render(wrap(
      <Routes>
        <Route path="/projects/:projectId" element={<ProjectDetailScreen sample={project()} section="profit" />} />
      </Routes>,
      "/projects/p1?period=month&at=2026-09",
    ));
    expect(screen.getByRole("link", { name: /לפי חודש/ })).toHaveAttribute("href", "/projects/p1/months?period=month&at=2026-09");
    for (const call of months.periods as Array<{ period: PeriodChoice }>) expect(call.period.kind).toBe("all");
  });

  const data: NonNullable<ProfitMonths> = {
    basis: "invoiced",
    from: null,
    to: null,
    project_id: "p1",
    after_overhead: false,
    months: [
      { month: "2026-09", from: "2026-09-01", to: "2026-09-30", open: false, by_currency: [{ currency: "ILS", income_minor: 100_000n, expense_minor: 40_000n, profit_minor: 60_000n }] },
    ],
    by_currency: [{ currency: "ILS", income_minor: 100_000n, expense_minor: 40_000n, profit_minor: 60_000n }],
  };

  it("asks for the months with no dates whatever the band's period", () => {
    months.periods.length = 0;
    render(wrap(
      <Routes>
        <Route path="/projects/:projectId/months" element={<ProfitMonthsScreen />} />
      </Routes>,
      "/projects/p1/months?period=months3&at=2026-09",
    ));
    expect(months.periods.length).toBeGreaterThan(0);
    for (const call of months.periods as Array<{ period: PeriodChoice }>) expect(call.period).toEqual(allTime());
  });

  it("shows the sample with the whole-project subtitle, a muted income figure, and no explainer", () => {
    render(wrap(<ProfitMonthsScreen sample={{ projectName: "פרויקט לדוגמה", data }} />, "/projects/p1/months?period=months3&at=2026-09"));
    expect(screen.getByText(/^מתחילת הפרויקט · רווח/)).toBeInTheDocument();
    expect(document.querySelector(".ui-income")).toBeNull();
    expect(document.querySelector(".ui-months-note")).toBeNull();
    // The meta is one line: only "הוצאות", and only on a month with income (#367).
    const parts = Array.from(document.querySelector(".ui-row-hint-line")?.querySelectorAll(".ui-hint-part") ?? []);
    expect(parts[0]?.textContent).toMatch(/^הוצאות /);
    expect(parts).toHaveLength(1);
  });

  it("a month with no income has no hint, since its profit already is minus the expenses (#367)", () => {
    const noIncome = { currency: "ILS", income_minor: 0n, expense_minor: 40_000n, profit_minor: -40_000n };
    const month = { month: "2026-09", from: "2026-09-01", to: "2026-09-30", open: false, by_currency: [noIncome] };
    render(wrap(<ProfitMonthsScreen sample={{ projectName: "פרויקט לדוגמה", data: { ...data, months: [month], by_currency: [noIncome] } }} />));
    expect(document.querySelector(".ui-row-hint-line")).toBeNull();
    expect(screen.queryByText(/^הכנסות /)).toBeNull();
  });

  it("an empty project says so, with no dead-end period to widen", () => {
    render(wrap(<ProfitMonthsScreen sample={{ projectName: "פרויקט לדוגמה", data: { ...data, months: [], by_currency: [] } }} />));
    expect(screen.getByText("אין עדיין חודשים עם תנועות")).toBeInTheDocument();
    expect(screen.getByText("מתחילת הפרויקט")).toBeInTheDocument();
  });
});

const unpaid: UnpaidRow[] = [
  { id: "u1", description: "חשבונית", doc_date: "2026-09-01", customer_name: "לקוח לדוגמה", project_name: null, open_gross_agorot: 50_000n, open_net_agorot: 40_000n, currency: "ILS", direction: "income", marked_paid_at: null },
];

describe("FLOW-335 Unpaid", () => {
  it("offers the SUMIT sync only once a row is marked", async () => {
    render(wrap(<UnpaidScreen sample={unpaid} />));
    expect(screen.queryByRole("button", { name: /רענון מ־SUMIT/ })).not.toBeInTheDocument();
    // FLOW-357: the mark is in the invoice's sheet.
    fireEvent.click(screen.getByRole("button", { name: /לקוח לדוגמה/ }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "לקוח לדוגמה" })).getByRole("button", { name: "סימון כשולם" }));
    const sync = screen.getByRole("button", { name: /רענון מ־SUMIT/ });
    fireEvent.click(sync);
    expect(screen.getByText("הרענון הסתיים.")).toBeInTheDocument();
  });

  it("lays the total out as a column on the start side", () => {
    // Two invoices: with one, the head is the title alone (FLOW-357).
    render(wrap(<UnpaidScreen sample={[...unpaid, { ...(unpaid[0] as UnpaidRow), id: "u2", customer_name: "לקוח נוסף" }]} />));
    const totals = document.querySelector(".ui-unpaid-totals");
    expect(totals).not.toBeNull();
    const style = getComputedStyle(totals as Element);
    expect(style.display).toBe("flex");
    expect(style.alignItems).toBe("flex-start");
  });
});
