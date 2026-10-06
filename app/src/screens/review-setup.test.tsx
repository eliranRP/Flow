import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Session } from "@supabase/supabase-js";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { SAMPLE_TOAST } from "../setup/copy";
import { ReviewScreen } from "./flow-screens";

const gate = vi.hoisted(() => ({ owner: "11111111-1111-1111-1111-111111111111" }));

const rpc = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; args?: unknown }>,
  impl: (_name: string, _args?: unknown): Promise<{ data: unknown; error: { message: string } | null }> =>
    Promise.resolve({ data: null, error: null }),
}));

const session = {
  access_token: "test",
  refresh_token: "test",
  expires_in: 3600,
  token_type: "bearer",
  user: {
    id: "11111111-1111-1111-1111-111111111111",
    aud: "authenticated",
    app_metadata: {},
    user_metadata: { full_name: "דנה" },
    created_at: "2026-09-27T00:00:00Z",
    email: "dana@example.com",
  },
} satisfies Session;

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

const dashboard = {
  company_id: "c",
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
  active_projects: 1,
  review_count: 0,
  projects: [],
};

const supabase = {
  auth: {
    onAuthStateChange: (callback: (event: string, next: Session | null) => void) => {
      callback("INITIAL_SESSION", session);
      return { data: { subscription: { unsubscribe: () => undefined } } };
    },
    getSession: () => Promise.resolve({ data: { session } }),
  },
  rpc: (name: string, args?: unknown) => {
    rpc.calls.push({ name, args });
    if (name === "get_dashboard") return Promise.resolve({ data: dashboard, error: null });
    return rpc.impl(name, args);
  },
  from: (table: string) => {
    if (table === "companies") return chain({ owner_id: gate.owner });
    return chain(null);
  },
};

vi.mock("../lib/supabase", () => ({
  getSupabase: () => supabase,
}));

function reviewRow(id: string, supplier: string) {
  return {
    id,
    transaction_id: `t-${id}`,
    description: supplier,
    doc_date: "2026-09-29",
    amount_net: -10_000,
    direction: "expense",
    reason: null,
    project_id: "p1",
    category_id: "c1",
    project_name: "הרצל",
    category_name: "חומרים",
    supplier_name: supplier,
    doc_kind: "invoice",
    auto_approved_today: 0,
  };
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <AuthProvider>
            <BooksProvider>
              <Routes>
                <Route path="/review" element={<ReviewScreen />} />
                <Route path="/setup/5" element={<p>step 5</p>} />
                <Route path="/" element={<p>home</p>} />
              </Routes>
            </BooksProvider>
          </AuthProvider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  localStorage.clear();
  rpc.calls.length = 0;
  rpc.impl = () => Promise.resolve({ data: null, error: null });
  gate.owner = session.user.id;
});

describe("review setup handoff", () => {
  it("shows the sample card when the setup queue is empty", async () => {
    rpc.impl = (name) => {
      if (name === "list_review") return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    };
    renderAt("/review?setup=1");
    expect(await screen.findByText("נתוני דוגמה · Example data")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "אישור" })).toBeInTheDocument();
  });

  it("shows the real queue when setup has items waiting", async () => {
    rpc.impl = (name) => {
      if (name === "list_review") return Promise.resolve({ data: [reviewRow("r1", "מחסן הנמל")], error: null });
      return Promise.resolve({ data: null, error: null });
    };
    renderAt("/review?setup=1");
    expect(await screen.findByRole("heading", { name: "מחסן הנמל" })).toBeInTheDocument();
    expect(screen.queryByText("נתוני דוגמה · Example data")).not.toBeInTheDocument();
  });

  it("continues home from the sample card when opened from the card", async () => {
    rpc.impl = (name) => {
      if (name === "list_review") return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    };
    renderAt("/review?setup=1&from=card");
    const approve = await screen.findByRole("button", { name: "אישור" });
    await waitFor(() => {
      expect(approve).toBeEnabled();
    });
    fireEvent.click(approve);
    expect(await screen.findByText(SAMPLE_TOAST)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "המשך" }));
    await waitFor(() => {
      expect(screen.getByText("home")).toBeInTheDocument();
    });
  });

  it("does not show the sample card for a viewer", async () => {
    gate.owner = "other";
    rpc.impl = (name) => {
      if (name === "list_review") return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    };
    renderAt("/review?setup=1");
    expect(await screen.findByText("הכל מאושר")).toBeInTheDocument();
    await expect(screen.findByText("נתוני דוגמה · Example data", {}, { timeout: 500 })).rejects.toThrow();
  });

  it("toasts setup handoff after the first real approval", async () => {
    rpc.impl = (name) => {
      if (name === "list_review") return Promise.resolve({ data: [reviewRow("r1", "מחסן הנמל")], error: null });
      if (name === "approve_review_item") return Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: null, error: null });
    };
    renderAt("/review?setup=1");
    const approve = await screen.findByRole("button", { name: "אישור" });
    await waitFor(() => {
      expect(approve).toBeEnabled();
    });
    fireEvent.click(approve);
    expect(await screen.findByText(SAMPLE_TOAST)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "המשך" }));
    await waitFor(() => {
      expect(screen.getByText("step 5")).toBeInTheDocument();
    });
  });

  it("hands the first real approval back to Home when opened from the card", async () => {
    rpc.impl = (name) => {
      if (name === "list_review") return Promise.resolve({ data: [reviewRow("r1", "מחסן הנמל")], error: null });
      return Promise.resolve({ data: null, error: null });
    };
    renderAt("/review?setup=1&from=card");
    const approve = await screen.findByRole("button", { name: "אישור" });
    await waitFor(() => {
      expect(approve).toBeEnabled();
    });
    fireEvent.click(approve);
    expect(await screen.findByText(SAMPLE_TOAST)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "המשך" }));
    await waitFor(() => {
      expect(screen.getByText("home")).toBeInTheDocument();
    });
  });
});
