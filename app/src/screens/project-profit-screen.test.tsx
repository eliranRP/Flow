import type { ProfitMonths, ProjectDetail } from "@flow/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ProjectProfitScreen, type ProjectProfitSample } from "./project-profit-screen";

const base = {
  id: "p-test",
  name: "Test Ct",
  status: "active",
  state_label: "פעיל",
  base_currency: "USD",
  by_currency: [{ currency: "USD", income_minor: 1_000_000n, direct_minor: 600_000n, shared_minor: 0n, profit_minor: 400_000n }],
  transactions: [],
} as unknown as NonNullable<ProjectDetail>;

const months: NonNullable<ProfitMonths> = {
  basis: "cash",
  from: "2026-09-01",
  to: "2026-10-16",
  project_id: "p-test",
  after_overhead: true,
  base_currency: "USD",
  months: [
    { month: "2026-10", from: "2026-10-01", to: "2026-10-16", open: true, by_currency: [{ currency: "USD", income_minor: 1_000_000n, expense_minor: 600_000n, profit_minor: 400_000n }] },
  ],
  by_currency: [{ currency: "USD", income_minor: 1_000_000n, expense_minor: 600_000n, profit_minor: 400_000n }],
};

function renderScreen(sample: ProjectProfitSample) {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/projects/p-test/profit"]}>
        <Routes>
          <Route path="/projects/:projectId/profit" element={<ProjectProfitScreen sample={sample} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ProjectProfitScreen", () => {
  it("shows the after-overhead rows when the project has a share", () => {
    renderScreen({ project: { ...base, overhead_weighted: true, overhead_share_minor: 100_000n }, months });
    expect(screen.getByText("חלק בהוצאות הכלליות")).toBeTruthy();
    expect(screen.getByText("רווח אחרי הוצאות כלליות")).toBeTruthy();
  });

  it("hides the after-overhead rows and their note when the project has no weighted share", () => {
    renderScreen({ project: { ...base, overhead_weighted: false, overhead_share_minor: null }, months });
    expect(screen.queryByText("חלק בהוצאות הכלליות")).toBeNull();
    expect(screen.queryByText("רווח אחרי הוצאות כלליות")).toBeNull();
    expect(screen.queryByText(/ההוצאות הכלליות מתחלקות/)).toBeNull();
  });

  it("lists one row per month, newest first, with the month's income and expenses", () => {
    renderScreen({ project: { ...base, overhead_weighted: false, overhead_share_minor: null }, months });
    expect(screen.getByText("אוקטובר · עד היום")).toBeTruthy();
    expect(screen.getByText(/הכנסות \$10,000 · הוצאות \$6,000/)).toBeTruthy();
  });
});
