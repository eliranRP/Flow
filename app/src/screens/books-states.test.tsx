import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { Session } from "@supabase/supabase-js";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import {
  CategoriesScreen,
  ProjectDetailScreen,
  ProjectsScreen,
  ReviewScreen,
  SettingsScreen,
  SplitScreen,
  TransactionScreen,
  UnpaidScreen,
} from "./flow-screens";
import { HomeScreen } from "./HomeScreen";

const rpc = vi.hoisted(() => ({
  handlers: [] as Array<(event: string, session: Session | null) => void>,
  impl: (_name: string, _args?: unknown): Promise<{ data: unknown; error: { message: string } | null }> =>
    Promise.resolve({ data: null, error: { message: "db down" } }),
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    auth: {
      onAuthStateChange: (callback: (event: string, session: Session | null) => void) => {
        rpc.handlers.push(callback);
        return { data: { subscription: { unsubscribe: () => undefined } } };
      },
      getSession: () => Promise.resolve({ data: { session } }),
      signOut: () => Promise.resolve({ error: null }),
    },
    rpc: (name: string, args?: unknown) => rpc.impl(name, args),
  }),
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

const emptyDashboard = {
  company_id: "c",
  name: "אלפא",
  vat_registered: true,
  basis: "invoiced",
  from: "2026-09-01",
  to: "2026-09-28",
  income_agorot: 100,
  direct_agorot: 0,
  shared_agorot: 0,
  overhead_agorot: 0,
  expense_agorot: 0,
  net_profit_agorot: 100,
  prev_income_agorot: null,
  prev_expense_agorot: null,
  prev_net_agorot: null,
  active_projects: 0,
  review_count: 0,
  projects: [],
};

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <AuthProvider>
            <BooksProvider>
              <Routes>
                <Route path="/" element={<HomeScreen />} />
                <Route path="/projects" element={<ProjectsScreen />} />
                <Route path="/projects/:projectId" element={<ProjectDetailScreen />} />
                <Route path="/review" element={<ReviewScreen />} />
                <Route path="/unpaid" element={<UnpaidScreen />} />
                <Route path="/settings" element={<SettingsScreen />} />
                <Route path="/settings/categories" element={<CategoriesScreen />} />
                <Route path="/transactions/:transactionId" element={<TransactionScreen />} />
                <Route path="/transactions/:transactionId/split" element={<SplitScreen />} />
              </Routes>
            </BooksProvider>
          </AuthProvider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
  act(() => {
    for (const handler of rpc.handlers) handler("INITIAL_SESSION", session);
  });
}

afterEach(() => {
  rpc.handlers.length = 0;
  rpc.impl = () => Promise.resolve({ data: null, error: { message: "db down" } });
});

describe("rejected reads", () => {
  it("does not call an empty projects list a successful empty state", async () => {
    renderAt("/projects");
    expect(await screen.findByRole("button", { name: "ניסיון חוזר" })).toBeInTheDocument();
    expect(screen.queryByText("עוד אין פרויקטים")).not.toBeInTheDocument();
  });

  it("does not call a failed unpaid load all paid", async () => {
    renderAt("/unpaid");
    expect(await screen.findByRole("button", { name: "ניסיון חוזר" })).toBeInTheDocument();
    expect(screen.queryByText("הכל שולם")).not.toBeInTheDocument();
  });

  it("does not call a failed project load not found", async () => {
    renderAt("/projects/abc");
    expect(await screen.findByRole("button", { name: "ניסיון חוזר" })).toBeInTheDocument();
    expect(screen.queryByText("הפרויקט לא נמצא.")).not.toBeInTheDocument();
  });

  it("does not call a failed transaction load not found", async () => {
    renderAt("/transactions/abc");
    expect(await screen.findByRole("button", { name: "ניסיון חוזר" })).toBeInTheDocument();
    expect(screen.queryByText("התנועה לא נמצאה.")).not.toBeInTheDocument();
  });

  it("does not call a failed review load an empty queue", async () => {
    renderAt("/review");
    expect(await screen.findByRole("button", { name: "ניסיון חוזר" })).toBeInTheDocument();
    expect(screen.queryByText("הכל מאושר")).not.toBeInTheDocument();
  });

  it("does not call a failed categories load an empty list", async () => {
    renderAt("/settings/categories");
    expect(await screen.findByRole("button", { name: "ניסיון חוזר" })).toBeInTheDocument();
    expect(screen.queryByText("אין עדיין קטגוריות")).not.toBeInTheDocument();
  });

  it("does not call a failed settings load a business with no company", async () => {
    renderAt("/settings");
    expect(await screen.findByRole("button", { name: "ניסיון חוזר" })).toBeInTheDocument();
    expect(screen.queryByText("עדיין בלי עסק")).not.toBeInTheDocument();
  });

  it("does not hide open invoices when only that query fails", async () => {
    rpc.impl = (name) => {
      if (name === "get_dashboard") return Promise.resolve({ data: emptyDashboard, error: null });
      if (name === "get_home") {
        return Promise.resolve({
          data: { company_id: "c", name: "אלפא", net_profit_agorot: 100, is_demo: false },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: { message: "db down" } });
    };
    renderAt("/");
    expect(await screen.findByRole("button", { name: "ניסיון חוזר" })).toBeInTheDocument();
    expect(screen.queryByText("הכל שולם")).not.toBeInTheDocument();
    expect(screen.getByText("הכנסות")).toBeInTheDocument();
  });

  it("shows the split form error instead of an empty project list when projects fail", async () => {
    renderAt("/transactions/abc/split");
    expect(await screen.findByRole("button", { name: "ניסיון חוזר" })).toBeInTheDocument();
    expect(screen.queryByText("אין פרויקטים לפיצול")).not.toBeInTheDocument();
  });
});

describe("rejected writes", () => {
  it("does not say a review item was skipped when the write fails", async () => {
    rpc.impl = (name) => {
      if (name === "list_review") {
        return Promise.resolve({
          data: [
            {
              id: "r1",
              transaction_id: "t1",
              description: "מלט",
              doc_date: "2026-09-01",
              amount_net: -100,
              direction: "expense",
              reason: null,
              project_id: "p1",
              category_id: "c1",
              supplier_name: "מחסן",
            },
          ],
          error: null,
        });
      }
      if (name === "resolve_review") return Promise.resolve({ data: null, error: { message: "no" } });
      return Promise.resolve({ data: [], error: null });
    };
    renderAt("/review");
    fireEvent.click(await screen.findByRole("button", { name: "דלג" }));
    expect(await screen.findByText("לא הצלחנו לדלג.")).toBeInTheDocument();
    expect(screen.queryByText("דילגנו על הפריט")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ניסיון חוזר" })).toBeInTheDocument();
  });
});
