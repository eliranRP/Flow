import type { Session } from "@supabase/supabase-js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth";
import { ToastProvider } from "../ui/toast";
import { BooksProvider } from "../use-books";
import { SetupHomeSlot } from "./home";
import { resetSetupServerForTests } from "./server-store";
import { emptySetupStore, readSetupStore, writeSetupStore } from "./storage";

const userId = "user-1";
const companyId = "company-1";
const session = {
  access_token: "test",
  refresh_token: "test",
  expires_in: 3600,
  token_type: "bearer",
  user: { id: userId, aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-09-27T00:00:00Z", email: "owner@example.com" },
} satisfies Session;

const gate = vi.hoisted(() => ({
  sumit: false,
  jev: false,
  review: false,
  setupRow: null as { state: unknown } | null,
  upserts: [] as unknown[],
}));

const dashboard = {
  company_id: companyId,
  name: "אלפא",
  vat_registered: true,
  basis: "invoiced" as const,
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

function chain(data: unknown) {
  const result = { data, error: null };
  const next = {
    select: () => next,
    eq: () => next,
    in: () => next,
    limit: () => next,
    maybeSingle: () => Promise.resolve(result),
    then: (onFulfilled: (value: typeof result) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return next;
}

const supabase = {
  auth: {
    onAuthStateChange: (callback: (event: string, next: Session | null) => void) => {
      callback("INITIAL_SESSION", session);
      return { data: { subscription: { unsubscribe: () => undefined } } };
    },
  },
  rpc: (name: string) => {
    if (name === "get_dashboard") return Promise.resolve({ data: dashboard, error: null });
    if (name === "sumit_status") {
      return Promise.resolve({
        data: { connected: gate.sumit, sumit_company_id: null, last_sync_at: null, last_error: null },
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: null });
  },
  from: (table: string) => {
    if (table === "companies") return chain({ owner_id: userId });
    if (table === "company_integrations") return chain(gate.jev ? { provider: "jev" } : null);
    if (table === "review_queue") return chain(gate.review ? [{ id: "r1" }] : []);
    if (table === "setup_states") {
      // Answers after the facts, as a slow network would.
      const row = gate.setupRow;
      const slow = {
        select: () => slow,
        eq: () => slow,
        upsert: (value: unknown) => {
          gate.upserts.push(value);
          return Promise.resolve({ data: null, error: null });
        },
        maybeSingle: () => new Promise((resolve) => setTimeout(() => { resolve({ data: row, error: null }); }, 150)),
      };
      return slow;
    }
    return chain(null);
  },
};

vi.mock("../lib/supabase", () => ({
  getSupabase: () => supabase,
}));

function renderHome() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>
          <AuthProvider>
            <BooksProvider>
              <SetupHomeSlot emptyHome={false} />
            </BooksProvider>
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("setup home card", () => {
  afterEach(() => {
    localStorage.clear();
    gate.sumit = false;
    gate.jev = false;
    gate.review = false;
    gate.setupRow = null;
    gate.upserts = [];
    resetSetupServerForTests();
  });


  it("keeps a dismissed card hidden", async () => {
    writeSetupStore(userId, companyId, {
      ...emptySetupStore(),
      run_started_at: "2026-10-04T00:00:00.000Z",
      card_dismissed_at: "2026-10-04T00:00:00.000Z",
    });
    renderHome();
    await waitFor(() => {
      expect(readSetupStore(userId, companyId).card_dismissed_at).not.toBeNull();
    });
    expect(screen.queryByRole("button", { name: "סגירת ההגדרה" })).not.toBeInTheDocument();
  });


});
