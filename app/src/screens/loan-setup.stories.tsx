import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fireEvent, waitFor, within } from "storybook/test";
import { Sheet } from "../ui/sheet";
import { LoanKindPicker, LoanSetupForm } from "./loan-setup";

const meta = {
  title: "Screens/Loan setup",
  component: LoanSetupForm,
  args: { companyCurrency: "ILS" },
  // The sheet's side gutter, so a PNG shows what ships (design lead, FLOW-115).
  decorators: [(Story) => <div className="ui-page-pad"><Story /></div>],
} satisfies Meta<typeof LoanSetupForm>;

export default meta;
type Story = StoryObj<typeof meta>;

const example = {
  companyCurrency: "ILS" as const,
  initial: {
    name: "הלוואת דוגמה",
    principal: "100000",
    rate: "6",
    term: "360",
    startDate: "2026-11-01",
    escrow: "0",
  },
};

const balloon = {
  companyCurrency: "USD" as const,
  advancedOpen: true,
  initial: {
    name: "הלוואת דוגמה",
    principal: "10000000",
    rate: "6",
    term: "12",
    startDate: "2026-11-01",
    escrow: "0",
    payment: "50000",
    currency: "USD" as const,
  },
};

export const Example: Story = { args: example };

export const Balloon: Story = { args: balloon };

export const Dollars: Story = {
  args: { companyCurrency: "USD", initial: { startDate: "2026-11-01" } },
};

/** FLOW-115: a new loan, as the sheet opens it. */
export const New: Story = { args: { companyCurrency: "ILS", initial: { startDate: "2026-11-01" } } };

/** FLOW-344 (B): with the principal cleared, the preview hides until the form is valid again. */
export const IncompleteHidden: Story = {
  args: example,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await fireEvent.change(canvas.getByLabelText("סכום מקורי"), { target: { value: "" } });
    await waitFor(() => expect(canvas.queryByText(/ריבית כוללת/)).toBeNull());
  },
};

/** FLOW-343: שמירה on a new, empty loan moves focus to the first field to type, with its error. */
export const SaveFocusesFirstEmpty: Story = {
  args: { companyCurrency: "ILS", initial: { startDate: "2026-11-01" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await fireEvent.click(canvas.getByRole("button", { name: "שמירה" }));
    await waitFor(() => expect(canvas.getByLabelText("מלווה")).toHaveFocus());
    await expect(canvas.getByText("כתבו את שם המלווה.")).toBeVisible();
  },
};

/** FLOW-115: the first-payment date sheet, open. */
export const DateSheetOpen: Story = {
  args: example,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await fireEvent.click(canvas.getByRole("button", { name: "תאריך תשלום ראשון" }));
    await waitFor(() => expect(within(canvasElement.ownerDocument.body).getByRole("dialog", { name: "תאריך תשלום ראשון" })).toBeVisible());
  },
};

/** The סוג view inside the new-loan sheet: one row per kind with its description. */
function KindPickerInSheet() {
  return (
    <Sheet open onOpenChange={() => undefined} title="סוג ההלוואה">
      <LoanKindPicker selected="amortizing" onSelect={() => undefined} />
    </Sheet>
  );
}
export const KindPicker: Story = { args: example, render: () => <KindPickerInSheet /> };
