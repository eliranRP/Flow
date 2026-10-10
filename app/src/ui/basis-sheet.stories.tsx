import type { Meta, StoryObj } from "@storybook/react";
import { BasisSheet } from "./basis-sheet";
import { padded } from "./story-support";

const meta = {
  title: "Components/BasisSheet",
  component: BasisSheet,
  decorators: [padded],
  parameters: { viewport: { defaultViewport: "flow390-short" } },
} satisfies Meta<typeof BasisSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PaymentDate: Story = {
  args: { open: true, onOpenChange: () => undefined, value: "cash", saving: null, onPick: () => undefined },
};
export const InvoiceDate: Story = {
  args: { ...PaymentDate.args, value: "invoiced" },
};
/** The tapped row spins; the other row waits until the save settles. */
export const Saving: Story = {
  args: { ...PaymentDate.args, saving: "invoiced" },
};
export const PaymentDateDark: Story = {
  args: PaymentDate.args,
  globals: { theme: "dark" },
};
export const PaymentDate320: Story = {
  args: PaymentDate.args,
  parameters: { viewport: { defaultViewport: "flow320" } },
};
