import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { SettingsScreen, SplitScreen, TransactionScreen } from "./flow-screens";

const rpc = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; args: unknown }>,
  impl: (_name: string, _args?: unknown): Promise<{ data: unknown; error: { message: string } | null }> =>
    Promise.resolve({ data: null, error: null }),
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args?: unknown) => {
      rpc.calls.push({ name, args });
      return rpc.impl(name, args);
    },
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
    expect(await screen.findByRole("heading", { name: "הוצאה" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /חולון/ }));
    fireEvent.click(await screen.findByRole("button", { name: "פרויקט: חולון, שינוי" }));
    fireEvent.click(await screen.findByRole("radio", { name: "וילה" }));
    fireEvent.click(await screen.findByRole("button", { name: "קטגוריה: חומרים, שינוי" }));
    fireEvent.click(await screen.findByRole("radio", { name: "הובלה" }));
    fireEvent.click(await screen.findByRole("button", { name: "שמירה ואישור" }));
    await waitFor(() => {
      expect(rpc.calls.some((call) => call.name === "reassign_transaction")).toBe(true);
    });
    const saved = rpc.calls.find((call) => call.name === "reassign_transaction");
    expect(saved?.args).toEqual({ p_id: "tx", p_project_id: "p2", p_category_id: "c2" });
    expect(rpc.calls.filter((call) => call.name === "get_transaction").length).toBeGreaterThan(1);
    expect(await screen.findByText("השיוך נשמר")).toBeInTheDocument();
  });
});

describe("split monthly rule", () => {
  it("hides the monthly toggle and shows a full income split as done", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <BooksProvider>
          <MemoryRouter>
            <SplitScreen
              sampleProjects={[
                { id: "p1", name: "חולון", incomeAgorot: 2n },
                { id: "p2", name: "וילה", incomeAgorot: 1n },
              ]}
              sampleAmount={10_000n}
              sampleContext="מלט"
            />
          </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(screen.queryByRole("switch", { name: "לפצל כך כל חודש" })).not.toBeInTheDocument();
    expect(screen.queryByText("כלל חודשי יגיע בהמשך")).not.toBeInTheDocument();
    expect(screen.queryByText("אופן הפיצול")).not.toBeInTheDocument();
    expect(screen.getAllByText(/הכנסות החודש/).length).toBeGreaterThan(0);
    expect(screen.getByText(/100%/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "שמירת פיצול" })).toBeEnabled();
  });

  it("disables save while a manual split is only partly allocated", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <BooksProvider>
          <MemoryRouter>
            <SplitScreen
              sampleMethod="manual"
              sampleShares={{ p1: "40" }}
              sampleProjects={[
                { id: "p1", name: "חולון", incomeAgorot: 2n },
                { id: "p2", name: "וילה", incomeAgorot: 1n },
              ]}
              sampleAmount={10_000n}
              sampleContext="מלט"
            />
          </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(screen.queryByText(/100%/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "שמירת פיצול" })).toBeDisabled();
  });

  it("saves only the shares", async () => {
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
            active_projects: 1,
            review_count: 0,
            projects: [project("p1", "חולון")],
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
            amount_gross: -100,
            amount_net: -100,
            vat_amount: 0,
            vat_status: "unknown",
            source: "manual",
            project_name: null,
            category_name: null,
            supplier_name: null,
            customer_name: null,
          },
          error: null,
        });
      }
      if (name === "save_split") return Promise.resolve({ data: null, error: null });
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
    fireEvent.click(await screen.findByRole("button", { name: "שמירת פיצול" }));
    await waitFor(() => {
      expect(rpc.calls.some((call) => call.name === "save_split")).toBe(true);
    });
    const saved = rpc.calls.find((call) => call.name === "save_split");
    expect(saved?.args).toEqual({
      p_transaction_id: "tx",
      p_shares: [{ project_id: "p1", share_bp: 10000 }],
    });
  });
});

describe("notification switches", () => {
  it("stays off and says they are inactive", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <BooksProvider>
          <MemoryRouter>
            <SettingsScreen
              sample={{
                name: "אלפא",
                vatRegistered: true,
                connected: false,
                companyId: null,
                lastError: null,
              }}
            />
          </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    for (const name of ["סיכום שבועי", "תזכורת לפריטים ממתינים", "אישור אוטומטי בביטחון גבוה"]) {
      const toggle = screen.getByRole("switch", { name });
      expect(toggle).toBeDisabled();
      expect(toggle).not.toBeChecked();
    }
    expect(screen.getAllByText("לא פעיל").length).toBeGreaterThanOrEqual(3);
  });
});

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
