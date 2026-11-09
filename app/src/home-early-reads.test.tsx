import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CASH_MONTHS } from "./cash";
import { startHomeReads } from "./home-early-reads";
import { defaultPeriod } from "./period";
import { BooksProvider, useDashboardQuery } from "./use-books";
import { useCashMonthsQuery } from "./use-cash";

const db = vi.hoisted(() => ({
  session: true,
  calls: [] as Array<{ name: string; args: unknown }>,
  sessionReads: 0,
}));

vi.mock("./lib/supabase", () => ({
  getSupabase: () => ({
    auth: {
      getSession: () => {
        db.sessionReads += 1;
        return Promise.resolve({ data: { session: db.session ? { access_token: "t" } : null } });
      },
    },
    rpc: (name: string, args?: unknown) => {
      db.calls.push({ name, args });
      return Promise.resolve({ data: { read: name }, error: null });
    },
  }),
}));

vi.mock("./wait-for-session", () => ({ waitForAccessToken: () => Promise.resolve() }));

vi.mock("./load-read-schemas", () => ({
  loadReadSchemas: () => Promise.resolve({
    dashboardSchema: { parse: (data: unknown) => data },
    cashMonthsSchema: { parse: (data: unknown) => data },
  }),
}));

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } });
}

async function settled(queryClient: QueryClient) {
  await waitFor(() => {
    expect(queryClient.isFetching()).toBe(0);
  });
}

beforeEach(() => {
  db.session = true;
  db.calls = [];
  db.sessionReads = 0;
});

describe("startHomeReads (FLOW-1115)", () => {
  it("sends Home's cash months and P&L reads on a cold start on Home with a session", async () => {
    const queryClient = client();
    startHomeReads(queryClient, { pathname: "/", search: "" });
    await waitFor(() => {
      expect(db.calls).toHaveLength(2);
    });
    await settled(queryClient);
    expect(db.calls).toEqual(expect.arrayContaining([
      { name: "cash_months", args: { p_months: CASH_MONTHS } },
      expect.objectContaining({ name: "get_dashboard" }),
    ]));
    expect(queryClient.getQueryData(["dashboard", "cash-months", "off", CASH_MONTHS])).toEqual({ read: "cash_months" });
    expect(queryClient.getQueryData(["dashboard", "off", defaultPeriod()])).toEqual({ read: "get_dashboard" });
  });

  it("Home's own queries pick the early reads up and send none of their own", async () => {
    const queryClient = client();
    startHomeReads(queryClient, { pathname: "/", search: "" });
    await waitFor(() => {
      expect(db.calls).toHaveLength(2);
    });
    await settled(queryClient);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/"]}>
          <BooksProvider>{children}</BooksProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
    const { result } = renderHook(() => ({ cash: useCashMonthsQuery(), dashboard: useDashboardQuery() }), { wrapper });
    await waitFor(() => {
      expect(result.current.cash.data).toEqual({ read: "cash_months" });
    });
    expect(result.current.dashboard.data).toEqual({ read: "get_dashboard" });
    expect(db.calls).toHaveLength(2);
  });

  it("reads nothing off Home, in a preview, or without a session", async () => {
    startHomeReads(client(), { pathname: "/projects", search: "" });
    startHomeReads(client(), { pathname: "/", search: "?preview=loading" });
    expect(db.sessionReads).toBe(0);
    db.session = false;
    startHomeReads(client(), { pathname: "/", search: "" });
    await waitFor(() => {
      expect(db.sessionReads).toBe(1);
    });
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(db.calls).toEqual([]);
  });
});
