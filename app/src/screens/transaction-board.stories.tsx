import type { Meta, StoryObj } from "@storybook/react";
import type { TransactionDetail } from "@flow/shared";
import { TransactionScreen } from "./flow-screens";
import { StoryRoute } from "../ui/story-route";
import { ExampleBar } from "../ui/screen-stories-support";

const meta = {
  title: "Screens/Transaction board",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

type Txn = NonNullable<TransactionDetail>;

/** The board's transaction frame: an open review, a project and a category, a USD expense. */
const boardTxn: Txn = {
  id: "t-board",
  description: "ספק לדוגמה",
  direction: "expense",
  doc_date: "2026-10-08",
  amount_gross: -128450n,
  amount_net: -128450n,
  vat_amount: 0n,
  vat_status: "source",
  source: "sumit",
  project_id: "p1",
  project_name: "פרויקט לדוגמה",
  category_id: "c1",
  category_name: "חומרים",
  supplier_name: "ספק לדוגמה",
  customer_name: null,
  currency: "USD",
  paid: false,
  open_gross_agorot: null,
  review_status: "open",
  review_id: "r1",
  allocations: [],
};

function BoardTransactionStory({ sample }: { sample: Txn }) {
  return (
    <StoryRoute entry="/transactions/t-board">
      <ExampleBar />
      <TransactionScreen
        sample={sample}
        sampleProjects={[{ id: "p1", name: "פרויקט לדוגמה" }]}
        sampleCategories={[{ id: "c1", name: "חומרים" }]}
      />
    </StoryRoute>
  );
}

/** The board's Pending state: the review is open, so the banner links to it and the status line shows. */
export const Pending: Story = {
  render: () => <BoardTransactionStory sample={boardTxn} />,
};

/** The board's NoProject state: no project yet, so the project row asks for one in the accent tone. */
export const NoProject: Story = {
  render: () => <BoardTransactionStory sample={{ ...boardTxn, project_id: null, project_name: null }} />,
};

/** The board's Manual state: a hand-entered expense with an assumed VAT line. */
export const Manual: Story = {
  render: () => (
    <BoardTransactionStory
      sample={{
        ...boardTxn,
        id: "t-manual",
        description: "רשומה ידנית",
        doc_date: "2026-09-12",
        amount_gross: -118n,
        amount_net: -100n,
        vat_amount: -18n,
        vat_status: "assumed",
        source: "manual",
        review_status: "approved",
        review_id: null,
        paid: true,
        currency: "ILS",
      }}
    />
  ),
};
