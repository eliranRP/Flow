import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { useProjectRecurringChangesQuery } from "./forecast";
import { projectAttentionRows } from "./screens/project-attention";

const PROJECT = "8c1a0b2e-1111-4000-8000-000000000001";
const LINE = "22222222-2222-4000-8000-000000000020";
const PARTY = "33333333-3333-4000-8000-000000000030";

// The project's own share of an invented rent platform: $2,000 against its usual $1,000.
const change = {
  direction: "income",
  party_id: PARTY,
  party_name: "Example Rent Platform",
  supplier_id: null,
  supplier_name: null,
  currency: "USD",
  amount_minor: 200000,
  typical_amount_minor: 100000,
  change_percent: 100,
  changed: true,
  typical_day: 5,
  transaction_id: LINE,
  project_id: PROJECT,
  project_name: "Pine Street",
  category_id: null,
  category_name: "הכנסות שכירות",
  source: "auto",
  pace: "month",
  alert_key: LINE,
  line_count: 1,
};

const rpc = vi.hoisted(() => vi.fn());

vi.mock("./lib/supabase", () => ({
  getSupabase: () => ({ rpc, auth: { getSession: () => Promise.resolve({ data: { session: { access_token: "t" } } }) } }),
}));
vi.mock("./wait-for-session", () => ({ waitForAccessToken: () => Promise.resolve() }));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
}

describe("FLOW-441: a project's changed recurring charges", () => {
  it("reads the project's own changes, not Home's", async () => {
    rpc.mockResolvedValue({ data: [change], error: null });
    const { result } = renderHook(() => useProjectRecurringChangesQuery(PROJECT), { wrapper });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(rpc).toHaveBeenCalledWith("project_recurring_changes", { p_project: PROJECT });
    expect(rpc).not.toHaveBeenCalledWith("recurring_changes", expect.anything());
    expect(result.current.data?.[0]?.amount_minor).toBe(200000n);
  });

  it("reads another company's project (null) as no changes", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() => useProjectRecurringChangesQuery(PROJECT), { wrapper });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(result.current.data).toEqual([]);
  });

  it("opens the project's line, on the project", () => {
    const rows = projectAttentionRows({
      projectId: PROJECT,
      pending: 0,
      late: [],
      changes: [{ ...change, amount_minor: 200000n, typical_amount_minor: 100000n }] as never,
      search: `?project=${PROJECT}`,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.to).toBe(`/transactions/${LINE}?project=${PROJECT}`);
  });
});
