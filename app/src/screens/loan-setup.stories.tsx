import type { Meta, StoryObj } from "@storybook/react";
import { expect, fireEvent, waitFor, within } from "@storybook/test";
import { Sheet } from "../ui/sheet";
import { LoanSaveButton, LoanSetupForm } from "./loan-setup";

const meta = {
  title: "Screens/Loan setup",
  component: LoanSetupForm,
  args: { companyCurrency: "ILS" },
  // The sheet's side gutter, so a PNG shows what ships (design lead, FLOW-115).
  decorators: [(Story) => <div className="ui-page-pad"><Story /></div>],
} satisfies Meta<typeof LoanSetupForm>;

export default meta;
type Story = StoryObj<typeof meta>;

const light390 = { parameters: { viewport: { defaultViewport: "flow390" } } };
const dark390 = { globals: { theme: "dark" }, parameters: { viewport: { defaultViewport: "flow390" } } };
const light320 = { parameters: { viewport: { defaultViewport: "flow320" } } };
const dark320 = { globals: { theme: "dark" }, parameters: { viewport: { defaultViewport: "flow320" } } };

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

export const Example: Story = { args: example, ...light390 };

/** FLOW-347: in the sheet, שמירה is pinned in the foot, so a 375x667 phone saves without a scroll. */
function InSheet() {
  return (
    <Sheet open onOpenChange={() => undefined} title="הלוואה" action={<LoanSaveButton formId="story-loan" />}>
      <LoanSetupForm {...example} formId="story-loan" saveInFoot />
    </Sheet>
  );
}
const se = { parameters: { viewport: { defaultViewport: "flow375-se" } } };
export const ExampleInSheetSe: Story = { args: example, render: () => <InSheet />, ...se };
export const ExampleInSheetDark320: Story = { args: example, render: () => <InSheet />, ...dark320 };
export const ExampleDark: Story = { args: example, ...dark390 };
export const Example320: Story = { args: example, ...light320 };
export const ExampleDark320: Story = { args: example, ...dark320 };

export const Balloon: Story = { args: balloon, ...light390 };
export const BalloonDark: Story = { args: balloon, ...dark390 };
export const Balloon320: Story = { args: balloon, ...light320 };
export const BalloonDark320: Story = { args: balloon, ...dark320 };

const largeFinal = {
  companyCurrency: "ILS" as const,
  initial: {
    name: "הלוואת דוגמה",
    principal: "34910.09",
    rate: "29.8",
    term: "480",
    startDate: "2026-11-01",
    escrow: "0",
  },
};

export const LargeFinal: Story = { args: largeFinal, ...light390 };
export const LargeFinalDark: Story = { args: largeFinal, ...dark390 };
export const LargeFinal320: Story = { args: largeFinal, ...light320 };
export const LargeFinalDark320: Story = { args: largeFinal, ...dark320 };

export const Dollars: Story = {
  args: { companyCurrency: "USD", initial: { startDate: "2026-11-01" } },
  ...light390,
};
export const DollarsDark: Story = {
  args: { companyCurrency: "USD", initial: { startDate: "2026-11-01" } },
  ...dark390,
};
export const Dollars320: Story = {
  args: { companyCurrency: "USD", initial: { startDate: "2026-11-01" } },
  ...light320,
};
export const DollarsDark320: Story = {
  args: { companyCurrency: "USD", initial: { startDate: "2026-11-01" } },
  ...dark320,
};

/** FLOW-115: a new loan, as the sheet opens it. */
export const New: Story = { args: { companyCurrency: "ILS", initial: { startDate: "2026-11-01" } }, ...light390 };
export const NewDark320: Story = { args: { companyCurrency: "ILS", initial: { startDate: "2026-11-01" } }, ...dark320 };

/** FLOW-344 (B): with the principal cleared, the preview hides until the form is valid again. */
export const IncompleteHidden: Story = {
  args: example,
  ...light390,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await fireEvent.change(canvas.getByLabelText("סכום מקורי"), { target: { value: "" } });
    await waitFor(() => expect(canvas.queryByText(/ריבית כוללת/)).toBeNull());
  },
};
export const IncompleteHiddenDark: Story = { ...IncompleteHidden, ...dark390 };
export const IncompleteHidden320: Story = { ...IncompleteHidden, ...light320 };

/** FLOW-343: שמירה on a new, empty loan moves focus to the first field to type, with its error. */
export const SaveFocusesFirstEmpty: Story = {
  args: { companyCurrency: "ILS", initial: { startDate: "2026-11-01" } },
  ...light390,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await fireEvent.click(canvas.getByRole("button", { name: "שמירה" }));
    await waitFor(() => expect(canvas.getByLabelText("מלווה")).toHaveFocus());
    await expect(canvas.getByText("כתבו את שם המלווה.")).toBeVisible();
  },
};
export const SaveFocusesFirstEmptyDark320: Story = { ...SaveFocusesFirstEmpty, ...dark320 };

/** FLOW-115: the first-payment date sheet, open. */
export const DateSheetOpen: Story = {
  args: example,
  ...light390,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await fireEvent.click(canvas.getByRole("button", { name: "תאריך תשלום ראשון" }));
    await waitFor(() => expect(within(canvasElement.ownerDocument.body).getByRole("dialog", { name: "תאריך תשלום ראשון" })).toBeVisible());
  },
};
export const DateSheetOpenDark320: Story = { ...DateSheetOpen, ...dark320 };
