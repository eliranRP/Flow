import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { UtilityRefundsScreen } from "./utility-refunds-screen";
import { PINE, storyUtilityClient, utilityFixSample, utilityRefundsSample } from "./utility-refunds-sample";
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

/** FLOW-1135 (V3-UtilityRefunds): two properties, each with a suggested refund and its bills not refunded. */
export const UtilityRefundsList: Story = {
  render: () => <RefundsStory />,
};

/** After כן on a payment filed under שכירות: הוחזר, "ייתכן שסווג לא נכון" and the fix with להשאיר. */
export const UtilityRefundsFix: Story = {
  name: "UtilityRefunds, may be filed wrong",
  render: () => <RefundsStory bills={utilityFixSample()} />,
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
    await canvas.findAllByRole("region", { name: /החזר אפשרי/ });
    await expect(canvas.queryByRole("button", { name: "כן, זה ההחזר" })).toBeNull();
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

/** לא takes the card away and the toast offers ביטול. */
export const UtilityRefundsAnswered: Story = {
  name: "UtilityRefunds, answered",
  render: () => <RefundsStory />,
  play: async ({ canvasElement }) => {
    const [no] = await within(canvasElement).findAllByRole("button", { name: "לא" });
    await userEvent.click(no as HTMLElement);
    await expect(await within(document.body).findByText("לא נציע את התשלום הזה שוב")).toBeInTheDocument();
  },
};
