import type { Meta, StoryObj } from "@storybook/react";
import { CurrencySheet } from "./currency-sheet";
import { padded } from "./story-support";

const meta = {
  title: "Components/CurrencySheet",
  component: CurrencySheet,
  decorators: [padded],
  parameters: { viewport: { defaultViewport: "flow390-short" } },
} satisfies Meta<typeof CurrencySheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Shekels: Story = {
  args: { open: true, onOpenChange: () => undefined, value: "ILS", saving: null, onPick: () => undefined },
};
export const Dollars: Story = {
  args: { ...Shekels.args, value: "USD" },
};
/** The tapped row spins; the other row waits until the save settles. */
export const Saving: Story = {
  args: { ...Shekels.args, value: "ILS", saving: "USD" },
};
export const DollarsDark: Story = {
  args: Dollars.args,
  globals: { theme: "dark" },
};
export const SavingDark: Story = {
  args: Saving.args,
  globals: { theme: "dark" },
};
