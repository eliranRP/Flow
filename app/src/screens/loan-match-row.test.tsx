import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TransactionLoanSplit } from "@flow/shared";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { LoanCategoryRow } from "./loan-match-row";
import { LOAN_WRITE_KEYS } from "./loan-match-api";
import { TransactionScreen } from "./flow-screens";

// FLOW-114 option B. Invented data: a 6,200.00 payment on an invented loan, parts 4,150 / 1,630 / 380 / 40.
const db = vi.hoisted(() => ({
  holdWrites: false,
  reads: [] as string[],
  rpcs: [] as Array<{ name: string; args: unknown }>,
  saveError: null as { message: string; code?: string } | null,
  clearError: null as { message: string; code?: string } | null,
  splits: [] as Array<Record<string, unknown>>,
  loanSplit: null as Record<string, unknown> | null,
}));

const STORED = [
  { part: "interest", amount_minor: 163_000, scheduled_minor: 163_000, category_id: "cat-i", needs_review: false, loan_id: "loan-1" },
  { part: "escrow", amount_minor: 38_000, scheduled_minor: 38_000, category_id: "cat-e", needs_review: false, loan_id: "loan-1" },
  { part: "principal", amount_minor: 415_000, scheduled_minor: 415_000, category_id: "cat-p", needs_review: false, loan_id: "loan-1" },
  { part: "fees", amount_minor: 4_000, scheduled_minor: 4_000, category_id: "cat-f", needs_review: false, loan_id: "loan-1" },
];

const SPLIT: TransactionLoanSplit = {
  loan_id: "loan-1",
  loan_name: "משכנתא לדוגמה",
  needs_review: false,
  by_parts: true,
  parts: [
    { part: "interest", amount_minor: 163_000n, in_pnl: true },
    { part: "escrow", amount_minor: 38_000n, in_pnl: true },
    { part: "principal", amount_minor: 415_000n, in_pnl: false },
    { part: "fees", amount_minor: 4_000n, in_pnl: true },
  ],
};

vi.mock("../use-is-viewer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../use-is-viewer")>()),
  useHoldWrites: () => db.holdWrites,
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    auth: {
      getSession: () => Promise.resolve({ data: { session: { access_token: "t" } }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
    },
    from: (table: string) => {
      db.reads.push(table);
      const one = (data: unknown) => ({ eq: () => ({ single: () => Promise.resolve({ data, error: null }) }) });
      if (table === "transactions") return { select: () => one({ amount_original: 620_000, currency: "ILS", company_id: "co-1" }) };
      if (table === "loans") return { select: () => one({ currency: "ILS" }) };
      if (table === "loan_splits") return { select: () => ({ eq: () => Promise.resolve({ data: db.splits, error: null }) }) };
      return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
    },
    rpc: (name: string, args: unknown) => {
      db.rpcs.push({ name, args });
      if (name === "save_loan_split") return Promise.resolve({ data: null, error: db.saveError });
      if (name === "clear_loan_split") {
        return Promise.resolve(db.clearError
          ? { data: null, error: db.clearError }
          : { data: { transaction_id: "tx", loan_id: "loan-1", parts: STORED }, error: null });
      }
      if (name === "list_categories") {
        return Promise.resolve({
          data: [{ id: "cat-p", name: "תשלומי הלוואה", kind: "expense", hidden: false, is_default: true, excluded_from_pnl: true, loan_part: "principal" }],
          error: null,
        });
      }
      if (name === "get_transaction") {
        return Promise.resolve({
          data: {
            id: "tx",
            description: "בנק לדוגמה",
            direction: "expense",
            doc_date: "2026-10-01",
            amount_gross: -620_000,
            amount_net: -620_000,
            vat_amount: 0,
            currency: "USD",
            vat_status: "source",
            source: "mercury",
            pnl_role: "project",
            review_status: "approved",
            project_id: "p1",
            project_name: "פרויקט לדוגמה",
            category_id: "cat-p",
            category_name: "תשלומי הלוואה",
            supplier_name: "בנק לדוגמה",
            customer_name: null,
            paid: true,
            open_gross_agorot: null,
            allocations: [],
            in_pnl_override: null,
            category_excluded_from_pnl: true,
            in_pnl: true,
            pnl_fixed: true,
            loan_split: db.loanSplit,
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

function renderRow(props: Partial<ComponentProps<typeof LoanCategoryRow>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <LoanCategoryRow transactionId="tx" split={SPLIT} direction="expense" active readOnly={false} {...props}>
            <p>category row</p>
          </LoanCategoryRow>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { client, invalidate };
}

function loanRow() {
  return screen.getByRole("button", { name: /^תשלום הלוואה · משכנתא לדוגמה/ });
}

async function openSheet() {
  fireEvent.click(loanRow());
  const dialog = await screen.findByRole("dialog", { name: "משכנתא לדוגמה" });
  // The stored parts arrive, so שמירה turns on.
  await waitFor(() => { expect(within(dialog).getByRole("button", { name: "שמירה" })).toBeEnabled(); });
  return dialog;
}

function calls(name: string) {
  return db.rpcs.filter((call) => call.name === name);
}

beforeEach(() => {
  db.holdWrites = false;
  db.reads = [];
  db.rpcs = [];
  db.saveError = null;
  db.clearError = null;
  db.splits = STORED;
  db.loanSplit = null;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("LoanCategoryRow (FLOW-114 option B)", () => {
  it("shows a matched payment as one row with its part count, in place of the category row", () => {
    renderRow();
    expect(loanRow()).toHaveTextContent("קטגוריה");
    expect(loanRow()).toHaveTextContent("4 חלקים");
    expect(screen.queryByText("category row")).not.toBeInTheDocument();
  });

  it("shows the category row on a line with no loan split", () => {
    renderRow({ split: null });
    expect(screen.getByText("category row")).toBeInTheDocument();
  });

  it("saves the edited parts in one save_loan_split, with the stored schedule and the fees category", async () => {
    renderRow();
    const dialog = await openSheet();
    fireEvent.change(within(dialog).getByLabelText("סכום, קרן"), { target: { value: "4100" } });
    fireEvent.change(within(dialog).getByLabelText("סכום, ריבית"), { target: { value: "1680" } });
    expect(within(dialog).getByText("₪6,200")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "שמירה" }));
    await waitFor(() => { expect(calls("save_loan_split")).toHaveLength(1); });
    expect(calls("save_loan_split")[0]?.args).toEqual({
      p_transaction_id: "tx",
      p_loan_id: "loan-1",
      p_parts: [
        { part: "interest", amount_minor: 168_000, scheduled_minor: 163_000 },
        { part: "escrow", amount_minor: 38_000, scheduled_minor: 38_000 },
        { part: "principal", amount_minor: 410_000, scheduled_minor: 415_000 },
        { part: "fees", amount_minor: 4_000, scheduled_minor: 4_000, category_id: "cat-f" },
      ],
    });
    // No row-by-row writes and no separate review clear.
    expect(calls("clear_loan_split_review")).toHaveLength(0);
    expect(await screen.findByText("הפיצול נשמר")).toBeInTheDocument();
  });

  it("keeps שמירה off while the parts don't add up to the line", async () => {
    renderRow();
    const dialog = await openSheet();
    fireEvent.change(within(dialog).getByLabelText("סכום, קרן"), { target: { value: "4000" } });
    expect(within(dialog).getByText("הסה״כ צריך להיות ₪6,200.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "שמירה" })).toBeDisabled();
  });

  it("toasts the server's balance check and keeps the sheet and its values", async () => {
    db.saveError = { message: "loan balance exceeded", code: "P0001" };
    renderRow();
    const dialog = await openSheet();
    fireEvent.change(within(dialog).getByLabelText("סכום, קרן"), { target: { value: "4100" } });
    fireEvent.change(within(dialog).getByLabelText("סכום, ריבית"), { target: { value: "1680" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "שמירה" }));
    expect(await screen.findByText("התשלום גבוה מיתרת ההלוואה.")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "משכנתא לדוגמה" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("סכום, קרן")).toHaveValue("4,100");
  });

  it("unmatches with clear_loan_split, toasts השיוך בוטל, and undo saves the same parts back", async () => {
    renderRow();
    const dialog = await openSheet();
    fireEvent.click(within(dialog).getByRole("button", { name: "ביטול השיוך" }));
    await waitFor(() => { expect(calls("clear_loan_split")).toHaveLength(1); });
    expect(calls("clear_loan_split")[0]?.args).toEqual({ p_transaction_id: "tx" });
    expect(await screen.findByText("השיוך בוטל")).toBeInTheDocument();
    expect(calls("save_loan_split")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    await waitFor(() => { expect(calls("save_loan_split")).toHaveLength(1); });
    expect(calls("save_loan_split")[0]?.args).toEqual({
      p_transaction_id: "tx",
      p_loan_id: "loan-1",
      p_parts: [
        { part: "interest", amount_minor: 163_000, scheduled_minor: 163_000 },
        { part: "escrow", amount_minor: 38_000, scheduled_minor: 38_000 },
        { part: "principal", amount_minor: 415_000, scheduled_minor: 415_000 },
        { part: "fees", amount_minor: 4_000, scheduled_minor: 4_000, category_id: "cat-f" },
      ],
    });
    expect(await screen.findByText("השיוך חזר")).toBeInTheDocument();
  });

  it("refreshes the P&L, the card and the loans after a save and after an unmatch", async () => {
    const { invalidate } = renderRow();
    const dialog = await openSheet();
    fireEvent.click(within(dialog).getByRole("button", { name: "ביטול השיוך" }));
    await screen.findByText("השיוך בוטל");
    const keys = invalidate.mock.calls.map(([filters]) => (filters?.queryKey as string[] | undefined)?.[0]);
    for (const key of ["dashboard", "home", "project", "project-category", "breakdown", "breakdown-lines", "profit-months", "txn", "loans", "loan-split", "line-split-loan"]) {
      expect(keys).toContain(key);
    }
    expect(new Set(keys)).toEqual(new Set(LOAN_WRITE_KEYS));
  });

  it("is a static row for a viewer: no sheet, no read, no write", async () => {
    renderRow({ readOnly: true });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    const row = screen.getByText("תשלום הלוואה · משכנתא לדוגמה");
    fireEvent.click(row);
    await new Promise((r) => { setTimeout(r, 50); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(db.reads).toEqual([]);
    expect(db.rpcs).toEqual([]);
  });

  it("marks a split that waits for review and opens it with the line's new split", async () => {
    db.splits = STORED.map((part) => ({ ...part, needs_review: true, ...(part.part === "principal" ? { amount_minor: 405_000 } : {}) }));
    renderRow({ split: { ...SPLIT, needs_review: true } });
    expect(loanRow()).toHaveTextContent("ממתין לבדיקה");
    const dialog = await openSheet();
    // 6,200 less the 40 fees: interest 1,630 and escrow 380 as scheduled; principal takes the rest.
    await waitFor(() => { expect(within(dialog).getByLabelText("סכום, קרן")).toHaveValue("4,150"); });
    expect(within(dialog).getByText("סכום השורה השתנה. בדקו את החלקים ושמרו.")).toBeInTheDocument();
  });
});

describe("the transaction card with a matched payment", () => {
  function showLive() {
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

  beforeEach(() => {
    db.loanSplit = {
      loan_id: "loan-1",
      loan_name: "משכנתא לדוגמה",
      needs_review: false,
      by_parts: true,
      parts: [
        { part: "interest", amount_minor: 163_000, in_pnl: true },
        { part: "escrow", amount_minor: 38_000, in_pnl: true },
        { part: "principal", amount_minor: 415_000, in_pnl: false },
      ],
    };
  });

  it("reads the split from get_transaction, with no separate split read", async () => {
    showLive();
    expect(await screen.findByRole("button", { name: /^תשלום הלוואה · משכנתא לדוגמה/ })).toHaveTextContent("3 חלקים");
    await new Promise((r) => { setTimeout(r, 50); });
    expect(db.reads).not.toContain("loan_splits");
    expect(db.rpcs.map((call) => call.name)).not.toContain("get_loan_split");
  });

  it("locks the category while matched: the row opens the split, never the category picker", async () => {
    showLive();
    const row = await screen.findByRole("button", { name: /^תשלום הלוואה · משכנתא לדוגמה/ });
    expect(screen.queryByRole("button", { name: /^קטגוריה/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^הלוואה,? ?שיוך להלוואה/ })).not.toBeInTheDocument();
    // The split by category stays off while the line is matched (decision 0136).
    expect(await screen.findByRole("button", { name: "פיצול לפי קטגוריות" })).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(row);
    expect(await screen.findByRole("dialog", { name: "משכנתא לדוגמה" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "בחירת קטגוריה" })).not.toBeInTheDocument();
  });

  it("gives a viewer the static row and no sheet", async () => {
    db.holdWrites = true;
    showLive();
    expect(await screen.findByText("תשלום הלוואה · משכנתא לדוגמה")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^תשלום הלוואה/ })).not.toBeInTheDocument();
  });
});
