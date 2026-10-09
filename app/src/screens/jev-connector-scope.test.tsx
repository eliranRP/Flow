import type { Session } from "@supabase/supabase-js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReviewRow } from "@flow/shared";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth";
import { defaultPeriod } from "../period";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { ReviewQueue, SettingsScreen } from "./flow-screens";
import {
  bindJevConnectorScope,
  boundJevConnectorScope,
  jevConnectorQueryKey,
  jevConnectorStorageKey,
  readJevConnectorFlag,
  writeJevConnectorFlag,
} from "./jev-review";

const scope = { userId: "user-1", companyId: "company-1" };

const session = {
  access_token: "test",
  refresh_token: "test",
  expires_in: 3600,
  token_type: "bearer",
  user: {
    id: scope.userId,
    aud: "authenticated",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-09-27T00:00:00Z",
    email: "owner@example.com",
  },
} satisfies Session;

const dashboard = {
  company_id: scope.companyId,
  name: "אלפא",
  vat_registered: true,
  basis: "invoiced",
  from: "2026-10-01",
  to: "2026-10-04",
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

const rpc = vi.hoisted(() => ({
  impl: (_name: string): Promise<{ data: unknown; error: null }> => Promise.resolve({ data: null, error: null }),
}));

function table(data: unknown = null) {
  const result = { data, error: null };
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: () => Promise.resolve(result),
    then: (
      onFulfilled: (value: typeof result) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return chain;
}

const supabase = {
  auth: {
    onAuthStateChange: (callback: (event: string, next: Session | null) => void) => {
      callback("INITIAL_SESSION", session);
      return { data: { subscription: { unsubscribe: () => undefined } } };
    },
    signOut: () => Promise.resolve({ error: null }),
  },
  rpc: (name: string) => rpc.impl(name),
  from: () => table(),
  functions: {
    invoke: () => Promise.resolve({ data: { state: "empty" }, error: null }),
  },
};

vi.mock("../lib/supabase", () => ({
  getSupabase: () => supabase,
}));

const open: ReviewRow = {
  id: "r1",
  transaction_id: "t1",
  description: "חומרי בניין",
  doc_date: "2026-04-12",
  amount_net: -2_200_000n,
  direction: "expense",
  reason: null,
  project_id: null,
  category_id: null,
  supplier_name: "חומרי בניין לדוגמה בע״מ",
  project_name: null,
  category_name: null,
  project_suggested: false,
  category_suggested: false,
};

function renderSettings(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <AuthProvider>
          <BooksProvider>
            <MemoryRouter initialEntries={["/settings"]}>
              <SettingsScreen />
            </MemoryRouter>
          </BooksProvider>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("Jev connector scope", () => {
  afterEach(() => {
    bindJevConnectorScope(null);
    localStorage.removeItem(jevConnectorStorageKey(scope));
    localStorage.removeItem("flow.jev-connector");
  });

  it("binds the scope from settings when the session and the dashboard company are both present", async () => {
    bindJevConnectorScope(null);
    rpc.impl = (name) => {
      if (name === "get_dashboard") return Promise.resolve({ data: dashboard, error: null });
      if (name === "sumit_status") {
        return Promise.resolve({
          data: { connected: false, sumit_company_id: null, last_sync_at: null, last_error: null },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    };
    renderSettings(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
    await waitFor(() => {
      expect(boundJevConnectorScope()).toEqual(scope);
    });
  });

  it("binds the scope from the review queue when the dashboard is already cached", async () => {
    bindJevConnectorScope(null);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["dashboard", "off", defaultPeriod()], { company_id: scope.companyId });
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <AuthProvider>
            <BooksProvider>
              <MemoryRouter>
                <ReviewQueue rows={[open]} search="" />
              </MemoryRouter>
            </BooksProvider>
          </AuthProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(boundJevConnectorScope()).toEqual(scope);
    });
  });

  it("drops the stored flag and the connector cache when settings signs out", async () => {
    bindJevConnectorScope(scope);
    writeJevConnectorFlag(true, scope);
    rpc.impl = (name) => {
      if (name === "get_dashboard") return Promise.resolve({ data: dashboard, error: null });
      if (name === "sumit_status") {
        return Promise.resolve({
          data: { connected: false, sumit_company_id: null, last_sync_at: null, last_error: null },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(jevConnectorQueryKey(scope), true);
    renderSettings(client);
    fireEvent.click(await screen.findByRole("button", { name: "התנתקות" }));
    await waitFor(() => {
      expect(readJevConnectorFlag(scope)).toBeUndefined();
      expect(client.getQueryData(jevConnectorQueryKey(scope))).toBeUndefined();
    });
  });
});
