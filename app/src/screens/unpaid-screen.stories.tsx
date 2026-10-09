import type { UnpaidRow } from "@flow/shared";
import type { Meta, StoryObj } from "@storybook/react";
import { UnpaidScreen } from "./flow-screens";
import { StoryRoute } from "../ui/story-route";
import { at320, dark, ExampleBar } from "../ui/screen-stories-support";

const sampleUnpaid: UnpaidRow[] = [
  {
    id: "u1",
    description: "הובלה",
    doc_date: "2026-09-02",
    project_name: "שיפוץ דירה ת״א",
    customer_name: "מ.ש. הובלות",
    open_gross_agorot: 600_000n,
    open_net_agorot: 508_475n,
  },
  {
    id: "u2",
    description: "חשמל",
    doc_date: "2026-09-10",
    project_name: "וילה רעננה",
    customer_name: "אבי חשמל",
    open_gross_agorot: 800_000n,
    open_net_agorot: 677_966n,
  },
  {
    id: "u3",
    description: "חומרים",
    doc_date: "2026-09-14",
    project_name: "בניין מגורים חולון",
    customer_name: "חומרי בניין לדוגמה",
    open_gross_agorot: 940_000n,
    open_net_agorot: 796_610n,
  },
];

const meta = {
  title: "Screens/Routes",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const UnpaidList: Story = {
  render: () => (
    <StoryRoute entry="/unpaid" tabs>
      <ExampleBar />
      <UnpaidScreen sample={sampleUnpaid} />
    </StoryRoute>
  ),
};

// FLOW-335: a row with SUMIT's document link opens it in a new tab (chevron); the others stay still.
export const UnpaidWithDocument: Story = {
  name: "Unpaid, document link",
  render: () => (
    <StoryRoute entry="/unpaid" tabs>
      <ExampleBar />
      <UnpaidScreen sample={sampleUnpaid.map((row, index) => (index === 0 ? { ...row, document_url: "https://pay.sumit.co.il/example/doc-1" } : row))} />
    </StoryRoute>
  ),
};
export const UnpaidWithDocumentDark: Story = { ...UnpaidWithDocument, name: "Unpaid, document link, dark", ...dark };
export const UnpaidWithDocument320: Story = { ...UnpaidWithDocument, name: "Unpaid, document link, 320", ...at320 };

export const UnpaidEmpty: Story = {
  render: () => (
    <StoryRoute entry="/unpaid?preview=empty" tabs>
      <ExampleBar />
      <UnpaidScreen />
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

const unpaidWithMark: UnpaidRow[] = [
  { ...sampleUnpaid[0], marked_paid_at: "2026-10-06T09:00:00Z", currency: "ILS", direction: "income" } as UnpaidRow,
  ...sampleUnpaid.slice(1).map((row) => ({ ...row, currency: "ILS", direction: "income" as const, marked_paid_at: null })),
  { id: "u4", description: "ייעוץ", doc_date: "2026-09-20", project_name: null, customer_name: "לקוח בדולרים לדוגמה", open_gross_agorot: 250_000n, open_net_agorot: 250_000n, currency: "USD", direction: "income", marked_paid_at: null },
];

export const UnpaidMarked: Story = {
  name: "Unpaid, a marked row waits for the sync",
  render: () => (
    <StoryRoute entry="/unpaid" tabs>
      <ExampleBar />
      <UnpaidScreen sample={unpaidWithMark} />
    </StoryRoute>
  ),
};
export const UnpaidMarkedDark: Story = { ...UnpaidMarked, name: "Unpaid, marked, dark", ...dark };
export const UnpaidMarked320: Story = { ...UnpaidMarked, name: "Unpaid, marked, 320", ...at320 };
export const UnpaidMarkedDark320: Story = { ...UnpaidMarked, name: "Unpaid, marked, dark, 320", ...dark, ...at320 };
