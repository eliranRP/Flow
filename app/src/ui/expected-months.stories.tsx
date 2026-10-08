import type { Meta, StoryObj } from "@storybook/react";
import { expectedMonthViews } from "../forecast";
import { SAMPLE_EXPECTED, SAMPLE_EXPECTED_OPEN_DONE, SAMPLE_EXPECTED_TWO_CURRENCIES } from "../forecast-sample";
import { ExpectedMonths } from "./expected-months";

const months = expectedMonthViews(SAMPLE_EXPECTED);
const open = () => undefined;

const meta = {
  title: "Components/ExpectedMonths",
  component: ExpectedMonths,
} satisfies Meta<typeof ExpectedMonths>;

export default meta;
type Story = StoryObj<typeof meta>;

// FLOW-403, plan option A3: the project's "צפוי" section, three months, one "כ־" figure each.
export const Filled: Story = { args: { months, onOpen: open } };
export const FilledDark: Story = { name: "Filled, dark", args: { months, onOpen: open }, globals: { theme: "dark" } };
export const Filled320: Story = { name: "Filled, 320", args: { months, onOpen: open }, parameters: { viewport: { defaultViewport: "flow320" } } };
export const TwoCurrencies: Story = { args: { months: expectedMonthViews(SAMPLE_EXPECTED_TWO_CURRENCIES), onOpen: open } };
export const TwoCurrencies320: Story = {
  name: "Two currencies, 320",
  args: { months: expectedMonthViews(SAMPLE_EXPECTED_TWO_CURRENCIES), onOpen: open },
  parameters: { viewport: { defaultViewport: "flow320" } },
};
export const OpenMonthDone: Story = {
  name: "Open month with nothing left",
  args: { months: expectedMonthViews(SAMPLE_EXPECTED_OPEN_DONE), onOpen: open },
};
export const NoHistory: Story = { name: "Not enough history", args: { months: [] } };
export const NoHistoryDark: Story = { name: "Not enough history, dark", args: { months: [] }, globals: { theme: "dark" } };
export const Loading: Story = { args: { months: [], phase: { kind: "loading" } } };
export const Error: Story = { args: { months: [], phase: { kind: "error", offline: false }, onRetry: open } };
export const ErrorDark: Story = { name: "Error, dark", args: { months: [], phase: { kind: "error", offline: false }, onRetry: open }, globals: { theme: "dark" } };
