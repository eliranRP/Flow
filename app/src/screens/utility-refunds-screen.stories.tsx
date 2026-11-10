import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { UtilityRefundsScreen } from "./utility-refunds-screen";
import { PINE, storyUtilityClient, utilityRefundsSample, utilitySplitSample, utilityTypesSample } from "./utility-refunds-sample";
import { StoryRoute } from "../ui/story-route";
import { ExampleBar } from "../ui/screen-stories-support";
import { UtilityClientProvider, type UtilityBill } from "../utility-refunds";

const meta = {
  title: "Screens/UtilityRefunds",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The screen as it reads through a stand-in for Flow's server (the sample's bills; every answer succeeds). */
function RefundsStory({ entry = "/utility-refunds", bills = utilityRefundsSample(), viewer = false }: { entry?: string; bills?: UtilityBill[]; viewer?: boolean }) {
  return (
    <StoryRoute entry={entry} tabs viewer={viewer}>
      <UtilityClientProvider client={storyUtilityClient(bills)}>
        <ExampleBar />
        <UtilityRefundsScreen />
      </UtilityClientProvider>
    </StoryRoute>
  );
}

/**
 * FLOW-1135, FLOW-1143: two properties, each with a refund the owner matched that is filed elsewhere (הוחזר, "ייתכן
 * שסווג לא נכון", the fix and להשאיר), then its bills not refunded. No suggestions and no filter.
 */
export const UtilityRefundsList: Story = {
  render: () => <RefundsStory />,
};

/** FLOW-1142: the rent payment is split by category: its parts under its leg, the project named where it differs. */
export const UtilityRefundsSplit: Story = {
  name: "UtilityRefunds, split payment",
  render: () => <RefundsStory bills={utilitySplitSample()} />,
  play: async ({ canvasElement }) => {
    const list = await within(canvasElement).findByRole("list", { name: "פיצול" });
    await expect(within(list).getAllByRole("listitem")).toHaveLength(3);
  },
};

/** FLOW-1142: long split lines (a long category and project) wrap at 320 and are never cut. */
export const UtilityRefundsSplitLong: Story = {
  name: "UtilityRefunds, split payment, long content",
  render: () => (
    <RefundsStory
      bills={utilitySplitSample().map((bill) => (bill.payment == null || bill.payment.parts.length === 0 ? bill : {
        ...bill,
        payment: {
          ...bill.payment,
          project_name: "דירת הגפן 3 · הבניין הצפוני ליד הפארק הגדול",
          parts: bill.payment.parts.map((part) => ({
            ...part,
            category_name: `${String(part.category_name)} ושירותים משותפים לבניין`,
            project_name: `${String(part.project_name)} · הבניין הדרומי ליד תחנת הרכבת`,
            amount_minor: part.amount_minor * 1000n + 7n,
          })),
        },
      }))}
    />
  ),
};

/** One property, opened from its page's row (`?project=`): Back returns to the property. */
export const UtilityRefundsProperty: Story = {
  name: "UtilityRefunds, one property",
  render: () => <RefundsStory entry={`/utility-refunds?project=${PINE}`} />,
};

/** A viewer sees the cards and the rows with no answers. */
export const UtilityRefundsViewer: Story = {
  name: "UtilityRefunds, viewer",
  render: () => <RefundsStory viewer />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findAllByRole("region", { name: /החזר לתיקון/ });
    await expect(canvas.queryByRole("button", { name: "להשאיר" })).toBeNull();
    await expect(canvas.queryByRole("button", { name: /^ראיתי:/ })).toBeNull();
  },
};

/** Every bill paid back or answered. */
export const UtilityRefundsEmpty: Story = {
  name: "UtilityRefunds, empty",
  render: () => <RefundsStory bills={[]} />,
};

/** Long supplier and property names end in an ellipsis; the day and the gap wrap; the answers keep their row. */
export const UtilityRefundsLong: Story = {
  name: "UtilityRefunds, long content",
  render: () => (
    <RefundsStory
      bills={utilityRefundsSample().map((bill) => ({
        ...bill,
        project_name: `${bill.project_name} · הבניין הצפוני ליד הפארק הגדול`,
        supplier_name: `${String(bill.supplier_name)} Regional Utilities Authority`,
        payment: bill.payment == null ? null : { ...bill.payment, party: "Zelle transfer from the tenant's joint account", category_name: "הכנסות אחרות מהשכרה לטווח ארוך" },
      }))}
    />
  ),
};

export const UtilityRefundsLoading: Story = {
  name: "UtilityRefunds, loading",
  render: () => <RefundsStory entry="/utility-refunds?preview=loading" />,
};

/** The read failed: what happened, with ניסיון חוזר. */
export const UtilityRefundsError: Story = {
  name: "UtilityRefunds, failed",
  render: () => <RefundsStory entry="/utility-refunds?preview=error" />,
};

/** A row opens its sheet: ראיתי first, then the company always pays, then the payment. */
export const UtilityRefundsSheet: Story = {
  name: "UtilityRefunds, bill sheet",
  render: () => <RefundsStory />,
  play: async ({ canvasElement }) => {
    const [row] = await within(canvasElement).findAllByRole("button", { name: /^City Water/ });
    await userEvent.click(row as HTMLElement);
    await expect(await within(document.body).findByRole("button", { name: "ראיתי, אין צורך בטיפול" })).toBeInTheDocument();
  },
};

/** FLOW-1159: a bill's drawer on the list: its status, the type's pattern, the type's history and the income link, above the answers. */
export const UtilityRefundsSheetContext: Story = {
  name: "UtilityRefunds, bill sheet with its history",
  render: () => <RefundsStory bills={utilityTypesSample()} />,
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: /^City Light/ }));
    const dialog = await within(document.body).findByRole("dialog");
    await expect(await within(dialog).findByRole("heading", { name: "כל חשבונות החשמל בנכס" })).toBeInTheDocument();
  },
};

/** FLOW-1141: ✓ slides the row toward it and folds it away (the v3 row-card fold); ביטול brings it back. */
export const UtilityRefundsFold: Story = {
  name: "UtilityRefunds, a row folds away",
  render: () => <RefundsStory />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const seen = await canvas.findByRole("button", { name: "ראיתי: Gas Co" });
    await userEvent.click(seen);
    await expect(await within(document.body).findByText("Gas Co · ראיתי")).toBeInTheDocument();
    await waitFor(() => expect(canvas.queryByRole("button", { name: "ראיתי: Gas Co" })).toBeNull());
    await userEvent.click(within(document.body).getByRole("button", { name: "ביטול" }));
    await expect(await canvas.findByRole("button", { name: "ראיתי: Gas Co" })).toBeInTheDocument();
  },
};

/** להשאיר keeps the payment's category: the card folds away and the toast offers ביטול. */
export const UtilityRefundsAnswered: Story = {
  name: "UtilityRefunds, answered",
  render: () => <RefundsStory />,
  play: async ({ canvasElement }) => {
    const [keep] = await within(canvasElement).findAllByRole("button", { name: "להשאיר" });
    await userEvent.click(keep as HTMLElement);
    await expect(await within(document.body).findByText("נשאר כמו שהוא")).toBeInTheDocument();
  },
};
