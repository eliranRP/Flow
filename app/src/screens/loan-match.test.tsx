import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import { useRef, useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../ui/toast";
import { LOAN_BUSY_HINT, LoanBalanceList, LoanSplitPanel, LoanTransactionSplit, ProjectLoanList } from "./loan-match";

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
  inserts: [] as unknown[],
  counted: null as Record<string, unknown> | null,
  insertError: null as { message: string; code?: string } | null,
  insertHold: null as Promise<void> | null,
  readError: null as { message: string } | null,
  readHold: null as Promise<void> | null,
  updateError: null as { message: string; code?: string } | null,
  clearError: null as { message: string; code?: string } | null,
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
const MATCH_ROW = /^שיוך להלוואה/;

function matchButton() {
  return screen.getByRole("button", { name: MATCH_ROW });
}

vi.mock("../use-is-viewer", () => ({
  useHoldWrites: () => false,
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    from: (table: string) => {
      if (table === "transactions") {
        return {
          select: () => ({
            eq: () => ({
              single: () => {
                const finish = () => ({
                  data: db.readError ? null : db.txn,
                  error: db.readError,
                });
                if (db.readHold) return db.readHold.then(() => finish());
                return Promise.resolve(finish());
              },
            }),
          }),
        };
      }
      if (table === "loan_splits") {
        return {
          select: () => ({
            eq: () => {
              const finish = () => ({ data: db.splits, error: null });
              if (db.readHold) return db.readHold.then(() => finish());
              return Promise.resolve(finish());
            },
          }),
          insert: (rows: unknown) => {
            db.inserts.push(rows);
            const finish = () => {
              if (!db.insertError && Array.isArray(rows)) {
                for (const row of rows as Array<Record<string, unknown>>) {
                  db.splits.push({
                    id: `split-${String(db.splits.length)}`,
                    part: String(row.part),
                    amount_minor: Number(row.amount_minor),
                    scheduled_minor: Number(row.scheduled_minor),
                    needs_review: false,
                    loan_id: String(row.loan_id),
                  });
                }
              }
              return { data: null, error: db.insertError };
            };
            if (db.insertHold) return db.insertHold.then(() => finish());
            return Promise.resolve(finish());
          },
          update: () => ({
            eq: () => Promise.resolve({ data: null, error: db.updateError }),
          }),
        };
      }
      if (table === "loans") {
        return {
          select: () => ({
            eq: () => {
              const finish = () => ({ data: db.loans, error: null });
              if (db.readHold) return db.readHold.then(() => finish());
              return Promise.resolve(finish());
            },
          }),
        };
      }
      if (table === "categories") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                not: () => {
                  const finish = () => ({ data: db.categories, error: null });
                  if (db.readHold) return db.readHold.then(() => finish());
                  return Promise.resolve(finish());
                },
              }),
            }),
          }),
        };
      }
      if (table === "loan_balances") {
        return {
          select: () => ({
            eq: () => {
              const finish = () => ({ data: db.balances, error: null });
              if (db.readHold) return db.readHold.then(() => finish());
              return Promise.resolve(finish());
            },
          }),
        };
      }
      throw new Error(table);
    },
    rpc: (name: string) => Promise.resolve({
      data: name === "get_loan_split" ? db.counted : null,
      error: name === "clear_loan_split_review" ? db.clearError : null,
    }),
  }),
}));

function PanelHarness(props: Partial<ComponentProps<typeof LoanSplitPanel>> = {}) {
  const [open, setOpen] = useState(false);
  const splitSectionRef = useRef<HTMLHeadingElement>(null);
  return (
    <MemoryRouter>
      <LoanSplitPanel
        offerMatch
        lineCurrency="ILS"
        displayCurrency="ILS"
        parts={null}
        loans={[loan]}
        needsReview={false}
        currencyMismatch={false}
        busy={false}
        sheetOpen={open}
        onSheetOpenChange={setOpen}
        splitSectionRef={splitSectionRef}
        onMatch={vi.fn()}
        onCorrect={vi.fn()}
        {...props}
      />
    </MemoryRouter>
  );
}

function panel(props: Partial<ComponentProps<typeof LoanSplitPanel>> = {}) {
  return render(<PanelHarness {...props} />);
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
  db.inserts = [];
  db.counted = null;
  db.insertError = null;
  db.insertHold = null;
  db.readError = null;
  db.readHold = null;
  db.updateError = null;
  db.clearError = null;
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

describe("LoanSplitPanel", () => {
  it("offers a loan when the line is not split yet", () => {
    const onMatch = vi.fn();
    panel({ onMatch });
    fireEvent.click(screen.getByRole("button", { name: "שיוך להלוואה" }));
    fireEvent.click(screen.getByRole("radio", { name: "הלוואת דוגמה" }));
    expect(onMatch).toHaveBeenCalledWith("loan-1");
  });

  it("shows the three parts and a one-tap correction when review is waiting", () => {
    const onCorrect = vi.fn();
    panel({
      onCorrect,
      needsReview: true,
      byParts: true,
      parts: [
        { id: "a", part: "interest", amountMinor: 500n, scheduledMinor: 500n, needsReview: true, loanId: "loan-1" },
        { id: "b", part: "escrow", amountMinor: 200n, scheduledMinor: 200n, needsReview: true, loanId: "loan-1" },
        { id: "c", part: "principal", amountMinor: 300n, scheduledMinor: 300n, needsReview: true, loanId: "loan-1", inPnl: false },
      ],
    });
    expect(screen.getByRole("heading", { name: "חלוקת התשלום" })).toBeInTheDocument();
    expect(screen.getByText("ריבית")).toBeInTheDocument();
    expect(screen.getByText("מסים וביטוח")).toBeInTheDocument();
    expect(screen.getByText("קרן")).toBeInTheDocument();
    expect(screen.getByText("−₪5")).toBeInTheDocument();
    expect(screen.getByText("−₪2")).toBeInTheDocument();
    expect(screen.getByText("−₪3")).toBeInTheDocument();
    expect(screen.getByText("−₪10")).toBeInTheDocument();
    expect(screen.getByText("החלוקה ממתינה לבדיקה.")).toBeInTheDocument();
    // FLOW-131: the flag cannot say why, so the hint names the busy loan as a maybe.
    expect(screen.getByText(LOAN_BUSY_HINT)).toBeInTheDocument();
    expect(screen.queryByText(/נספר ברווח/)).not.toBeInTheDocument();
    expect(screen.queryByText("מחוץ לרווח")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "עדכון החלוקה" }));
    expect(onCorrect).toHaveBeenCalled();
  });

  it("shows what counts in profit, the kept-out principal, and a total equal to the line", () => {
    panel({
      byParts: true,
      parts: [
        { id: "c", part: "principal", amountMinor: 100_000n, scheduledMinor: 100_000n, needsReview: false, loanId: "loan-1", inPnl: false },
        { id: "a", part: "interest", amountMinor: 105_000n, scheduledMinor: 105_000n, needsReview: false, loanId: "loan-1", inPnl: true },
        { id: "b", part: "escrow", amountMinor: 40_000n, scheduledMinor: 40_000n, needsReview: false, loanId: "loan-1", inPnl: true },
      ],
    });
    expect(screen.getByText(/נספר ברווח/)).toHaveTextContent("נספר ברווח ₪1,450");
    expect(screen.getAllByText("מחוץ לרווח")).toHaveLength(1);
    const principal = screen.getByText("קרן").closest(".ui-row");
    expect(principal).toHaveTextContent("מחוץ לרווח");
    expect(principal).toHaveTextContent("−₪1,000");
    const total = screen.getByText("סה״כ").closest(".ui-row");
    expect(total).toHaveTextContent("−₪2,450");
    const titles = [...document.querySelectorAll(".ui-row-title")].map((node) => node.textContent);
    expect(titles).toEqual(["ריבית", "מסים וביטוח", "קרן", "סה״כ"]);
  });

  it("counts the whole line when the P&L does not count by parts", () => {
    panel({
      byParts: false,
      parts: [
        { id: "a", part: "interest", amountMinor: 500n, scheduledMinor: 500n, needsReview: false, loanId: "loan-1", inPnl: null },
        { id: "b", part: "escrow", amountMinor: 200n, scheduledMinor: 200n, needsReview: false, loanId: "loan-1", inPnl: null },
        { id: "c", part: "principal", amountMinor: 300n, scheduledMinor: 300n, needsReview: false, loanId: "loan-1", inPnl: false },
      ],
    });
    expect(screen.queryByText(/נספר ברווח/)).not.toBeInTheDocument();
    expect(screen.queryByText("מחוץ לרווח")).not.toBeInTheDocument();
    expect(screen.getByText("סה״כ").closest(".ui-row")).toHaveTextContent("−₪10");
  });

  it("hides matching for a viewer", () => {
    panel({ readOnly: true });
    expect(screen.queryByRole("button", { name: MATCH_ROW })).not.toBeInTheDocument();
  });

  it("keeps the split and hides the correction for a viewer", () => {
    panel({
      readOnly: true,
      needsReview: true,
      parts: [
        { id: "a", part: "interest", amountMinor: 500n, scheduledMinor: 500n, needsReview: true, loanId: "loan-1" },
        { id: "b", part: "escrow", amountMinor: 200n, scheduledMinor: 200n, needsReview: true, loanId: "loan-1" },
        { id: "c", part: "principal", amountMinor: 300n, scheduledMinor: 300n, needsReview: true, loanId: "loan-1" },
      ],
    });
    expect(screen.getByText("ריבית")).toBeInTheDocument();
    expect(screen.getByText("החלוקה ממתינה לבדיקה.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "עדכון החלוקה" })).not.toBeInTheDocument();
    expect(screen.queryByText(LOAN_BUSY_HINT)).not.toBeInTheDocument();
  });

  it("does not offer a one-tap correction when the currency does not match", () => {
    panel({
      needsReview: true,
      currencyMismatch: true,
      parts: [
        { id: "a", part: "interest", amountMinor: 500n, scheduledMinor: 500n, needsReview: true, loanId: "loan-1" },
        { id: "b", part: "escrow", amountMinor: 200n, scheduledMinor: 200n, needsReview: true, loanId: "loan-1" },
        { id: "c", part: "principal", amountMinor: 300n, scheduledMinor: 300n, needsReview: true, loanId: "loan-1" },
      ],
    });
    expect(screen.getByText("המטבע של השורה לא מתאים להלוואה.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "עדכון החלוקה" })).not.toBeInTheDocument();
    expect(screen.queryByText(LOAN_BUSY_HINT)).not.toBeInTheDocument();
  });

  it("shows a busy radio while a match is saving", () => {
    panel({ savingId: "loan-1" });
    fireEvent.click(screen.getByRole("button", { name: "שיוך להלוואה" }));
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
  it("sends one insert when the loan row is tapped twice while pending", async () => {
    let release!: () => void;
    db.insertHold = new Promise<void>((resolve) => { release = resolve; });
    renderSplit();
    await waitFor(() => { expect(matchButton()).toBeInTheDocument(); });
    fireEvent.click(matchButton());
    const radio = screen.getByRole("radio", { name: "הלוואת דוגמה" });
    fireEvent.click(radio);
    await waitFor(() => { expect(db.inserts).toHaveLength(1); });
    fireEvent.click(radio);
    await new Promise((r) => { setTimeout(r, 50); });
    expect(db.inserts).toHaveLength(1);
    act(() => { release(); });
    await new Promise((r) => { setTimeout(r, 50); });
    expect(db.inserts).toHaveLength(1);
  });

  it("maps 23505, refetches, and closes the picker", async () => {
    db.insertError = { message: "duplicate key", code: "23505" };
    renderSplit();
    await waitFor(() => { expect(matchButton()).toBeInTheDocument(); });
    fireEvent.click(matchButton());
    db.splits = [
      { id: "a", part: "interest", amount_minor: 500, scheduled_minor: 500, needs_review: false, loan_id: "loan-1" },
      { id: "b", part: "escrow", amount_minor: 0, scheduled_minor: 0, needs_review: false, loan_id: "loan-1" },
      { id: "c", part: "principal", amount_minor: 99_500, scheduled_minor: 99_500, needs_review: false, loan_id: "loan-1" },
    ];
    fireEvent.click(screen.getByRole("radio", { name: "הלוואת דוגמה" }));
    await waitFor(() => { expect(screen.getByText("התשלום כבר שויך להלוואה.")).toBeInTheDocument(); });
    await waitFor(() => { expect(screen.getByRole("heading", { name: "חלוקת התשלום" })).toBeInTheDocument(); });
    expect(screen.queryByRole("radio", { name: "הלוואת דוגמה" })).not.toBeInTheDocument();
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
    expect(db.inserts).toHaveLength(0);
  });

  it("shows a busy radio while the insert is pending", async () => {
    let release!: () => void;
    db.insertHold = new Promise<void>((resolve) => { release = resolve; });
    renderSplit();
    await waitFor(() => { expect(matchButton()).toBeInTheDocument(); });
    fireEvent.click(matchButton());
    fireEvent.click(screen.getByRole("radio", { name: "הלוואת דוגמה" }));
    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "הלוואת דוגמה" })).toHaveAttribute("aria-busy", "true");
    });
    act(() => { release(); });
  });

  it("files each part under the category with that loan_part, whatever its name", async () => {
    renderSplit();
    await waitFor(() => { expect(matchButton()).toBeInTheDocument(); });
    fireEvent.click(matchButton());
    fireEvent.click(screen.getByRole("radio", { name: "הלוואת דוגמה" }));
    await waitFor(() => { expect(db.inserts).toHaveLength(1); });
    const rows = db.inserts[0] as Array<{ part: string; category_id: string }>;
    expect(Object.fromEntries(rows.map((row) => [row.part, row.category_id]))).toEqual({
      interest: "cat-i",
      escrow: "cat-e",
      principal: "cat-p",
    });
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

  it("refuses a payment above the loan balance", async () => {
    db.balances = [{ loan_id: "loan-1", balance_minor: 100 }];
    renderSplit();
    await waitFor(() => { expect(matchButton()).toBeInTheDocument(); });
    fireEvent.click(matchButton());
    fireEvent.click(screen.getByRole("radio", { name: "הלוואת דוגמה" }));
    await waitFor(() => { expect(screen.getByText("התשלום גבוה מיתרת ההלוואה.")).toBeInTheDocument(); });
    expect(db.inserts).toHaveLength(0);
  });

  it("uses correction failure copy", async () => {
    db.splits = [
      { id: "a", part: "interest", amount_minor: 500, scheduled_minor: 500, needs_review: true, loan_id: "loan-1" },
      { id: "b", part: "escrow", amount_minor: 200, scheduled_minor: 200, needs_review: true, loan_id: "loan-1" },
      { id: "c", part: "principal", amount_minor: 300, scheduled_minor: 300, needs_review: true, loan_id: "loan-1" },
    ];
    db.updateError = { message: "denied", code: "42501" };
    renderSplit();
    await waitFor(() => { expect(screen.getByRole("button", { name: "עדכון החלוקה" })).toBeInTheDocument(); });
    fireEvent.click(screen.getByRole("button", { name: "עדכון החלוקה" }));
    await waitFor(() => { expect(screen.getByText("אין הרשאה לעדכן את החלוקה.")).toBeInTheDocument(); });
  });

  it("says the payment is above the balance when clearing re-checks it (FLOW-131)", async () => {
    db.splits = [
      { id: "a", part: "interest", amount_minor: 500, scheduled_minor: 500, needs_review: true, loan_id: "loan-1" },
      { id: "b", part: "escrow", amount_minor: 200, scheduled_minor: 200, needs_review: true, loan_id: "loan-1" },
      { id: "c", part: "principal", amount_minor: 300, scheduled_minor: 300, needs_review: true, loan_id: "loan-1" },
    ];
    db.clearError = { message: "loan_split_balance", code: "23514" };
    renderSplit();
    await waitFor(() => { expect(screen.getByText(LOAN_BUSY_HINT)).toBeInTheDocument(); });
    fireEvent.click(screen.getByRole("button", { name: "עדכון החלוקה" }));
    await waitFor(() => { expect(screen.getByText("התשלום גבוה מיתרת ההלוואה.")).toBeInTheDocument(); });
  });

  it("moves focus to the split heading after a successful match", async () => {
    renderSplit();
    await waitFor(() => { expect(matchButton()).toBeInTheDocument(); });
    fireEvent.click(matchButton());
    fireEvent.click(screen.getByRole("radio", { name: "הלוואת דוגמה" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "חלוקת התשלום" })).toHaveFocus();
    });
  });

  it("formats split parts in the loan currency", async () => {
    db.txn = { company_id: "co-1", amount_original: 100_000, currency: "USD" };
    db.loans = [{
      id: "loan-1",
      name: "הלוואת דוגמה",
      currency: "USD",
      principal_minor: 10_000_000,
      annual_rate_ppm: 60_000,
      term_months: 360,
      start_date: "2026-02-01",
      payment_minor: 59_955,
      escrow_minor: 0,
    }];
    db.splits = [
      { id: "a", part: "interest", amount_minor: 500, scheduled_minor: 500, needs_review: false, loan_id: "loan-1" },
      { id: "b", part: "escrow", amount_minor: 200, scheduled_minor: 200, needs_review: false, loan_id: "loan-1" },
      { id: "c", part: "principal", amount_minor: 300, scheduled_minor: 300, needs_review: false, loan_id: "loan-1" },
    ];
    db.counted = {
      by_parts: true,
      parts: [
        { part: "interest", amount_minor: 500, in_pnl: true },
        { part: "escrow", amount_minor: 200, in_pnl: true },
        { part: "principal", amount_minor: 300, in_pnl: false },
      ],
    };
    renderSplit();
    await waitFor(() => { expect(screen.getByRole("heading", { name: "חלוקת התשלום" })).toBeInTheDocument(); });
    expect(screen.getByText("−$5")).toBeInTheDocument();
    expect(screen.getByText(/נספר ברווח/)).toHaveTextContent("נספר ברווח $7");
    expect(screen.getByText("קרן").closest(".ui-row")).toHaveTextContent("מחוץ לרווח");
  });

  it("hints the lone matching loan on the שיוך row", async () => {
    renderSplit();
    await waitFor(() => { expect(matchButton()).toBeInTheDocument(); });
    expect(within(matchButton()).getByText("הלוואת דוגמה")).toBeInTheDocument();
  });
});
