import { FunctionsHttpError } from "@supabase/supabase-js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const edge = vi.hoisted(() => ({
  invoke: (_name: string, _body?: unknown): Promise<{ data: unknown; error: unknown }> =>
    Promise.resolve({ data: null, error: null }),
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args?: unknown) => {
      rpc.calls.push({ name, args });
      return rpc.impl(name, args);
    },
    functions: {
      invoke: (name: string, body?: unknown) => edge.invoke(name, body),
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
    expect(screen.getAllByText(/הכנסות/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/הכנסות החודש/)).not.toBeInTheDocument();
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
    expect(screen.getByText("אפליקציה")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /התקנה למסך הבית/ })).toBeInTheDocument();
  });

  it("asks to check the id and the key when connect rejects the key", async () => {
    edge.invoke = () => Promise.resolve({
      data: null,
      error: new FunctionsHttpError({ json: () => Promise.resolve({ error: "sumit_auth" }) }),
    });
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
    fireEvent.click(screen.getByRole("button", { name: /חיבור SUMIT/ }));
    fireEvent.change(await screen.findByLabelText("מספר חברה"), { target: { value: "1001" } });
    fireEvent.change(screen.getByLabelText("מפתח API"), { target: { value: "secret-key" } });
    fireEvent.click(screen.getByRole("button", { name: /^חיבור$/ }));
    expect(await screen.findByText("החיבור נכשל. בדקו את המזהה ואת המפתח.")).toBeInTheDocument();
  });

  it("asks to retry when connect fails before SUMIT answers", async () => {
    edge.invoke = () => Promise.resolve({
      data: null,
      error: new Error("Failed to fetch"),
    });
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
    fireEvent.click(screen.getByRole("button", { name: /חיבור SUMIT/ }));
    fireEvent.change(await screen.findByLabelText("מספר חברה"), { target: { value: "1001" } });
    fireEvent.change(screen.getByLabelText("מפתח API"), { target: { value: "secret-key" } });
    fireEvent.click(screen.getByRole("button", { name: /^חיבור$/ }));
    expect(await screen.findByText("לא הצלחנו להתחבר. נסו שוב.")).toBeInTheDocument();
    expect(screen.queryByText(/בדקו/)).not.toBeInTheDocument();
  });

  it("disables refresh until the retry time and asks to reconnect after a bad key", () => {
    const later = new Date(Date.now() + 60 * 60_000).toISOString();
    const { unmount } = render(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <BooksProvider>
            <MemoryRouter>
              <SettingsScreen
                sample={{
                  name: "אלפא",
                  vatRegistered: true,
                  connected: true,
                  companyId: 1001,
                  lastError: "sumit_rejected",
                  nextAttemptAt: later,
                }}
              />
            </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    const heldButton = screen.getByRole("button", { name: /רענון עכשיו/ });
    expect(heldButton).toBeDisabled();
    expect(heldButton).toHaveClass("ui-row-clear-hint");
    expect(heldButton.querySelector(".ui-row-chevron")).toBeNull();
    expect(getComputedStyle(heldButton).opacity).toBe("1");
    expect(getComputedStyle(heldButton.querySelector(".ui-row-title") as Element).opacity).toBe("0.45");
    expect(getComputedStyle(heldButton.querySelector(".ui-row-icon") as Element).opacity).toBe("0.45");
    expect(screen.getByText("SUMIT לא זמין כרגע.")).toBeInTheDocument();
    expect(screen.queryByText(/נבדוק שוב מאוחר יותר/)).toBeNull();
    const hint = screen.getByText(/אפשר לנסות שוב ב-/);
    expect(hint.closest("button")).toBe(heldButton);
    expect(hint.querySelector("bdi")).toHaveAttribute("dir", "ltr");
    expect(getComputedStyle(hint).opacity).toBe("1");
    expect(getComputedStyle(hint).color).toBe(getComputedStyle(screen.getByText("עוסק מורשה")).color);
    unmount();

    vi.useFakeTimers();
    try {
      const soon = new Date(Date.now() + 5_000).toISOString();
      const held = render(
        <QueryClientProvider client={new QueryClient()}>
          <ToastProvider>
            <BooksProvider>
              <MemoryRouter>
                <SettingsScreen
                  sample={{
                    name: "אלפא",
                    vatRegistered: true,
                    connected: true,
                    companyId: 1001,
                    lastError: "sumit_rejected",
                    nextAttemptAt: soon,
                  }}
                />
              </MemoryRouter>
            </BooksProvider>
          </ToastProvider>
        </QueryClientProvider>,
      );
      expect(screen.getByRole("button", { name: /רענון עכשיו/ })).toBeDisabled();
      act(() => { vi.advanceTimersByTime(5_100); });
      const released = screen.getByRole("button", { name: /רענון עכשיו/ });
      expect(released).toBeEnabled();
      expect(released.querySelector(".ui-row-chevron")).not.toBeNull();
      held.unmount();
    } finally {
      vi.useRealTimers();
    }

    render(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <BooksProvider>
            <MemoryRouter>
              <SettingsScreen
                sample={{
                  name: "אלפא",
                  vatRegistered: true,
                  connected: true,
                  companyId: 1001,
                  lastError: "sumit_auth",
                  nextAttemptAt: null,
                }}
              />
            </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText("החיבור ל-SUMIT נכשל.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "חיבור מחדש" })).toBeInTheDocument();
    expect(screen.getAllByText(/מחדש/)).toHaveLength(1);
    const authRefresh = screen.getByRole("button", { name: /רענון עכשיו/ });
    expect(authRefresh).toBeDisabled();
    expect(authRefresh).toHaveClass("ui-row-clear-hint");
    expect(authRefresh.querySelector(".ui-row-chevron")).toBeNull();
    expect(getComputedStyle(authRefresh).opacity).toBe("1");
    const authHint = screen.getByText("המזהה או המפתח לא התקבלו");
    expect(authHint.closest("button")).toBe(authRefresh);
    expect(getComputedStyle(authHint).opacity).toBe("1");
    expect(getComputedStyle(authRefresh.querySelector(".ui-row-title") as Element).opacity).toBe("0.45");
  });
});

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
    fireEvent.click(await screen.findByRole("button", { name: "קטגוריה: חומרים, שינוי" }));
    fireEvent.click(await screen.findByRole("radio", { name: "הובלה" }));
    fireEvent.click(await screen.findByRole("button", { name: "שמירה" }));
    await waitFor(() => {
      expect(rpc.calls.some((call) => call.name === "set_transaction_category")).toBe(true);
    });
    expect(rpc.calls.some((call) => call.name === "reassign_transaction")).toBe(false);
    expect(rpc.calls.find((call) => call.name === "set_transaction_category")?.args).toEqual({
      p_id: "tx",
      p_category_id: "c2",
    });
    fireEvent.click(await screen.findByRole("button", { name: "ביטול" }));
    await waitFor(() => {
      expect(rpc.calls.some((call) => call.name === "undo_reassign" && (call.args as { p_id?: string }).p_id === "undo-9")).toBe(true);
    });
  });

  it("labels an unsplit shared cost, one share, and asks to save without approving", async () => {
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

  it("reads שמירה while an unallocated shared cost still needs a split", async () => {
    mountShared({
      review_status: "open",
      review_reason: "unallocated_shared",
      category_id: "c1",
      category_name: "חומרים",
      allocations: [
        { project_id: "p1", project_name: "חולון", share_bp: 6000, amount_net: -600_000 },
        { project_id: "p2", project_name: "וילה", share_bp: 4000, amount_net: -400_000 },
      ],
    });
    expect(await screen.findByText("מפוצל · 2 פרויקטים")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /חומרים/ }));
    expect(await screen.findByRole("button", { name: "שמירה" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "שמירה ואישור" })).not.toBeInTheDocument();
  });

  it("reads שמירה ואישור when a category save closes a missing category", async () => {
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
    expect(await screen.findByRole("button", { name: "שמירה ואישור" })).toBeInTheDocument();
  });

  it("reads שמירה when a shared cost has no allocations", async () => {
    mountShared({
      review_status: "open",
      review_reason: "missing_category",
      category_id: null,
      category_name: null,
      allocations: [],
    });
    expect(await screen.findByText("עלות משותפת · טרם פוצלה")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /בלי קטגוריה/ }));
    expect(await screen.findByRole("button", { name: "שמירה" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "שמירה ואישור" })).not.toBeInTheDocument();
  });
});

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
