import type { ProjectDetail } from "@flow/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
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

// The project's figure is in; its months are still loading.
const ready = { data: project, isPending: false, isLoading: false, isError: false, isPaused: false, fetchStatus: "idle", status: "success", refetch: vi.fn() };
const loading = { data: undefined, isPending: true, isLoading: true, isError: false, isPaused: false, fetchStatus: "fetching", status: "pending", refetch: vi.fn() };

vi.mock("../use-books", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../use-books")>()),
  useProjectQuery: () => ready,
  useProfitMonthsQuery: () => loading,
}));
vi.mock("../project-next-month-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../project-next-month-query")>()),
  useNextMonthForecast: () => ({ forecast: null, pending: true, failed: false, paused: false, month: "2026-11", edits: [], recurring: [], categoryMonths: null, categories: [], refetch: vi.fn() }),
}));

describe("ProjectProfitScreen while its months load", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("shows the figure and, after the skeleton delay, a loading skeleton where the month rows go", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={["/projects/p-test/profit"]}>
          <Routes>
            <Route path="/projects/:projectId/profit" element={<ProjectProfitScreen />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText("הוצאות שנספרות ברווח")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(400); });
    expect(screen.getByRole("status").textContent).toContain("טוען");
  });
});
