import type { ProjectDetail, UnpaidRow } from "@flow/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { allTime, type PeriodChoice } from "../period";
import { ToastProvider } from "../ui/toast";
import { BooksProvider } from "../use-books";
import { ProjectDetailScreen, UnpaidScreen } from "./flow-screens";
import { projectStateLine } from "./project-detail-screen";
import { ProjectProfitScreen } from "./project-profit-screen";

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
    render(wrap(<ProjectDetailScreen sample={project()} />, "/projects/p1"));
    expect(screen.queryByText("פעיל")).not.toBeInTheDocument();
  });

  it("keeps the overhead switch in the edit sheet (from the ⋯ menu), not on the page (FLOW-340 C)", () => {
    render(wrap(<ProjectDetailScreen sample={project()} />, "/projects/p1?period=month&at=2026-09"));
    expect(screen.queryByRole("switch", { name: /רווח אחרי הוצאות כלליות/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "עוד" }));
    fireEvent.click(screen.getByRole("button", { name: /עריכת פרטים/ }));
    expect(screen.getByRole("switch", { name: /רווח אחרי הוצאות כלליות/ })).toBeInTheDocument();
  });
});

describe("FLOW-337 the project's months are the whole project", () => {
  it("asks for the months with no dates whatever the link's period", () => {
    months.periods.length = 0;
    render(wrap(
      <Routes>
        <Route path="/projects/:projectId/profit" element={<ProjectProfitScreen />} />
      </Routes>,
      "/projects/p1/profit?period=months3&at=2026-09",
    ));
    expect(months.periods.length).toBeGreaterThan(0);
    for (const call of months.periods as Array<{ period: PeriodChoice }>) expect(call.period).toEqual(allTime());
  });
});

const unpaid: UnpaidRow[] = [
  { id: "u1", description: "חשבונית", doc_date: "2026-09-01", customer_name: "לקוח לדוגמה", project_name: null, open_gross_agorot: 50_000n, open_net_agorot: 40_000n, currency: "ILS", direction: "income", marked_paid_at: null },
];

describe("FLOW-335 Unpaid", () => {
  it("offers the SUMIT refresh on the list, and it reports the sync", () => {
    render(wrap(<UnpaidScreen sample={unpaid} />));
    const refresh = screen.getByRole("button", { name: /רענון מ־SUMIT/ });
    fireEvent.click(refresh);
    expect(screen.getByText("הרענון הסתיים.")).toBeInTheDocument();
  });

  it("shows the open total as money in (green, no plus, as on the board) above the list", () => {
    render(wrap(<UnpaidScreen sample={[...unpaid, { ...(unpaid[0] as UnpaidRow), id: "u2", customer_name: "לקוח נוסף" }]} />));
    const total = document.querySelector(".ui-inv-total");
    expect(total).not.toBeNull();
    expect(total?.textContent).not.toContain("+");
    expect(total?.querySelector(".ui-income")).not.toBeNull();
  });
});
