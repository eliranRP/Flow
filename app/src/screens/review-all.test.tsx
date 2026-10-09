import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Session } from "@supabase/supabase-js";
import { MemoryRouter, Outlet, Route, RouterProvider, Routes, createMemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth";
import { refreshLedger } from "../books-focus";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { ChangeForm, ReviewAllList, ReviewScreen, SplitScreen, queueAfterFocus, resetReviewListFocus, reviewFocusPath, reviewListPath, rotateReview } from "./flow-screens";


const rpc = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; args?: unknown }>,
  impl: (_name: string, _args?: unknown): Promise<{ data: unknown; error: { message: string } | null }> =>
    Promise.resolve({ data: null, error: null }),
}));

const supabase = {
  auth: {
    onAuthStateChange: (callback: (event: string, session: Session | null) => void) => {
      callback("INITIAL_SESSION", session);
      return { data: { subscription: { unsubscribe: () => undefined } } };
    },
    getSession: () => Promise.resolve({ data: { session } }),
    signOut: () => Promise.resolve({ error: null }),
  },
  rpc: (name: string, args?: unknown) => {
    rpc.calls.push({ name, args });
    return rpc.impl(name, args);
  },
};

vi.mock("../lib/supabase", () => ({
  getSupabase: () => supabase,
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

const dashboard = {
  company_id: "c",
  name: "אלפא",
  vat_registered: true,
  basis: "invoiced",
  from: "2026-09-01",
  to: "2026-09-28",
  income_agorot: 0,
  direct_agorot: 0,
  shared_agorot: 0,
  overhead_agorot: 0,
  expense_agorot: 0,
  net_profit_agorot: 0,
  prev_income_agorot: null,
  prev_expense_agorot: null,
  prev_net_agorot: null,
  active_projects: 2,
  review_count: 2,
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
    {
      id: "p2",
      name: "וילה",
      status: "active",
      income_agorot: 0,
      direct_agorot: 0,
      shared_agorot: 0,
      profit_before_shared_agorot: 0,
      profit_agorot: 0,
    },
  ],
};

const categories = [
  { id: "c1", name: "חומרים", kind: "expense", hidden: false, is_default: false },
  { id: "c2", name: "הובלה", kind: "expense", hidden: false, is_default: false },
];

function reviewRow(id: string, supplier: string, projectId: string | null, extra: Record<string, unknown> = {}) {
  return {
    id,
    transaction_id: `t-${id}`,
    description: supplier,
    doc_date: "2026-09-29",
    amount_net: -10_000,
    direction: "expense",
    reason: null,
    project_id: projectId,
    category_id: "c1",
    project_name: projectId === "p1" ? "הרצל" : projectId === "p2" ? "וילה" : null,
    category_name: "חומרים",
    supplier_name: supplier,
    doc_kind: "invoice",
    auto_approved_today: 3,
    ...extra,
  };
}

function showsPlace(text: string) {
  expect(screen.getByText((_content, element) => {
    return element?.tagName === "SPAN" && element.classList.contains("t-hint") && element.textContent === text;
  })).toBeInTheDocument();
}

/** אישור ignores a click while the previous write is still busy. */
async function approveWhenIdle(nextHeading: string) {
  await waitFor(() => {
    const button = screen.getByRole("button", { name: "אישור" });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute("aria-busy");
  });
  fireEvent.click(screen.getByRole("button", { name: "אישור" }));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(await screen.findByRole("heading", { name: nextHeading })).toBeInTheDocument();
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
                <Route path="/review/all" element={<ReviewScreen />} />
                <Route path="/review/change" element={<ChangeForm />} />
                <Route path="/transactions/:transactionId/split" element={<SplitScreen />} />
              </Routes>
            </BooksProvider>
          </AuthProvider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  rpc.calls.length = 0;
  rpc.impl = () => Promise.resolve({ data: null, error: null });
  resetReviewListFocus();
});

describe("review list paths", () => {
  it("keeps a project filter on the list and on the opened card", () => {
    expect(reviewListPath("")).toBe("/review/all");
    expect(reviewListPath("?project=p1&preview=1")).toBe("/review/all?project=p1&preview=1");
    const focused = new URL(reviewFocusPath("?project=p1", "r2"), "http://localhost");
    expect(focused.pathname).toBe("/review");
    expect(focused.searchParams.get("project")).toBe("p1");
    expect(focused.searchParams.get("item")).toBe("r2");
    expect(focused.searchParams.get("from")).toBe("all");
    expect(focused.searchParams.get("pick")).toBeNull();
    expect(rotateReview([{ id: "a" }, { id: "b" }, { id: "c" }], "b").map((row) => row.id)).toEqual(["b", "c", "a"]);
    const opened = queueAfterFocus([{ id: "a" }, { id: "b" }, { id: "c" }], "b", null);
    expect(opened.rows.map((row) => row.id)).toEqual(["b", "c", "a"]);
    const next = queueAfterFocus([{ id: "a" }, { id: "c" }], "b", opened.order);
    expect(next.rows.map((row) => row.id)).toEqual(["c", "a"]);
  });
});

describe("review queue list", () => {
  it("puts הצגת הכול on the start side of the counter line, before the bar and above the filed banner", async () => {
    rpc.impl = (name) => {
      if (name === "list_review") {
        return Promise.resolve({
          data: [{ ...reviewRow("r1", "מחסן הנמל", "p1"), auto_approved_today: 2 }],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    };
    renderAt("/review");
    const link = await screen.findByRole("link", { name: "הצגת הכול" });
    expect(link).toHaveAttribute("href", "/review/all");
    // FLOW-601: the meter waits for the role (list_my_companies), so it can land after the link.
    const meter = await screen.findByRole("meter", { name: "התקדמות התור" });
    const banner = await screen.findByText(/שויכו אוטומטית היום/);
    const card = screen.getByRole("heading", { name: "מחסן הנמל" });
    expect(link.compareDocumentPosition(meter) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(link.parentElement).toHaveClass("ui-review-meter");
    expect(link.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(link.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("lists every open item, opens that card, and returns to the list", async () => {
    rpc.impl = (name) => {
      if (name === "list_review") {
        return Promise.resolve({
          data: [reviewRow("r1", "מחסן הנמל", "p1"), reviewRow("r2", "עגורני החוף", "p2")],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    };
    renderAt("/review");
    fireEvent.click(await screen.findByRole("link", { name: "הצגת הכול" }));
    const first = await screen.findByRole("link", { name: /מחסן הנמל/ });
    const second = screen.getByRole("link", { name: /עגורני החוף/ });
    // FLOW-305: the date moved from each row into one quiet day head above the rows.
    expect(screen.getAllByRole("heading", { level: 3, name: /29\/09/ })).toHaveLength(1);
    expect(first).toHaveTextContent("100");
    expect(first).toHaveTextContent("✦ הרצל · חומרים");
    fireEvent.click(second);
    expect(await screen.findByRole("heading", { name: "עגורני החוף" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "אישור" })).toBeInTheDocument();
    expect(screen.queryByRole("meter", { name: "התקדמות התור" })).not.toBeInTheDocument();
    showsPlace("2 מתוך 2");
    fireEvent.click(screen.getByRole("button", { name: "חזרה" }));
    const opened = await screen.findByRole("link", { name: /עגורני החוף/ });
    expect(screen.getByRole("link", { name: /מחסן הנמל/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "אישור" })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(opened).toHaveFocus();
    });
  });

  it("opens the same card when the address is refreshed", async () => {
    rpc.impl = (name) => {
      if (name === "list_review") {
        return Promise.resolve({
          data: [reviewRow("r1", "מחסן הנמל", "p1"), reviewRow("r2", "עגורני החוף", "p2")],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    };
    renderAt("/review?item=r2&from=all");
    expect(await screen.findByRole("heading", { name: "עגורני החוף" })).toBeInTheDocument();
    // FLOW-327 r1: Back already goes to the list, so the card leaves הצגת הכול out; with Back the
    // header stays on one line so the pinned bar clears the tab bar at 375x667.
    expect(screen.queryByRole("link", { name: "הצגת הכול" })).toBeNull();
    const title = screen.getByRole("heading", { name: "לאישור" });
    expect(title.closest("header")).not.toHaveClass("ui-page-stacked");
    fireEvent.click(screen.getByRole("button", { name: "חזרה" }));
    expect(await screen.findByRole("link", { name: /מחסן הנמל/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "עגורני החוף" })).not.toBeInTheDocument();
  });

  it("does not list another project's items from a filtered queue", async () => {
    rpc.impl = (name, args) => {
      if (name === "list_review") {
        return Promise.resolve({
          data: [reviewRow("r1", "מחסן הנמל", "p1"), reviewRow("r2", "עגורני החוף", "p2")],
          error: null,
        });
      }
      if (name === "project_waiting") {
        expect(args).toEqual({ p_project: "p1" });
        return Promise.resolve({
          data: [{
            review_id: "r1",
            transaction_id: "t-r1",
            description: "מחסן הנמל",
            doc_date: "2026-09-29",
            amount_net: -10_000,
            direction: "expense",
            reason: null,
            project_id: "p1",
            category_id: "c1",
            category_name: "חומרים",
            supplier_name: "מחסן הנמל",
          }],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    };
    renderAt("/review?project=p1");
    const link = await screen.findByRole("link", { name: "הצגת הכול" });
    expect(link).toHaveAttribute("href", "/review/all?project=p1");
    expect(screen.getByRole("heading", { name: "לאישור" }).closest("header")).not.toHaveClass("ui-page-stacked");
    fireEvent.click(link);
    expect(await screen.findByRole("link", { name: /מחסן הנמל/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /עגורני החוף/ })).not.toBeInTheDocument();
  });

  it("opens the project picker from the card and saves only the project", async () => {
    let savedProject = false;
    rpc.impl = (name) => {
      if (name === "list_review") {
        return Promise.resolve({
          data: [reviewRow("r1", "מחסן הנמל", savedProject ? "p1" : null, {
            category_id: null,
            category_name: null,
            project_name: savedProject ? "הרצל" : null,
            project_suggested: false,
          })],
          error: null,
        });
      }
      if (name === "get_dashboard") return Promise.resolve({ data: dashboard, error: null });
      if (name === "list_categories") return Promise.resolve({ data: categories, error: null });
      if (name === "resolve_review") {
        savedProject = true;
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };
    renderAt("/review");
    expect(screen.queryByText("אין הצעה, הקישו לבחירה")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "בחירת פרויקט" }, { timeout: 2500 }));
    expect(await screen.findByRole("heading", { name: "בחירת פרויקט" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "הרצל" }));
    await waitFor(() => {
      expect(rpc.calls.some((call) => call.name === "resolve_review")).toBe(true);
    });
    expect(rpc.calls.find((call) => call.name === "resolve_review")?.args).toEqual({
      p_id: "r1",
      p_action: "changed",
      p_resolve: false,
      p_project_id: "p1",
    });
    expect(await screen.findByRole("heading", { name: "מחסן הנמל" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "פרויקט: הרצל" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "בחירת קטגוריה" })).toBeEnabled();
    expect(screen.queryByText("בחרו פרויקט וקטגוריה.")).not.toBeInTheDocument();
  });

  it("saves a category on a card with no project and stays there", async () => {
    let savedCategory = false;
    rpc.impl = (name) => {
      if (name === "list_review") {
        return Promise.resolve({
          data: [reviewRow("r1", "מחסן הנמל", null, savedCategory
            ? { category_id: "c1", category_name: "חומרים", category_suggested: false, project_name: null }
            : { category_id: null, category_name: null, project_name: null })],
          error: null,
        });
      }
      if (name === "get_dashboard") return Promise.resolve({ data: dashboard, error: null });
      if (name === "list_categories") return Promise.resolve({ data: categories, error: null });
      if (name === "resolve_review") {
        savedCategory = true;
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };
    renderAt("/review");
    fireEvent.click(await screen.findByRole("button", { name: "קטגוריה: לא נבחר" }));
    fireEvent.click(await screen.findByRole("radio", { name: "חומרים" }));
    await waitFor(() => {
      expect(rpc.calls.some((call) => call.name === "resolve_review")).toBe(true);
    });
    expect(rpc.calls.find((call) => call.name === "resolve_review")?.args).toEqual({
      p_id: "r1",
      p_action: "changed",
      p_resolve: false,
      p_category_id: "c1",
    });
    expect(await screen.findByRole("heading", { name: "מחסן הנמל" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "קטגוריה: חומרים" })).toBeInTheDocument();
    expect(screen.queryByText("חסר פרויקט, הקישו לבחירה")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "שינוי שיוך" })).not.toBeInTheDocument();
  });

  it("saves a complete category tap and returns to the same card", async () => {
    let savedCategory = false;
    rpc.impl = (name) => {
      if (name === "list_review") {
        return Promise.resolve({
          data: [reviewRow("r1", "מחסן הנמל", "p1", savedCategory ? { category_id: "c2", category_name: "הובלה", category_suggested: false } : {})],
          error: null,
        });
      }
      if (name === "get_dashboard") return Promise.resolve({ data: dashboard, error: null });
      if (name === "list_categories") return Promise.resolve({ data: categories, error: null });
      if (name === "resolve_review") {
        savedCategory = true;
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };
    renderAt("/review");
    fireEvent.click(await screen.findByRole("button", { name: "קטגוריה: חומרים, הצעה" }));
    fireEvent.click(await screen.findByRole("radio", { name: "הובלה" }));
    await waitFor(() => {
      expect(rpc.calls.some((call) => call.name === "resolve_review")).toBe(true);
    });
    const saved = rpc.calls.find((call) => call.name === "resolve_review");
    expect(saved?.args).toEqual({
      p_id: "r1",
      p_action: "changed",
      p_resolve: false,
      p_category_id: "c2",
    });
    expect(await screen.findByRole("heading", { name: "מחסן הנמל" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "קטגוריה: הובלה" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "שינוי שיוך" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "בחירת קטגוריה" })).not.toBeInTheDocument();
  });

  it("closes a card-line picker back to the card", async () => {
    rpc.impl = (name) => {
      if (name === "list_review") return Promise.resolve({ data: [reviewRow("r1", "מחסן הנמל", "p1")], error: null });
      if (name === "get_dashboard") return Promise.resolve({ data: dashboard, error: null });
      if (name === "list_categories") return Promise.resolve({ data: categories, error: null });
      return Promise.resolve({ data: null, error: null });
    };
    renderAt("/review");
    fireEvent.click(await screen.findByRole("button", { name: "קטגוריה: חומרים, הצעה" }));
    const dialog = await screen.findByRole("dialog", { name: "בחירת קטגוריה" });
    expect(screen.getByRole("heading", { name: "בחירת קטגוריה" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "סגירה" }));
    expect(await screen.findByRole("heading", { name: "מחסן הנמל" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "שינוי שיוך" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "קטגוריה: חומרים, הצעה" }));
    const again = await screen.findByRole("dialog", { name: "בחירת קטגוריה" });
    fireEvent.click(within(again).getByRole("button", { name: "סגירה" }));
    expect(await screen.findByRole("heading", { name: "מחסן הנמל" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "בחירת קטגוריה" })).not.toBeInTheDocument();
  });

  it("opens the split from the project row and keeps the middle dot", async () => {
    rpc.impl = (name) => {
      if (name === "list_review") {
        return Promise.resolve({
          data: [reviewRow("r1", "עגורני החוף", null, {
            reason: "missing_category",
            pnl_role: "shared",
            share_count: 2,
            category_id: null,
            category_name: null,
            project_name: null,
          })],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    };
    renderAt("/review");
    expect(await screen.findByRole("button", { name: "פרויקט: מפוצל · 2 פרויקטים" })).toBeInTheDocument();
    expect(screen.queryByText("חסר קטגוריה, הקישו לבחירה")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "פרויקט: מפוצל · 2 פרויקטים" }));
    expect(await screen.findByRole("heading", { name: "פיצול בין פרויקטים" })).toBeInTheDocument();
    expect(rpc.calls.some((call) => call.name === "collapse_split")).toBe(false);
  });

  it("saves a split category from the card row", async () => {
    rpc.impl = (name) => {
      if (name === "list_review") {
        return Promise.resolve({
          data: [reviewRow("r1", "עגורני החוף", null, {
            reason: "missing_category",
            pnl_role: "shared",
            share_count: 2,
            category_id: null,
            category_name: null,
            project_name: null,
          })],
          error: null,
        });
      }
      if (name === "get_dashboard") return Promise.resolve({ data: dashboard, error: null });
      if (name === "list_categories") return Promise.resolve({ data: categories, error: null });
      if (name === "set_transaction_category") return Promise.resolve({ data: "undo-1", error: null });
      return Promise.resolve({ data: null, error: null });
    };
    renderAt("/review");
    fireEvent.click(await screen.findByRole("button", { name: "קטגוריה: לא נבחר" }));
    fireEvent.click(await screen.findByRole("radio", { name: "חומרים" }));
    await waitFor(() => {
      expect(rpc.calls.some((call) => call.name === "set_transaction_category")).toBe(true);
    });
    expect(rpc.calls.find((call) => call.name === "set_transaction_category")?.args).toEqual({
      p_id: "t-r1",
      p_category_id: "c1",
      p_resolve: false,
    });
    expect(rpc.calls.some((call) => call.name === "resolve_review")).toBe(false);
  });

  it("advances to the following list item after אישור", async () => {
    let open = true;
    rpc.impl = (name) => {
      if (name === "list_review") {
        const rows = [
          reviewRow("r1", "מחסן הנמל", "p1"),
          reviewRow("r2", "עגורני החוף", "p2"),
          reviewRow("r3", "ברזל לדוגמה", "p1"),
        ];
        return Promise.resolve({ data: open ? rows : rows.filter((row) => row.id !== "r2"), error: null });
      }
      if (name === "approve_review_item") {
        open = false;
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };
    renderAt("/review");
    fireEvent.click(await screen.findByRole("link", { name: "הצגת הכול" }));
    fireEvent.click(await screen.findByRole("link", { name: /עגורני החוף/ }));
    expect(await screen.findByRole("heading", { name: "עגורני החוף" })).toBeInTheDocument();
    await approveWhenIdle("ברזל לדוגמה");
    expect(screen.queryByRole("heading", { name: "מחסן הנמל" })).not.toBeInTheDocument();
  });

  it("keeps the list order across three approvals", async () => {
    const names = ["מחסן הנמל", "עגורני החוף", "ברזל לדוגמה", "צבע לדוגמה", "חשמלאות לדוגמה"];
    const removed = new Set<string>();
    rpc.impl = (name, args) => {
      if (name === "list_review") {
        const rows = names.map((supplier, index) => reviewRow(`r${String(index + 1)}`, supplier, "p1"));
        return Promise.resolve({ data: rows.filter((row) => !removed.has(row.id)), error: null });
      }
      if (name === "approve_review_item") {
        const id = (args as { p_id?: string } | undefined)?.p_id;
        if (id) removed.add(id);
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };
    renderAt("/review");
    fireEvent.click(await screen.findByRole("link", { name: "הצגת הכול" }));
    fireEvent.click(await screen.findByRole("link", { name: /ברזל לדוגמה/ }));
    expect(await screen.findByRole("heading", { name: "ברזל לדוגמה" })).toBeInTheDocument();
    showsPlace("3 מתוך 5");
    await approveWhenIdle("צבע לדוגמה");
    showsPlace("3 מתוך 4");
    await approveWhenIdle("חשמלאות לדוגמה");
    showsPlace("3 מתוך 3");
    await approveWhenIdle("מחסן הנמל");
    expect(screen.queryByRole("heading", { name: "עגורני החוף" })).not.toBeInTheDocument();
    showsPlace("1 מתוך 2");
  });

  it("leaves the queue at /review after the last list item", async () => {
    let open = true;
    rpc.impl = (name) => {
      if (name === "list_review") {
        return Promise.resolve({ data: open ? [reviewRow("r1", "מחסן הנמל", "p1")] : [], error: null });
      }
      if (name === "approve_review_item") {
        open = false;
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };
    const router = createMemoryRouter(
      [
        { path: "/review", element: <ReviewScreen /> },
        { path: "/review/all", element: <ReviewScreen /> },
      ],
      { initialEntries: ["/review"] },
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <AuthProvider>
            <BooksProvider>
              <RouterProvider router={router} />
            </BooksProvider>
          </AuthProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("link", { name: "הצגת הכול" }));
    fireEvent.click(await screen.findByRole("link", { name: /מחסן הנמל/ }));
    fireEvent.click(await screen.findByRole("button", { name: "אישור" }));
    expect(await screen.findByText("הכל מאושר")).toBeInTheDocument();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/review");
    });
    expect(router.state.location.search).not.toContain("from=all");
  });

  it("does not replace the change sheet when the open item leaves", async () => {
    rpc.impl = (name) => {
      if (name === "list_review") {
        return Promise.resolve({ data: [reviewRow("r2", "עגורני החוף", "p1")], error: null });
      }
      if (name === "get_dashboard") return Promise.resolve({ data: dashboard, error: null });
      if (name === "list_categories") return Promise.resolve({ data: categories, error: null });
      return Promise.resolve({ data: null, error: null });
    };
    const router = createMemoryRouter(
      [
        {
          element: <><ReviewScreen /><Outlet /></>,
          children: [
            { path: "/review", element: null },
            { path: "/review/all", element: null },
            { path: "/review/change", element: <ChangeForm /> },
          ],
        },
      ],
      { initialEntries: ["/review/change?item=r1&from=all"] },
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <AuthProvider>
            <BooksProvider>
              <RouterProvider router={router} />
            </BooksProvider>
          </AuthProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("dialog", { name: "שינוי שיוך" })).toBeInTheDocument();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/review/change");
    });
    expect(router.state.location.search).toContain("item=r1");
  });

  it("still advances on /review when the focused item has left", async () => {
    rpc.impl = (name) => {
      if (name === "list_review") {
        return Promise.resolve({ data: [reviewRow("r2", "עגורני החוף", "p1")], error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };
    const router = createMemoryRouter(
      [
        {
          element: <><ReviewScreen /><Outlet /></>,
          children: [
            { path: "/review", element: null },
            { path: "/review/change", element: <ChangeForm /> },
          ],
        },
      ],
      { initialEntries: ["/review?item=r1&from=all"] },
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <AuthProvider>
            <BooksProvider>
              <RouterProvider router={router} />
            </BooksProvider>
          </AuthProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("heading", { name: "עגורני החוף" })).toBeInTheDocument();
    await waitFor(() => {
      expect(router.state.location.search).toContain("item=r2");
    });
    expect(router.state.location.pathname).toBe("/review");
  });

  it("sends a refreshed change picker back to the summary", async () => {
    rpc.impl = (name) => {
      if (name === "list_review") {
        return Promise.resolve({
          data: [reviewRow("r1", "מחסן הנמל", null, { category_id: null, category_name: null, project_name: null })],
          error: null,
        });
      }
      if (name === "get_dashboard") return Promise.resolve({ data: dashboard, error: null });
      if (name === "list_categories") return Promise.resolve({ data: categories, error: null });
      return Promise.resolve({ data: null, error: null });
    };
    renderAt("/review/change?item=r1&pick=category");
    const dialog = await screen.findByRole("dialog", { name: "בחירת קטגוריה" });
    fireEvent.click(within(dialog).getByRole("button", { name: "סגירה" }));
    expect(await screen.findByRole("heading", { name: "שינוי שיוך" })).toBeInTheDocument();
    expect(await screen.findByText("בחרו פרויקט וקטגוריה.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "בחירת קטגוריה" })).not.toBeInTheDocument();
  });

  it("returns focus to the line that opened the picker", async () => {
    rpc.impl = (name) => {
      if (name === "list_review") return Promise.resolve({ data: [reviewRow("r1", "מחסן הנמל", "p1")], error: null });
      if (name === "get_dashboard") return Promise.resolve({ data: dashboard, error: null });
      if (name === "list_categories") return Promise.resolve({ data: categories, error: null });
      return Promise.resolve({ data: null, error: null });
    };
    const router = createMemoryRouter(
      [
        {
          element: <><ReviewScreen /><Outlet /></>,
          children: [
            { path: "/review", element: null },
            { path: "/review/change", element: <ChangeForm /> },
          ],
        },
      ],
      { initialEntries: ["/review"] },
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <AuthProvider>
            <BooksProvider>
              <RouterProvider router={router} />
            </BooksProvider>
          </AuthProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    const line = await screen.findByRole("button", { name: "קטגוריה: חומרים, הצעה" });
    fireEvent.click(line);
    const dialog = await screen.findByRole("dialog", { name: "בחירת קטגוריה" });
    fireEvent.click(within(dialog).getByRole("button", { name: "סגירה" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "קטגוריה: חומרים, הצעה" })).toHaveFocus();
    });
  });

  it("returns focus to the line on a list-opened card", async () => {
    rpc.impl = (name) => {
      if (name === "list_review") {
        return Promise.resolve({
          data: [reviewRow("r2", "עגורני החוף", "p2"), reviewRow("r1", "מחסן הנמל", "p1")],
          error: null,
        });
      }
      if (name === "get_dashboard") return Promise.resolve({ data: dashboard, error: null });
      if (name === "list_categories") return Promise.resolve({ data: categories, error: null });
      return Promise.resolve({ data: null, error: null });
    };
    const router = createMemoryRouter(
      [
        {
          element: <><ReviewScreen /><Outlet /></>,
          children: [
            { path: "/review", element: null },
            { path: "/review/change", element: <ChangeForm /> },
          ],
        },
      ],
      { initialEntries: ["/review?item=r1&from=all"] },
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <AuthProvider>
            <BooksProvider>
              <RouterProvider router={router} />
            </BooksProvider>
          </AuthProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("heading", { name: "מחסן הנמל" })).toBeInTheDocument();
    const line = screen.getByRole("button", { name: "קטגוריה: חומרים, הצעה" });
    fireEvent.click(line);
    const dialog = await screen.findByRole("dialog", { name: "בחירת קטגוריה" });
    expect(screen.getByRole("heading", { name: "מחסן הנמל", hidden: true })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "סגירה" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "קטגוריה: חומרים, הצעה" })).toHaveFocus();
    });
    expect(screen.getByRole("heading", { name: "מחסן הנמל" })).toBeInTheDocument();
  });

  it("returns focus to the line after back on a list-opened card", async () => {
    rpc.impl = (name) => {
      if (name === "list_review") {
        return Promise.resolve({
          data: [reviewRow("r2", "עגורני החוף", "p2"), reviewRow("r1", "מחסן הנמל", "p1")],
          error: null,
        });
      }
      if (name === "get_dashboard") return Promise.resolve({ data: dashboard, error: null });
      if (name === "list_categories") return Promise.resolve({ data: categories, error: null });
      return Promise.resolve({ data: null, error: null });
    };
    const router = createMemoryRouter(
      [
        {
          element: <><ReviewScreen /><Outlet /></>,
          children: [
            { path: "/review", element: null },
            { path: "/review/change", element: <ChangeForm /> },
          ],
        },
      ],
      { initialEntries: ["/review?item=r1&from=all"] },
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <AuthProvider>
            <BooksProvider>
              <RouterProvider router={router} />
            </BooksProvider>
          </AuthProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "קטגוריה: חומרים, הצעה" }));
    const dialog = await screen.findByRole("dialog", { name: "בחירת קטגוריה" });
    fireEvent.click(within(dialog).getByRole("button", { name: "סגירה" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "קטגוריה: חומרים, הצעה" })).toHaveFocus();
    });
  });

  it("returns a complete picker to the summary, and the next step brings it back", async () => {
    rpc.impl = (name) => {
      if (name === "list_review") return Promise.resolve({ data: [reviewRow("r1", "מחסן הנמל", "p1")], error: null });
      if (name === "get_dashboard") return Promise.resolve({ data: dashboard, error: null });
      if (name === "list_categories") return Promise.resolve({ data: categories, error: null });
      return Promise.resolve({ data: null, error: null });
    };
    const router = createMemoryRouter(
      [{ path: "/review/change", element: <ChangeForm /> }],
      { initialEntries: ["/review/change?item=r1"] },
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <AuthProvider>
            <BooksProvider>
              <RouterProvider router={router} />
            </BooksProvider>
          </AuthProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "קטגוריה: חומרים, שינוי" }));
    const dialog = await screen.findByRole("dialog", { name: "בחירת קטגוריה" });
    fireEvent.click(within(dialog).getByRole("button", { name: "סגירה" }));
    expect(await screen.findByRole("heading", { name: "שינוי שיוך" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "שינוי שיוך" })).toBeInTheDocument();
    await router.navigate(1);
    expect(await screen.findByRole("heading", { name: "בחירת קטגוריה" })).toBeInTheDocument();
    await router.navigate(-1);
    expect(await screen.findByRole("heading", { name: "שינוי שיוך" })).toBeInTheDocument();
  });

  it("keeps the dashboard after review is mounted, a reader joins, and the ledger refreshes", async () => {
    let releaseApprove: () => void = () => undefined;
    const approveGate = new Promise<void>((resolve) => {
      releaseApprove = resolve;
    });
    rpc.impl = (name) => {
      if (name === "list_review") return Promise.resolve({ data: [reviewRow("r1", "מחסן הנמל", "p1")], error: null });
      if (name === "get_dashboard") return Promise.resolve({ data: dashboard, error: null });
      if (name === "list_categories") return Promise.resolve({ data: categories, error: null });
      if (name === "approve_review_item") return approveGate.then(() => ({ data: null, error: null }));
      return Promise.resolve({ data: null, error: null });
    };
    const router = createMemoryRouter(
      [{
        element: <><ReviewScreen /><Outlet /></>,
        children: [
          { path: "/review", element: null },
          { path: "/review/change", element: <ChangeForm /> },
        ],
      }],
      { initialEntries: ["/review"] },
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <AuthProvider>
            <BooksProvider>
              <RouterProvider router={router} />
            </BooksProvider>
          </AuthProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("button", { name: "אישור" })).toBeInTheDocument();
    await router.navigate("/review/change?item=r1");
    expect(await screen.findByRole("heading", { name: "שינוי שיוך" })).toBeInTheDocument();
    await waitFor(() => {
      const settled = client.getQueryCache().findAll({ queryKey: ["dashboard"] });
      expect(settled.some((query) => query.state.data != null && query.state.fetchStatus === "idle")).toBe(true);
    });
    const before = rpc.calls.filter((call) => call.name === "get_dashboard").length;
    expect(before).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "אישור", hidden: true }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "אישור", hidden: true })).toHaveAttribute("aria-busy", "true");
    });
    await act(async () => {
      refreshLedger(client);
      await client.invalidateQueries({ queryKey: ["dashboard"] });
    });
    expect(rpc.calls.filter((call) => call.name === "get_dashboard").length).toBeGreaterThan(before);
    const cached = client.getQueryCache().findAll({ queryKey: ["dashboard"] });
    expect(cached.some((query) => query.state.data != null)).toBe(true);
    releaseApprove();
    expect(await screen.findByText("הפריט אושר")).toBeInTheDocument();
  });
});

describe("review amounts keep their currency", () => {
  it("shows a dollar review row as dollars", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
        <MemoryRouter>
        <ReviewAllList
          rows={[{
            id: "r-usd",
            transaction_id: "t-usd",
            description: "Pending credit",
            doc_date: "2026-09-03",
            amount_net: 10000n,
            currency: "USD",
            direction: "income",
            reason: "pending_income",
            project_id: null,
            category_id: null,
            supplier_name: null,
          }]}
          search=""
          backTo="/review"
        />
        </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText("$100")).toHaveClass("ui-income");
    expect(screen.queryByText("+$100")).not.toBeInTheDocument();
    expect(screen.queryByText("₪100")).not.toBeInTheDocument();
  });
});
