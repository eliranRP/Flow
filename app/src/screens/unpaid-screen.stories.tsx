import type { Meta, StoryObj } from "@storybook/react";
import { InvoiceScreen } from "./invoice-screen";
import { UnpaidScreen } from "./unpaid-screen";
import { StoryRoute } from "../ui/story-route";
import { ExampleBar } from "../ui/screen-stories-support";
import { invoicesSample, invoicesSummary } from "../dev/invoices-sample";
import { israelToday, shiftDays } from "../ui/date-math";
import type { UnpaidInvoice } from "../unpaid";

const meta = {
  title: "Screens/Routes",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const rows = invoicesSample();
const summary = invoicesSummary();

/** FLOW-367: the board's list: the summary card, three invoices oldest first, one bank match. */
export const UnpaidList: Story = {
  render: () => (
    <StoryRoute entry="/unpaid" tabs>
      <ExampleBar />
      <UnpaidScreen sample={rows} summary={summary} />
    </StoryRoute>
  ),
};

/** No invoice is over 30 days: the signal line in the summary card is not drawn. */
export const UnpaidNoOverdue: Story = {
  name: "Unpaid, none over 30 days",
  render: () => (
    <StoryRoute entry="/unpaid" tabs>
      <ExampleBar />
      <UnpaidScreen
        sample={rows.map((row) => ({ ...row, doc_date: shiftDays(israelToday(), -10) }))}
        summary={summary}
      />
    </StoryRoute>
  ),
};

/** A marked row waits for the sync: dimmed, with its ביטול line; the other rows keep their mark line. */
export const UnpaidMarked: Story = {
  name: "Unpaid, a marked row waits for the sync",
  render: () => (
    <StoryRoute entry="/unpaid" tabs>
      <ExampleBar />
      <UnpaidScreen
        sample={rows.map((row) => (row.id === "inv-1047" ? { ...row, marked_paid_at: "2026-10-16T09:00:00Z" } : row))}
        summary={summary}
      />
    </StoryRoute>
  ),
};

/** A deposit that matches a row shows its match line on the list, and the match card on the page. */
export const UnpaidMatchOnPage: Story = {
  name: "Invoice page, bank match found",
  render: () => (
    <StoryRoute entry="/unpaid/inv-1051" tabs>
      <ExampleBar />
      <InvoiceScreen sample={rows} summary={summary} invoiceId="inv-1051" />
    </StoryRoute>
  ),
};

export const UnpaidDetailNoMatch: Story = {
  name: "Invoice page, no match",
  render: () => (
    <StoryRoute entry="/unpaid/inv-1043" tabs>
      <ExampleBar />
      <InvoiceScreen sample={rows} summary={summary} invoiceId="inv-1043" />
    </StoryRoute>
  ),
};

/** No PDF link on SUMIT for this invoice: the document row is not drawn. */
export const UnpaidDetailNoDocument: Story = {
  name: "Invoice page, no document",
  render: () => (
    <StoryRoute entry="/unpaid/inv-1043" tabs>
      <ExampleBar />
      <InvoiceScreen
        sample={rows.map((row): UnpaidInvoice => (row.id === "inv-1043" ? { ...row, document_url: null } : row))}
        summary={summary}
        invoiceId="inv-1043"
      />
    </StoryRoute>
  ),
};

/** Everything is paid: the summary card and the sort row's list go, the empty state stays. */
export const UnpaidEmpty: Story = {
  render: () => (
    <StoryRoute entry="/unpaid?state=done" tabs>
      <ExampleBar />
      <UnpaidScreen sample={[]} summary={summary} />
    </StoryRoute>
  ),
};

export const UnpaidError: Story = {
  render: () => (
    <StoryRoute entry="/unpaid?preview=error" tabs>
      <ExampleBar />
      <UnpaidScreen />
    </StoryRoute>
  ),
};
