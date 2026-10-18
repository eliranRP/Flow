import type { Meta, StoryObj } from "@storybook/react";
import { userEvent, within } from "@storybook/test";
import type { TransactionDetail } from "@flow/shared";
import { TransactionScreen } from "./flow-screens";
import { StoryRoute } from "../ui/story-route";
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
          supplier_name: "חומרי בניין לדוגמה בע״מ",
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

/** FLOW-415 (a-3): the cash view and recurring switches under נספר ברווח. Invented data. */
const recurringSample = {
  transaction_id: "t1",
  party: { direction: "expense" as const, id: "s-power", name: "אור חשמל", currency: "ILS" },
  recurring: true,
  override: null,
  detected: true,
  typical_day: 4,
  typical_amount_minor: -185_000n,
};
function RecurringStory({ income = false }: { income?: boolean }) {
  return (
    <StoryRoute entry="/transactions/t1">
      <ExampleBar />
      <TransactionScreen
        sample={pnlSample(income
          ? { direction: "income", amount_gross: 1_200_000n, amount_net: 1_200_000n, supplier_name: null, customer_name: "לקוח לדוגמה", category_name: "שכירות" }
          : { supplier_name: "אור חשמל", project_name: "בניין הדקל", category_name: "חשמל", amount_gross: -255_000n, amount_net: -255_000n })}
        sampleCategories={[{ id: "c1", name: income ? "שכירות" : "חשמל" }]}
        sampleRecurring={income ? { ...recurringSample, party: { ...recurringSample.party, direction: "income", name: "לקוח לדוגמה" } } : recurringSample}
      />
    </StoryRoute>
  );
}
export const TransactionRecurring: Story = { name: "Recurring charge, found by itself", render: () => <RecurringStory /> };
