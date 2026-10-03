import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  vi.restoreAllMocks();
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
      if (name === "resolve_review") return Promise.resolve({ data: null, error: { message: "Failed to fetch" } });
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
              project_suggested: true,
              category_suggested: true,
              auto_approved_today: 0,
            },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    };
    renderAt("/review");
    expect(await screen.findAllByText("הצעה")).toHaveLength(2);
    expect(screen.getByText("פרויקט")).toBeInTheDocument();
    expect(screen.getByText("הרצל")).toBeInTheDocument();
    expect(screen.getByText("קטגוריה")).toBeInTheDocument();
    expect(screen.getByText("חומרים")).toBeInTheDocument();
    expect(screen.queryByText("92%")).not.toBeInTheDocument();
    expect(screen.getByText(/חשבונית/)).toBeInTheDocument();
    expect(screen.queryByText(/AI/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "אישור" }));
    await waitFor(() => {
      expect(calls).toContain("approve_review_item");
    });
    expect(args.find((entry) => isRecord(entry) && entry.p_check_shown === true)).toMatchObject({
      p_id: "r1",
      p_project_id: "p1",
      p_category_id: "c1",
      p_remember: false,
      p_shown_project_id: "p1",
      p_shown_category_id: "c1",
      p_check_shown: true,
    });
    fireEvent.click(await screen.findByRole("button", { name: "ביטול" }));
    await waitFor(() => {
      expect(calls).toContain("reopen_review");
    });
    expect(await screen.findByText("הפריט חזר לתור, והשיוך הקודם שוחזר.")).toBeInTheDocument();
    expect(calls).not.toContain("resolve_review");
  });

  it("shows an info toast when the shown assignment is stale", async () => {
    rpc.impl = (name) => {
      if (name === "list_review") {
        return Promise.resolve({
          data: [{
            id: "r1",
            transaction_id: "t1",
            description: "מלט",
            doc_date: "2026-09-01",
            amount_net: -100,
            direction: "expense",
            reason: null,
            project_id: "p2",
            category_id: "c1",
            project_name: "ביתא",
            category_name: "חומרים",
            supplier_name: "מחסן",
          }],
          error: null,
        });
      }
      if (name === "approve_review_item") {
        return Promise.resolve({ data: { ok: false, error: { code: "stale" } }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };
    renderAt("/review");
    fireEvent.click(await screen.findByRole("button", { name: "אישור" }));
    expect(await screen.findByText("השיוך עודכן. בדקו את הכרטיס.")).toBeInTheDocument();
    expect(screen.queryByText("הפריט אושר")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ניסיון חוזר" })).not.toBeInTheDocument();
    expect(screen.getByText("ביתא")).toBeInTheDocument();
  });

  it("shows an info toast when the item is already closed", async () => {
    let open = true;
    rpc.impl = (name) => {
      if (name === "list_review") {
        return Promise.resolve({
          data: open ? [{
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
            project_name: "הרצל",
            category_name: "חומרים",
          }] : [],
          error: null,
        });
      }
      if (name === "approve_review_item") {
        open = false;
        return Promise.resolve({ data: { ok: false, error: { code: "already_closed" } }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };
    renderAt("/review");
    fireEvent.click(await screen.findByRole("button", { name: "אישור" }));
    expect(await screen.findByText("הפריט כבר טופל.")).toBeInTheDocument();
    expect(await screen.findByText("הכל מאושר")).toBeInTheDocument();
    expect(screen.queryByText("הפריט אושר")).not.toBeInTheDocument();
  });

  it("offers a retry when approve hits a deadlock", async () => {
    rpc.impl = (name) => {
      if (name === "list_review") {
        return Promise.resolve({
          data: [{
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
            project_name: "הרצל",
            category_name: "חומרים",
          }],
          error: null,
        });
      }
      if (name === "approve_review_item") return Promise.resolve({ data: null, error: { message: "deadlock detected" } });
      return Promise.resolve({ data: null, error: null });
    };
    renderAt("/review");
    fireEvent.click(await screen.findByRole("button", { name: "אישור" }));
    expect(await screen.findByText("לא הצלחנו לאשר.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ניסיון חוזר" })).toBeInTheDocument();
    expect(screen.queryByText("הפריט אושר")).not.toBeInTheDocument();
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
    expect(screen.queryByText("חסר פרויקט, הקישו לבחירה")).not.toBeInTheDocument();
    expect(screen.getByText("חומרים")).toBeInTheDocument();
    const approve = screen.getByRole("button", { name: "אישור" });
    expect(approve).toBeEnabled();
    fireEvent.click(approve);
    expect(await screen.findByRole("heading", { name: "חלוקה בין פרויקטים" })).toBeInTheDocument();
    expect(calls).not.toContain("resolve_review");
    expect(calls).not.toContain("approve_split_review");
  });

  it("approves a categorised split without collapsing it", async () => {
    const calls: string[] = [];
    const args: unknown[] = [];
    rpc.impl = (name, input) => {
      calls.push(name);
      args.push(input);
      if (name === "list_review") {
        return Promise.resolve({
          data: [
            {
              id: "r-split",
              transaction_id: "t-split",
              description: "ליסינג",
              doc_date: "2026-09-01",
              doc_kind: "invoice",
              amount_net: -200000,
              direction: "expense",
              reason: "missing_category",
              pnl_role: "shared",
              share_count: 2,
              project_id: null,
              category_id: "c1",
              project_name: null,
              category_name: "חומרים",
              category_suggested: false,
              supplier_name: "מחסן",
            },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    };
    renderAt("/review");
    expect(await screen.findByText("מפוצל · 2 פרויקטים")).toBeInTheDocument();
    expect(screen.queryByText("הצעה")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "אישור" }));
    await waitFor(() => {
      expect(calls).toContain("approve_split_review");
    });
    expect(calls).not.toContain("resolve_review");
    expect(args.find((entry) => isRecord(entry) && "p_id" in entry)).toEqual({ p_id: "r-split" });
    expect(await screen.findByText("הפריט אושר")).toBeInTheDocument();
  });

  it("approves a project-role card with more than one share through the split", async () => {
    const calls: string[] = [];
    const args: unknown[] = [];
    rpc.impl = (name, input) => {
      calls.push(name);
      args.push(input);
      if (name === "list_review") {
        return Promise.resolve({
          data: [
            {
              id: "r-shares",
              transaction_id: "t-shares",
              description: "ליסינג",
              doc_date: "2026-09-01",
              doc_kind: "invoice",
              amount_net: -200000,
              direction: "expense",
              reason: "missing_category",
              pnl_role: "project",
              share_count: 2,
              project_id: "p1",
              category_id: "c1",
              project_name: "הרצל",
              category_name: "חומרים",
              category_suggested: false,
              supplier_name: "מחסן",
            },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    };
    renderAt("/review");
    expect(await screen.findByText("מפוצל · 2 פרויקטים")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "אישור" }));
    await waitFor(() => {
      expect(calls).toContain("approve_split_review");
    });
    expect(calls).not.toContain("resolve_review");
    expect(args.find((entry) => isRecord(entry) && "p_id" in entry)).toEqual({ p_id: "r-shares" });
  });

  it("unsplits an unallocated shared cost from the project picker", async () => {
    const calls: string[] = [];
    rpc.impl = (name) => {
      calls.push(name);
      if (name === "collapse_split") return Promise.resolve({ data: "undo-split", error: null });
      if (name === "undo_reassign") return Promise.resolve({ data: null, error: null });
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
    fireEvent.click(await screen.findByRole("button", { name: /פרויקט:/ }));
    expect(await screen.findByText("החלוקה תרד, והסכום כולו יעבור לפרויקט הזה.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "הרצל" }));
    await waitFor(() => {
      expect(calls).toContain("collapse_split");
    });
    expect(calls).not.toContain("resolve_review");
    expect(calls).not.toContain("reassign_transaction");
    expect(calls).not.toContain("save_split");
    expect(await screen.findByText("השיוך נשמר")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ביטול", hidden: true }));
    await waitFor(() => {
      expect(calls).toContain("undo_reassign");
    });
  });

  it("keeps a closed review row so a second pick still writes", async () => {
    let open = true;
    const calls: string[] = [];
    rpc.impl = (name) => {
      calls.push(name);
      if (name === "list_review") {
        if (!open) return Promise.resolve({ data: [], error: null });
        return Promise.resolve({
          data: [{
            id: "r1",
            transaction_id: "t1",
            description: "מלט",
            doc_date: "2026-09-01",
            amount_net: -100,
            direction: "expense",
            reason: "suggested",
            pnl_role: "project",
            share_count: 0,
            project_id: "p1",
            category_id: "c1",
            project_name: "הרצל",
            category_name: "חומרים",
            supplier_name: "מחסן",
          }],
          error: null,
        });
      }
      if (name === "get_dashboard") {
        return Promise.resolve({
          data: {
            ...emptyDashboard,
            projects: [
              { id: "p1", name: "הרצל", status: "active", income_agorot: 0, direct_agorot: 0, shared_agorot: 0, profit_before_shared_agorot: 0, profit_agorot: 0 },
              { id: "p2", name: "וילה", status: "active", income_agorot: 0, direct_agorot: 0, shared_agorot: 0, profit_before_shared_agorot: 0, profit_agorot: 0 },
            ],
          },
          error: null,
        });
      }
      if (name === "list_categories") {
        return Promise.resolve({
          data: [
            { id: "c1", name: "חומרים", kind: "expense", hidden: false, is_default: true },
            { id: "c2", name: "הובלה", kind: "expense", hidden: false, is_default: false },
          ],
          error: null,
        });
      }
      if (name === "resolve_review") {
        open = false;
        return Promise.resolve({ data: null, error: null });
      }
      if (name === "reassign_transaction") return Promise.resolve({ data: "undo-2", error: null });
      return Promise.resolve({ data: null, error: null });
    };
    renderAt("/review/change?item=r1");
    fireEvent.click(await screen.findByRole("button", { name: /קטגוריה:/ }));
    fireEvent.click(await screen.findByRole("radio", { name: "הובלה" }));
    await waitFor(() => {
      expect(calls).toContain("resolve_review");
    });
    expect(await screen.findByText("מחסן")).toBeInTheDocument();
    expect(screen.queryByText("אין פריט לשינוי")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /פרויקט:/ }));
    fireEvent.click(await screen.findByRole("radio", { name: "וילה" }));
    await waitFor(() => {
      expect(calls).toContain("reassign_transaction");
    });
    expect(calls.filter((name) => name === "resolve_review")).toHaveLength(1);
  });

  it("saves a split category from review and collapses a project tap", async () => {
    const calls: string[] = [];
    rpc.impl = (name) => {
      calls.push(name);
      if (name === "list_review") {
        return Promise.resolve({
          data: [{
            id: "r1",
            transaction_id: "t1",
            description: "ליסינג",
            doc_date: "2026-07-01",
            amount_net: -320000,
            direction: "expense",
            reason: "missing_category",
            pnl_role: "shared",
            share_count: 6,
            project_id: null,
            category_id: null,
            project_name: null,
            category_name: null,
            supplier_name: "ליסינג הדרך בע״מ",
          }],
          error: null,
        });
      }
      if (name === "get_dashboard") {
        return Promise.resolve({
          data: {
            ...emptyDashboard,
            projects: [
              { id: "p1", name: "הרצל", status: "active", income_agorot: 0, direct_agorot: 0, shared_agorot: 0, profit_before_shared_agorot: 0, profit_agorot: 0 },
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
      if (name === "set_transaction_category") return Promise.resolve({ data: "undo-c", error: null });
      if (name === "collapse_split") return Promise.resolve({ data: "undo-s", error: null });
      return Promise.resolve({ data: null, error: null });
    };
    renderAt("/review/change?item=r1");
    expect(await screen.findByRole("button", { name: /פרויקט: מפוצל · 6 פרויקטים/ })).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "לזכור לספק הזה" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /קטגוריה:/ }));
    fireEvent.click(await screen.findByRole("radio", { name: "חומרים" }));
    await waitFor(() => {
      expect(calls).toContain("set_transaction_category");
    });
    expect(screen.queryByText("בחרו פרויקט וקטגוריה.")).not.toBeInTheDocument();
    expect(calls).not.toContain("resolve_review");
    fireEvent.click(await screen.findByRole("button", { name: /פרויקט:/ }));
    expect(await screen.findByText("החלוקה תרד, והסכום כולו יעבור לפרויקט הזה.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "הרצל" }));
    await waitFor(() => {
      expect(calls).toContain("collapse_split");
    });
    expect(calls).not.toContain("resolve_review");
    const saved = await screen.findByText("השיוך נשמר");
    const toast = saved.closest(".ui-toast");
    expect(toast).not.toBeNull();
    const undo = toast?.querySelector("button");
    expect(undo).toHaveTextContent("ביטול");
    if (!undo) throw new Error("undo missing");
    fireEvent.click(undo);
    await waitFor(() => {
      expect(calls).toContain("undo_reassign");
    });
  });

  it("reassigns an income review with a null project on the second pick", async () => {
    let open = true;
    let projectArg: unknown = "missing";
    rpc.impl = (name, args) => {
      if (name === "list_review") {
        if (!open) return Promise.resolve({ data: [], error: null });
        return Promise.resolve({
          data: [{
            id: "r1",
            transaction_id: "t1",
            description: "תקבול",
            doc_date: "2026-09-01",
            amount_net: 100,
            direction: "income",
            reason: "missing_category",
            project_id: null,
            category_id: null,
            project_name: null,
            category_name: null,
            supplier_name: "לקוח",
          }],
          error: null,
        });
      }
      if (name === "list_categories") {
        return Promise.resolve({
          data: [
            { id: "c1", name: "תקבול מלקוח", kind: "income", hidden: false, is_default: true },
            { id: "c2", name: "הכנסה אחרת", kind: "income", hidden: false, is_default: false },
          ],
          error: null,
        });
      }
      if (name === "get_dashboard") return Promise.resolve({ data: emptyDashboard, error: null });
      if (name === "resolve_review") {
        open = false;
        return Promise.resolve({ data: null, error: null });
      }
      if (name === "reassign_transaction") {
        projectArg = (args as { p_project_id?: unknown } | undefined)?.p_project_id;
        return Promise.resolve({ data: "undo-income", error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };
    renderAt("/review/change?item=r1");
    fireEvent.click(await screen.findByRole("button", { name: /קטגוריה:/ }));
    fireEvent.click(await screen.findByRole("radio", { name: "תקבול מלקוח" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /קטגוריה: תקבול מלקוח/ })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /קטגוריה:/ }));
    fireEvent.click(await screen.findByRole("radio", { name: "הכנסה אחרת" }));
    await waitFor(() => {
      expect(projectArg).toBeNull();
    });
  });

  it("shows a split's category on the queue card and does not ask for a project", () => {
    const row = (category: string | null): ReviewRow => ({
      id: "r1",
      transaction_id: "t1",
      description: "מנוף",
      doc_date: "2026-09-29",
      amount_net: -100_000n,
      direction: "expense",
      reason: "missing_category",
      pnl_role: "shared",
      share_count: 2,
      project_id: null,
      category_id: category == null ? null : "c1",
      supplier_name: "עגורני החוף בע״מ",
      project_name: null,
      category_name: category,
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter>
            <ReviewQueue rows={[row(null)]} search="" sample />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText("מפוצל · 2 פרויקטים")).toBeInTheDocument();
    expect(screen.queryByText("הצעה")).not.toBeInTheDocument();
    expect(screen.getByText("חסר קטגוריה, הקישו לבחירה")).toBeInTheDocument();
    expect(screen.queryByText("חסר פרויקט, הקישו לבחירה")).not.toBeInTheDocument();
    rerender(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter>
            <ReviewQueue rows={[row("שינוע")]} search="" sample />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText("שינוע")).toBeInTheDocument();
    expect(screen.getByText("הצעה")).toBeInTheDocument();
    expect(screen.queryByText("חסר פרויקט, הקישו לבחירה")).not.toBeInTheDocument();
    rerender(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter>
            <ReviewQueue rows={[{ ...row("שינוע"), category_suggested: false }]} search="" sample />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText("שינוע")).toBeInTheDocument();
    expect(screen.queryByText("הצעה")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "אישור" })).toBeEnabled();
  });

  it("labels a guessed project and not a rule-owned category", () => {
    const row = {
      id: "r1",
      transaction_id: "t1",
      description: "מלט",
      doc_date: "2026-09-29",
      amount_net: -100_000n,
      direction: "expense" as const,
      reason: "suggested",
      project_id: "p1",
      category_id: "c1",
      supplier_name: "מחסן",
      project_name: "הרצל",
      category_name: "חומרים",
      category_suggested: false,
      project_suggested: true,
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const queue = (item: typeof row) => (
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter>
            <ReviewQueue rows={[item]} search="" sample />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    );
    const { rerender } = render(queue(row));
    const project = screen.getByRole("button", { name: "פרויקט: הרצל, הצעה" });
    const category = screen.getByRole("button", { name: "קטגוריה: חומרים" });
    expect(within(project).getByText("הצעה")).toBeInTheDocument();
    expect(within(category).queryByText("הצעה")).not.toBeInTheDocument();
    rerender(queue({ ...row, project_suggested: false }));
    const owned = screen.getByRole("button", { name: "פרויקט: הרצל" });
    expect(within(owned).queryByText("הצעה")).not.toBeInTheDocument();
  });

  it("clears the category הצעה after the owner picks it", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter initialEntries={["/review/change"]}>
            <BooksProvider>
              <ChangeForm
                sample={{
                  supplier: "מחסן",
                  amount: "₪100",
                  suggestionId: "p1",
                  suggestionCategoryId: "c1",
                  projectId: "p1",
                  categoryId: "c1",
                  projects: [{ id: "p1", name: "הרצל" }],
                  categories: [
                    { id: "c1", name: "חומרים", hidden: false },
                    { id: "c2", name: "שינוע", hidden: false },
                  ],
                  categorySuggested: true,
                }}
              />
            </BooksProvider>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
    const category = await screen.findByRole("button", { name: "קטגוריה: חומרים, שינוי" });
    expect(within(category).getByText("הצעה")).toBeInTheDocument();
    expect(within(screen.getByRole("button", { name: "פרויקט: הרצל, שינוי" })).getByText("הצעה")).toBeInTheDocument();
    fireEvent.click(category);
    fireEvent.click(await screen.findByRole("radio", { name: /חומרים/ }));
    const cleared = await screen.findByRole("button", { name: "קטגוריה: חומרים, שינוי" });
    expect(within(cleared).queryByText("הצעה")).not.toBeInTheDocument();
    expect(within(screen.getByRole("button", { name: "פרויקט: הרצל, שינוי" })).getByText("הצעה")).toBeInTheDocument();
  });

  it("does not tag an owner-picked project when project_suggested is false", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter initialEntries={["/review/change"]}>
            <BooksProvider>
              <ChangeForm
                sample={{
                  supplier: "מחסן",
                  amount: "₪100",
                  suggestionId: "p1",
                  suggestionCategoryId: "c1",
                  projectId: "p1",
                  categoryId: "c1",
                  projects: [{ id: "p1", name: "הרצל" }],
                  categories: [{ id: "c1", name: "חומרים", hidden: false }],
                  categorySuggested: false,
                  project_suggested: false,
                }}
              />
            </BooksProvider>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
    const project = await screen.findByRole("button", { name: "פרויקט: הרצל, שינוי" });
    expect(within(project).queryByText("הצעה")).not.toBeInTheDocument();
    fireEvent.click(project);
    const row = await screen.findByRole("radio", { name: "הרצל" });
    expect(within(row).queryByText("הצעה")).not.toBeInTheDocument();
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
    expect(await screen.findByText("חסר קטגוריה, הקישו לבחירה")).toBeInTheDocument();
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
    expect(await screen.findByText("אין הצעה, הקישו לבחירה")).toBeInTheDocument();
    const approve = screen.getByRole("button", { name: "אישור" });
    expect(approve).toBeDisabled();
    expect(getComputedStyle(approve).cursor).toBe("not-allowed");
    fireEvent.click(approve);
    expect(screen.queryByText(/אי אפשר לאשר/)).not.toBeInTheDocument();
  });

  it("advances the visit meter on a local skip and keeps it when the card leaves", async () => {
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
    const first = row("a", "חומרי בניין השרון");
    const second = row("b", "הובלות הגליל");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function queue(rows: ReviewRow[], onDone: (id: string) => void) {
      return (
        <QueryClientProvider client={client}>
          <ToastProvider>
            <MemoryRouter>
              <ReviewQueue
                rows={rows}
                search=""
                sample
                previewWrite={{ run: () => Promise.resolve(), onDone, onUndo: () => undefined }}
              />
            </MemoryRouter>
          </ToastProvider>
        </QueryClientProvider>
      );
    }
    const { rerender } = render(queue([first, second], () => undefined));
    const meter = screen.getByRole("meter", { name: "התקדמות התור" });
    expect(meter).toHaveAttribute("aria-valuenow", "1");
    expect(meter).toHaveAttribute("aria-valuemax", "2");
    fireEvent.click(screen.getByRole("button", { name: "דלג" }));
    await waitFor(() => {
      expect(screen.getByRole("meter", { name: "התקדמות התור" })).toHaveAttribute("aria-valuenow", "2");
    });
    expect(screen.getByRole("meter", { name: "התקדמות התור" })).toHaveAttribute("aria-valuemax", "2");
    rerender(queue([second], () => undefined));
    expect(screen.getByRole("meter", { name: "התקדמות התור" })).toHaveAttribute("aria-valuenow", "2");
    expect(screen.getByRole("meter", { name: "התקדמות התור" })).toHaveAttribute("aria-valuemax", "2");
    expect(await screen.findByRole("heading", { name: "הובלות הגליל" })).toBeInTheDocument();
  });

  it("grows the visit total by one when an approved card comes back", async () => {
    const row = (id: string, supplier: string): ReviewRow => ({
      id,
      transaction_id: id,
      description: supplier,
      doc_date: "2026-06-20",
      amount_net: -1_000n,
      direction: "expense",
      reason: null,
      project_id: "p",
      category_id: "c",
      supplier_name: supplier,
      project_name: "אלפא",
      category_name: "מלט",
    });
    const rows = [row("a", "ספק א"), row("b", "ספק ב")];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let listed = rows;
    function draw() {
      return (
        <QueryClientProvider client={client}>
          <ToastProvider>
            <MemoryRouter>
              <ReviewQueue
                rows={listed}
                search=""
                sample
                previewWrite={{
                  run: () => Promise.resolve(),
                  onDone: (id) => {
                    listed = listed.filter((item) => item.id !== id);
                    rerender(draw());
                  },
                  onUndo: (id) => {
                    const original = rows.find((item) => item.id === id);
                    if (original == null || listed.some((item) => item.id === id)) return;
                    listed = [original, ...listed];
                    rerender(draw());
                  },
                }}
              />
            </MemoryRouter>
          </ToastProvider>
        </QueryClientProvider>
      );
    }
    const { rerender } = render(draw());
    expect(screen.getByRole("meter", { name: "התקדמות התור" })).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByRole("meter", { name: "התקדמות התור" })).toHaveAttribute("aria-valuemax", "2");
    fireEvent.click(screen.getByRole("button", { name: "אישור" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "ספק ב" })).toBeInTheDocument();
    });
    expect(screen.getByRole("meter", { name: "התקדמות התור" })).toHaveAttribute("aria-valuenow", "2");
    expect(screen.getByRole("meter", { name: "התקדמות התור" })).toHaveAttribute("aria-valuemax", "2");
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "ספק א" })).toBeInTheDocument();
    });
    expect(screen.getByRole("meter", { name: "התקדמות התור" })).toHaveAttribute("aria-valuenow", "2");
    expect(screen.getByRole("meter", { name: "התקדמות התור" })).toHaveAttribute("aria-valuemax", "3");
  });

  it("keeps the visit index when a card closes remotely or a new card arrives", () => {
    const row = (id: string, supplier: string): ReviewRow => ({
      id,
      transaction_id: id,
      description: supplier,
      doc_date: "2026-06-20",
      amount_net: -1_000n,
      direction: "expense",
      reason: null,
      project_id: "p",
      category_id: "c",
      supplier_name: supplier,
      project_name: "אלפא",
      category_name: "מלט",
    });
    const rows = [row("a", "ספק א"), row("b", "ספק ב"), row("c", "ספק ג")];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function queue(listed: ReviewRow[]) {
      return (
        <QueryClientProvider client={client}>
          <ToastProvider>
            <MemoryRouter>
              <ReviewQueue rows={listed} search="" sample />
            </MemoryRouter>
          </ToastProvider>
        </QueryClientProvider>
      );
    }
    const { rerender } = render(queue(rows));
    expect(screen.getByRole("meter", { name: "התקדמות התור" })).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByRole("meter", { name: "התקדמות התור" })).toHaveAttribute("aria-valuemax", "3");
    rerender(queue(rows.slice(1)));
    expect(screen.getByRole("meter", { name: "התקדמות התור" })).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByRole("meter", { name: "התקדמות התור" })).toHaveAttribute("aria-valuemax", "2");
    rerender(queue(rows));
    expect(screen.getByRole("meter", { name: "התקדמות התור" })).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByRole("meter", { name: "התקדמות התור" })).toHaveAttribute("aria-valuemax", "3");
  });
});

describe("an unchanged complete review", () => {
  function completeReview(): string[] {
    const calls: string[] = [];
    rpc.impl = (name) => {
      calls.push(name);
      if (name === "list_review") {
        return Promise.resolve({
          data: [{
            id: "r1",
            transaction_id: "t1",
            description: "מלט",
            doc_date: "2026-09-01",
            amount_net: -100,
            direction: "expense",
            reason: "suggested",
            pnl_role: "project",
            share_count: 0,
            project_id: "p1",
            category_id: "c1",
            project_name: "הרצל",
            category_name: "חומרים",
            supplier_name: "מחסן",
            category_suggested: true,
          }],
          error: null,
        });
      }
      if (name === "get_dashboard") {
        return Promise.resolve({
          data: {
            ...emptyDashboard,
            projects: [
              { id: "p1", name: "הרצל", status: "active", income_agorot: 0, direct_agorot: 0, shared_agorot: 0, profit_before_shared_agorot: 0, profit_agorot: 0 },
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
      if (name === "resolve_review" || name === "reassign_transaction") {
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };
    return calls;
  }

  async function openComplete(): Promise<string[]> {
    const calls = completeReview();
    renderAt("/review/change?item=r1");
    expect(await screen.findByRole("button", { name: "פרויקט: הרצל, שינוי" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "קטגוריה: חומרים, שינוי" })).toBeInTheDocument();
    return calls;
  }

  function writes(calls: string[]): string[] {
    return calls.filter((name) => name === "resolve_review" || name === "reassign_transaction");
  }

  it("does not write when ✕ closes an unchanged sheet", async () => {
    const calls = await openComplete();
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "שינוי שיוך" })).not.toBeInTheDocument();
    });
    expect(writes(calls)).toEqual([]);
  });

  it("does not write when the scrim closes an unchanged sheet", async () => {
    const calls = await openComplete();
    const scrim = document.querySelector("[data-vaul-overlay]");
    if (!(scrim instanceof HTMLElement)) throw new Error("scrim missing");
    fireEvent.pointerDown(scrim, { button: 0, pointerId: 1, pointerType: "mouse" });
    fireEvent.click(scrim);
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "שינוי שיוך" })).not.toBeInTheDocument();
    });
    expect(writes(calls)).toEqual([]);
  });

  it("does not write when back is pressed on an unchanged sheet", async () => {
    const calls = await openComplete();
    const before = writes(calls);
    await act(async () => {
      window.dispatchEvent(new PopStateEvent("popstate"));
      await new Promise((resolve) => {
        window.setTimeout(resolve, 50);
      });
    });
    expect(writes(calls)).toEqual(before);
    expect(screen.getByRole("dialog", { name: "שינוי שיוך" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "פרויקט: הרצל, שינוי" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "לזכור לספק הזה" })).toBeChecked();
    expect(screen.queryByText("הזכירה נשמרת עם השיוך. החזירו את המתג כדי לסגור.")).not.toBeInTheDocument();
    expect(screen.queryByText("בחרו פרויקט וקטגוריה.")).not.toBeInTheDocument();
  });

  it("does not write when a swipe closes an unchanged sheet", async () => {
    const calls = await openComplete();
    await act(async () => {
      await new Promise((resolve) => {
        window.setTimeout(resolve, 550);
      });
    });
    const drawer = document.querySelector("[data-vaul-drawer]");
    if (!(drawer instanceof HTMLElement)) throw new Error("drawer missing");
    HTMLElement.prototype.setPointerCapture = () => undefined;
    fireEvent.pointerDown(drawer, { pointerId: 1, pageX: 20, pageY: 40, clientX: 20, clientY: 40, pointerType: "mouse" });
    await act(async () => {
      await Promise.resolve();
    });
    drawer.style.transform = "matrix(1, 0, 0, 1, 0, 400)";
    fireEvent.pointerUp(drawer, { pointerId: 1, pageX: 20, pageY: 420, clientX: 20, clientY: 420, pointerType: "mouse" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "שינוי שיוך" })).not.toBeInTheDocument();
    });
    expect(writes(calls)).toEqual([]);
    // Vaul clears its drag flag 200ms after the swipe. Let that run before the file ends.
    await act(async () => {
      await new Promise((resolve) => {
        window.setTimeout(resolve, 250);
      });
    });
  });

  it("commits a remember change when ✕ closes", async () => {
    const calls = await openComplete();
    fireEvent.click(screen.getByRole("switch", { name: "לזכור לספק הזה" }));
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    await waitFor(() => {
      expect(calls).toContain("resolve_review");
    });
    expect(calls).not.toContain("reassign_transaction");
  });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
