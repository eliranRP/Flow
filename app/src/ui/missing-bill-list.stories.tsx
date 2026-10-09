import type { Meta, StoryObj } from "@storybook/react";
import { missingBillViews } from "../forecast";
import { SAMPLE_MISSING_BILLS, SAMPLE_MISSING_USD } from "../forecast-sample";

const [water, power] = SAMPLE_MISSING_BILLS;
import { MissingBillList } from "./missing-bill-list";
import { longHebrew } from "./story-support";

const now = new Date("2026-10-08T09:00:00Z");
const rows = missingBillViews(SAMPLE_MISSING_BILLS, "", now);

// Rows carry bigint amounts, so they stay in render: story args go through JSON.
const meta = {
  title: "Components/MissingBillList",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// FLOW-403, plan option A2: one row per late bill, one "כ־" amount and the due day.
export const Several: Story = { render: () => <MissingBillList rows={rows} /> };
export const SeveralDark: Story = { name: "Several, dark", render: () => <MissingBillList rows={rows} />, globals: { theme: "dark" } };
export const Several320: Story = { name: "Several, 320", render: () => <MissingBillList rows={rows} />, parameters: { viewport: { defaultViewport: "flow320" } } };
export const One: Story = { render: () => <MissingBillList rows={rows.slice(1)} /> };
export const OtherCurrency: Story = {
  name: "Other currency (USD)",
  render: () => <MissingBillList rows={missingBillViews([...SAMPLE_MISSING_BILLS, SAMPLE_MISSING_USD], "", now)} />,
};
export const DueLastDay: Story = {
  name: "Due on the month's last day",
  render: () => <MissingBillList rows={missingBillViews(water == null ? [] : [{ ...water, typical_day: 28, expected_by: "2026-10-31" }], "", now)} />,
};
export const LongHebrew: Story = {
  name: "Long Hebrew",
  render: () => <MissingBillList rows={missingBillViews(power == null ? [] : [{ ...power, supplier_name: longHebrew, typical_amount_minor: -12_345_600n }], "", now)} />,
  parameters: { viewport: { defaultViewport: "flow320" } },
};
export const Empty: Story = { render: () => <MissingBillList rows={[]} /> };
export const EmptyDark: Story = { name: "Empty, dark", render: () => <MissingBillList rows={[]} />, globals: { theme: "dark" } };
export const Loading: Story = { render: () => <MissingBillList rows={[]} phase={{ kind: "loading" }} /> };
export const Error: Story = { render: () => <MissingBillList rows={[]} phase={{ kind: "error", offline: false }} /> };
