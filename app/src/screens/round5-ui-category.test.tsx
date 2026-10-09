import { type Session } from "@supabase/supabase-js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { SplitScreen, TransactionScreen } from "./flow-screens";

const rpc = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; args: unknown }>,
  impl: (_name: string, _args?: unknown): Promise<{ data: unknown; error: { message: string } | null }> =>
    Promise.resolve({ data: null, error: null }),
}));

const edge = vi.hoisted(() => ({
  invoke: (_name: string, _body?: unknown): Promise<{ data: unknown; error: unknown }> =>
    Promise.resolve({ data: null, error: null }),
}));

const auth = vi.hoisted(() => ({
  handlers: [] as Array<(event: string, session: Session | null) => void>,
  signOuts: 0,
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    auth: {
      onAuthStateChange: (callback: (event: string, session: Session | null) => void) => {
        auth.handlers.push(callback);
        return { data: { subscription: { unsubscribe: () => undefined } } };
      },
      signOut: () => {
        auth.signOuts += 1;
        return Promise.resolve({ error: null });
      },
    },
    rpc: (name: string, args?: unknown) => {
      rpc.calls.push({ name, args });
      return rpc.impl(name, args);
    },
    functions: {
      invoke: (name: string, body?: unknown) => edge.invoke(name, body),
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => {
            if (table === "connector_connection_status") {
              return Promise.resolve({ data: null, error: null });
            }
            return Promise.resolve({ data: null, error: null });
          },
        }),
      }),
    }),
  }),
}));

const expense = {
  id: "tx",
  description: "מלט",
  direction: "expense",
  doc_date: "2026-09-12",
  amount_gross: -1_180_000n,
  amount_net: -1_000_000n,
  vat_amount: -180_000n,
  vat_status: "assumed",
  source: "sumit",
  project_id: "p1",
  project_name: "חולון",
  category_id: "c1",
  category_name: "חומרים",
  supplier_name: "ספק",
  customer_name: null,
};

function mountShared(extra: Record<string, unknown>) {
  rpc.calls.length = 0;
  rpc.impl = (name) => {
    if (name === "get_transaction") {
      return Promise.resolve({
        data: {
          ...expense,
          amount_gross: -1_180_000,
          amount_net: -1_000_000,
          vat_amount: -180_000,
          project_id: null,
          project_name: null,
          pnl_role: "shared",
          allocations: [],
          ...extra,
        },
        error: null,
      });
    }
    if (name === "get_dashboard") {
      return Promise.resolve({
        data: {
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
          review_count: 0,
          projects: [project("p1", "חולון"), project("p2", "וילה")],
        },
        error: null,
      });
    }
    if (name === "list_categories") {
      return Promise.resolve({
        data: [
          { id: "c1", name: "חומרים", kind: "expense", hidden: false, is_default: false },
          { id: "c2", name: "הובלה", kind: "expense", hidden: false, is_default: false },
        ],
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: null });
  };
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <BooksProvider>
          <MemoryRouter initialEntries={["/transactions/tx"]}>
            <Routes>
              <Route path="/transactions/:transactionId" element={<TransactionScreen />} />
              <Route path="/transactions/:transactionId/split" element={<SplitScreen />} />
            </Routes>
          </MemoryRouter>
        </BooksProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function project(id: string, name: string) {
  return {
    id,
    name,
    status: "active" as const,
    state_label: "פעיל",
    budget_agorot: null,
    income_agorot: 0,
    direct_agorot: 0,
    shared_agorot: 0,
    profit_before_shared_agorot: 0,
    profit_agorot: 0,
  };
}

describe("shared transaction category", () => {
  it("names the split, saves the category, and keeps the shares on undo", async () => {
    rpc.calls.length = 0;
    rpc.impl = (name) => {
      if (name === "get_transaction") {
        return Promise.resolve({
          data: {
            ...expense,
            amount_gross: -1_180_000,
            amount_net: -1_000_000,
            vat_amount: -180_000,
            project_id: null,
            project_name: null,
            pnl_role: "shared",
            allocations: [
              { project_id: "p1", project_name: "חולון", share_bp: 6000, amount_net: -600_000 },
              { project_id: "p2", project_name: "וילה", share_bp: 4000, amount_net: -400_000 },
            ],
          },
          error: null,
        });
      }
      if (name === "get_dashboard") {
        return Promise.resolve({
          data: {
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
            review_count: 0,
            projects: [project("p1", "חולון"), project("p2", "וילה")],
          },
          error: null,
        });
      }
      if (name === "list_categories") {
        return Promise.resolve({
          data: [
            { id: "c1", name: "חומרים", kind: "expense", hidden: false, is_default: false },
            { id: "c2", name: "הובלה", kind: "expense", hidden: false, is_default: false },
          ],
          error: null,
        });
      }
      if (name === "set_transaction_category") return Promise.resolve({ data: "undo-9", error: null });
      if (name === "undo_reassign") return Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: null, error: null });
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <BooksProvider>
            <MemoryRouter initialEntries={["/transactions/tx"]}>
              <Routes>
                <Route path="/transactions/:transactionId" element={<TransactionScreen />} />
                <Route path="/transactions/:transactionId/split" element={<SplitScreen />} />
              </Routes>
            </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("מפוצל · 2 פרויקטים")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /מפוצל · 2 פרויקטים/ }));
    expect(await screen.findByRole("heading", { name: "פיצול בין פרויקטים" })).toBeInTheDocument();
  });

  it("saves a shared category without calling reassign", async () => {
    rpc.calls.length = 0;
    rpc.impl = (name) => {
      if (name === "get_transaction") {
        return Promise.resolve({
          data: {
            ...expense,
            amount_gross: -1_180_000,
            amount_net: -1_000_000,
            vat_amount: -180_000,
            project_id: null,
            project_name: null,
            pnl_role: "shared",
            allocations: [
              { project_id: "p1", project_name: "חולון", share_bp: 6000, amount_net: -600_000 },
              { project_id: "p2", project_name: "וילה", share_bp: 4000, amount_net: -400_000 },
            ],
          },
          error: null,
        });
      }
      if (name === "get_dashboard") {
        return Promise.resolve({
          data: {
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
            review_count: 0,
            projects: [project("p1", "חולון"), project("p2", "וילה")],
          },
          error: null,
        });
      }
      if (name === "list_categories") {
        return Promise.resolve({
          data: [
            { id: "c1", name: "חומרים", kind: "expense", hidden: false, is_default: false },
            { id: "c2", name: "הובלה", kind: "expense", hidden: false, is_default: false },
          ],
          error: null,
        });
      }
      if (name === "set_transaction_category") return Promise.resolve({ data: "undo-9", error: null });
      if (name === "undo_reassign") return Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: null, error: null });
    };
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <BooksProvider>
            <MemoryRouter initialEntries={["/transactions/tx"]}>
              <Routes>
                <Route path="/transactions/:transactionId" element={<TransactionScreen />} />
              </Routes>
            </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("heading", { name: "הוצאה" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /חומרים/ }));
    fireEvent.click(await screen.findByRole("radio", { name: "הובלה" }));
    await waitFor(() => {
      expect(rpc.calls.find((call) => call.name === "set_transaction_category")?.args).toEqual({
        p_id: "tx",
        p_category_id: "c2",
      });
    });
    expect(rpc.calls.some((call) => call.name === "reassign_transaction")).toBe(false);
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /הובלה/ })).toBeInTheDocument();
    expect(rpc.calls.filter((call) => call.name === "set_transaction_category")).toHaveLength(1);
    fireEvent.click(await screen.findByRole("button", { name: "ביטול" }));
    await waitFor(() => {
      expect(rpc.calls.some((call) => call.name === "undo_reassign" && (call.args as { p_id?: string }).p_id === "undo-9")).toBe(true);
    });
  });

  it("labels an unsplit shared cost and opens the split", async () => {
    mountShared({
      review_status: "open",
      review_reason: "unallocated_shared",
      allocations: [],
    });
    expect(await screen.findByText("עלות משותפת · טרם פוצלה")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /עלות משותפת · טרם פוצלה/ }));
    expect(await screen.findByRole("heading", { name: "פיצול בין פרויקטים" })).toBeInTheDocument();
  });

  it("names the single project on a one-share row", async () => {
    mountShared({
      allocations: [{ project_id: "p1", project_name: "חולון", share_bp: 10000, amount_net: -1_000_000 }],
    });
    expect(await screen.findByRole("button", { name: /חולון/ })).toBeInTheDocument();
    expect(screen.queryByText(/מפוצל/)).not.toBeInTheDocument();
    expect(screen.queryByText(/טרם פוצלה/)).not.toBeInTheDocument();
  });

  it("saves a missing category on a split from the tap, and keeps no summary save button", async () => {
    mountShared({
      review_status: "open",
      review_reason: "missing_category",
      category_id: null,
      category_name: null,
      allocations: [
        { project_id: "p1", project_name: "חולון", share_bp: 6000, amount_net: -600_000 },
        { project_id: "p2", project_name: "וילה", share_bp: 4000, amount_net: -400_000 },
      ],
    });
    expect(await screen.findByText("מפוצל · 2 פרויקטים")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /בלי קטגוריה/ }));
    expect(screen.queryByRole("button", { name: "שמירה" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "שמירה ואישור" })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("radio", { name: "הובלה" }));
    await waitFor(() => {
      expect(rpc.calls.some((call) => call.name === "set_transaction_category" && (call.args as { p_category_id?: string }).p_category_id === "c2")).toBe(true);
    });
    expect(rpc.calls.some((call) => call.name === "reassign_transaction")).toBe(false);
  });

  it("rolls a failed split category back and retries that same category", async () => {
    let fail = true;
    let release: (() => void) | null = null;
    rpc.calls.length = 0;
    rpc.impl = (name) => {
      if (name === "get_transaction") {
        return Promise.resolve({
          data: {
            ...expense,
            amount_gross: -1_180_000,
            amount_net: -1_000_000,
            vat_amount: -180_000,
            project_id: null,
            project_name: null,
            pnl_role: "shared",
            allocations: [
              { project_id: "p1", project_name: "חולון", share_bp: 6000, amount_net: -600_000 },
              { project_id: "p2", project_name: "וילה", share_bp: 4000, amount_net: -400_000 },
            ],
          },
          error: null,
        });
      }
      if (name === "get_dashboard") {
        return Promise.resolve({
          data: {
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
            review_count: 0,
            projects: [project("p1", "חולון"), project("p2", "וילה")],
          },
          error: null,
        });
      }
      if (name === "list_categories") {
        return Promise.resolve({
          data: [
            { id: "c1", name: "חומרים", kind: "expense", hidden: false, is_default: false },
            { id: "c2", name: "הובלה", kind: "expense", hidden: false, is_default: false },
          ],
          error: null,
        });
      }
      if (name === "set_transaction_category") {
        if (fail) {
          return new Promise((resolve) => {
            release = () => {
              resolve({ data: null, error: { message: "Failed to fetch" } });
            };
          });
        }
        return Promise.resolve({ data: "undo-9", error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <BooksProvider>
            <MemoryRouter initialEntries={["/transactions/tx"]}>
              <Routes>
                <Route path="/transactions/:transactionId" element={<TransactionScreen />} />
              </Routes>
            </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /חומרים/ }));
    fireEvent.click(await screen.findByRole("radio", { name: "הובלה" }));
    const saving = await screen.findByRole("radio", { name: "הובלה" });
    expect(saving).toHaveAttribute("aria-busy", "true");
    expect(saving.querySelector(".ui-spinner")).not.toBeNull();
    expect(saving.querySelector(".ui-radio")?.textContent).not.toContain("✓");
    expect(getComputedStyle(saving).cursor).toBe("progress");
    expect(screen.getByRole("radio", { name: "חומרים" })).toBeDisabled();
    expect(getComputedStyle(screen.getByRole("radio", { name: "חומרים" })).cursor).toBe("not-allowed");
    await act(() => {
      release?.();
      return Promise.resolve();
    });
    expect(await screen.findByRole("button", { name: "ניסיון חוזר", hidden: true })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "הובלה" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("radio", { name: "חומרים" })).toHaveAttribute("aria-checked", "true");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "ניסיון חוזר", hidden: true }));
    await waitFor(() => {
      const calls = rpc.calls.filter((call) => call.name === "set_transaction_category");
      expect(calls).toHaveLength(2);
      expect(calls[1]?.args).toEqual({ p_id: "tx", p_category_id: "c2" });
    });
    expect(screen.getByRole("radio", { name: "הובלה" })).toHaveAttribute("aria-checked", "true");
    expect(rpc.calls.some((call) => call.name === "reassign_transaction")).toBe(false);
  });

  it("opens a split's category row on the category picker, with no unsplit step", async () => {
    rpc.calls.length = 0;
    rpc.impl = (name) => {
      if (name === "get_transaction") {
        return Promise.resolve({
          data: {
            ...expense,
            amount_gross: -1_180_000,
            amount_net: -1_000_000,
            vat_amount: -180_000,
            project_id: null,
            project_name: null,
            pnl_role: "shared",
            allocations: [
              { project_id: "p1", project_name: "חולון", share_bp: 6000, amount_net: -600_000 },
              { project_id: "p2", project_name: "וילה", share_bp: 4000, amount_net: -400_000 },
            ],
          },
          error: null,
        });
      }
      if (name === "get_dashboard") {
        return Promise.resolve({
          data: {
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
            review_count: 0,
            projects: [project("p1", "חולון"), project("p2", "וילה")],
          },
          error: null,
        });
      }
      if (name === "list_categories") {
        return Promise.resolve({
          data: [
            { id: "c1", name: "חומרים", kind: "expense", hidden: false, is_default: false },
            { id: "c2", name: "הובלה", kind: "expense", hidden: false, is_default: false },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    };
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <BooksProvider>
            <MemoryRouter initialEntries={["/transactions/tx"]}>
              <Routes>
                <Route path="/transactions/:transactionId" element={<TransactionScreen />} />
              </Routes>
            </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("מפוצל · 2 פרויקטים")).toBeInTheDocument();
    // FLOW-320: the split's own row opens the split. Unsplitting is לפרויקט אחד there.
    fireEvent.click(screen.getByRole("button", { name: /חומרים/ }));
    expect(await screen.findByRole("heading", { name: "בחירת קטגוריה" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /פרויקט: מפוצל · 2 פרויקטים/ })).not.toBeInTheDocument();
    expect(screen.queryByText("הפיצול ירד, והסכום כולו יעבור לפרויקט הזה.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "חזרה" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(rpc.calls.some((call) => call.name === "set_transaction_category" || call.name === "collapse_split")).toBe(false);
  });

  it("moves a split to one project by removing its part, and ביטול puts the shares back (FLOW-346)", async () => {
    rpc.calls.length = 0;
    rpc.impl = (name) => {
      if (name === "get_transaction") {
        return Promise.resolve({
          data: {
            ...expense,
            amount_gross: -1_180_000,
            amount_net: -1_000_000,
            vat_amount: -180_000,
            project_id: null,
            project_name: null,
            pnl_role: "shared",
            allocations: [
              { project_id: "p1", project_name: "חולון", share_bp: 6000, amount_net: -600_000 },
              { project_id: "p2", project_name: "וילה", share_bp: 4000, amount_net: -400_000 },
            ],
          },
          error: null,
        });
      }
      if (name === "get_dashboard") {
        return Promise.resolve({
          data: {
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
            review_count: 0,
            projects: [project("p1", "חולון"), project("p2", "וילה")],
          },
          error: null,
        });
      }
      if (name === "collapse_split") return Promise.resolve({ data: "undo-one", error: null });
      if (name === "undo_reassign") return Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: null, error: null });
    };
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <BooksProvider>
            <MemoryRouter initialEntries={["/transactions/tx/split"]}>
              <Routes>
                <Route path="/transactions/:transactionId" element={<TransactionScreen />} />
                <Route path="/transactions/:transactionId/split" element={<SplitScreen />} />
              </Routes>
            </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "הסרת החלק וילה" }));
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    await waitFor(() => {
      expect(rpc.calls.find((call) => call.name === "save_split")?.args).toEqual({
        p_transaction_id: "tx",
        p_shares: [{ project_id: "p1", amount_minor: 1_000_000 }],
      });
    });
    expect(rpc.calls.some((call) => call.name === "collapse_split")).toBe(false);
    fireEvent.click(await screen.findByRole("button", { name: "ביטול", hidden: true }));
    await waitFor(() => {
      expect(rpc.calls.filter((call) => call.name === "save_split").at(-1)?.args).toEqual({
        p_transaction_id: "tx",
        p_shares: [
          { project_id: "p2", amount_minor: 400_000 },
          { project_id: "p1", amount_minor: 600_000 },
        ],
      });
    });
  });

  it("holds a shared line until the rest has a project", () => {
    rpc.calls.length = 0;
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <BooksProvider>
            <MemoryRouter>
              <SplitScreen
                sampleAmount={1_000n}
                sampleProjects={[
                  { id: "p1", name: "חולון" },
                  { id: "p2", name: "וילה" },
                ]}
                sampleRestProject={null}
                sampleParts={[{ projectId: "p2", value: "4" }]}
              />
            </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    expect(screen.getByRole("heading", { name: "פיצול בין פרויקטים" })).toBeInTheDocument();
    expect(screen.getAllByText("בחרו פרויקט לשאר.").length).toBeGreaterThan(0);
    expect(rpc.calls.some((call) => call.name === "collapse_split" || call.name === "save_split")).toBe(false);
  });
});
