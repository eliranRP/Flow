import type { ProfitMonths, ProjectDetail } from "@flow/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectProfitScreen } from "./project-profit-screen";

const project = {
  id: "p-test",
  name: "Test Ct",
  status: "active",
  state_label: "פעיל",
  base_currency: "USD",
  by_currency: [{ currency: "USD", income_minor: 1_000_000n, direct_minor: 600_000n, shared_minor: 0n, profit_minor: 400_000n }],
  categories: [],
  transactions: [],
} as unknown as NonNullable<ProjectDetail>;

const loadedMonths = {
  basis: "cash",
  from: "2026-09-01",
  to: "2026-10-31",
  months: [
    { month: "2026-10", from: "2026-10-01", to: "2026-10-31", open: true, by_currency: [{ currency: "USD", income_minor: 500_000n, expense_minor: -300_000n, profit_minor: 200_000n }] },
    { month: "2026-09", from: "2026-09-01", to: "2026-09-30", open: false, by_currency: [{ currency: "USD", income_minor: 500_000n, expense_minor: -300_000n, profit_minor: 200_000n }] },
  ],
} as unknown as NonNullable<ProfitMonths>;

const ready = { data: project, isPending: false, isLoading: false, isError: false, isPaused: false, fetchStatus: "idle", status: "success", refetch: vi.fn() };
const forecastBase = { forecast: null, failed: false, month: "2026-11", edits: [], recurring: [], categoryMonths: null, categories: [], refetch: vi.fn() };

// Each case sets what the months read and the forecast reads return.
const state = vi.hoisted((): { months: object; forecast: object } => ({ months: {}, forecast: {} }));

vi.mock("../use-books", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../use-books")>()),
  useProjectQuery: () => ready,
  useProfitMonthsQuery: () => state.months,
}));
vi.mock("../project-next-month-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../project-next-month-query")>()),
  useNextMonthForecast: () => state.forecast,
}));

function renderScreen() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/projects/p-test/profit"]}>
        <Routes>
          <Route path="/projects/:projectId/profit" element={<ProjectProfitScreen />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ProjectProfitScreen while its months and forecast load", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("shows the month rows, with no skeleton, when the months are in and the forecast reads are paused offline", () => {
    state.months = { ...ready, data: loadedMonths };
    state.forecast = { ...forecastBase, pending: true, paused: true };
    renderScreen();
    act(() => { vi.advanceTimersByTime(400); });
    expect(screen.getByText("אוקטובר · עד היום")).toBeTruthy();
    expect(screen.getByText("ספטמבר")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    expect(document.querySelector("[aria-busy]")).toBeNull();
  });

  it("shows the figure and, after the skeleton delay, a loading skeleton where the month rows go", () => {
    state.months = { data: undefined, isPending: true, isLoading: true, isError: false, isPaused: false, fetchStatus: "fetching", status: "pending", refetch: vi.fn() };
    state.forecast = { ...forecastBase, pending: true, paused: false };
    renderScreen();
    expect(screen.getByText("הוצאות שנספרות ברווח")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(400); });
    expect(screen.getByRole("status").textContent).toContain("טוען");
  });

  it("shows a failure line whose retry reads the months again when they fail", () => {
    const refetch = vi.fn();
    state.months = { data: undefined, isPending: false, isLoading: false, isError: true, isPaused: false, fetchStatus: "idle", status: "error", refetch };
    state.forecast = { ...forecastBase, pending: false, paused: false };
    renderScreen();
    expect(screen.getByRole("status").textContent).toContain("לא הצלחנו לטעון");
    fireEvent.click(screen.getByRole("button", { name: "נסו שוב" }));
    expect(refetch).toHaveBeenCalledOnce();
  });
});
