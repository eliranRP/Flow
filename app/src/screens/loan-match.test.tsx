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
        return { select: () => ({ eq: () => held(() => ({ data: db.loans, error: null })) }) };
      }
      if (table === "categories") {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ not: () => held(() => ({ data: db.categories, error: null })) }) }) }),
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
    await waitFor(() => { expect(other.client.getQueryCache().getAll().every((query) => query.state.status === "success")).toBe(true); });
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

  it("refuses a payment above the loan balance before it calls the server", async () => {
    db.balances = [{ loan_id: "loan-1", balance_minor: 100 }];
    renderSplit();
    await waitFor(() => { expect(matchButton()).toBeInTheDocument(); });
    fireEvent.click(matchButton());
    fireEvent.click(screen.getByRole("radio", { name: "הלוואת דוגמה" }));
    await waitFor(() => { expect(screen.getByText("התשלום גבוה מיתרת ההלוואה.")).toBeInTheDocument(); });
    expect(saves()).toHaveLength(0);
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

  it("does not offer a paid-off loan for a payment after the day it ended", async () => {
    const paidOff = { ...db.loans[0], status: "paid_off", closed_on: "2026-01-15" };
    db.loans = [paidOff as (typeof db.loans)[number]];
    renderSplit({ docDate: "2026-02-01" });
    await waitFor(() => { expect(matchButton()).toBeInTheDocument(); });
    expect(within(matchButton()).queryByText("הלוואת דוגמה")).not.toBeInTheDocument();
    fireEvent.click(matchButton());
    expect(screen.queryByRole("radio", { name: "הלוואת דוגמה" })).not.toBeInTheDocument();
  });

  it("still offers a paid-off loan for a payment on or before the day it ended", async () => {
    const paidOff = { ...db.loans[0], status: "paid_off", closed_on: "2026-02-01" };
    db.loans = [paidOff as (typeof db.loans)[number]];
    renderSplit({ docDate: "2026-02-01" });
    await waitFor(() => { expect(matchButton()).toBeInTheDocument(); });
    expect(within(matchButton()).getByText("הלוואת דוגמה")).toBeInTheDocument();
  });

  it("does not offer a demand loan: it has no schedule to split by (decision 0132)", async () => {
    const demand = { ...db.loans[0], kind: "demand", term_months: null, payment_minor: null };
    db.loans = [demand as unknown as (typeof db.loans)[number]];
    renderSplit({ docDate: "2026-02-01" });
    await waitFor(() => { expect(matchButton()).toBeInTheDocument(); });
    expect(within(matchButton()).queryByText("הלוואת דוגמה")).not.toBeInTheDocument();
    fireEvent.click(matchButton());
    expect(screen.queryByRole("radio", { name: "הלוואת דוגמה" })).not.toBeInTheDocument();
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
    db.loans = [...db.loans, { ...db.loans[0], id: "loan-2", name: "הלוואה שנייה" }];
    db.balances = [...db.balances, { loan_id: "loan-2", balance_minor: 10_000_000 }];
    renderSplit();
    await waitFor(() => { expect(matchButton()).toBeInTheDocument(); });
    expect(within(matchButton()).getByText("2 הלוואות")).toBeInTheDocument();
  });
});

describe("loanMatchHint (FLOW-115)", () => {
  it("always gives the row a hint", () => {
    expect(loanMatchHint([{ name: "משכנתא" }], "ILS")).toBe("משכנתא");
    expect(loanMatchHint([{ name: "א" }, { name: "ב" }, { name: "ג" }], "ILS")).toBe("3 הלוואות");
    expect(loanMatchHint([], "USD")).toBe("אין הלוואה בדולר");
  });
});
