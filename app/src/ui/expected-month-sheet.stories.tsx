import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { expectedMonthViews } from "../forecast";
import { SAMPLE_EXPECTED, SAMPLE_EXPECTED_TWO_CURRENCIES } from "../forecast-sample";
import { ExpectedMonthParties, ExpectedMonthSheet } from "./expected-month-sheet";
import type { ExpectedMonthRow } from "./expected-months";
import { inSheet, longHebrew } from "./story-support";

function secondMonth(data: typeof SAMPLE_EXPECTED): ExpectedMonthRow {
  const month = expectedMonthViews(data)[1];
  if (month == null) throw new Error("sample has three months");
  return month;
}
const november = secondMonth(SAMPLE_EXPECTED);
const novemberTwo = secondMonth(SAMPLE_EXPECTED_TWO_CURRENCIES);
const firstParty = november.parties.slice(0, 1).map((party) => ({ ...party, name: longHebrew, minor: 12_345_600n }));

const meta = {
  title: "Components/ExpectedMonthSheet",
  component: ExpectedMonthParties,
  parameters: { sheetTitle: "נובמבר" },
} satisfies Meta<typeof ExpectedMonthParties>;

export default meta;
type Story = StoryObj<typeof meta>;

// FLOW-403, plan option A4: who makes up one month's figure. Income in green; no edit.
export const Filled: Story = { decorators: [inSheet], args: { parties: november.parties } };
export const FilledDark: Story = { name: "Filled, dark", decorators: [inSheet], args: { parties: november.parties }, globals: { theme: "dark" } };
export const Filled320: Story = { name: "Filled, 320", decorators: [inSheet], args: { parties: november.parties }, parameters: { viewport: { defaultViewport: "flow320" } } };
export const OneParty: Story = { decorators: [inSheet], args: { parties: november.parties.slice(0, 1) } };
export const OtherCurrency: Story = { decorators: [inSheet], args: { parties: novemberTwo.parties } };
export const LongHebrew: Story = {
  name: "Long Hebrew",
  decorators: [inSheet],
  args: { parties: firstParty },
  parameters: { viewport: { defaultViewport: "flow320" } },
};

function OpenSheet({ month }: { month: ExpectedMonthRow }) {
  const [open, setOpen] = useState(true);
  return <ExpectedMonthSheet month={month} open={open} onOpenChange={setOpen} />;
}

export const AsSheet: Story = {
  name: "As a sheet",
  args: { parties: november.parties },
  render: () => <OpenSheet month={november} />,
};
