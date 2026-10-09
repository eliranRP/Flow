import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import { useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../ui/toast";
import { LoanBalanceList, LoanMatchOffer, LoanTransactionSplit, ProjectLoanList, loanMatchHint } from "./loan-match";

const db = vi.hoisted(() => ({
  txn: { company_id: "co-1", amount_original: 100_000, currency: "ILS" },
  splits: [] as Array<{
    id: string;
    part: string;
    amount_minor: number;
    scheduled_minor: number;
    needs_review: boolean;
    loan_id: string;
  }>,
  /** Every table read, by table name. */
  reads: [] as string[],
  rpcs: [] as Array<{ name: string; args: unknown }>,
  /** mcp_loan_payments rows by loan id (FLOW-106). */
  payments: new Map<string, unknown[]>(),
  /** Every category, for the split editor's fees picker (FLOW-106). */
  allCategories: [
    { id: "cat-i", name: "ריבית", kind: "expense", loan_part: "interest", excluded_from_pnl: false, hidden: false },
    { id: "cat-bank", name: "עמלות בנק", kind: "expense", loan_part: null, excluded_from_pnl: false, hidden: false },
  ],
  loanUpdates: [] as Array<{ values: unknown; id: unknown }>,
  saveError: null as { message: string; code?: string } | null,
  saveHold: null as Promise<void> | null,
  readError: null as { message: string } | null,
  readHold: null as Promise<void> | null,
  loans: [{
    id: "loan-1",
    name: "הלוואת דוגמה",
    currency: "ILS",
    principal_minor: 10_000_000,
    annual_rate_ppm: 60_000,
    term_months: 360,
    start_date: "2026-02-01",
    payment_minor: 59_955,
    escrow_minor: 0,
  }],
  balances: [{ loan_id: "loan-1", balance_minor: 10_000_000 }],
  categories: [
    { id: "cat-i", loan_part: "interest" },
    { id: "cat-e", loan_part: "escrow" },
    { id: "cat-p", loan_part: "principal" },
  ],
}));

const loan = {
  id: "loan-1",
  name: "הלוואת דוגמה",
  currency: "ILS",
  principalMinor: 10_000_000,
  annualRatePpm: 60_000,
  termMonths: 360,
  startDate: "2026-02-01",
  paymentMinor: 59_955,
  escrowMinor: 0,
  balanceMinor: 10_000_000n,
};
const MATCH_ROW = /^הלוואה,? ?שיוך להלוואה/;

function matchButton() {
  return screen.getByRole("button", { name: MATCH_ROW });
}

function held<T>(finish: () => T): Promise<T> {
  return db.readHold ? db.readHold.then(() => finish()) : Promise.resolve(finish());
}

vi.mock("../use-is-viewer", () => ({
  useHoldWrites: () => false,
  useViewerNoteId: () => undefined,
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    from: (table: string) => {
      db.reads.push(table);
      if (table === "transactions") {
        return {
          select: () => ({
            eq: () => ({
              single: () => held(() => ({ data: db.readError ? null : db.txn, error: db.readError })),
            }),
          }),
        };
      }
      if (table === "loan_splits") {
        return { select: () => ({ eq: () => held(() => ({ data: db.splits, error: null })) }) };
      }
      if (table === "loans") {
        return {
          select: () => ({ eq: () => held(() => ({ data: db.loans, error: null })) }),
          update: (values: unknown) => ({
            eq: (_column: string, id: unknown) => {
              db.loanUpdates.push({ values, id });
              return Promise.resolve({ data: null, error: null });
            },
          }),
        };
      }
      if (table === "categories") {
        return {
          select: () => ({
            eq: () => ({ eq: () => ({ not: () => held(() => ({ data: db.categories, error: null })) }) }),
            order: () => Promise.resolve({ data: db.allCategories, error: null }),
          }),
        };
      }
      if (table === "loan_balances") {
        return { select: () => ({ eq: () => held(() => ({ data: db.balances, error: null })) }) };
      }
      throw new Error(table);
    },
    rpc: (name: string, args: unknown) => {
      db.rpcs.push({ name, args });
      if (name === "save_loan_split") {
        const finish = () => ({ data: null, error: db.saveError });
        return db.saveHold ? db.saveHold.then(finish) : Promise.resolve(finish());
      }
      if (name === "mcp_loan_payments") {
        const loanId = (args as { p_loan_id: string }).p_loan_id;
        return Promise.resolve({ data: db.payments.get(loanId) ?? [], error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

function saves() {
  return db.rpcs.filter((call) => call.name === "save_loan_split").map((call) => call.args as {
    p_transaction_id: string;
    p_loan_id: string;
    p_parts: Array<Record<string, unknown>>;
  });
}

function OfferHarness(props: Partial<ComponentProps<typeof LoanMatchOffer>> = {}) {
  const [open, setOpen] = useState(false);
  return (
    <MemoryRouter>
      <LoanMatchOffer
        lineCurrency="ILS"
        loans={[loan]}
        busy={false}
        sheetOpen={open}
        onSheetOpenChange={setOpen}
        onMatch={vi.fn()}
        {...props}
      />
    </MemoryRouter>
  );
}

function renderSplit(props: Partial<ComponentProps<typeof LoanTransactionSplit>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <LoanTransactionSplit
            transactionId="txn-1"
            docDate="2026-02-01"
            loanPart="principal"
            direction="expense"
            active
            {...props}
          />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { client, ...view };
}

beforeEach(() => {
  db.txn = { company_id: "co-1", amount_original: 100_000, currency: "ILS" };
  db.splits = [];
  db.reads = [];
  db.rpcs = [];
  db.payments = new Map();
  db.loanUpdates = [];
  db.saveError = null;
  db.saveHold = null;
  db.readError = null;
  db.readHold = null;
  db.loans = [{
    id: "loan-1",
    name: "הלוואת דוגמה",
    currency: "ILS",
    principal_minor: 10_000_000,
    annual_rate_ppm: 60_000,
    term_months: 360,
    start_date: "2026-02-01",
    payment_minor: 59_955,
    escrow_minor: 0,
  }];
  db.balances = [{ loan_id: "loan-1", balance_minor: 10_000_000 }];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("LoanMatchOffer", () => {
  it("offers a loan when the line is not split yet", () => {
    const onMatch = vi.fn();
    render(<OfferHarness onMatch={onMatch} />);
    fireEvent.click(screen.getByRole("button", { name: /שיוך להלוואה/ }));
    fireEvent.click(screen.getByRole("radio", { name: "הלוואת דוגמה" }));
    expect(onMatch).toHaveBeenCalledWith("loan-1");
  });

  it("names the line's currency when every loan is in another one (FLOW-115)", () => {
    render(<OfferHarness lineCurrency="USD" />);
    fireEvent.click(screen.getByRole("button", { name: /שיוך להלוואה/ }));
    expect(screen.getByText("אין הלוואה בדולר.")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("hides matching for a viewer", () => {
    render(<OfferHarness readOnly />);
    expect(screen.queryByRole("button", { name: /שיוך להלוואה/ })).not.toBeInTheDocument();
  });

  it("shows a busy radio while a match is saving", () => {
    render(<OfferHarness savingId="loan-1" />);
    fireEvent.click(screen.getByRole("button", { name: /שיוך להלוואה/ }));
    expect(screen.getByRole("radio", { name: "הלוואת דוגמה" })).toHaveAttribute("aria-busy", "true");
  });
});

describe("LoanBalanceList", () => {
  it("shows the balance and a waiting hint", () => {
    render(
      <LoanBalanceList
        rows={[{
          id: "loan-1",
          name: "הלוואת דוגמה",
          currency: "ILS",
          balanceMinor: 11_700_000n,
          flaggedParts: 3,
        }]}
      />,
    );
    expect(screen.getByText("הלוואת דוגמה")).toBeInTheDocument();
    const amount = screen.getByText("₪117,000");
    // FLOW-501: cents are drawn small, ".00" included.
    expect(amount).toHaveTextContent("₪117,000.00");
    expect(amount.querySelector(".ui-num-cents")).toHaveTextContent(".00");
    expect(screen.getByText("ממתין לבדיקה")).toBeInTheDocument();
  });

  it("joins the waiting hint and the project, and names the project on the owner's button", () => {
    render(
      <LoanBalanceList
        rows={[
          { id: "loan-1", name: "הלוואת דוגמה", currency: "ILS", balanceMinor: 100n, flaggedParts: 1, projectId: "p-a", projectName: "פרויקט א" },
          { id: "loan-2", name: "הלוואה שנייה", currency: "ILS", balanceMinor: 100n, flaggedParts: 0, projectId: null, projectName: null },
        ]}
        onOpen={() => undefined}
      />,
    );
    expect(screen.getByText("ממתין לבדיקה · פרויקט א")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^הלוואת דוגמה, .*פרויקט: פרויקט א$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^הלוואה שנייה, .*פרויקט: ללא פרויקט$/ })).toBeInTheDocument();
  });
});

describe("ProjectLoanList", () => {
  it("shows each loan's balance and marks a paid-off loan", () => {
    render(
      <ProjectLoanList
        rows={[
          { id: "loan-1", name: "הלוואת דוגמה", currency: "ILS", balance_minor: 11_700_000n },
          { id: "loan-2", name: "הלוואה שנפרעה", currency: "ILS", balance_minor: 0n },
        ]}
      />,
    );
    expect(screen.getByText("₪117,000")).toBeInTheDocument();
    expect(screen.getAllByText("נפרעה")).toHaveLength(1);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("LoanTransactionSplit", () => {
  it("sends one save_loan_split when the loan row is tapped twice while pending", async () => {
    let release!: () => void;
    db.saveHold = new Promise<void>((resolve) => { release = resolve; });
    renderSplit();
    await waitFor(() => { expect(matchButton()).toBeInTheDocument(); });
    fireEvent.click(matchButton());
    const radio = screen.getByRole("radio", { name: "הלוואת דוגמה" });
    fireEvent.click(radio);
    await waitFor(() => { expect(saves()).toHaveLength(1); });
    fireEvent.click(radio);
    await new Promise((r) => { setTimeout(r, 50); });
    expect(saves()).toHaveLength(1);
    act(() => { release(); });
    await new Promise((r) => { setTimeout(r, 50); });
    expect(saves()).toHaveLength(1);
  });

  it("matches in one call: the line, the loan and the schedule's parts, no categories and no table writes", async () => {
    renderSplit();
    await waitFor(() => { expect(matchButton()).toBeInTheDocument(); });
    fireEvent.click(matchButton());
    fireEvent.click(screen.getByRole("radio", { name: "הלוואת דוגמה" }));
    await waitFor(() => { expect(saves()).toHaveLength(1); });
    const [call] = saves();
    expect(call?.p_transaction_id).toBe("txn-1");
    expect(call?.p_loan_id).toBe("loan-1");
    expect(call?.p_parts.map((part) => part.part)).toEqual(["interest", "escrow", "principal"]);
    expect(call?.p_parts.reduce((sum, part) => sum + Number(part.amount_minor), 0)).toBe(100_000);
    // The server files each part under the loan's category, else the keyed default (0128).
    expect(call?.p_parts.some((part) => "category_id" in part)).toBe(false);
    expect(db.rpcs.filter((item) => item.name === "clear_loan_split_review")).toHaveLength(0);
  });

  it("matches a loan with no balance row yet: it is not read as paid off (FLOW-115)", async () => {
    db.balances = [];
    renderSplit();
    await waitFor(() => { expect(matchButton()).toBeInTheDocument(); });
    fireEvent.click(matchButton());
    fireEvent.click(screen.getByRole("radio", { name: "הלוואת דוגמה" }));
    await waitFor(() => { expect(saves()).toHaveLength(1); });
  });

  it("says the loan closed before the payment date (FLOW-136)", async () => {
    db.saveError = { message: "loan closed" };
    renderSplit();
    await waitFor(() => { expect(matchButton()).toBeInTheDocument(); });
    fireEvent.click(matchButton());
    fireEvent.click(screen.getByRole("radio", { name: "הלוואת דוגמה" }));
    await waitFor(() => { expect(screen.getByText("ההלוואה נסגרה לפני תאריך התשלום.")).toBeInTheDocument(); });
  });

  it("toasts the server's balance check", async () => {
    db.saveError = { message: "loan balance exceeded", code: "P0001" };
    renderSplit();
    await waitFor(() => { expect(matchButton()).toBeInTheDocument(); });
    fireEvent.click(matchButton());
    fireEvent.click(screen.getByRole("radio", { name: "הלוואת דוגמה" }));
    await waitFor(() => { expect(screen.getByText("התשלום גבוה מיתרת ההלוואה.")).toBeInTheDocument(); });
  });

  it("shows a paid-off loan disabled with its reason", async () => {
    db.balances = [{ loan_id: "loan-1", balance_minor: 0 }];
    renderSplit();
    await waitFor(() => { expect(matchButton()).toBeInTheDocument(); });
    fireEvent.click(matchButton());
    const radio = screen.getByRole("radio", { name: "הלוואת דוגמה" });
    expect(radio).toBeDisabled();
    expect(radio).toHaveAccessibleDescription("ההלוואה נפרעה");
    fireEvent.click(radio);
    expect(saves()).toHaveLength(0);
  });

  it("shows a busy radio while the save is pending", async () => {
    let release!: () => void;
    db.saveHold = new Promise<void>((resolve) => { release = resolve; });
    renderSplit();
    await waitFor(() => { expect(matchButton()).toBeInTheDocument(); });
    fireEvent.click(matchButton());
    fireEvent.click(screen.getByRole("radio", { name: "הלוואת דוגמה" }));
    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "הלוואת דוגמה" })).toHaveAttribute("aria-busy", "true");
    });
    act(() => { release(); });
  });

  it("does not offer שיוך on a category that is not the loan principal", async () => {
    const first = renderSplit({ loanPart: null });
    await new Promise((r) => { setTimeout(r, 50); });
    expect(screen.queryByRole("button", { name: MATCH_ROW })).not.toBeInTheDocument();
    first.unmount();
    renderSplit({ loanPart: "interest" });
    await new Promise((r) => { setTimeout(r, 50); });
    expect(screen.queryByRole("button", { name: MATCH_ROW })).not.toBeInTheDocument();
  });

  it("offers שיוך on a loan's own principal category (FLOW-134)", async () => {
    const own = { ...db.loans[0], interest_category_id: null, escrow_category_id: null, principal_category_id: "cat-own-p" };
    db.loans = [own as (typeof db.loans)[number]];
    renderSplit({ loanPart: null, categoryId: "cat-own-p" });
    await waitFor(() => { expect(matchButton()).toBeInTheDocument(); });
    const other = renderSplit({ loanPart: null, categoryId: "cat-other" });
    // Wait for this instance's read to land: a line on another category renders nothing while it loads too.
    await waitFor(() => { expect(other.client.isFetching()).toBe(0); });
    await waitFor(() => { expect(other.client.getQueryCache().getAll().every((query) => query.state.status === "success" || query.isDisabled())).toBe(true); });
    expect(within(other.container).queryByRole("button", { name: MATCH_ROW })).not.toBeInTheDocument();
  });

  it("does not offer שיוך while the read is loading", async () => {
    db.readHold = new Promise<void>(() => undefined);
    renderSplit();
    await waitFor(() => { expect(screen.queryByRole("button", { name: MATCH_ROW })).not.toBeInTheDocument(); });
  });

  it("shows retry after a failed read and hides שיוך", async () => {
    db.readError = { message: "offline" };
    renderSplit();
    await waitFor(() => { expect(screen.getByRole("button", { name: "ניסיון חוזר: שיוך להלוואה" })).toBeInTheDocument(); });
    expect(screen.queryByRole("button", { name: MATCH_ROW })).not.toBeInTheDocument();
    db.readError = null;
    fireEvent.click(screen.getByRole("button", { name: "ניסיון חוזר: שיוך להלוואה" }));
    await waitFor(() => { expect(matchButton()).toBeInTheDocument(); });
  });

  it("disables a loan whose balance is below the payment's principal, before any save (FLOW-106)", async () => {
    db.balances = [{ loan_id: "loan-1", balance_minor: 100 }];
    renderSplit();
    await waitFor(() => { expect(matchButton()).toBeInTheDocument(); });
    fireEvent.click(matchButton());
    const radio = screen.getByRole("radio", { name: /הלוואת דוגמה/ });
    expect(radio).toBeDisabled();
    expect(within(radio).getByText("התשלום גבוה מיתרת ההלוואה")).toBeInTheDocument();
    fireEvent.click(radio);
    expect(saves()).toHaveLength(0);
  });

  it("says what one tap writes: the schedule row for the line's date (FLOW-106)", async () => {
    renderSplit();
    await waitFor(() => { expect(matchButton()).toBeInTheDocument(); });
    fireEvent.click(matchButton());
    expect(within(screen.getByRole("radio", { name: /הלוואת דוגמה/ })).getByText("לפי הלוח · ₪599.55")).toBeInTheDocument();
  });

  it("writes a catch-up line as that many installments when it equals them to the cent (FLOW-106)", async () => {
    // Two schedule rows of 100,000.00 at 6% over 360 months: 599.55 each.
    db.txn = { ...db.txn, amount_original: 119_910 };
    renderSplit({ docDate: "2026-03-01" });
    await waitFor(() => { expect(matchButton()).toBeInTheDocument(); });
    fireEvent.click(matchButton());
    const radio = screen.getByRole("radio", { name: /הלוואת דוגמה/ });
    expect(within(radio).getByText("2 תשלומים לפי הלוח · ₪1,199.10")).toBeInTheDocument();
    fireEvent.click(radio);
    await waitFor(() => { expect(saves()).toHaveLength(1); });
    const parts = saves()[0]?.p_parts ?? [];
    expect(parts.map((part) => part.part)).toEqual(["interest", "escrow", "principal"]);
    expect(parts.reduce((sum, part) => sum + Number(part.amount_minor), 0)).toBe(119_910);
    expect(Number(parts[0]?.amount_minor)).toBeGreaterThan(99_000);
  });

  it("starts the installments after the rows already paid (FLOW-106)", async () => {
    db.payments = new Map([["loan-1", [{ transaction_id: "txn-0", doc_date: "2026-02-01", needs_review: false, interest_minor: 50_000, escrow_minor: 0, principal_minor: 9_955, fees_minor: 0 }]]]);
    db.txn = { ...db.txn, amount_original: 119_910 };
    renderSplit({ docDate: "2026-04-01" });
    await waitFor(() => { expect(matchButton()).toBeInTheDocument(); });
    fireEvent.click(matchButton());
    // Row 1 is paid, so the two installments are rows 2 and 3: less interest than rows 1 and 2.
    const radio = screen.getByRole("radio", { name: /הלוואת דוגמה/ });
    expect(within(radio).getByText("2 תשלומים לפי הלוח · ₪1,199.10")).toBeInTheDocument();
    fireEvent.click(radio);
    await waitFor(() => { expect(saves()).toHaveLength(1); });
    const interest = Number(saves()[0]?.p_parts[0]?.amount_minor);
    expect(interest).toBeLessThan(99_950);
    expect(interest).toBeGreaterThan(99_800);
  });

  it("skips the split reads when get_transaction says the line has no split (FLOW-114)", async () => {
    renderSplit({ split: null });
    await waitFor(() => { expect(matchButton()).toBeInTheDocument(); });
    expect(db.reads).not.toContain("loan_splits");
    expect(db.rpcs.map((call) => call.name)).not.toContain("get_loan_split");
  });

  it("reads nothing on a matched line: the category row shows the loan", async () => {
    renderSplit({
      split: { loan_id: "loan-1", loan_name: "הלוואת דוגמה", needs_review: false, by_parts: true, parts: [] },
    });
    await new Promise((r) => { setTimeout(r, 50); });
    expect(db.reads).toEqual([]);
    expect(screen.queryByRole("button", { name: MATCH_ROW })).not.toBeInTheDocument();
  });

  it("disables a paid-off loan for a payment after the day it ended, naming the day (FLOW-106)", async () => {
    const paidOff = { ...db.loans[0], status: "paid_off", closed_on: "2026-01-15" };
    db.loans = [paidOff as (typeof db.loans)[number]];
    renderSplit({ docDate: "2026-02-01" });
    await waitFor(() => { expect(matchButton()).toBeInTheDocument(); });
    fireEvent.click(matchButton());
    const radio = screen.getByRole("radio", { name: /הלוואת דוגמה/ });
    expect(radio).toBeDisabled();
    expect(within(radio).getByText("נפרעה ב־15/01/2026")).toBeInTheDocument();
  });

  it("still offers a paid-off loan for a payment on or before the day it ended", async () => {
    const paidOff = { ...db.loans[0], status: "paid_off", closed_on: "2026-02-01" };
    db.loans = [paidOff as (typeof db.loans)[number]];
    renderSplit({ docDate: "2026-02-01" });
    await waitFor(() => { expect(matchButton()).toBeInTheDocument(); });
    expect(within(matchButton()).getByText("הלוואת דוגמה")).toBeInTheDocument();
  });

  it("offers a demand loan: the accrued interest, the rest to principal (FLOW-106, decision 0132)", async () => {
    const demand = { ...db.loans[0], kind: "demand", term_months: null, payment_minor: null };
    db.loans = [demand as unknown as (typeof db.loans)[number]];
    // 100,000.00 at 6% for the 30 days from 2026-02-01: 493.15.
    renderSplit({ docDate: "2026-03-03" });
    await waitFor(() => { expect(matchButton()).toBeInTheDocument(); });
    fireEvent.click(matchButton());
    const radio = screen.getByRole("radio", { name: /הלוואת דוגמה/ });
    expect(within(radio).getByText("ריבית צבורה ₪493.15 · השאר לקרן")).toBeInTheDocument();
    fireEvent.click(radio);
    await waitFor(() => { expect(saves()).toHaveLength(1); });
    const parts = saves()[0]?.p_parts ?? [];
    expect(parts.map((part) => [part.part, part.amount_minor])).toEqual([["interest", 49_315], ["escrow", 0], ["principal", 50_685]]);
  });

  it("disables a demand loan before its start, or with a later payment attached (FLOW-106)", async () => {
    const demand = { ...db.loans[0], kind: "demand", term_months: null, payment_minor: null };
    db.loans = [demand as unknown as (typeof db.loans)[number]];
    const early = renderSplit({ docDate: "2026-01-20" });
    await waitFor(() => { expect(matchButton()).toBeInTheDocument(); });
    fireEvent.click(matchButton());
    expect(within(screen.getByRole("radio", { name: /הלוואת דוגמה/ })).getByText("לפני תחילת ההלוואה")).toBeInTheDocument();
    early.unmount();
    db.payments = new Map([["loan-1", [{ transaction_id: "txn-9", doc_date: "2026-04-01", needs_review: false, interest_minor: 1_000, escrow_minor: 0, principal_minor: 1_000, fees_minor: 0 }]]]);
    renderSplit({ docDate: "2026-03-03" });
    await waitFor(() => { expect(matchButton()).toBeInTheDocument(); });
    fireEvent.click(matchButton());
    const radio = screen.getByRole("radio", { name: /הלוואת דוגמה/ });
    expect(radio).toBeDisabled();
    expect(within(radio).getByText("יש תשלום מאוחר יותר")).toBeInTheDocument();
  });

  it("opens the split editor from חלוקה אחרת and saves fees with their category, kept on the loan (FLOW-106)", async () => {
    db.txn = { ...db.txn, amount_original: 60_090 };
    renderSplit();
    await waitFor(() => { expect(matchButton()).toBeInTheDocument(); });
    fireEvent.click(matchButton());
    fireEvent.click(screen.getByRole("button", { name: "חלוקה אחרת" }));
    const editor = await screen.findByRole("dialog", { name: "חלוקת התשלום" });
    fireEvent.change(within(editor).getByLabelText("עמלות"), { target: { value: "1.35" } });
    expect(within(editor).getByText("בחרו לאן נרשמות העמלות.")).toBeInTheDocument();
    expect(within(editor).getByRole("button", { name: "שמירה" })).toBeDisabled();
    const picker = within(editor).getByLabelText("עמלות נרשמות ב");
    await waitFor(() => { expect(within(picker).getByRole("option", { name: "עמלות בנק" })).toBeInTheDocument(); });
    fireEvent.change(picker, { target: { value: "cat-bank" } });
    expect(within(editor).getByRole("switch", { name: "לשמור להלוואה הזו" })).toBeChecked();
    fireEvent.click(within(editor).getByRole("button", { name: "שמירה" }));
    await waitFor(() => { expect(saves()).toHaveLength(1); });
    expect(db.loanUpdates).toEqual([{ values: { fees_category_id: "cat-bank" }, id: "loan-1" }]);
    const parts = saves()[0]?.p_parts ?? [];
    expect(parts.map((part) => part.part)).toEqual(["interest", "escrow", "principal", "fees"]);
    expect(parts[3]).toEqual({ part: "fees", amount_minor: 135, scheduled_minor: 135, category_id: "cat-bank" });
    expect(parts.reduce((sum, part) => sum + Number(part.amount_minor), 0)).toBe(60_090);
  });

  it("takes the lender's exact parts and holds the save until they add up to the line (FLOW-106)", async () => {
    renderSplit();
    await waitFor(() => { expect(matchButton()).toBeInTheDocument(); });
    fireEvent.click(matchButton());
    fireEvent.click(screen.getByRole("button", { name: "חלוקה אחרת" }));
    const editor = await screen.findByRole("dialog", { name: "חלוקת התשלום" });
    fireEvent.click(within(editor).getByRole("radio", { name: "סכומים מדויקים" }));
    const principal = within(editor).getByLabelText("סכום, קרן");
    expect(principal).toHaveValue("500");
    fireEvent.change(principal, { target: { value: "400" } });
    expect(within(editor).getByText("החלקים צריכים להסתכם ב־₪1,000. חסרים ₪100.")).toBeInTheDocument();
    expect(within(editor).getByRole("button", { name: "שמירה" })).toBeDisabled();
    fireEvent.change(within(editor).getByLabelText("סכום, ריבית"), { target: { value: "600" } });
    fireEvent.click(within(editor).getByRole("button", { name: "שמירה" }));
    await waitFor(() => { expect(saves()).toHaveLength(1); });
    expect((saves()[0]?.p_parts ?? []).map((part) => [part.part, part.amount_minor])).toEqual([["interest", 60_000], ["escrow", 0], ["principal", 40_000]]);
    expect(db.loanUpdates).toEqual([]);
  });

  it("splits an interest-only payment by its schedule and rate rows", async () => {
    // 100,000.00 at 6%, 12 interest-only months; a rate row from 2026-02-01 makes it 12%.
    db.loans = [{
      ...db.loans[0],
      kind: "interest_only",
      interest_only_months: 12,
      loan_rates: [{ effective_date: "2026-02-01", annual_rate_ppm: 120_000 }],
    } as unknown as (typeof db.loans)[number]];
    db.txn = { company_id: "co-1", amount_original: 100_000, currency: "ILS" };
    renderSplit({ docDate: "2026-02-01" });
    await waitFor(() => { expect(matchButton()).toBeInTheDocument(); });
    fireEvent.click(matchButton());
    fireEvent.click(screen.getByRole("radio", { name: "הלוואת דוגמה" }));
    await waitFor(() => { expect(saves()).toHaveLength(1); });
    const rows = saves()[0]?.p_parts ?? [];
    expect(rows.map((row) => [row.part, row.amount_minor, row.scheduled_minor])).toEqual([
      ["interest", 100_000, 100_000],
      ["escrow", 0, 0],
      ["principal", 0, 0],
    ]);
  });

  it("moves focus to the loan row after a match (FLOW-114)", async () => {
    renderSplit();
    // The card's category row turns into the loan row once the match lands.
    const row = document.createElement("button");
    row.className = "ui-loan-row";
    row.textContent = "loan row";
    document.body.append(row);
    await waitFor(() => { expect(matchButton()).toBeInTheDocument(); });
    fireEvent.click(matchButton());
    fireEvent.click(screen.getByRole("radio", { name: "הלוואת דוגמה" }));
    await waitFor(() => { expect(row).toHaveFocus(); });
    row.remove();
  });

  it("hints the lone matching loan on the שיוך row", async () => {
    renderSplit();
    await waitFor(() => { expect(matchButton()).toBeInTheDocument(); });
    expect(within(matchButton()).getByText("הלוואת דוגמה")).toBeInTheDocument();
  });

  it("counts the loans on the שיוך row when there are two (FLOW-115)", async () => {
    const first = db.loans[0];
    if (first === undefined) throw new Error("no loan fixture");
    db.loans = [...db.loans, { ...first, id: "loan-2", name: "הלוואה שנייה" }];
    db.balances = [...db.balances, { loan_id: "loan-2", balance_minor: 10_000_000 }];
    renderSplit();
    await waitFor(() => { expect(matchButton()).toBeInTheDocument(); });
    expect(within(matchButton()).getByText("2 הלוואות")).toBeInTheDocument();
  });
});

describe("loanMatchHint (FLOW-115)", () => {
  it("always gives the row a hint", () => {
    const ils = (name: string) => ({ name, currency: "ILS" });
    expect(loanMatchHint([ils("משכנתא"), { name: "דולרית", currency: "USD" }], "ILS")).toBe("משכנתא");
    expect(loanMatchHint([ils("א"), ils("ב"), ils("ג")], "ILS")).toBe("3 הלוואות");
    expect(loanMatchHint([ils("א")], "USD")).toBe("אין הלוואה בדולר");
    expect(loanMatchHint([], "USD")).toBe("אין עדיין הלוואה");
  });
});
