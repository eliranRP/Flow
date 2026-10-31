import type { ProfitMonths, ProjectDetail } from "@flow/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { JUNIPER_NEXT } from "../dev/project-next-month-sample";
import { ProjectProfitScreen } from "./project-profit-screen";

// FLOW-1002: the overhead project's next month is the company's general costs, in the company's currency.
vi.mock("../next-month-for-project", async () => {
  const query = await import("../project-next-month-query");
  return {
    useProjectNextMonth: (id: string, currency: string, sample: Parameters<typeof query.useNextMonthForecast>[2], enabled?: boolean) =>
      ({ ...query.useNextMonthForecast(id, currency, sample, enabled), currency: "ILS" }),
  };
});

const project = {
  id: "p-test", name: "Test Ct", status: "active", state_label: "פעיל", base_currency: "USD",
  by_currency: [{ currency: "USD", income_minor: 1_000_000n, direct_minor: 600_000n, shared_minor: 0n, profit_minor: 400_000n }],
  categories: [], transactions: [],
} as unknown as NonNullable<ProjectDetail>;

const months: NonNullable<ProfitMonths> = {
  basis: "cash", from: "2026-09-01", to: "2026-10-16", project_id: "p-test", after_overhead: true, base_currency: "USD",
  months: [
    { month: "2026-10", from: "2026-10-01", to: "2026-10-16", open: true, by_currency: [{ currency: "USD", income_minor: 1_000_000n, expense_minor: 600_000n, profit_minor: 400_000n }] },
    { month: "2026-09", from: "2026-09-01", to: "2026-09-30", open: false, by_currency: [{ currency: "USD", income_minor: 500_000n, expense_minor: 700_000n, profit_minor: -200_000n }] },
  ],
  by_currency: [{ currency: "USD", income_minor: 1_000_000n, expense_minor: 600_000n, profit_minor: 400_000n }],
};

describe("ProjectProfitScreen, overhead project in another currency (FLOW-1002)", () => {
  it("shows the card in the forecast's currency with no history beside it, and the months in the project's", () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={["/projects/p-test/profit"]}>
          <Routes><Route path="/projects/:projectId/profit" element={<ProjectProfitScreen sample={{ project, months, next: JUNIPER_NEXT }} />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const card = container.querySelector(".ui-fc-block");
    expect(card?.textContent).toContain("₪");
    expect(card?.textContent).not.toContain("$");
    // No "מול ₪0 בספטמבר" and no chart: the project's September is in dollars.
    expect(card?.textContent).not.toContain("מול");
    expect(container.querySelector(".ui-fc-chart-title")).toBeNull();
    const rows = Array.from(container.querySelectorAll(".ui-row-title")).map((row) => row.closest("li, a, div")?.textContent ?? "");
    expect(rows.length).toBe(2);
    expect(rows.every((row) => row.includes("$") && !row.includes("₪"))).toBe(true);
  });
});
