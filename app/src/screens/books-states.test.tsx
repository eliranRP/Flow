import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Session } from "@supabase/supabase-js";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth";
import { demoProject } from "../demo/model";
import { resetShownCompanyForTests, setShownCompany } from "../lib/company-header";
import { forgetProjectReads } from "../project-cache";
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

// Home's cash read (FLOW-413): one month with money in and out.
const cashMonths = {
  basis: "paid",
  base_currency: "ILS",
  months: [
    {
      month: `${new Date().toISOString().slice(0, 7)}-01`,
      by_currency: [
        { currency: "ILS", in_minor: 100, out_minor: 0, net_minor: 100, profit_minor: 100, excluded_count: 0, excluded_in_minor: 0, excluded_out_minor: 0 },
      ],
    },
  ],
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
                <Route path="/projects/:projectId" element={<ProjectDetailScreen section="profit" />} />
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

  it("keeps a project read before on screen when its fresh read fails (FLOW-804)", async () => {
    setShownCompany(session.user.id, "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    const wire = JSON.parse(JSON.stringify(demoProject("herzl"), (_key, value: unknown) => (
      typeof value === "bigint" ? value.toString() : value
    ))) as unknown;
    rpc.impl = (name) => Promise.resolve(name === "get_project" ? { data: wire, error: null } : { data: null, error: { message: "db down" } });
    const first = renderAt("/projects/herzl");
    expect(await screen.findByRole("heading", { level: 1, name: "שיפוץ הרצל 12" })).toBeInTheDocument();
    first.unmount();
    // That visit was an hour ago, so the saved read is stale and is read again.
    const saved = JSON.parse(localStorage.getItem("flow-project-reads") ?? "null") as { entries: { at: number }[] };
    for (const entry of saved.entries) entry.at -= 3_600_000;
    localStorage.setItem("flow-project-reads", JSON.stringify(saved));
    // The next open (a reload): the server is away, and the saved read is the page.
    const reads: string[] = [];
    rpc.impl = (name) => {
      reads.push(name);
      return Promise.resolve({ data: null, error: { message: "db down" } });
    };
    renderAt("/projects/herzl");
    expect(screen.getByRole("heading", { level: 1, name: "שיפוץ הרצל 12" })).toBeInTheDocument();
    await waitFor(() => { expect(reads).toContain("get_project"); });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("heading", { level: 1, name: "שיפוץ הרצל 12" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ניסיון חוזר" })).not.toBeInTheDocument();
    forgetProjectReads();
    resetShownCompanyForTests();
  });

  it("reads a project's groups only once its own read has landed (FLOW-804)", async () => {
    const wire = JSON.parse(JSON.stringify(demoProject("herzl"), (_key, value: unknown) => (
      typeof value === "bigint" ? value.toString() : value
    ))) as unknown;
    let answer: (value: { data: unknown; error: null }) => void = () => undefined;
    const reads: string[] = [];
    rpc.impl = (name) => {
      reads.push(name);
      if (name === "get_project") return new Promise((resolve) => { answer = resolve; });
      return Promise.resolve({ data: [], error: null });
    };
    renderAt("/projects/herzl");
    await waitFor(() => { expect(reads).toContain("get_project"); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(reads).not.toContain("list_project_groups");
    await act(async () => { answer({ data: wire, error: null }); await Promise.resolve(); });
    expect(await screen.findByRole("heading", { level: 1, name: "שיפוץ הרצל 12" })).toBeInTheDocument();
    await waitFor(() => { expect(reads).toContain("list_project_groups"); });
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

  it("keeps the company currency row static until the stored currency reads (FLOW-504)", async () => {
    const answers: Array<{ data: unknown; error: { message: string } | null }> = [
      { data: null, error: { message: "db down" } },
      { data: "usd", error: null },
      { data: "USD", error: null },
    ];
    let stored = answers[0];
    rpc.impl = (name) => {
      if (name === "get_dashboard") return Promise.resolve({ data: emptyDashboard, error: null });
      if (name === "mcp_company_loan_currency") return Promise.resolve(stored ?? { data: null, error: null });
      return Promise.resolve({ data: null, error: { message: "db down" } });
    };
    const currencyRow = () => screen.getByText("מטבע העסק").closest(".ui-row");
    // A failed read and an odd value both read as a failure, never as a shekel company.
    for (const answer of answers.slice(0, 2)) {
      stored = answer;
      renderAt("/settings");
      await waitFor(() => { expect(currencyRow()).toHaveTextContent("לא הצלחנו לטעון"); });
      expect(screen.queryByRole("button", { name: /^מטבע העסק/ })).not.toBeInTheDocument();
      cleanup();
      rpc.handlers.length = 0;
    }
    stored = answers[2];
    renderAt("/settings");
    expect(await screen.findByRole("button", { name: "מטבע העסק: $ דולר" })).toBeInTheDocument();
  });

  it("does not hide open invoices when only that query fails", async () => {
    rpc.impl = (name) => {
      if (name === "get_dashboard") return Promise.resolve({ data: emptyDashboard, error: null });
      if (name === "cash_months") return Promise.resolve({ data: cashMonths, error: null });
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
      if (name === "approve_review_item") {
        return Promise.resolve({
          data: null,
          error: { message: "could not serialize access due to concurrent update", code: "40001" },
        });
      }
      return Promise.resolve({ data: null, error: null });
    };
    renderAt("/review");
    fireEvent.click(await screen.findByRole("button", { name: "אישור" }));
    expect(await screen.findByText("לא הצלחנו לאשר.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ניסיון חוזר" })).toBeInTheDocument();
    expect(screen.queryByText("הפריט אושר")).not.toBeInTheDocument();
  });

  it("focuses אישור before retrying a serialization failure", async () => {
    let attempts = 0;
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
      if (name === "approve_review_item") {
        attempts += 1;
        if (attempts === 1) {
          return Promise.resolve({
            data: null,
            error: { message: "could not serialize access due to concurrent update", code: "40001" },
          });
        }
        return new Promise(() => undefined);
      }
      return Promise.resolve({ data: null, error: null });
    };
    renderAt("/review");
    fireEvent.click(await screen.findByRole("button", { name: "אישור" }));
    const retry = await screen.findByRole("button", { name: "ניסיון חוזר" });
    expect(screen.getByText("לא הצלחנו לאשר.")).toBeInTheDocument();
    retry.focus();
    fireEvent.click(retry);
    const approve = screen.getByRole("button", { name: "אישור" });
    await waitFor(() => {
      expect(approve).toHaveFocus();
    });
    expect(approve).toHaveAttribute("aria-busy", "true");
    expect(document.body).not.toHaveFocus();
  });

  it("refreshes the queue when the item is gone", async () => {
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
        return Promise.resolve({ data: { ok: false, error: { code: "not_found" } }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };
    renderAt("/review");
    fireEvent.click(await screen.findByRole("button", { name: "אישור" }));
    expect(await screen.findByText("לא הצלחנו לאשר.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ניסיון חוזר" })).not.toBeInTheDocument();
    expect(screen.queryByText("הפריט אושר")).not.toBeInTheDocument();
    expect(await screen.findByText("הכל מאושר")).toBeInTheDocument();
  });

  it("does not treat a malformed approve body as success", async () => {
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
      if (name === "approve_review_item") return Promise.resolve({ data: { surprise: true }, error: null });
      return Promise.resolve({ data: null, error: null });
    };
    renderAt("/review");
    fireEvent.click(await screen.findByRole("button", { name: "אישור" }));
    expect(await screen.findByText("לא הצלחנו לאשר.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ניסיון חוזר" })).not.toBeInTheDocument();
    expect(screen.queryByText("הפריט אושר")).not.toBeInTheDocument();
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
          data: [
            { id: "c1", name: "חומרים", kind: "expense", hidden: false, is_default: true },
            { id: "i1", name: "שכירות", kind: "income", hidden: false, is_default: true },
          ],
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

  it("closes after a reversal pick, with no remember note and no supplier rule", async () => {
    const calls = await openComplete();
    fireEvent.click(screen.getByRole("button", { name: "קטגוריה: חומרים, שינוי" }));
    fireEvent.click(await screen.findByRole("button", { name: "החזר ללקוח" }));
    fireEvent.click(await screen.findByRole("radio", { name: "שכירות" }));
    await waitFor(() => {
      expect(writes(calls)).toContain("resolve_review");
    });
    expect(await screen.findByRole("button", { name: "קטגוריה: שכירות, החזר, שינוי" })).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "לזכור לספק הזה" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "שינוי שיוך" })).not.toBeInTheDocument();
    });
    expect(screen.queryByText("הזכירה נשמרת עם השיוך. החזירו את המתג כדי לסגור.")).not.toBeInTheDocument();
  });

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
