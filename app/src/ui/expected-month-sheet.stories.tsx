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

// Parties carry bigint amounts, so they stay in render: story args go through JSON.
const meta = {
  title: "Components/ExpectedMonthSheet",
  parameters: { sheetTitle: "נובמבר" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// FLOW-403, plan option A4: who makes up one month's figure. Income in green; no edit.
export const Filled: Story = { decorators: [inSheet], render: () => <ExpectedMonthParties parties={november.parties} /> };
export const FilledDark: Story = { name: "Filled, dark", decorators: [inSheet], render: () => <ExpectedMonthParties parties={november.parties} />, globals: { theme: "dark" } };
export const Filled320: Story = { name: "Filled, 320", decorators: [inSheet], render: () => <ExpectedMonthParties parties={november.parties} />, parameters: { viewport: { defaultViewport: "flow320" } } };
export const OneParty: Story = { decorators: [inSheet], render: () => <ExpectedMonthParties parties={november.parties.slice(0, 1)} /> };
export const OtherCurrency: Story = { decorators: [inSheet], render: () => <ExpectedMonthParties parties={novemberTwo.parties} /> };
export const LongHebrew: Story = {
  name: "Long Hebrew",
  decorators: [inSheet],
  render: () => <ExpectedMonthParties parties={firstParty} />,
  parameters: { viewport: { defaultViewport: "flow320" } },
};

function OpenSheet({ month }: { month: ExpectedMonthRow }) {
  const [open, setOpen] = useState(true);
  return <ExpectedMonthSheet month={month} open={open} onOpenChange={setOpen} />;
}

export const AsSheet: Story = {
  name: "As a sheet",
  render: () => <OpenSheet month={november} />,
};
