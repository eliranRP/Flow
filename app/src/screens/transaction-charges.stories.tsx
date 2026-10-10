import type { Meta, StoryObj } from "@storybook/react";
import { userEvent, within } from "@storybook/test";
import type { TransactionDetail } from "@flow/shared";
import { TransactionScreen } from "./flow-screens";
import { StoryRoute } from "../ui/story-route";
import { mailboxCharges, rentCharges } from "../ui/related-charges.sample";
import { ExampleBar, at320, dark } from "../ui/screen-stories-support";

/** FLOW-431 (the owner's layout A): the transaction screen with its "חיובים קודמים" section. Invented data. */
const meta = {
  title: "Screens/Routes",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function line(income: boolean): NonNullable<TransactionDetail> {
  return {
    id: income ? "r1" : "t1",
    description: income ? "שכירות" : "Example Mailbox",
    direction: income ? "income" : "expense",
    doc_date: income ? "2026-10-01" : "2026-10-06",
    amount_gross: income ? 400_000n : -2_299n,
    amount_net: income ? 400_000n : -2_299n,
    vat_amount: 0n,
    vat_status: "source",
    doc_kind: income ? "invoice" : "receipt",
    source: "mercury",
    project_id: "overhead",
    project_name: "הוצאות כלליות",
    category_id: "c1",
    category_name: income ? "שכירות" : "תוכנות ומנויים",
    supplier_name: income ? null : "Example Mailbox",
    customer_name: income ? "שוכר לדוגמה" : null,
    review_status: "approved",
    paid: true,
    open_gross_agorot: null,
    currency: income ? "ILS" : "USD",
  };
}

function ChargesStory({ income = false }: { income?: boolean }) {
  return (
    <StoryRoute entry={income ? "/transactions/r1" : "/transactions/t1"}>
      <ExampleBar />
      <TransactionScreen sample={line(income)} sampleCategories={[{ id: "c1", name: income ? "שכירות" : "תוכנות ומנויים" }]} sampleCharges={income ? rentCharges : mailboxCharges} />
    </StoryRoute>
  );
}

const openSheet = {
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: "לכל החיובים" }));
  },
};

export const TransactionUsualChange: Story = { name: "Transaction, against the usual amount", render: () => <ChargesStory /> };
export const TransactionUsualChangeDark: Story = { name: "Transaction, against the usual amount, dark", render: () => <ChargesStory />, ...dark };
export const TransactionUsualChange320: Story = { name: "Transaction, against the usual amount, 320", render: () => <ChargesStory />, ...at320 };
export const TransactionUsualChangeIncome: Story = { name: "Income, against the usual amount", render: () => <ChargesStory income /> };
export const TransactionUsualChangeSheet: Story = { name: "Transaction, earlier charges sheet", render: () => <ChargesStory />, ...openSheet };
