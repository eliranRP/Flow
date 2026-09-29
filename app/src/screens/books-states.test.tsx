import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Session } from "@supabase/supabase-js";
import type { ReviewRow } from "@flow/shared";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import {
  CategoriesScreen,
  ProjectDetailScreen,
  ProjectsScreen,
  ChangeForm,
  ReviewQueue,
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
                <Route path="/review/change" element={<ChangeForm />} />
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
    expect(screen.getByText("נכנס")).toBeInTheDocument();
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

  it("approves a review item and undo calls reopen_review", async () => {
    const calls: string[] = [];
    const args: unknown[] = [];
    rpc.impl = (name, input) => {
      calls.push(name);
      args.push(input);
      if (name === "list_review") {
        return Promise.resolve({
          data: [
            {
              id: "r1",
              transaction_id: "t1",
              description: "מלט",
              doc_date: "2026-09-01",
              doc_kind: "invoice",
              amount_net: -100,
              vat_agorot: 18,
              direction: "expense",
              reason: "suggested",
              project_id: "p1",
              category_id: "c1",
              project_name: "הרצל",
              category_name: "חומרים",
              confidence: 92,
              supplier_name: "מחסן",
              auto_approved_today: 0,
            },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    };
    renderAt("/review");
    expect(await screen.findByText("הצעה")).toBeInTheDocument();
    expect(screen.getByText("פרויקט")).toBeInTheDocument();
    expect(screen.getByText("הרצל")).toBeInTheDocument();
    expect(screen.getByText("קטגוריה")).toBeInTheDocument();
    expect(screen.getByText("חומרים")).toBeInTheDocument();
    expect(screen.queryByText("92%")).not.toBeInTheDocument();
    expect(screen.getByText(/חשבונית/)).toBeInTheDocument();
    expect(screen.queryByText(/AI/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "אישור" }));
    await waitFor(() => {
      expect(calls).toContain("resolve_review");
    });
    expect(args.find((entry) => isRecord(entry) && entry.p_action === "approved")).toMatchObject({
      p_action: "approved",
      p_remember: false,
      p_project_id: "p1",
      p_category_id: "c1",
    });
    fireEvent.click(await screen.findByRole("button", { name: "ביטול" }));
    await waitFor(() => {
      expect(calls).toContain("reopen_review");
    });
    expect(await screen.findByText("הפריט חזר לתור, והשיוך הקודם שוחזר.")).toBeInTheDocument();
    expect(calls).toContain("resolve_review");
  });

  it("opens split for an unallocated shared cost", async () => {
    const calls: string[] = [];
    rpc.impl = (name) => {
      calls.push(name);
      if (name === "list_review") {
        return Promise.resolve({
          data: [
            {
              id: "r1",
              transaction_id: "t-shared",
              description: "מלט",
              doc_date: "2026-09-01",
              amount_net: -100,
              direction: "expense",
              reason: "unallocated_shared",
              project_id: null,
              category_id: "c1",
              project_name: null,
              category_name: "חומרים",
              supplier_name: "מחסן",
            },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    };
    renderAt("/review");
    expect(await screen.findByText("הוצאה משותפת · אישור יפתח חלוקה")).toBeInTheDocument();
    expect(screen.queryByText("חסר פרויקט, בחרו בשינוי")).not.toBeInTheDocument();
    expect(screen.getByText("חומרים")).toBeInTheDocument();
    const approve = screen.getByRole("button", { name: "אישור" });
    expect(approve).toBeEnabled();
    fireEvent.click(approve);
    expect(await screen.findByRole("heading", { name: "חלוקה בין פרויקטים" })).toBeInTheDocument();
    expect(calls).not.toContain("resolve_review");
  });

  it("says a shared cost is split when one project is refused", async () => {
    rpc.impl = (name) => {
      if (name === "get_dashboard") {
        return Promise.resolve({
          data: {
            ...emptyDashboard,
            projects: [
              {
                id: "p1",
                name: "הרצל",
                status: "active",
                income_agorot: 0,
                direct_agorot: 0,
                shared_agorot: 0,
                profit_before_shared_agorot: 0,
                profit_agorot: 0,
              },
            ],
          },
          error: null,
        });
      }
      if (name === "list_categories") {
        return Promise.resolve({
          data: [{ id: "c1", name: "חומרים", kind: "expense", hidden: false, is_default: true }],
          error: null,
        });
      }
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
              reason: "unallocated_shared",
              project_id: "p1",
              category_id: "c1",
              project_name: "הרצל",
              category_name: "חומרים",
              supplier_name: "מחסן",
            },
          ],
          error: null,
        });
      }
      if (name === "resolve_review") {
        return Promise.resolve({
          data: null,
          error: { message: "shared costs are split, not assigned to one project" },
        });
      }
      return Promise.resolve({ data: null, error: null });
    };
    renderAt("/review/change?item=r1");
    fireEvent.click(await screen.findByRole("button", { name: "שמירה ואישור" }));
    expect(await screen.findByText("עלות משותפת מחולקת במסך החלוקה.")).toBeInTheDocument();
    expect(screen.queryByText("לא נשמר – אין חיבור")).not.toBeInTheDocument();
  });

  it("says a project expense is missing a category", async () => {
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
              reason: "missing_category",
              project_id: "p1",
              category_id: null,
              project_name: "הרצל",
              category_name: null,
              supplier_name: "מחסן",
            },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    };
    renderAt("/review");
    expect(await screen.findByText("חסר קטגוריה, בחרו בשינוי")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "אישור" })).toBeDisabled();
  });

  it("disables approve when the card has no suggestion", async () => {
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
              reason: "missing_category",
              project_id: null,
              category_id: null,
              project_name: null,
              category_name: null,
              supplier_name: "מחסן",
            },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    };
    renderAt("/review");
    expect(await screen.findByText("אין הצעה, בחרו בשינוי")).toBeInTheDocument();
    const approve = screen.getByRole("button", { name: "אישור" });
    expect(approve).toBeDisabled();
    expect(getComputedStyle(approve).cursor).toBe("not-allowed");
    fireEvent.click(approve);
    expect(screen.queryByText(/אי אפשר לאשר/)).not.toBeInTheDocument();
  });

  it("advances the visit meter without shrinking the queue", async () => {
    const row = (id: string, supplier: string): ReviewRow => ({
      id,
      transaction_id: id,
      description: supplier,
      doc_date: "2026-06-20",
      amount_net: -1_600_000n,
      direction: "expense",
      reason: null,
      project_id: "p",
      category_id: "c",
      supplier_name: supplier,
      project_name: "שיפוץ הרצל 12",
      category_name: "חומרים",
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function queue(rows: ReviewRow[]) {
      return (
        <QueryClientProvider client={client}>
          <ToastProvider>
            <MemoryRouter>
              <ReviewQueue rows={rows} search="" sample />
            </MemoryRouter>
          </ToastProvider>
        </QueryClientProvider>
      );
    }
    const { rerender } = render(queue([row("a", "חומרי בניין השרון"), row("b", "הובלות הגליל")]));
    const meter = screen.getByRole("meter", { name: "התקדמות התור" });
    expect(meter).toHaveAttribute("aria-valuenow", "1");
    expect(meter).toHaveAttribute("aria-valuemax", "2");
    rerender(queue([row("b", "הובלות הגליל")]));
    const next = screen.getByRole("meter", { name: "התקדמות התור" });
    expect(next).toHaveAttribute("aria-valuenow", "2");
    expect(next).toHaveAttribute("aria-valuemax", "2");
    expect(await screen.findByRole("heading", { name: "הובלות הגליל" })).toBeInTheDocument();
  });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
