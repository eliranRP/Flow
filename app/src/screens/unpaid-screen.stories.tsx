import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { InvoiceScreen } from "./invoice-screen";
import { UnpaidScreen } from "./unpaid-screen";
import { StoryRoute } from "../ui/story-route";
import { ExampleBar } from "../ui/screen-stories-support";
import { invoicesSample, invoicesSummary } from "../dev/invoices-sample";
import { longHebrew } from "../ui/story-support";
import type { UnpaidInvoice } from "../unpaid";
import { israelToday, shiftDays } from "../ui/date-math";

const meta = {
  title: "Screens/Routes",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const rows = invoicesSample();
const summary = invoicesSummary();

/** FLOW-1049: a long list, names past one line, half of them over 30 days (the docked and long-content stories). */
const longRows: UnpaidInvoice[] = Array.from({ length: 14 }, (_, k) => ({
  description: "חשבונית",
  project_name: null,
  open_gross_agorot: BigInt(250_000 + k * 40_000),
  open_net_agorot: BigInt(250_000 + k * 40_000),
  currency: "USD",
  doc_number: String(1100 + k),
  id: `long-${String(k)}`,
  customer_name: k % 3 === 0 ? `${longHebrew} ${String(k)}` : `לקוח ${String(k + 1)}`,
  doc_date: shiftDays(israelToday(), -(k * 5 + 3)),
  match: null,
}));

/** FLOW-367: the board's list: the summary card, three invoices oldest first, one bank match. */
export const UnpaidList: Story = {
  render: () => (
    <StoryRoute entry="/unpaid" tabs>
      <ExampleBar />
      <UnpaidScreen sample={rows} summary={summary} />
    </StoryRoute>
  ),
};

/** An invoice open past UNPAID_OVERDUE_DAYS (34 days): its age line says it is late. */
export const UnpaidOverdue: Story = {
  name: "Unpaid, an invoice open over 30 days",
  render: () => (
    <StoryRoute entry="/unpaid" tabs>
      <ExampleBar />
      <UnpaidScreen sample={rows.filter((row) => row.id === "inv-1043")} summary={summary} />
    </StoryRoute>
  ),
};

/** A marked row waits for the sync: full contrast, its line says the state, with its ביטול (FLOW-968). */
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

/** FLOW-968: offline with invoices on screen, a line says which moment they are from. */
export const UnpaidOffline: Story = {
  render: () => (
    <StoryRoute entry="/unpaid" tabs>
      <ExampleBar />
      <UnpaidScreen sample={rows} summary={summary} offlineSince={Date.parse("2026-10-26T06:41:00Z")} />
    </StoryRoute>
  ),
};

/** FLOW-968: the invoice page offline keeps the invoice and says which moment it is from. */
export const InvoiceOffline: Story = {
  name: "Invoice page, offline",
  render: () => (
    <StoryRoute entry="/unpaid/inv-1043" tabs>
      <ExampleBar />
      <InvoiceScreen sample={rows} summary={summary} invoiceId="inv-1043" offlineSince={Date.parse("2026-10-26T06:41:00Z")} />
    </StoryRoute>
  ),
};

/** FLOW-968: the invoice page's failed read keeps the bar and says what happened. */
export const InvoiceError: Story = {
  name: "Invoice page, failed",
  render: () => (
    <StoryRoute entry="/unpaid/inv-1043?preview=error" tabs>
      <ExampleBar />
      <InvoiceScreen invoiceId="inv-1043" />
    </StoryRoute>
  ),
};

/** FLOW-1049: the read is on its way: the title stays. FLOW-1139: the total, its line, the filter and the rows as a skeleton. */
export const UnpaidLoading: Story = {
  name: "Unpaid, loading",
  render: () => (
    <StoryRoute entry="/unpaid?preview=loading" tabs>
      <ExampleBar />
      <UnpaidScreen />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("טוען…")).toHaveAttribute("role", "status");
    await expect(canvasElement.querySelector(".ui-skel-lines-figure")).not.toBeNull();
    await expect(canvasElement.querySelector(".ui-skel-lines-chips")).not.toBeNull();
  },
};

/** FLOW-1139: the invoice page while the invoices load: the detail page's shape, not list rows. */
export const InvoiceLoading: Story = {
  name: "Invoice page, loading",
  render: () => (
    <StoryRoute entry="/unpaid/inv-1043?preview=loading" tabs>
      <ExampleBar />
      <InvoiceScreen invoiceId="inv-1043" />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("טוען…")).toHaveAttribute("role", "status");
    await expect(canvasElement.querySelector(".ui-skel-detail-head")).not.toBeNull();
    await expect(canvasElement.querySelector(".ui-skel-row")).toBeNull();
  },
};

/** FLOW-1049: long names end in an ellipsis; the check button keeps its 44px. */
export const UnpaidLong: Story = {
  name: "Unpaid, long content",
  render: () => (
    <StoryRoute entry="/unpaid" tabs>
      <ExampleBar />
      <UnpaidScreen sample={longRows} summary={summary} />
    </StoryRoute>
  ),
};

/** FLOW-1049: scrolled, the list bar slides in and the segment docks into it. */
export const UnpaidDocked: Story = {
  name: "Unpaid, docked",
  render: () => (
    <StoryRoute entry="/unpaid" tabs>
      <ExampleBar />
      <UnpaidScreen sample={longRows} summary={summary} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    window.scrollTo({ top: 700, behavior: "instant" });
    await waitFor(() => expect(canvasElement.querySelector(".ui-compact-dock")).toHaveAttribute("data-open"));
  },
};

/** FLOW-1049: באיחור 30+ keeps only the invoices open more than 30 days. */
export const UnpaidLateFilter: Story = {
  name: "Unpaid, over 30 days",
  render: () => (
    <StoryRoute entry="/unpaid" tabs>
      <ExampleBar />
      <UnpaidScreen sample={rows} summary={summary} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const [late] = within(canvasElement).getAllByRole("radio", { name: /^באיחור 30\+/ });
    await userEvent.click(late as HTMLElement);
    await expect(late).toHaveAttribute("aria-checked", "true");
  },
};

/** FLOW-1049: the check button marks the row paid, and the toast offers ביטול. */
export const UnpaidMarkPaid: Story = {
  name: "Unpaid, marked with the check",
  render: () => (
    <StoryRoute entry="/unpaid" tabs>
      <ExampleBar />
      <UnpaidScreen sample={rows} summary={summary} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const [check] = within(canvasElement).getAllByRole("button", { name: /^סימון כשולם: / });
    await userEvent.click(check as HTMLElement);
    await expect(await within(document.body).findByText("סומן כשולם")).toBeInTheDocument();
  },
};
