import type { Session } from "@supabase/supabase-js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth";
import { BooksProvider } from "../use-books";
import { useSetupFacts } from "./facts";

const userId = "user-1";
const session = {
  access_token: "test",
  refresh_token: "test",
  expires_in: 3600,
  token_type: "bearer",
  user: { id: userId, aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-09-27T00:00:00Z", email: "owner@example.com" },
} satisfies Session;

const gate = vi.hoisted(() => ({
  rpc: [] as string[],
  jev: null as { provider: string } | null,
  jevError: false,
  review: [] as Array<{ id: string }>,
  reviewError: false,
}));

function chain(data: unknown, fail = false) {
  const result = fail ? { data: null, error: { message: "down" } } : { data, error: null };
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
    gate.rpc.push(name);
    if (name === "get_dashboard") {
      return Promise.resolve({
        data: {
          company_id: "company-1",
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
        },
        error: null,
      });
    }
    if (name === "sumit_status") {
      return Promise.resolve({
        data: { connected: false, sumit_company_id: null, last_sync_at: null, last_error: null },
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: null });
  },
  from: (table: string) => {
    if (table === "company_integrations") return chain(gate.jev, gate.jevError);
    if (table === "review_queue") return chain(gate.review, gate.reviewError);
    return chain(null);
  },
};

vi.mock("../lib/supabase", () => ({
  getSupabase: () => supabase,
}));

function Probe({ active = true }: { active?: boolean }) {
  const facts = useSetupFacts(active);
  return (
    <p>
      {facts.ready ? "ready" : "wait"}
      {facts.jevSaved ? ":jev" : ":nojev"}
      {facts.hasResolvedReview ? ":review" : ":noreview"}
    </p>
  );
}

function renderProbe(active = true) {
  gate.rpc.length = 0;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AuthProvider>
          <BooksProvider>
            <Probe active={active} />
          </BooksProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("setup facts", () => {
  it("does not read the dashboard when the query is off", async () => {
    renderProbe(false);
    await waitFor(() => {
      expect(screen.getByText("ready:nojev:noreview")).toBeInTheDocument();
    });
    expect(gate.rpc).not.toContain("get_dashboard");
  });

  it("counts a Jev row and a resolved review, and a failed read is not done", async () => {
    gate.jev = { provider: "jev" };
    gate.review = [{ id: "r1" }];
    gate.jevError = false;
    gate.reviewError = false;
    renderProbe();
    await waitFor(() => {
      expect(screen.getByText("ready:jev:review")).toBeInTheDocument();
    });
  });

  it("leaves Jev and the first approval open when the reads fail or are empty", async () => {
    gate.jev = null;
    gate.review = [];
    gate.jevError = true;
    gate.reviewError = true;
    renderProbe();
    await waitFor(() => {
      expect(screen.getByText("ready:nojev:noreview")).toBeInTheDocument();
    });
  });
});
