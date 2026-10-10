import type { Meta, StoryObj } from "@storybook/react";
import { arrivedViews, missingBillViews } from "../recurring";
import { SAMPLE_MISSING_BILLS, SAMPLE_MISSING_RENAMED, SAMPLE_MISSING_USD, SAMPLE_RECURRING_CHANGES, SAMPLE_RECURRING_THIS_MONTH } from "../forecast-sample";

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

// FLOW-913 (owner 16:03Z, layout A): one line per row. A row closes by swipe over "סגירה"; עריכה
// shows "סגירה" in place of the chevron; the first visit peeks the top row once.
const closeRows = missingBillViews(filed, "", now);
const closeArrived = arrivedViews(SAMPLE_RECURRING_THIS_MONTH, SAMPLE_RECURRING_CHANGES, "");
const noop = () => undefined;
export const Closable: Story = {
  name: "Closable",
  render: () => <MissingBillList rows={closeRows} arrived={closeArrived} onHide={noop} />,
};
export const Editing: Story = {
  name: "Editing: סגירה",
  render: () => <MissingBillList rows={closeRows} arrived={closeArrived} onHide={noop} editing />,
};
export const EditingDark: Story = {
  name: "Editing: סגירה, dark",
  render: () => <MissingBillList rows={closeRows} arrived={closeArrived} onHide={noop} editing />,
  globals: { theme: "dark" },
};
export const Editing320: Story = {
  name: "Editing: סגירה, 320",
  render: () => <MissingBillList rows={closeRows} arrived={closeArrived} onHide={noop} editing />,
  parameters: { viewport: { defaultViewport: "flow320" } },
};
export const Peek: Story = {
  name: "First visit: the top row peeks",
  render: () => <MissingBillList rows={closeRows} arrived={closeArrived} onHide={noop} peek />,
};
// FLOW-430: "אולי זה: <name> · <amount> · dd/mm" with "כן, אותו ספק" and "לא" under the row.
const matched = missingBillViews([...filed, SAMPLE_MISSING_RENAMED], "", now);
const answer = () => undefined;
const suggested = SAMPLE_MISSING_RENAMED.suggestion;
export const SuggestedMatch: Story = { name: "Suggested match", render: () => <MissingBillList rows={matched} onMatch={answer} onHide={answer} /> };
export const SuggestedMatch320: Story = { ...SuggestedMatch, name: "Suggested match, 320", parameters: { viewport: { defaultViewport: "flow320" } } };
export const SuggestedMatchDark: Story = { ...SuggestedMatch, name: "Suggested match, dark", globals: { theme: "dark" } };
export const SuggestedMatchLongHebrew: Story = {
  name: "Suggested match, long Hebrew",
  render: () => (
    <MissingBillList
      rows={missingBillViews([{ ...SAMPLE_MISSING_RENAMED, suggestion: suggested == null ? null : { ...suggested, party_name: longHebrew } }], "", now)}
      onMatch={answer}
    />
  ),
  parameters: { viewport: { defaultViewport: "flow320" } },
};
