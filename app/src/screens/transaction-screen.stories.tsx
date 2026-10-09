import type { Meta, StoryObj } from "@storybook/react";
import { userEvent, within } from "@storybook/test";
import type { TransactionDetail } from "@flow/shared";
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

function pnlSample(extra: Partial<NonNullable<TransactionDetail>>): NonNullable<TransactionDetail> {
  return {
    id: "t1",
    description: "חומרי בניין",
    direction: "expense",
    doc_date: "2026-09-21",
    amount_gross: -240_000n,
    amount_net: -240_000n,
    vat_amount: 0n,
    vat_status: "unknown",
    doc_kind: "expense",
    source: "sumit",
    project_id: "holon",
    project_name: "בניין מגורים חולון",
    category_id: "c1",
    category_name: "חומרים",
    supplier_name: "ספק לדוגמה",
    customer_name: null,
    review_status: "approved",
    paid: false,
    open_gross_agorot: null,
    in_pnl_override: null,
    category_excluded_from_pnl: false,
    in_pnl: true,
    pnl_fixed: false,
    ...extra,
  };
}

/** FLOW-124: a line split by category with one part kept out reads "חלקית ברווח" from pnl_state. */
export const TransactionPnlMixed: Story = {
  name: "P&L partly kept out (split by category)",
  render: () => (
    <StoryRoute entry="/transactions/t1">
      <ExampleBar />
      <TransactionScreen sample={pnlSample({ pnl_state: "mixed" })} sampleCategories={[{ id: "c1", name: "חומרים" }]} />
    </StoryRoute>
  ),
};

/** FLOW-329: a loan line's P&L row is locked; its parts decide what counts. */
export const TransactionPnlLoanLine: Story = {
  name: "P&L locked (loan payment)",
  render: () => (
    <StoryRoute entry="/transactions/t1">
      <ExampleBar />
      <TransactionScreen sample={pnlSample({ category_name: "תשלומי הלוואה", pnl_fixed: true, pnl_state: "mixed" })} sampleCategories={[{ id: "c1", name: "תשלומי הלוואה" }]} />
    </StoryRoute>
  ),
};

/** FLOW-124: the category is kept out, so the hint names it and the switch brings back this line only. */
export const TransactionPnlCategoryOut: Story = {
  name: "P&L kept out by its category",
  render: () => (
    <StoryRoute entry="/transactions/t1">
      <ExampleBar />
      <TransactionScreen sample={pnlSample({ category_name: "פיקדונות", category_excluded_from_pnl: true, in_pnl: false, pnl_state: "out" })} sampleCategories={[{ id: "c1", name: "פיקדונות" }]} />
    </StoryRoute>
  ),
};

/** FLOW-124: one line of a kept-out category brought back in shows the "ברווח והפסד" pill. */
export const TransactionPnlForcedIn: Story = {
  name: "P&L forced back in",
  render: () => (
    <StoryRoute entry="/transactions/t1">
      <ExampleBar />
      <TransactionScreen sample={pnlSample({ category_name: "פיקדונות", category_excluded_from_pnl: true, in_pnl_override: true, in_pnl: true, pnl_state: "in" })} sampleCategories={[{ id: "c1", name: "פיקדונות" }]} />
    </StoryRoute>
  ),
};

/** FLOW-329: ⋯ shows on a manual line only and holds מחיקה; the play opens it so clip-check measures it. */
export const TransactionManualMore: Story = {
  name: "Manual line ⋯ sheet",
  render: () => (
    <StoryRoute entry="/transactions/t1">
      <ExampleBar />
      <TransactionScreen sample={pnlSample({ source: "manual", supplier_name: "רישום ידני" })} sampleCategories={[{ id: "c1", name: "חומרים" }]} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "עוד" }));
    await storyBody(canvasElement).findByRole("dialog", { name: "עוד" });
  },
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
