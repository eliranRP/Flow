import type { Meta, StoryObj } from "@storybook/react";
import { arrivedViews, missingBillViews } from "../recurring";
import { SAMPLE_MISSING_BILLS, SAMPLE_MISSING_USD, SAMPLE_RECURRING_CHANGES, SAMPLE_RECURRING_THIS_MONTH } from "../forecast-sample";

const [water, power] = SAMPLE_MISSING_BILLS;
import { MissingBillList } from "./missing-bill-list";
import { longHebrew } from "./story-support";

const now = new Date("2026-10-08T09:00:00Z");
// FLOW-415: both invented bills file to a project and a category.
const filed = SAMPLE_MISSING_BILLS.map((row) =>
  row.supplier_id === "s-water" ? { ...row, project_name: "שיפוץ לדוגמה", category_name: "מים" } : row,
);
const rows = missingBillViews(filed, "", now);

// Rows carry bigint amounts, so they stay in render: story args go through JSON.
const meta = {
  title: "Components/MissingBillList",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// FLOW-403, plan option A2: one row per late bill, one "כ־" amount. FLOW-415 layout A: two hint lines,
// "project · category" and "כל חודש ב־N · אחרון dd/mm".
export const Several: Story = { render: () => <MissingBillList rows={rows} /> };
export const SeveralDark: Story = { name: "Several, dark", render: () => <MissingBillList rows={rows} />, globals: { theme: "dark" } };
export const Several320: Story = { name: "Several, 320", render: () => <MissingBillList rows={rows} />, parameters: { viewport: { defaultViewport: "flow320" } } };
export const One: Story = { render: () => <MissingBillList rows={rows.slice(1)} /> };
export const NoPlace: Story = {
  name: "Files nowhere: one hint line",
  render: () => <MissingBillList rows={missingBillViews(SAMPLE_MISSING_BILLS.map((row) => ({ ...row, project_name: null, category_name: null })), "", now)} />,
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
  render: () => <MissingBillList rows={missingBillViews(power == null ? [] : [{ ...power, supplier_name: longHebrew, party_name: longHebrew, typical_amount_minor: -12_345_600n, project_name: longHebrew }], "", now)} />,
  parameters: { viewport: { defaultViewport: "flow320" } },
};
export const Empty: Story = { render: () => <MissingBillList rows={[]} /> };
export const EmptyDark: Story = { name: "Empty, dark", render: () => <MissingBillList rows={[]} />, globals: { theme: "dark" } };
export const Loading: Story = { render: () => <MissingBillList rows={[]} phase={{ kind: "loading" }} /> };
export const Error: Story = { render: () => <MissingBillList rows={[]} phase={{ kind: "error", offline: false }} /> };

// Owner, 2026-10-10: a list that can hide ends each row in one muted eye-off button, no chevron, and a
// Latin project name keeps its start ("Example Holdings Compa…", not "…ny / Overhead").
const latin = (name: string) => (row: (typeof SAMPLE_RECURRING_THIS_MONTH)[number]) => ({ ...row, project_name: name });
const hideRows = missingBillViews(filed.map((row) => ({ ...row, project_name: "Example Holdings Company / Overhead" })), "", now);
const hideArrived = arrivedViews(SAMPLE_RECURRING_THIS_MONTH.map(latin("Sample Street 2220")), SAMPLE_RECURRING_CHANGES, "");
const noop = () => undefined;
export const Hideable: Story = {
  name: "Hideable, Latin projects",
  render: () => <MissingBillList rows={hideRows} arrived={hideArrived} onHide={noop} />,
  parameters: { viewport: { defaultViewport: "flow390" } },
};
export const HideableDark: Story = {
  name: "Hideable, Latin projects, dark",
  render: () => <MissingBillList rows={hideRows} arrived={hideArrived} onHide={noop} />,
  parameters: { viewport: { defaultViewport: "flow390" } },
  globals: { theme: "dark" },
};
export const Hideable320: Story = {
  name: "Hideable, 320",
  render: () => <MissingBillList rows={hideRows} arrived={hideArrived} onHide={noop} />,
  parameters: { viewport: { defaultViewport: "flow320" } },
};
