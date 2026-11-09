import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { UtilityRefundsScreen } from "./utility-refunds-screen";
import { PINE, utilityFixSample, utilityRefundsSample } from "./utility-refunds-sample";
import { StoryRoute } from "../ui/story-route";
import { ExampleBar } from "../ui/screen-stories-support";

const meta = {
  title: "Screens/UtilityRefunds",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** FLOW-1135 (V3-UtilityRefunds): two properties, each with a suggested refund and its bills not refunded. */
export const UtilityRefundsList: Story = {
  render: () => (
    <StoryRoute entry="/utility-refunds" tabs>
      <ExampleBar />
      <UtilityRefundsScreen sample={utilityRefundsSample()} />
    </StoryRoute>
  ),
};

/** After כן on a payment filed under שכירות: הוחזר, "ייתכן שסווג לא נכון" and the fix with להשאיר. */
export const UtilityRefundsFix: Story = {
  name: "UtilityRefunds, may be filed wrong",
  render: () => (
    <StoryRoute entry="/utility-refunds" tabs>
      <ExampleBar />
      <UtilityRefundsScreen sample={utilityFixSample()} />
    </StoryRoute>
  ),
};

/** One property, opened from its page's row (`?project=`): Back returns to the property. */
export const UtilityRefundsProperty: Story = {
  name: "UtilityRefunds, one property",
  render: () => (
    <StoryRoute entry={`/utility-refunds?project=${PINE}`} tabs>
      <ExampleBar />
      <UtilityRefundsScreen sample={utilityRefundsSample()} />
    </StoryRoute>
  ),
};

/** A viewer sees the cards and the rows with no answers. */
export const UtilityRefundsViewer: Story = {
  name: "UtilityRefunds, viewer",
  render: () => (
    <StoryRoute entry="/utility-refunds" tabs viewer>
      <ExampleBar />
      <UtilityRefundsScreen sample={utilityRefundsSample()} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("button", { name: "כן, זה ההחזר" })).toBeNull();
    await expect(canvas.queryByRole("button", { name: /^ראיתי:/ })).toBeNull();
  },
};

/** Every bill paid back or answered. */
export const UtilityRefundsEmpty: Story = {
  name: "UtilityRefunds, empty",
  render: () => (
    <StoryRoute entry="/utility-refunds" tabs>
      <ExampleBar />
      <UtilityRefundsScreen sample={[]} />
    </StoryRoute>
  ),
};

/** Long supplier and property names end in an ellipsis; the answers keep their row. */
export const UtilityRefundsLong: Story = {
  name: "UtilityRefunds, long content",
  render: () => (
    <StoryRoute entry="/utility-refunds" tabs>
      <ExampleBar />
      <UtilityRefundsScreen
        sample={utilityRefundsSample().map((bill) => ({
          ...bill,
          project_name: `${bill.project_name} · הבניין הצפוני ליד הפארק הגדול`,
          supplier_name: `${String(bill.supplier_name)} Regional Utilities Authority`,
          payment: bill.payment == null ? null : { ...bill.payment, party: "Zelle transfer from the tenant's joint account" },
        }))}
      />
    </StoryRoute>
  ),
};

export const UtilityRefundsLoading: Story = {
  name: "UtilityRefunds, loading",
  render: () => (
    <StoryRoute entry="/utility-refunds?preview=loading" tabs>
      <ExampleBar />
      <UtilityRefundsScreen />
    </StoryRoute>
  ),
};

/** The read failed: what happened, with ניסיון חוזר. */
export const UtilityRefundsError: Story = {
  name: "UtilityRefunds, failed",
  render: () => (
    <StoryRoute entry="/utility-refunds?preview=error" tabs>
      <ExampleBar />
      <UtilityRefundsScreen />
    </StoryRoute>
  ),
};

/** A row opens its sheet: ראיתי first, then the company always pays, then the payment. */
export const UtilityRefundsSheet: Story = {
  name: "UtilityRefunds, bill sheet",
  render: () => (
    <StoryRoute entry="/utility-refunds" tabs>
      <ExampleBar />
      <UtilityRefundsScreen sample={utilityRefundsSample()} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const [row] = within(canvasElement).getAllByRole("button", { name: /^City Water/ });
    await userEvent.click(row as HTMLElement);
    await expect(await within(document.body).findByRole("button", { name: "ראיתי, אין צורך בטיפול" })).toBeInTheDocument();
  },
};

/** לא takes the card away and the toast offers ביטול. */
export const UtilityRefundsAnswered: Story = {
  name: "UtilityRefunds, answered",
  render: () => (
    <StoryRoute entry="/utility-refunds" tabs>
      <ExampleBar />
      <UtilityRefundsScreen sample={utilityRefundsSample()} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const [no] = within(canvasElement).getAllByRole("button", { name: "לא" });
    await userEvent.click(no as HTMLElement);
    await expect(await within(document.body).findByText("לא נציע את התשלום הזה שוב")).toBeInTheDocument();
  },
};
