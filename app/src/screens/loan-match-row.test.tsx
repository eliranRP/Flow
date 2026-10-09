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
  splitsError: null as { message: string } | null,
  amountOriginal: 620_000,
  splits: [] as Array<Record<string, unknown>>,
  loanSplit: null as Record<string, unknown> | null,
  pnlFixed: true,
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
      if (table === "transactions") return { select: () => one({ amount_original: db.amountOriginal, currency: "ILS", company_id: "co-1" }) };
      if (table === "loans") return { select: () => one({ currency: "ILS" }) };
      if (table === "loan_splits") {
        return { select: () => ({ eq: () => Promise.resolve(db.splitsError ? { data: null, error: db.splitsError } : { data: db.splits, error: null }) }) };
      }
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
            pnl_fixed: db.pnlFixed,
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
  db.pnlFixed = true;
  db.reads = [];
  db.rpcs = [];
  db.saveError = null;
  db.clearError = null;
  db.splitsError = null;
  db.amountOriginal = 620_000;
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

  it("saves the edited parts in one save_loan_split, with the stored schedule and each part's category", async () => {
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
        { part: "interest", amount_minor: 168_000, scheduled_minor: 163_000, category_id: "cat-i" },
        { part: "escrow", amount_minor: 38_000, scheduled_minor: 38_000, category_id: "cat-e" },
        { part: "principal", amount_minor: 410_000, scheduled_minor: 415_000, category_id: "cat-p" },
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
    // The amount sits in its own LTR span (bdi).
    // FLOW-115: the line prints only the difference, in its own LTR span (bdi).
    expect(dialog.querySelector(".ui-loan-parts-problem")).toHaveTextContent("חסרים ₪150 כדי להגיע לסכום השורה.");
    expect(dialog.querySelector(".ui-loan-parts-problem bdi")).toHaveTextContent("₪150");
    expect(within(dialog).getByRole("button", { name: "שמירה" })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("סכום, קרן"), { target: { value: "4300" } });
    expect(dialog.querySelector(".ui-loan-parts-problem")).toHaveTextContent("יש ₪150 יותר מסכום השורה.");
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
        { part: "interest", amount_minor: 163_000, scheduled_minor: 163_000, category_id: "cat-i" },
        { part: "escrow", amount_minor: 38_000, scheduled_minor: 38_000, category_id: "cat-e" },
        { part: "principal", amount_minor: 415_000, scheduled_minor: 415_000, category_id: "cat-p" },
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
    for (const key of ["dashboard", "review", "search", "project", "project-category", "breakdown", "breakdown-lines", "profit-months", "txn", "loans", "loan-split", "line-split-loan"]) {
      expect(keys).toContain(key);
    }
    expect(new Set(keys)).toEqual(new Set(LOAN_WRITE_KEYS));
  });

  it("opens the parts read-only for a viewer: no fields, no actions, no read, no write", async () => {
    renderRow({ readOnly: true, currency: "ILS" });
    fireEvent.click(loanRow());
    const dialog = await screen.findByRole("dialog", { name: "משכנתא לדוגמה" });
    expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "שמירה" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "ביטול השיוך" })).not.toBeInTheDocument();
    expect(within(dialog).getByText("קרן")).toBeInTheDocument();
    expect(within(dialog).getByText("₪4,150")).toBeInTheDocument();
    expect(within(dialog).getByText("₪6,200")).toBeInTheDocument();
    await new Promise((r) => { setTimeout(r, 50); });
    expect(db.reads).toEqual([]);
    expect(db.rpcs).toEqual([]);
  });

  it("offers ניסיון חוזר when the stored parts fail to load, and reads them again", async () => {
    db.splitsError = { message: "offline" };
    renderRow();
    fireEvent.click(loanRow());
    const dialog = await screen.findByRole("dialog", { name: "משכנתא לדוגמה" });
    expect(await within(dialog).findByText("לא הצלחנו לטעון את הפיצול.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "שמירה" })).toBeDisabled();
    db.splitsError = null;
    fireEvent.click(within(dialog).getByRole("button", { name: "ניסיון חוזר" }));
    await waitFor(() => { expect(within(dialog).getByRole("button", { name: "שמירה" })).toBeEnabled(); });
    expect(within(dialog).queryByRole("button", { name: "ניסיון חוזר" })).not.toBeInTheDocument();
  });

  it("sends one undo however fast the toast is tapped", async () => {
    renderRow();
    const dialog = await openSheet();
    fireEvent.click(within(dialog).getByRole("button", { name: "ביטול השיוך" }));
    await screen.findByText("השיוך בוטל");
    const undo = screen.getByRole("button", { name: "ביטול" });
    fireEvent.click(undo);
    fireEvent.click(undo);
    await screen.findByText("השיוך חזר");
    expect(calls("save_loan_split")).toHaveLength(1);
  });

  it("undoes the unmatch of a flagged split with the line's new split, as the sheet would", async () => {
    // The line was re-synced to 6,200 while the parts still add up to 6,100.
    db.splits = STORED.map((part) => ({ ...part, needs_review: true, ...(part.part === "principal" ? { amount_minor: 405_000 } : {}) }));
    const flagged = STORED.map((part) => (part.part === "principal" ? { ...part, amount_minor: 405_000, needs_review: true } : { ...part, needs_review: true }));
    db.rpcs = [];
    renderRow({ split: { ...SPLIT, needs_review: true } });
    const dialog = await openSheet();
    // clear_loan_split returns the parts as they were.
    const cleared = flagged;
    const original = STORED.slice();
    STORED.splice(0, STORED.length, ...cleared);
    fireEvent.click(within(dialog).getByRole("button", { name: "ביטול השיוך" }));
    await screen.findByText("השיוך בוטל");
    STORED.splice(0, STORED.length, ...original);
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    await waitFor(() => { expect(calls("save_loan_split")).toHaveLength(1); });
    const parts = (calls("save_loan_split")[0]?.args as { p_parts: Array<{ part: string; amount_minor: number }> }).p_parts;
    expect(Object.fromEntries(parts.map((part) => [part.part, part.amount_minor]))).toEqual({
      interest: 163_000,
      escrow: 38_000,
      principal: 415_000,
      fees: 4_000,
    });
  });

  it("closes quietly when the line was already unmatched elsewhere", async () => {
    db.clearError = { message: "line has no loan split", code: "P0001" };
    const { invalidate } = renderRow();
    const dialog = await openSheet();
    fireEvent.click(within(dialog).getByRole("button", { name: "ביטול השיוך" }));
    await waitFor(() => { expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); });
    expect(screen.queryByText("לא הצלחנו לבטל את השיוך.")).not.toBeInTheDocument();
    expect(invalidate.mock.calls.some(([filters]) => (filters?.queryKey as string[] | undefined)?.[0] === "txn")).toBe(true);
  });

  it("offers a retry when another write changed the split meanwhile", async () => {
    db.clearError = { message: "loan split changed", code: "40001" };
    renderRow();
    const dialog = await openSheet();
    fireEvent.click(within(dialog).getByRole("button", { name: "ביטול השיוך" }));
    expect(await screen.findByText("השיוך השתנה בינתיים.")).toBeInTheDocument();
    // The toast's action (the open sheet hides the page from the accessibility tree).
    expect(screen.getByText("ניסיון חוזר").closest("button")).not.toBeNull();
  });

  it("closes and refreshes when a retry of a changed split finds it already unmatched", async () => {
    db.clearError = { message: "loan split changed", code: "40001" };
    const { invalidate } = renderRow();
    const dialog = await openSheet();
    fireEvent.click(within(dialog).getByRole("button", { name: "ביטול השיוך" }));
    expect(await screen.findByText("השיוך השתנה בינתיים.")).toBeInTheDocument();
    db.clearError = { message: "line has no loan split", code: "P0001" };
    invalidate.mockClear();
    const retry = screen.getByText("ניסיון חוזר").closest("button");
    if (retry == null) throw new Error("no retry");
    fireEvent.click(retry);
    await waitFor(() => { expect(calls("clear_loan_split")).toHaveLength(2); });
    await waitFor(() => { expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); });
    expect(screen.queryByText("לא הצלחנו לבטל את השיוך.")).not.toBeInTheDocument();
    const keys = invalidate.mock.calls.map(([filters]) => (filters?.queryKey as string[] | undefined)?.[0]);
    expect(new Set(keys)).toEqual(new Set(LOAN_WRITE_KEYS));
  });

  it("keeps ביטול השיוך off while the stored parts are read", async () => {
    renderRow();
    fireEvent.click(loanRow());
    const dialog = await screen.findByRole("dialog", { name: "משכנתא לדוגמה" });
    expect(within(dialog).getByRole("button", { name: "ביטול השיוך" })).toBeDisabled();
    await waitFor(() => { expect(within(dialog).getByRole("button", { name: "ביטול השיוך" })).toBeEnabled(); });
  });

  it("says the fees category does not fit", async () => {
    db.saveError = { message: "category does not fit the loan part" };
    renderRow();
    const dialog = await openSheet();
    fireEvent.click(within(dialog).getByRole("button", { name: "שמירה" }));
    expect(await screen.findByText("הקטגוריה לא מתאימה לחלק הזה.")).toBeInTheDocument();
  });

  it("marks a split that waits for review and opens it with the line's new split", async () => {
    db.splits = STORED.map((part) => ({ ...part, needs_review: true, ...(part.part === "principal" ? { amount_minor: 405_000 } : {}) }));
    renderRow({ split: { ...SPLIT, needs_review: true } });
    expect(loanRow()).toHaveTextContent("ממתין לבדיקה");
    const dialog = await openSheet();
    // 6,200 less the 40 fees: interest 1,630 and escrow 380 as scheduled; principal takes the rest.
    await waitFor(() => { expect(within(dialog).getByLabelText("סכום, קרן")).toHaveValue("4,150"); });
    // FLOW-115: the waiting line says why and prints only the change.
    expect(within(dialog).getByText("סכום השורה עלה ב־₪100, אז החלקים צריכים בדיקה. בדקו ושמרו.")).toBeInTheDocument();
  });

  it("says a correction failed in its own words and reads the parts again (FLOW-115)", async () => {
    db.splits = STORED.map((part) => ({ ...part, needs_review: true, ...(part.part === "principal" ? { amount_minor: 405_000 } : {}) }));
    db.saveError = { message: "boom" };
    renderRow({ split: { ...SPLIT, needs_review: true } });
    const dialog = await openSheet();
    await waitFor(() => { expect(within(dialog).getByLabelText("סכום, קרן")).toHaveValue("4,150"); });
    const reads = db.reads.filter((table) => table === "loan_splits").length;
    fireEvent.click(within(dialog).getByRole("button", { name: "שמירה" }));
    expect(await screen.findByText("לא הצלחנו לשמור את התיקון.")).toBeInTheDocument();
    await waitFor(() => { expect(db.reads.filter((table) => table === "loan_splits").length).toBeGreaterThan(reads); });
  });

  it("keeps what was typed when a correction fails (FLOW-115)", async () => {
    db.splits = STORED.map((part) => ({ ...part, needs_review: true, ...(part.part === "principal" ? { amount_minor: 405_000 } : {}) }));
    db.saveError = { message: "התשלום גבוה מיתרת ההלוואה", code: "P0001" };
    renderRow({ split: { ...SPLIT, needs_review: true } });
    const dialog = await openSheet();
    await waitFor(() => { expect(within(dialog).getByLabelText("סכום, קרן")).toHaveValue("4,150"); });
    fireEvent.change(within(dialog).getByLabelText("סכום, קרן"), { target: { value: "4100" } });
    fireEvent.change(within(dialog).getByLabelText("סכום, ריבית"), { target: { value: "1680" } });
    const reads = db.reads.filter((table) => table === "loan_splits").length;
    fireEvent.click(within(dialog).getByRole("button", { name: "שמירה" }));
    await waitFor(() => { expect(db.reads.filter((table) => table === "loan_splits").length).toBeGreaterThan(reads); });
    await new Promise((r) => { setTimeout(r, 50); });
    expect(within(dialog).getByLabelText("סכום, קרן")).toHaveValue("4,100");
    expect(within(dialog).getByLabelText("סכום, ריבית")).toHaveValue("1,680");
  });

  it("keeps the usual failure words on a split that does not wait for review", async () => {
    db.saveError = { message: "boom" };
    renderRow();
    const dialog = await openSheet();
    fireEvent.click(within(dialog).getByRole("button", { name: "שמירה" }));
    expect(await screen.findByText("לא הצלחנו לשמור את הפיצול.")).toBeInTheDocument();
  });

  it("corrects a flagged split again on every open", async () => {
    db.splits = STORED.map((part) => ({ ...part, needs_review: true, ...(part.part === "principal" ? { amount_minor: 405_000 } : {}) }));
    renderRow({ split: { ...SPLIT, needs_review: true } });
    let dialog = await openSheet();
    await waitFor(() => { expect(within(dialog).getByLabelText("סכום, קרן")).toHaveValue("4,150"); });
    fireEvent.click(within(dialog).getByRole("button", { name: "סגירה" }));
    await waitFor(() => { expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); });
    dialog = await openSheet();
    await waitFor(() => { expect(within(dialog).getByLabelText("סכום, קרן")).toHaveValue("4,150"); });
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

  it("keeps the P&L switch locked on a matched line even when pnl_fixed is false", async () => {
    db.pnlFixed = false;
    showLive();
    await screen.findByRole("button", { name: /^תשלום הלוואה · משכנתא לדוגמה/ });
    expect(await screen.findByText("לפי חלקי ההלוואה")).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: /נספר ברווח/ })).not.toBeInTheDocument();
  });

  it("gives a viewer the row and a read-only sheet", async () => {
    db.holdWrites = true;
    showLive();
    fireEvent.click(await screen.findByRole("button", { name: /^תשלום הלוואה · משכנתא לדוגמה/ }));
    const dialog = await screen.findByRole("dialog", { name: "משכנתא לדוגמה" });
    expect(within(dialog).getByText("$4,150")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "שמירה" })).not.toBeInTheDocument();
  });
});
