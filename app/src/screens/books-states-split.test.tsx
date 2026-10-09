import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Session } from "@supabase/supabase-js";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { CategoriesScreen, ProjectDetailScreen, ProjectsScreen, ChangeForm, ReviewScreen, SettingsScreen, SplitScreen, TransactionScreen, UnpaidScreen } from "./flow-screens";
import { HomeScreen } from "./HomeScreen";

const rpc = vi.hoisted(() => ({
  handlers: [] as Array<(event: string, session: Session | null) => void>,
  impl: (_name: string, _args?: unknown): Promise<{ data: unknown; error: { message: string; code?: string } | null }> =>
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

describe("rejected writes", () => {
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
    expect(await screen.findByText("הוצאה משותפת · אישור יפתח פיצול")).toBeInTheDocument();
    expect(screen.queryByText("חסר פרויקט, הקישו לבחירה")).not.toBeInTheDocument();
    expect(screen.getByText("חומרים")).toBeInTheDocument();
    const approve = screen.getByRole("button", { name: "אישור" });
    expect(approve).toBeEnabled();
    fireEvent.click(approve);
    expect(await screen.findByRole("heading", { name: "פיצול בין פרויקטים" })).toBeInTheDocument();
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
    // #177: one call sets the category and approves.
    expect(calls).not.toContain("set_transaction_category");
    expect(args.find((entry) => isRecord(entry) && "p_id" in entry)).toEqual({ p_id: "r-split", p_category_id: "c1" });
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
    // #177: one call sets the category and approves.
    expect(calls).not.toContain("set_transaction_category");
    expect(args.find((entry) => isRecord(entry) && "p_id" in entry)).toEqual({ p_id: "r-shares", p_category_id: "c1" });
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
    expect(await screen.findByText("הפיצול ירד, והסכום כולו יעבור לפרויקט הזה.")).toBeInTheDocument();
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
    expect(await screen.findByText("הפיצול ירד, והסכום כולו יעבור לפרויקט הזה.")).toBeInTheDocument();
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

  it("reassigns an income review with the picked project on the second pick", async () => {
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
      if (name === "get_dashboard") {
        return Promise.resolve({
          data: {
            ...emptyDashboard,
            projects: [{
              id: "p1",
              name: "אתר א",
              status: "active",
              income_agorot: 0,
              direct_agorot: 0,
              shared_agorot: 0,
              profit_before_shared_agorot: 0,
              profit_agorot: 0,
            }],
          },
          error: null,
        });
      }
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
    expect(await screen.findByRole("dialog", { name: "שינוי שיוך" })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /פרויקט:/ }, { timeout: 2500 }));
    fireEvent.click(await screen.findByRole("radio", { name: "אתר א" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /פרויקט: אתר א/ })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /קטגוריה:/ }));
    fireEvent.click(await screen.findByRole("radio", { name: "תקבול מלקוח" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /קטגוריה: תקבול מלקוח/ })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /קטגוריה:/ }));
    fireEvent.click(await screen.findByRole("radio", { name: "הכנסה אחרת" }));
    await waitFor(() => {
      expect(projectArg).toBe("p1");
    });
  });
});
