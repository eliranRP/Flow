import type { Session } from "@supabase/supabase-js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { ConnectionsScreen } from "./flow-screens";

const state = vi.hoisted(() => ({
  sumit: null as Record<string, unknown> | null,
  mercury: null as Record<string, unknown> | null,
  calls: [] as string[],
}));

const invokeEdge = vi.hoisted(() => vi.fn((_name: string, _body: Record<string, unknown>) => Promise.resolve(undefined)));

vi.mock("../edge", () => ({
  invokeEdge: (name: string, body: Record<string, unknown>) => invokeEdge(name, body),
  edgeErrorCode: () => Promise.resolve("connect_failed"),
  isRecord: (value: unknown) => typeof value === "object" && value !== null,
  isJsonReader: () => false,
}));

const dashboard = {
  company_id: "company-1",
  name: "אלפא",
  vat_registered: true,
  basis: "invoiced",
  from: null,
  to: null,
  income_agorot: 0,
  direct_agorot: 0,
  shared_agorot: 0,
  overhead_agorot: 0,
  expense_agorot: 0,
  net_profit_agorot: 0,
  prev_income_agorot: null,
  prev_expense_agorot: null,
  prev_net_agorot: null,
  active_projects: 0,
  review_count: 0,
  projects: [],
};

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    auth: {
      onAuthStateChange: (callback: (event: string, session: Session | null) => void) => {
        callback("INITIAL_SESSION", null);
        return { data: { subscription: { unsubscribe: () => undefined } } };
      },
      signOut: () => Promise.resolve({ error: null }),
    },
    rpc: (name: string) => {
      state.calls.push(name);
      if (name === "get_dashboard") return Promise.resolve({ data: dashboard, error: null });
      if (name === "list_categories") return Promise.resolve({ data: [], error: null });
      if (name === "sumit_status") return Promise.resolve({ data: state.sumit, error: null });
      return Promise.resolve({ data: null, error: null });
    },
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({
            data: table === "connector_connection_status" ? state.mercury : null,
            error: null,
          }),
        }),
      }),
    }),
  }),
}));

afterEach(() => {
  window.history.replaceState(null, "");
  invokeEdge.mockReset();
  invokeEdge.mockResolvedValue(undefined);
  state.sumit = null;
  state.mercury = null;
  state.calls = [];
});

function sumit(partial: Record<string, unknown>) {
  return {
    connected: true,
    sumit_company_id: 1001,
    last_sync_at: "2026-10-03T09:05:00.000Z",
    last_error: null,
    next_attempt_at: null,
    syncing: false,
    ...partial,
  };
}

function mercury(partial: Record<string, unknown>) {
  return {
    company_id: "company-1",
    provider: "mercury",
    connected: true,
    last_sync_at: "2026-10-03T09:05:00.000Z",
    last_error: null,
    next_attempt_at: null,
    import_from: null,
    account_labels: null,
    skip_count: 0,
    syncing: false,
    ...partial,
  };
}

function renderSettings(ui: ReactNode = <ConnectionsScreen />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <BooksProvider>
          <MemoryRouter initialEntries={["/settings"]}>
            {ui}
          </MemoryRouter>
        </BooksProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { client, ...view };
}

async function openSheet(name: "SUMIT" | "Mercury") {
  fireEvent.click(await screen.findByRole("button", { name }));
  return screen.getByRole("dialog", { name });
}

describe("refresh syncing state", () => {
  it("sends one SUMIT refresh when רענון עכשיו is tapped twice", async () => {
    state.sumit = sumit({});
    let finish: () => void = () => undefined;
    invokeEdge.mockImplementation(() => new Promise((resolve) => { finish = () => { resolve(undefined); }; }));
    renderSettings();
    const sheet = await openSheet("SUMIT");
    const refresh = within(sheet).getByRole("button", { name: "רענון עכשיו" });
    fireEvent.click(refresh);
    await waitFor(() => { expect(refresh).toHaveAttribute("aria-busy", "true"); });
    expect(refresh).toHaveAccessibleName("מרענן…");
    expect(refresh.querySelector(".ui-spinner")).not.toBeNull();
    expect(refresh.querySelector(".ui-row-chevron")).toBeNull();
    fireEvent.click(refresh);
    expect(invokeEdge).toHaveBeenCalledTimes(1);
    expect(invokeEdge.mock.calls[0]?.[0]).toBe("sumit-sync");
    finish();
    await waitFor(() => { expect(screen.getByText("הרענון הסתיים.")).toBeInTheDocument(); });
    expect(invokeEdge).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveAccessibleName("רענון עכשיו");
    expect(refresh.querySelector(".ui-spinner")).toBeNull();
  });

  it("shows a SUMIT refresh that the server is running as busy after a reload", async () => {
    state.sumit = sumit({ syncing: true });
    renderSettings();
    const sheet = await openSheet("SUMIT");
    const refresh = within(sheet).getByRole("button", { name: "מרענן…" });
    expect(refresh).toHaveAttribute("aria-busy", "true");
    expect(refresh.querySelector(".ui-spinner")).not.toBeNull();
    fireEvent.click(refresh);
    expect(invokeEdge).not.toHaveBeenCalled();
  });

  it("shows a Mercury refresh that the server is running as busy after a reload", async () => {
    state.mercury = mercury({ syncing: true });
    renderSettings();
    const sheet = await openSheet("Mercury");
    const refresh = within(sheet).getByRole("button", { name: "מרענן…" });
    expect(refresh).toHaveAttribute("aria-busy", "true");
    expect(refresh.querySelector(".ui-spinner")).not.toBeNull();
    fireEvent.click(refresh);
    expect(invokeEdge).not.toHaveBeenCalled();
  });

  it("reloads the books and says the refresh finished when the server claim clears", async () => {
    state.sumit = sumit({ syncing: true });
    const { client } = renderSettings();
    const sheet = await openSheet("SUMIT");
    const refresh = within(sheet).getByRole("button", { name: "מרענן…" });
    const dashboardReads = state.calls.filter((name) => name === "get_dashboard").length;
    state.sumit = sumit({ syncing: false, last_sync_at: "2026-10-03T09:20:00.000Z" });
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["sumit"] });
    });
    await waitFor(() => { expect(screen.getByText("הרענון הסתיים.")).toBeInTheDocument(); });
    expect(refresh).toHaveAccessibleName("רענון עכשיו");
    expect(refresh).toHaveAttribute("aria-busy", "false");
    await waitFor(() => {
      expect(state.calls.filter((name) => name === "get_dashboard").length).toBeGreaterThan(dashboardReads);
    });
    expect(invokeEdge).not.toHaveBeenCalled();
  });

  it("does not say a Mercury refresh finished when the claim clears on a failure", async () => {
    state.mercury = mercury({ syncing: true });
    const { client } = renderSettings();
    const sheet = await openSheet("Mercury");
    const refresh = within(sheet).getByRole("button", { name: "מרענן…" });
    state.mercury = mercury({ syncing: false, last_error: "transient" });
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["mercury"] });
    });
    await waitFor(() => { expect(refresh).toHaveAccessibleName("רענון עכשיו"); });
    expect(screen.queryByText("הרענון הסתיים.")).not.toBeInTheDocument();
  });
});
