import type { Meta, StoryObj } from "@storybook/react";
import { expectedMonthViews } from "../forecast";
import { SAMPLE_EXPECTED, SAMPLE_EXPECTED_OPEN_DONE, SAMPLE_EXPECTED_TWO_CURRENCIES } from "../forecast-sample";
import { ExpectedMonths } from "./expected-months";

const months = expectedMonthViews(SAMPLE_EXPECTED);
const open = () => undefined;

// Months carry bigint amounts, so they stay in render: story args go through JSON.
const meta = {
  title: "Components/ExpectedMonths",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// FLOW-403, plan option A3: the project's "צפוי" section, three months, one "כ־" figure each.
export const Filled: Story = { render: () => <ExpectedMonths months={months} onOpen={open} /> };
export const TwoCurrencies: Story = { render: () => <ExpectedMonths months={expectedMonthViews(SAMPLE_EXPECTED_TWO_CURRENCIES)} onOpen={open} /> };
export const OpenMonthDone: Story = {
  name: "Open month with nothing left",
  render: () => <ExpectedMonths months={expectedMonthViews(SAMPLE_EXPECTED_OPEN_DONE)} onOpen={open} />,
};
export const NoHistory: Story = { name: "Not enough history", render: () => <ExpectedMonths months={[]} /> };
export const Loading: Story = { render: () => <ExpectedMonths months={[]} phase={{ kind: "loading" }} /> };
export const Error: Story = { render: () => <ExpectedMonths months={[]} phase={{ kind: "error", offline: false }} onRetry={open} /> };
