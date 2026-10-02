import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Session } from "@supabase/supabase-js";
import { MemoryRouter, Route, RouterProvider, Routes, createMemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { ChangeForm, ReviewScreen, SplitScreen, queueAfterFocus, resetReviewListFocus, reviewFocusPath, reviewListPath, rotateReview } from "./flow-screens";

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
  it("puts הצג הכול on the counter line, after the bar and above the filed banner", async () => {
    rpc.impl = (name) => {
      if (name === "list_review") return Promise.resolve({ data: [reviewRow("r1", "מחסן הנמל", "p1")], error: null });
      return Promise.resolve({ data: null, error: null });
    };
    renderAt("/review");
    const link = await screen.findByRole("link", { name: "הצג הכול" });
    expect(link).toHaveAttribute("href", "/review/all");
    const meter = screen.getByRole("meter", { name: "התקדמות התור" });
    const banner = screen.getByText(/שויכו היום/);
    const card = screen.getByRole("heading", { name: "מחסן הנמל" });
    expect(meter.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
    fireEvent.click(await screen.findByRole("link", { name: "הצג הכול" }));
    const first = await screen.findByRole("link", { name: /מחסן הנמל/ });
    const second = screen.getByRole("link", { name: /עגורני החוף/ });
    expect(first).toHaveTextContent("29/09");
    expect(first).toHaveTextContent("100");
    expect(second).toHaveTextContent("29/09");
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
    const link = await screen.findByRole("link", { name: "הצג הכול" });
    expect(link).toHaveAttribute("href", "/review/all?project=p1");
    fireEvent.click(link);
    expect(await screen.findByRole("link", { name: /מחסן הנמל/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /עגורני החוף/ })).not.toBeInTheDocument();
  });

  it("opens the project picker from the card and holds a half-filled choice", async () => {
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
    renderAt("/review");
    expect(await screen.findByText("אין הצעה, הקישו לבחירה")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "פרויקט: לא נבחר" }));
    expect(await screen.findByRole("heading", { name: "בחירת פרויקט" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "הרצל" }));
    expect(await screen.findByText("בחרו פרויקט וקטגוריה.")).toBeInTheDocument();
    expect(rpc.calls.some((call) => call.name === "resolve_review")).toBe(false);
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
    expect(saved?.args).toMatchObject({
      p_id: "r1",
      p_action: "changed",
      p_project_id: "p1",
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
    fireEvent.click(within(dialog).getByRole("button", { name: "חזרה" }));
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
    expect(screen.getByText("חסר קטגוריה, הקישו לבחירה")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "פרויקט: מפוצל · 2 פרויקטים" }));
    expect(await screen.findByRole("heading", { name: "חלוקה בין פרויקטים" })).toBeInTheDocument();
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
          reviewRow("r3", "ברזל הדרום", "p1"),
        ];
        return Promise.resolve({ data: open ? rows : rows.filter((row) => row.id !== "r2"), error: null });
      }
      if (name === "resolve_review") {
        open = false;
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };
    renderAt("/review");
    fireEvent.click(await screen.findByRole("link", { name: "הצג הכול" }));
    fireEvent.click(await screen.findByRole("link", { name: /עגורני החוף/ }));
    expect(await screen.findByRole("heading", { name: "עגורני החוף" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "אישור" }));
    expect(await screen.findByRole("heading", { name: "ברזל הדרום" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "מחסן הנמל" })).not.toBeInTheDocument();
  });

  it("keeps the list order across three approvals", async () => {
    const names = ["מחסן הנמל", "עגורני החוף", "ברזל הדרום", "צבע הדרום", "חשמל הצפון"];
    const removed = new Set<string>();
    rpc.impl = (name, args) => {
      if (name === "list_review") {
        const rows = names.map((supplier, index) => reviewRow(`r${String(index + 1)}`, supplier, "p1"));
        return Promise.resolve({ data: rows.filter((row) => !removed.has(row.id)), error: null });
      }
      if (name === "resolve_review") {
        const id = (args as { p_id?: string } | undefined)?.p_id;
        if (id) removed.add(id);
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };
    renderAt("/review");
    fireEvent.click(await screen.findByRole("link", { name: "הצג הכול" }));
    fireEvent.click(await screen.findByRole("link", { name: /ברזל הדרום/ }));
    expect(await screen.findByRole("heading", { name: "ברזל הדרום" })).toBeInTheDocument();
    showsPlace("3 מתוך 5");
    fireEvent.click(screen.getByRole("button", { name: "אישור" }));
    expect(await screen.findByRole("heading", { name: "צבע הדרום" })).toBeInTheDocument();
    showsPlace("3 מתוך 4");
    fireEvent.click(screen.getByRole("button", { name: "אישור" }));
    expect(await screen.findByRole("heading", { name: "חשמל הצפון" })).toBeInTheDocument();
    showsPlace("3 מתוך 3");
    fireEvent.click(screen.getByRole("button", { name: "אישור" }));
    expect(await screen.findByRole("heading", { name: "מחסן הנמל" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "עגורני החוף" })).not.toBeInTheDocument();
    showsPlace("1 מתוך 2");
  });

  it("leaves the queue at /review after the last list item", async () => {
    let open = true;
    rpc.impl = (name) => {
      if (name === "list_review") {
        return Promise.resolve({ data: open ? [reviewRow("r1", "מחסן הנמל", "p1")] : [], error: null });
      }
      if (name === "resolve_review") {
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
    fireEvent.click(await screen.findByRole("link", { name: "הצג הכול" }));
    fireEvent.click(await screen.findByRole("link", { name: /מחסן הנמל/ }));
    fireEvent.click(await screen.findByRole("button", { name: "אישור" }));
    expect(await screen.findByText("הכל מאושר")).toBeInTheDocument();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/review");
    });
    expect(router.state.location.search).not.toContain("from=all");
  });
});
