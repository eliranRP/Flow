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

function renderTxn(sample: NonNullable<Parameters<typeof TransactionScreen>[0]>["sample"]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
        <ToastProvider>
          <BooksProvider>
            <MemoryRouter>
              <TransactionScreen sample={sample} />
            </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
    </QueryClientProvider>,
  );
}

function mockTxnBooks(txn: Record<string, unknown> = {}) {
  rpc.calls.length = 0;
  rpc.impl = (name) => {
    if (name === "get_transaction") {
      return Promise.resolve({
        data: {
          ...expense,
          amount_gross: -1_180_000,
          amount_net: -1_000_000,
          vat_amount: -180_000,
          review_status: "open",
          ...txn,
          paid: false,
          open_gross_agorot: null,
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
          review_count: 1,
          projects: [
            project("p1", "חולון"),
            project("p2", "וילה"),
          ],
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
    if (name === "reassign_transaction") return Promise.resolve({ data: "undo-1", error: null });
    return Promise.resolve({ data: null, error: null });
  };
}

function mountTxn() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
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

describe("transaction status chips", () => {
  it("shows a queued expense as waiting and an unpaid invoice as uncollected", () => {
    const { unmount } = renderTxn({ ...expense, review_status: "open", paid: false, open_gross_agorot: null });
    expect(screen.getByText("ממתין לאישור")).toBeInTheDocument();
    expect(screen.queryByText("טרם נגבה")).not.toBeInTheDocument();
    expect(screen.queryByText("שולם")).not.toBeInTheDocument();
    unmount();

    renderTxn({
      ...expense,
      direction: "income",
      review_status: "approved",
      paid: false,
      open_gross_agorot: 500_000n,
      customer_name: "לקוח",
      supplier_name: null,
    });
    expect(screen.getByText("מאושר")).toBeInTheDocument();
    expect(screen.getByText("טרם נגבה")).toBeInTheDocument();
  });

  it("shows the VAT as a plain line, with no empty invoice row", () => {
    renderTxn(expense);
    expect(screen.getByText(/^מע״מ /)).toHaveTextContent("מע״מ −₪1,800 · מע״מ משוער 18%");
    expect(screen.queryByRole("button", { name: "חשבונית ותשלום" })).not.toBeInTheDocument();
    // FLOW-322: no document row or hint promises what the detail does not show (an invoice number, the bank line).
    expect(screen.queryByText(/מספר חשבונית|שורת הבנק/)).not.toBeInTheDocument();
  });

  it("hides the VAT line when a shekel line has no VAT", () => {
    renderTxn({ ...expense, amount_gross: -1_000_000n, vat_amount: 0n, vat_status: "source" });
    expect(screen.queryByText(/^מע״מ /)).not.toBeInTheDocument();
  });

  it("hides VAT and invoice rows for a USD expense", () => {
    renderTxn({
      ...expense,
      currency: "USD",
      amount_gross: -125_000n,
      amount_net: -125_000n,
      vat_amount: 0n,
      vat_status: "source",
    });
    expect(screen.getByText("−$1,250")).toBeInTheDocument();
    expect(screen.queryByText("לפני מע״מ")).not.toBeInTheDocument();
    expect(screen.queryByText(/^מע״מ /)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "חשבונית ותשלום" })).not.toBeInTheDocument();
  });

  it("shows a dollar detail in dollars", () => {
    renderTxn({
      ...expense,
      direction: "income",
      amount_gross: 1234n,
      amount_net: 1234n,
      vat_amount: 0n,
      currency: "USD",
      review_status: null,
      paid: null,
      open_gross_agorot: null,
      customer_name: "לקוח",
      supplier_name: null,
    });
    // The cents sit in their own span, drawn smaller; the figure still reads as one text.
    expect(screen.getByText((_, node) => node?.tagName === "BDI" && node.textContent === "$12.34")).toBeInTheDocument();
  });

  it("draws no status chip when the review and payment are unknown", () => {
    renderTxn({ ...expense, review_status: null, paid: null, open_gross_agorot: null });
    expect(screen.queryByText("ממתין לאישור")).not.toBeInTheDocument();
    expect(screen.queryByText("מאושר")).not.toBeInTheDocument();
    expect(screen.queryByText("טרם נגבה")).not.toBeInTheDocument();
    expect(screen.queryByText("שולם")).not.toBeInTheDocument();
  });
});

describe("transaction reassignment", () => {
  it("saves through reassign_transaction and invalidates the books", async () => {
    mockTxnBooks();
    mountTxn();
    expect(await screen.findByRole("heading", { name: "הוצאה" })).toBeInTheDocument();
    // FLOW-320: each row opens its own picker, and a pick closes the sheet.
    fireEvent.click(screen.getByRole("button", { name: /חולון/ }));
    fireEvent.click(await screen.findByRole("radio", { name: "וילה" }));
    await waitFor(() => {
      expect(rpc.calls.some((call) => call.name === "reassign_transaction")).toBe(true);
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    fireEvent.click(await screen.findByRole("button", { name: /חומרים/ }));
    fireEvent.click(await screen.findByRole("radio", { name: "הובלה" }));
    await waitFor(() => {
      const saved = rpc.calls.filter((call) => call.name === "reassign_transaction");
      expect(saved.at(-1)?.args).toEqual({ p_id: "tx", p_project_id: "p2", p_category_id: "c2" });
    });
    expect(screen.queryByRole("button", { name: "שמירה ואישור" })).not.toBeInTheDocument();
    expect(rpc.calls.filter((call) => call.name === "get_transaction").length).toBeGreaterThan(1);
    expect(await screen.findByText("השיוך נשמר")).toBeInTheDocument();
  });
});

describe("transaction detail pickers (FLOW-320)", () => {
  it("opens the project row on the project picker and returns focus to it on חזרה", async () => {
    mockTxnBooks();
    mountTxn();
    const row = await screen.findByRole("button", { name: /חולון/ });
    row.focus();
    fireEvent.click(row);
    expect(await screen.findByRole("dialog", { name: "בחירת פרויקט" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "שינוי שיוך" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "חזרה" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(row).toHaveFocus();
    }, { timeout: 2000 });
    expect(rpc.calls.some((call) => call.name === "reassign_transaction")).toBe(false);
  });

  it("opens the category row on the category picker and returns focus to it on Escape", async () => {
    mockTxnBooks();
    mountTxn();
    const row = await screen.findByRole("button", { name: /חומרים/ });
    row.focus();
    fireEvent.click(row);
    const dialog = await screen.findByRole("dialog", { name: "בחירת קטגוריה" });
    expect(screen.queryByRole("heading", { name: "שינוי שיוך" })).not.toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(row).toHaveFocus();
    }, { timeout: 2000 });
  });

  it("closes a picker on Back with no stop at the summary", async () => {
    mockTxnBooks();
    mountTxn();
    fireEvent.click(await screen.findByRole("button", { name: /חומרים/ }));
    expect(await screen.findByRole("dialog", { name: "בחירת קטגוריה" })).toBeInTheDocument();
    await act(async () => {
      window.dispatchEvent(new PopStateEvent("popstate"));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.queryByRole("heading", { name: "שינוי שיוך" })).not.toBeInTheDocument();
  });

  it("re-files the category in two taps and returns focus to the row", async () => {
    mockTxnBooks();
    mountTxn();
    const row = await screen.findByRole("button", { name: /חומרים/ });
    row.focus();
    fireEvent.click(row);
    fireEvent.click(await screen.findByRole("radio", { name: "הובלה" }));
    await waitFor(() => {
      expect(rpc.calls.find((call) => call.name === "reassign_transaction")?.args).toEqual({ p_id: "tx", p_project_id: "p1", p_category_id: "c2" });
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /הובלה/ })).toHaveFocus();
    }, { timeout: 2000 });
  });

  it("stops at the summary when a project pick still needs a category", async () => {
    mockTxnBooks({ category_id: null, category_name: null });
    mountTxn();
    fireEvent.click(await screen.findByRole("button", { name: /חולון/ }));
    fireEvent.click(await screen.findByRole("radio", { name: "וילה" }));
    expect(await screen.findByRole("heading", { name: "שינוי שיוך" })).toBeInTheDocument();
    expect(screen.getByText("בחרו קטגוריה.")).toBeInTheDocument();
    expect(rpc.calls.some((call) => call.name === "reassign_transaction")).toBe(false);
  });
});

describe("split between projects (FLOW-346)", () => {
  function sample(props: Partial<Parameters<typeof SplitScreen>[0]> = {}) {
    return render(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <BooksProvider>
            <MemoryRouter initialEntries={["/split"]}>
              <Routes>
                <Route
                  path="/split"
                  element={
                    <SplitScreen
                      sampleProjects={[
                        { id: "a", name: "חולון" },
                        { id: "b", name: "וילה" },
                      ]}
                      sampleAmount={2_866_316n}
                      sampleMeta="מוסך"
                      sampleRestProject="a"
                      backTo="/back"
                      {...props}
                    />
                  }
                />
                <Route path="/back" element={<h1>חזרה</h1>} />
              </Routes>
            </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
  }

  it("opens like the split by categories: the rest holds the line, no ways to choose", () => {
    sample();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByText("איך לפצל?")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "השאר, חולון, שינוי" })).toBeInTheDocument();
    expect(screen.getByText("הוספת חלק")).toBeInTheDocument();
    expect(screen.getByText("נשאר לשורה")).toBeInTheDocument();
  });

  it("leaves an untouched split without saving", async () => {
    const onSave = vi.fn(() => undefined);
    sample({ onSave });
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    expect(await screen.findByRole("heading", { name: "חזרה" })).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("saves exact cents: the part as typed, the rest on its project", async () => {
    const onSave = vi.fn(() => undefined);
    sample({ onSave, sampleParts: [{ projectId: "b", value: "8000" }] });
    expect(screen.getAllByText("₪20,663.16").length).toBeGreaterThan(0);
    fireEvent.change(screen.getByRole("textbox", { name: "סכום, וילה" }), { target: { value: "8000.01" } });
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    await waitFor(() => { expect(onSave).toHaveBeenCalledOnce(); });
    expect(onSave).toHaveBeenCalledWith([
      { project_id: "b", amount_minor: 800_001 },
      { project_id: "a", amount_minor: 2_066_315 },
    ]);
  });

  it("holds a split past the line once, then discards it", async () => {
    const onSave = vi.fn(() => undefined);
    sample({ onSave, sampleParts: [{ projectId: "b", value: "30000" }] });
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    expect(await screen.findByRole("button", { name: "ביטול השינוי" })).toBeInTheDocument();
    expect(screen.getByText("עוברים את השורה")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    expect(await screen.findByRole("heading", { name: "חזרה" })).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("names a project twice on the part", () => {
    sample({ sampleParts: [{ projectId: "a", value: "100" }] });
    expect(screen.getByText("הפרויקט הזה כבר בפיצול.")).toBeInTheDocument();
  });

  it("reopens a saved split and sends exact amounts to save_split", async () => {
    rpc.calls.length = 0;
    rpc.impl = (name) => {
      if (name === "get_dashboard") {
        return Promise.resolve({
          data: {
            company_id: "c",
            name: "אלפא",
            vat_registered: true,
            basis: "invoiced",
            from: null,
            to: null,
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
      if (name === "get_transaction") {
        return Promise.resolve({
          data: {
            id: "tx",
            description: "מלט",
            direction: "expense",
            doc_date: "2026-09-12",
            amount_gross: -10_000,
            amount_net: -10_000,
            vat_amount: 0,
            vat_status: "unknown",
            source: "manual",
            pnl_role: "shared",
            project_id: null,
            project_name: null,
            category_name: null,
            supplier_name: null,
            customer_name: null,
            allocations: [
              { project_id: "p1", share_bp: 7000, amount_net: -7_000 },
              { project_id: "p2", share_bp: 3000, amount_net: -3_000 },
            ],
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <BooksProvider>
            <MemoryRouter initialEntries={["/transactions/tx/split"]}>
              <Routes>
                <Route path="/transactions/:transactionId/split" element={<SplitScreen />} />
              </Routes>
            </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    const field = await screen.findByRole("textbox", { name: "סכום, וילה" });
    expect(field).toHaveValue("30");
    expect(screen.getByRole("button", { name: "השאר, חולון, שינוי" })).toBeInTheDocument();
    fireEvent.change(field, { target: { value: "25.5" } });
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    await waitFor(() => {
      expect(rpc.calls.some((call) => call.name === "save_split")).toBe(true);
    });
    expect(rpc.calls.find((call) => call.name === "save_split")?.args).toEqual({
      p_transaction_id: "tx",
      p_shares: [
        { project_id: "p2", amount_minor: 2_550 },
        { project_id: "p1", amount_minor: 7_450 },
      ],
    });
  });
});
