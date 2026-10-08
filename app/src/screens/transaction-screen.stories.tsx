import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "@storybook/test";
import { useState } from "react";
import type { TransactionLoanSplit } from "@flow/shared";
import { LoanMatchSampleProvider, type LoanMatchApi } from "./loan-match-api";
import { TransactionScreen } from "./flow-screens";
import { StoryRoute } from "../ui/story-route";
import { SeedLineMeta, storyMeta } from "../ui/story-support";
import type { TxnMeta } from "../txn-meta";
import { ExampleBar, storyBody } from "../ui/screen-stories-support";

const meta = {
  title: "Screens/Routes",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function TransactionStory() {
  return (
    <StoryRoute entry="/transactions/t1">
      <ExampleBar />
      <TransactionScreen
        sample={{
          id: "t1",
          description: "חשבונית חומרים",
          direction: "expense",
          doc_date: "2026-09-21",
          amount_gross: -1_003_000n,
          amount_net: -850_000n,
          vat_amount: -153_000n,
          vat_status: "source",
          doc_kind: "invoice",
          source: "sumit",
          project_id: "holon",
          project_name: "בניין מגורים חולון",
          category_id: "c1",
          category_name: "חומרים",
          supplier_name: "חומרי בניין השרון בע״מ",
          customer_name: null,
          review_status: "approved",
          paid: true,
          open_gross_agorot: null,
        }}
        sampleProjects={[
          { id: "holon", name: "בניין מגורים חולון", code: "P-14" },
          { id: "villa", name: "וילה רעננה", code: "P-02" },
        ]}
        sampleCategories={[
          { id: "c1", name: "חומרים" },
          { id: "c2", name: "ציוד והשכרה" },
          { id: "c3", name: "הובלה" },
        ]}
      />
    </StoryRoute>
  );
}

export const Transaction: Story = {
  render: () => <TransactionStory />,
};

/** FLOW-320: the project row opens the change sheet straight on the project picker. */
export const TransactionProjectPicker: Story = {
  name: "Project row opens the project picker",
  parameters: { viewport: { defaultViewport: "flow390-short" } },
  render: () => <TransactionStory />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /בניין מגורים חולון/ }));
    await storyBody(canvasElement).findByRole("dialog", { name: "בחירת פרויקט" });
  },
};

/** FLOW-320: the category row opens the change sheet straight on the category picker. */
export const TransactionCategoryPicker: Story = {
  name: "Category row opens the category picker",
  parameters: { viewport: { defaultViewport: "flow390-short" } },
  render: () => <TransactionStory />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /חומרים/ }));
    await storyBody(canvasElement).findByRole("dialog", { name: "בחירת קטגוריה" });
  },
};

export const TransactionOutOfPnl: Story = {
  name: "Out of the P&L",
  render: () => (
    <StoryRoute entry="/transactions/t1">
      <ExampleBar />
      <TransactionScreen
        sample={{
          id: "t1",
          description: "החזר פיקדון",
          direction: "expense",
          doc_date: "2026-09-21",
          amount_gross: -120_000n,
          amount_net: -120_000n,
          vat_amount: 0n,
          vat_status: "unknown",
          doc_kind: "expense",
          source: "sumit",
          project_id: "holon",
          project_name: "בניין מגורים חולון",
          category_id: "c1",
          category_name: "חומרים",
          supplier_name: "ספק לדוגמה עם שם ארוך במיוחד לבדיקה",
          customer_name: null,
          review_status: "open",
          paid: false,
          open_gross_agorot: null,
          in_pnl_override: false,
          category_excluded_from_pnl: false,
          in_pnl: false,
          pnl_fixed: false,
        }}
        sampleCategories={[{ id: "c1", name: "חומרים" }]}
      />
    </StoryRoute>
  ),
};

/** FLOW-303: opened from a list, so ˄ ˅ sit before ⋯. The middle row has both. */
export const TransactionInList: Story = {
  name: "In a list",
  render: () => (
    <StoryRoute entry="/transactions/t1" state={{ txnList: { ids: ["t0", "t1", "t2"], from: "/projects/holon" } }}>
      <ExampleBar />
      <TransactionScreen
        sample={{
          id: "t1",
          description: "חשבונית חומרים",
          direction: "expense",
          doc_date: "2026-09-21",
          amount_gross: -1_003_000n,
          amount_net: -850_000n,
          vat_amount: -153_000n,
          vat_status: "source",
          doc_kind: "invoice",
          source: "sumit",
          project_id: "holon",
          project_name: "בניין מגורים חולון",
          category_id: "c1",
          category_name: "חומרים",
          supplier_name: "חומרי בניין השרון בע״מ",
          customer_name: null,
          review_status: "approved",
          paid: true,
          open_gross_agorot: null,
        }}
      />
    </StoryRoute>
  ),
};

/** The last row: ˅ stays in place, marked unavailable. */
export const TransactionListEnd: Story = {
  name: "Last in a list",
  render: () => (
    <StoryRoute entry="/transactions/t2" state={{ txnList: { ids: ["t0", "t1", "t2"], from: "/projects/holon" } }}>
      <ExampleBar />
      <TransactionScreen
        sample={{
          id: "t2",
          description: "הובלה",
          direction: "income",
          doc_date: "2026-09-22",
          amount_gross: 12_345_678n,
          amount_net: 10_462_439n,
          vat_amount: 1_883_239n,
          vat_status: "source",
          doc_kind: "invoice",
          source: "sumit",
          project_id: "holon",
          project_name: "בניין מגורים חולון",
          category_id: "c1",
          category_name: "הכנסות מפרויקט",
          supplier_name: null,
          customer_name: "לקוח לדוגמה עם שם ארוך מאוד לבדיקה",
          review_status: "open",
          paid: false,
          open_gross_agorot: 12_345_678n,
        }}
      />
    </StoryRoute>
  ),
};

export const TransactionShared: Story = {
  name: "Shared",
  render: () => (
    <StoryRoute entry="/transactions/t1">
      <ExampleBar />
      <TransactionScreen
        sample={{
          id: "t1",
          description: "משכורת עובדי שטח",
          direction: "expense",
          doc_date: "2026-09-21",
          amount_gross: -3_600_000n,
          amount_net: -3_600_000n,
          vat_amount: 0n,
          vat_status: "unknown",
          doc_kind: "expense",
          source: "sumit",
          pnl_role: "shared",
          project_id: null,
          project_name: null,
          category_id: "c1",
          category_name: "עבודה",
          supplier_name: "עובדי שטח",
          customer_name: null,
          review_status: null,
          paid: true,
          open_gross_agorot: null,
          allocations: [
            { project_id: "a", project_name: "חולון", share_bp: 4000, amount_net: -1_440_000n },
            { project_id: "b", project_name: "פתח תקווה", share_bp: 3500, amount_net: -1_260_000n },
            { project_id: "c", project_name: "רעננה", share_bp: 2500, amount_net: -900_000n },
          ],
        }}
        sampleCategories={[
          { id: "c1", name: "עבודה" },
          { id: "c2", name: "הובלה" },
        ]}
      />
    </StoryRoute>
  ),
};

export const TransactionUnsplit: Story = {
  name: "Unsplit shared",
  render: () => (
    <StoryRoute entry="/transactions/t1">
      <ExampleBar />
      <TransactionScreen
        sample={{
          id: "t1",
          description: "ביטוח אתר",
          direction: "expense",
          doc_date: "2026-09-21",
          amount_gross: -1_180_000n,
          amount_net: -1_000_000n,
          vat_amount: -180_000n,
          vat_status: "assumed",
          doc_kind: "expense",
          source: "sumit",
          pnl_role: "shared",
          project_id: null,
          project_name: null,
          category_id: null,
          category_name: null,
          supplier_name: "סוכנות הביטוח",
          customer_name: null,
          review_status: "open",
          review_reason: "missing_category",
          paid: true,
          open_gross_agorot: null,
          allocations: [],
        }}
        sampleCategories={[
          { id: "c1", name: "ביטוח" },
          { id: "c2", name: "הובלה" },
        ]}
      />
    </StoryRoute>
  ),
};

export const TransactionUsdExpense: Story = {
  render: () => (
    <StoryRoute entry="/transactions/t-usd" tabs>
      <ExampleBar />
      <TransactionScreen
        sample={{
          id: "t-usd",
          description: "Sample vendor",
          direction: "expense",
          doc_date: "2026-09-10",
          amount_gross: -125_000n,
          amount_net: -125_000n,
          vat_amount: 0n,
          currency: "USD",
          vat_status: "source",
          source: "mercury",
          project_name: "Cedar Lot",
          category_name: "Utilities",
          supplier_name: "Sample vendor",
          customer_name: null,
        }}
      />
    </StoryRoute>
  ),
};

/** FLOW-307: the largest detail amounts step down from 36px until they fit the side padding. */
export const TransactionLargestExpense: Story = {
  render: () => (
    <StoryRoute entry="/transactions/t-large">
      <ExampleBar />
      <TransactionScreen
        sample={{
          id: "t-large",
          description: "חשבונית חומרים",
          direction: "expense",
          doc_date: "2026-09-21",
          amount_gross: -9_999_999_999n,
          amount_net: -9_999_999_999n,
          vat_amount: 0n,
          vat_status: "source",
          doc_kind: "invoice",
          source: "sumit",
          project_name: "בניין מגורים חולון",
          category_name: "חומרים",
          supplier_name: "חומרי בניין השרון בע״מ",
          customer_name: null,
        }}
      />
    </StoryRoute>
  ),
};

export const TransactionLargestUsdIncome: Story = {
  render: () => (
    <StoryRoute entry="/transactions/t-large-usd">
      <ExampleBar />
      <TransactionScreen
        sample={{
          id: "t-large-usd",
          description: "Sample customer",
          direction: "income",
          doc_date: "2026-09-10",
          amount_gross: 9_999_999_999n,
          amount_net: 9_999_999_999n,
          vat_amount: 0n,
          currency: "USD",
          vat_status: "source",
          source: "mercury",
          project_name: "Cedar Lot",
          category_name: "Rent",
          supplier_name: null,
          customer_name: "Sample customer",
        }}
      />
    </StoryRoute>
  ),
};

/* FLOW-304. Bank details on the transaction screen and the review card. Invented data only. */
function MercuryTransaction({ meta, income = false }: { meta: TxnMeta; income?: boolean }) {
  return (
    <StoryRoute entry="/transactions/t-meta" tabs>
      <SeedLineMeta meta={[meta]} />
      <ExampleBar />
      <TransactionScreen
        sample={{
          id: "t-meta",
          description: "EXAMPLE OFFICE SUITE",
          direction: income ? "income" : "expense",
          doc_date: "2026-09-10",
          amount_gross: income ? 480_000n : -125_000n,
          amount_net: income ? 480_000n : -125_000n,
          vat_amount: 0n,
          currency: "USD",
          vat_status: "source",
          source: "mercury",
          project_name: "Cedar Lot",
          category_name: income ? "Rent" : "Office",
          supplier_name: income ? null : "Example Office Suite",
          customer_name: income ? "Sample Tenant LLC" : null,
        }}
      />
    </StoryRoute>
  );
}

export const TransactionMetaNone: Story = {
  name: "Transaction bank details: none",
  render: () => <MercuryTransaction meta={storyMeta("t-meta", {})} />,
};

export const TransactionMetaCard: Story = {
  name: "Transaction bank details: card",
  render: () => (
    <MercuryTransaction
      meta={storyMeta("t-meta", {
        method: "card",
        card_last4: "4242",
        account: "Mercury Checking (1)",
        counterparty: "Example Office Suite",
        bank_description: "EXAMPLE OFFICE SUITE ••6789",
      })}
    />
  ),
};

export const TransactionMetaAchMemo: Story = {
  name: "Transaction bank details: ACH and memo",
  render: () => (
    <MercuryTransaction
      meta={storyMeta("t-meta", {
        method: "ach",
        account: "Mercury Checking ••1234",
        counterparty: "Example Office Suite Holdings",
        memo: "Invoice 1042 for the September office lease, parking, and storage",
        bank_description: "ACH EXAMPLE OFFICE SUITE HOLDINGS PPD",
      })}
    />
  ),
};

export const TransactionMetaLongMemoOpen: Story = {
  name: "Transaction bank details: long memo, open",
  render: () => (
    <MercuryTransaction
      meta={storyMeta("t-meta", {
        method: "ach",
        memo: "Invoice 1042 for the September office lease, parking for two cars, storage unit B, after-hours cleaning, the shared kitchen supplies, the lobby badge reissue, and the late fee that was waived by the landlord in August after the elevator repair",
      })}
    />
  ),
  play: async ({ canvasElement }) => {
    const toggle = await within(canvasElement).findByRole("button", { name: /הערה/ });
    await userEvent.click(toggle);
    // Route stories open with the title focused (storybook-layout's focus check); the click moved it.
    canvasElement.querySelector<HTMLElement>(".ui-focus-title")?.focus();
  },
};

export const TransactionMetaWire: Story = {
  name: "Transaction bank details: wire income",
  render: () => (
    <MercuryTransaction
      income
      meta={storyMeta("t-meta", {
        method: "wire",
        account: "Mercury Savings ••5678",
        counterparty: "Sample Tenant Holdings LLC",
        bank_description: "WIRE FROM SAMPLE TENANT HOLDINGS ••4321",
      })}
    />
  ),
};

export const TransactionMetaHebrewMemo: Story = {
  name: "Transaction bank details: Hebrew memo",
  render: () => (
    <MercuryTransaction
      meta={storyMeta("t-meta", {
        method: "transfer",
        account: "Mercury Checking ••1234",
        memo: "העברה לחשבון החיסכון לפני תשלום המע״מ של חודש ספטמבר",
      })}
    />
  ),
};

export const TransactionMetaLongAccount: Story = {
  name: "Transaction bank details: long account name",
  render: () => (
    <MercuryTransaction
      meta={storyMeta("t-meta", {
        method: "check",
        account: "Mercury Operating Reserve for Cedar Lot Construction ••1234",
        counterparty: "Example Construction Supply and Equipment Rental Company",
      })}
    />
  ),
};

/* FLOW-114 option B: a payment matched to a loan shows as one row in place of the category row.
   Invented data: a 6,200 payment on an invented mortgage, split 4,150 / 1,630 / 380 / 40. */
const LOAN_TXN = {
  id: "t-loan",
  description: "בנק לדוגמה",
  direction: "expense",
  doc_date: "2026-10-01",
  amount_gross: -620_000n,
  amount_net: -620_000n,
  vat_amount: 0n,
  vat_status: "source",
  doc_kind: "expense",
  source: "manual",
  project_id: "gefen",
  project_name: "הגפן 12",
  category_id: "c-loan",
  category_name: "תשלום הלוואה",
  supplier_name: "בנק לדוגמה",
  customer_name: null,
  review_status: "approved",
  paid: true,
  open_gross_agorot: null,
  pnl_fixed: true,
} as const;

const LOAN_SPLIT: TransactionLoanSplit = {
  loan_id: "loan-gefen",
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

function loanStoryApi({ currency = "ILS", saveFails = false }: { currency?: string; saveFails?: boolean } = {}): LoanMatchApi {
  const stored = LOAN_SPLIT.parts.map((part) => ({
    part: part.part,
    amountMinor: part.amount_minor,
    scheduledMinor: part.amount_minor,
    categoryId: part.part === "fees" ? "c-fees" : null,
    needsReview: false,
  }));
  return {
    read: () => Promise.resolve({
      companyId: "co-sample",
      lineMinor: 620_000n,
      currency,
      splits: [],
      byParts: false,
      loans: [{
        id: "loan-gefen",
        name: "משכנתא לדוגמה",
        currency,
        principalMinor: 100_000_000,
        annualRatePpm: 50_000,
        termMonths: 360,
        startDate: "2026-01-01",
        paymentMinor: 620_000,
        escrowMinor: 38_000,
        balanceMinor: 90_000_000n,
        categoryIds: { principal: "c-loan" },
      }],
      categoryIds: { principal: "c-loan" },
    }),
    readStored: () => Promise.resolve({ lineMinor: 620_000n, currency, loanCurrency: currency, parts: stored }),
    save: () => (saveFails ? Promise.reject(new Error("loan balance exceeded")) : Promise.resolve()),
    clear: () => Promise.resolve({
      loanId: "loan-gefen",
      parts: stored.map((part) => ({
        part: part.part,
        amount_minor: Number(part.amountMinor),
        scheduled_minor: Number(part.scheduledMinor),
        category_id: part.categoryId,
        needs_review: false,
      })),
    }),
  };
}

function LoanMatchStory({ currency = "ILS", saveFails = false, viewer = false }: { currency?: string; saveFails?: boolean; viewer?: boolean }) {
  const [api] = useState(() => loanStoryApi({ currency, saveFails }));
  return (
    <StoryRoute entry="/transactions/t-loan" viewer={viewer}>
      <ExampleBar />
      <LoanMatchSampleProvider api={api} initial={LOAN_SPLIT} loanNames={{ "loan-gefen": "משכנתא לדוגמה" }}>
        <TransactionScreen
          sample={{ ...LOAN_TXN, currency, loan_split: LOAN_SPLIT }}
          sampleProjects={[{ id: "gefen", name: "הגפן 12" }]}
          sampleCategories={[{ id: "c-loan", name: "תשלום הלוואה" }]}
        />
      </LoanMatchSampleProvider>
    </StoryRoute>
  );
}

const LOAN_ROW = /^תשלום הלוואה · משכנתא לדוגמה/;

/** Matched: one row, "תשלום הלוואה · <loan>" with the part count under it. */
export const TransactionLoanMatched: Story = {
  name: "Loan payment matched",
  render: () => <LoanMatchStory />,
};

/** The row opens the split sheet: the parts, the total, שמירה and a quiet ביטול השיוך. */
export const TransactionLoanEditing: Story = {
  name: "Loan payment, split sheet",
  parameters: { viewport: { defaultViewport: "flow375-se" } },
  render: () => <LoanMatchStory />,
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: LOAN_ROW }));
    const dialog = await storyBody(canvasElement).findByRole("dialog", { name: "משכנתא לדוגמה" });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "שמירה" })).toBeEnabled());
  },
};

/** The server's balance check refuses the save: an error toast, and the sheet keeps the values. */
export const TransactionLoanSaveError: Story = {
  name: "Loan payment, save refused by the balance check",
  parameters: { viewport: { defaultViewport: "flow375-se" } },
  render: () => <LoanMatchStory saveFails />,
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: LOAN_ROW }));
    const body = storyBody(canvasElement);
    const dialog = await body.findByRole("dialog", { name: "משכנתא לדוגמה" });
    const save = within(dialog).getByRole("button", { name: "שמירה" });
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.clear(within(dialog).getByLabelText("סכום, קרן"));
    await userEvent.type(within(dialog).getByLabelText("סכום, קרן"), "4100");
    await userEvent.clear(within(dialog).getByLabelText("סכום, ריבית"));
    await userEvent.type(within(dialog).getByLabelText("סכום, ריבית"), "1680");
    await userEvent.click(save);
    await body.findByText("התשלום גבוה מיתרת ההלוואה.");
  },
};

/** After ביטול השיוך: the category row is back, the שיוך row returns, and the toast offers undo. */
export const TransactionLoanUnmatched: Story = {
  name: "Loan payment unmatched, with undo",
  render: () => <LoanMatchStory />,
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: LOAN_ROW }));
    const body = storyBody(canvasElement);
    const dialog = await body.findByRole("dialog", { name: "משכנתא לדוגמה" });
    await userEvent.click(within(dialog).getByRole("button", { name: "ביטול השיוך" }));
    await body.findByText("השיוך בוטל");
    await within(canvasElement).findByRole("button", { name: /שיוך להלוואה/ });
  },
};

/** A viewer reads the row. */
export const TransactionLoanViewer: Story = {
  name: "Loan payment, viewer",
  render: () => <LoanMatchStory viewer />,
};

/** A viewer opens the parts read-only: no fields, no שמירה, no ביטול השיוך. */
export const TransactionLoanViewerSheet: Story = {
  name: "Loan payment, viewer reads the parts",
  parameters: { viewport: { defaultViewport: "flow375-se" } },
  render: () => <LoanMatchStory viewer />,
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: LOAN_ROW }));
    const dialog = await storyBody(canvasElement).findByRole("dialog", { name: "משכנתא לדוגמה" });
    await expect(within(dialog).queryByRole("button", { name: "שמירה" })).toBeNull();
  },
};

/** A dollar loan on a dollar line: the sheet shows $. */
export const TransactionLoanUsd: Story = {
  name: "Loan payment in dollars, split sheet",
  parameters: { viewport: { defaultViewport: "flow375-se" } },
  render: () => <LoanMatchStory currency="USD" />,
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: LOAN_ROW }));
    await storyBody(canvasElement).findByRole("dialog", { name: "משכנתא לדוגמה" });
  },
};
