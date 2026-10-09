import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Session } from "@supabase/supabase-js";
import type { ReviewRow } from "@flow/shared";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { CategoriesScreen, ProjectDetailScreen, ProjectsScreen, ChangeForm, ReviewQueue, ReviewScreen, SettingsScreen, SplitScreen, TransactionScreen, UnpaidScreen } from "./flow-screens";
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

describe("rejected writes", () => {
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
    expect(screen.queryByText("חסר קטגוריה, הקישו לבחירה")).not.toBeInTheDocument();
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
    expect(screen.queryByText("חסר קטגוריה, הקישו לבחירה")).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "בחירת קטגוריה" }, { timeout: 2500 })).toBeEnabled();
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
    expect(screen.queryByText("אין הצעה, הקישו לבחירה")).not.toBeInTheDocument();
    const approve = await screen.findByRole("button", { name: "בחירת פרויקט" }, { timeout: 2500 });
    expect(approve).toBeEnabled();
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
