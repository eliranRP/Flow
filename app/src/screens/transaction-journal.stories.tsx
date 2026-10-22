import type { Meta, StoryObj } from "@storybook/react";
import { userEvent, within } from "@storybook/test";
import type { TransactionDetail } from "@flow/shared";
import type { LineJournal } from "../line-journal";
import type { TxnMeta } from "../txn-meta";
import { StoryRoute } from "../ui/story-route";
import { ExampleBar } from "../ui/screen-stories-support";
import { TransactionScreen } from "./transaction-screen";

/**
 * FLOW-954 (board LedgerLinePlain and LedgerLineAdvanced). The line screen's פקודת יומן: a plain line keeps
 * it behind a quiet link at the bottom; a line with legs outside the P&L shows it open; a line Jev booked
 * carries "✦ נרשם ע״י Jev". Invented data only.
 */
const meta = {
  title: "Screens/Transaction journal",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

type Txn = NonNullable<TransactionDetail>;

const bankLine = (txn: Txn): TxnMeta => ({
  transaction_id: txn.id,
  method: "ach",
  card_last4: null,
  memo: null,
  account: "Example Checking ••1234",
  counterparty: null,
  bank_description: `${txn.description.toUpperCase()}; ACH DEBIT`,
});

const plainTxn: Txn = {
  id: "t-journal",
  description: "Example Plumbing",
  direction: "expense",
  doc_date: "2026-10-09",
  amount_gross: -240_000n,
  amount_net: -240_000n,
  vat_amount: 0n,
  vat_status: "source",
  source: "mercury",
  project_id: "p1",
  project_name: "פרויקט הרצליה",
  category_id: "c1",
  category_name: "קבלני משנה",
  supplier_name: "Example Plumbing",
  customer_name: null,
  currency: "USD",
  paid: true,
  open_gross_agorot: null,
  review_status: "approved",
  allocations: [],
};

const leg = (ordinal: number, name: string, type: "income" | "expense" | "asset" | "liability", amount: bigint, extra: Partial<LineJournal["legs"][number]> = {}) => ({
  ordinal,
  account_id: `a${String(ordinal)}`,
  account_name: name,
  account_type: type,
  system: false,
  is_bank: false,
  in_pnl: type === "income" || type === "expense",
  project_name: null,
  amount_minor: amount,
  ...extra,
});

const plainJournal: LineJournal = {
  currency: "USD",
  balanced: true,
  booked_by_ai: false,
  legs: [
    leg(1, "קבלני משנה", "expense", 240_000n, { project_name: "פרויקט הרצליה" }),
    leg(2, "Bank/Clearing", "asset", -240_000n, { system: true, is_bank: true }),
  ],
};

const loanTxn: Txn = {
  ...plainTxn,
  id: "t-journal-loan",
  description: "Example Loan Servicing",
  supplier_name: "Example Loan Servicing",
  doc_date: "2026-10-04",
  amount_gross: -235_000n,
  amount_net: -235_000n,
  project_name: "פרויקט רעננה",
  category_name: "ריבית משכנתא",
};

const loanJournal: LineJournal = {
  currency: "USD",
  balanced: true,
  booked_by_ai: true,
  legs: [
    leg(1, "ריבית משכנתא", "expense", 140_000n, { project_name: "פרויקט רעננה" }),
    leg(2, "Escrow", "asset", 60_000n, { system: true, project_name: "פרויקט רעננה" }),
    leg(3, "Loan principal", "liability", 35_000n, { system: true, project_name: "פרויקט רעננה" }),
    leg(4, "Bank/Clearing", "asset", -235_000n, { system: true, is_bank: true }),
  ],
};

function JournalStory({ txn, journal }: { txn: Txn; journal: LineJournal }) {
  return (
    <StoryRoute entry={`/transactions/${txn.id}`}>
      <ExampleBar />
      <TransactionScreen
        sample={txn}
        sampleProjects={[{ id: "p1", name: txn.project_name ?? "" }]}
        sampleCategories={[{ id: "c1", name: txn.category_name ?? "" }]}
        sampleMeta={bankLine(txn)}
        sampleJournal={journal}
      />
    </StoryRoute>
  );
}

/** A plain line: "פקודת יומן ▾" at the bottom, closed. */
export const PlainLine: Story = {
  render: () => <JournalStory txn={plainTxn} journal={plainJournal} />,
};

/** The link opens the entry in place: חובה (the cost) then זכות (the bank), balanced. */
export const PlainLineOpen: Story = {
  render: () => <JournalStory txn={plainTxn} journal={plainJournal} />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /^פקודת יומן/ }));
    await within(canvasElement).findByRole("region", { name: "פקודת יומן" });
  },
};

/** A mortgage payment Jev booked: escrow and principal are outside the P&L, so the entry shows open, with the badge. */
export const KeptOutLegsBookedByJev: Story = {
  render: () => <JournalStory txn={loanTxn} journal={loanJournal} />,
};

/** A plain line Jev booked: the badge shows once the entry is opened. */
export const PlainLineBookedByJev: Story = {
  render: () => <JournalStory txn={plainTxn} journal={{ ...plainJournal, booked_by_ai: true }} />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /^פקודת יומן/ }));
    await within(canvasElement).findByText(/נרשם ע״י Jev/);
  },
};
