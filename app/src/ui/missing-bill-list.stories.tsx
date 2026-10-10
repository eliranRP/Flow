import type { Meta, StoryObj } from "@storybook/react";
import { missingBillViews } from "../forecast";
import { SAMPLE_MISSING_BILLS, SAMPLE_MISSING_USD } from "../forecast-sample";

const [water, power] = SAMPLE_MISSING_BILLS;
import { MissingBillList } from "./missing-bill-list";
import { longHebrew } from "./story-support";

const now = new Date("2026-10-08T09:00:00Z");
// FLOW-415: invented names for where each bill files.
const NAMES: Record<string, string> = { "p-water": "שיפוץ לדוגמה", "c-water": "מים", p1: "בניין הדקל", "c-power": "חשמל" };
const names = { project: (id: string) => NAMES[id], category: (id: string) => NAMES[id] };
const filed = SAMPLE_MISSING_BILLS.map((row) =>
  row.supplier_id === "s-water" ? { ...row, project_id: "p-water", category_id: "c-water" } : { ...row, category_id: "c-power" },
);
const rows = missingBillViews(filed, "", now, names);

// Rows carry bigint amounts, so they stay in render: story args go through JSON.
const meta = {
  title: "Components/MissingBillList",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// FLOW-403, plan option A2: one row per late bill, one "כ־" amount. FLOW-415 layout A: two hint lines,
// "project · category" and "בדרך כלל ב־N לחודש · אחרון dd/mm".
export const Several: Story = { render: () => <MissingBillList rows={rows} /> };
export const SeveralDark: Story = { name: "Several, dark", render: () => <MissingBillList rows={rows} />, globals: { theme: "dark" } };
export const Several320: Story = { name: "Several, 320", render: () => <MissingBillList rows={rows} />, parameters: { viewport: { defaultViewport: "flow320" } } };
export const One: Story = { render: () => <MissingBillList rows={rows.slice(1)} /> };
export const NoPlace: Story = {
  name: "Files nowhere: one hint line",
  render: () => <MissingBillList rows={missingBillViews(SAMPLE_MISSING_BILLS, "", now)} />,
};
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
  render: () => <MissingBillList rows={missingBillViews(power == null ? [] : [{ ...power, supplier_name: longHebrew, typical_amount_minor: -12_345_600n, category_id: "c-power" }], "", now, { project: () => longHebrew, category: () => "חשמל" })} />,
  parameters: { viewport: { defaultViewport: "flow320" } },
};
export const Empty: Story = { render: () => <MissingBillList rows={[]} /> };
export const EmptyDark: Story = { name: "Empty, dark", render: () => <MissingBillList rows={[]} />, globals: { theme: "dark" } };
export const Loading: Story = { render: () => <MissingBillList rows={[]} phase={{ kind: "loading" }} /> };
export const Error: Story = { render: () => <MissingBillList rows={[]} phase={{ kind: "error", offline: false }} /> };
