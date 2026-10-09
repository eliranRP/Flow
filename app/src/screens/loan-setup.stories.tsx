import type { Meta, StoryObj } from "@storybook/react";
import { expect, fireEvent, waitFor, within } from "@storybook/test";
import { LoanSetupForm } from "./loan-setup";

const meta = {
  title: "Screens/Loan setup",
  component: LoanSetupForm,
  args: { companyCurrency: "ILS" },
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

/** FLOW-115: the kept preview dims while the principal is cleared. */
export const IncompleteDimmed: Story = {
  args: example,
  ...light390,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await fireEvent.change(canvas.getByLabelText("סכום מקורי"), { target: { value: "" } });
    await waitFor(() => expect(canvasElement.querySelector(".ui-loan-preview-stale")).not.toBeNull());
  },
};
export const IncompleteDimmedDark: Story = { ...IncompleteDimmed, ...dark390 };

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
