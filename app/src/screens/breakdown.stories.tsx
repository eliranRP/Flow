import type { Breakdown, BreakdownGroupBy, BreakdownLinesPage } from "@flow/shared";
import type { Meta, StoryObj } from "@storybook/react";
import type { ReactElement } from "react";
import { Route, Routes } from "react-router-dom";
import { StoryRoute } from "../ui/story-route";
import { BreakdownLinesScreen, BreakdownScreen } from "./breakdown";

/** FLOW-301. Home's נכנס / יצא breakdown and one group's lines. Invented data only. */

const meta = {
  title: "Screens/Breakdown",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const expenses: NonNullable<Breakdown> = {
  direction: "expense",
  basis: "invoiced",
  group_by: "category",
  from: "2026-10-01",
  to: "2026-10-31",
  totals: [{ currency: "ILS", amount_minor: 4_832_000n, count: 34 }],
  groups: [
    { key: "c1", name: "חומרים", currency: "ILS", amount_minor: 1_845_000n, count: 14, shared: true },
    { key: "c2", name: "קבלני משנה", currency: "ILS", amount_minor: 1_280_000n, count: 5, shared: false },
    { key: "c3", name: "שכר עובדים", currency: "ILS", amount_minor: 820_000n, count: 4, shared: false },
    { key: "c4", name: "ריבית משכנתא", currency: "ILS", amount_minor: 412_000n, count: 2, shared: false },
    { key: "none", name: null, currency: "ILS", amount_minor: 240_000n, count: 3, shared: false },
    { key: "c5", name: "כלים וציוד", currency: "ILS", amount_minor: 235_000n, count: 6, shared: false },
  ],
  excluded: [{ currency: "ILS", amount_minor: 125_000n, count: 2 }],
  review_count: 3,
};

const byProject: NonNullable<Breakdown> = {
  ...expenses,
  group_by: "project",
  groups: [
    { key: "p1", name: "מגדל הים", currency: "ILS", amount_minor: 2_210_000n, count: 15, shared: true },
    { key: "p2", name: "וילה בהרצליה", currency: "ILS", amount_minor: 1_340_000n, count: 9, shared: true },
    { key: "unassigned", name: null, currency: "ILS", amount_minor: 642_000n, count: 4, shared: false },
    { key: "overhead", name: null, currency: "ILS", amount_minor: 640_000n, count: 6, shared: false },
  ],
};

const longNames: NonNullable<Breakdown> = {
  ...expenses,
  groups: [
    { key: "c1", name: "חומרי גמר, ריצוף, חיפוי קירות ואביזרי אינסטלציה לשלב ב׳", currency: "ILS", amount_minor: 123_456_700n, count: 128, shared: true },
    { key: "c2", name: "קבלני משנה לעבודות חשמל ותקשורת", currency: "ILS", amount_minor: 98_765_400n, count: 77, shared: false },
    { key: "c3", name: "תוכנה", currency: "USD", amount_minor: 1_250_000n, count: 3, shared: false },
  ],
  totals: [
    { currency: "ILS", amount_minor: 222_222_100n, count: 205 },
    { currency: "USD", amount_minor: 1_250_000n, count: 3 },
  ],
};

const income: NonNullable<Breakdown> = {
  direction: "income",
  basis: "invoiced",
  group_by: "payer",
  from: "2026-10-01",
  to: "2026-10-31",
  totals: [
    { currency: "ILS", amount_minor: 7_250_000n, count: 9 },
    { currency: "USD", amount_minor: 480_000n, count: 2 },
  ],
  groups: [
    { key: "s1", name: "דניאל כהן", currency: "ILS", amount_minor: 3_180_000n, count: 4, shared: false },
    { key: "s2", name: "מיכל לוי", currency: "ILS", amount_minor: 2_920_000n, count: 3, shared: false },
    { key: "none", name: null, currency: "ILS", amount_minor: 1_150_000n, count: 2, shared: false },
    { key: "s3", name: "Example Holdings", currency: "USD", amount_minor: 480_000n, count: 2, shared: false },
  ],
  excluded: [],
  review_count: 0,
};

const linesPage: NonNullable<BreakdownLinesPage> = {
  rows: [
    { transaction_id: "t1", part: null, description: "חשבונית 5521", supplier_name: "טמבור בע״מ", project_name: "מגדל הים", category_name: "חומרים", doc_date: "2026-10-05", currency: "ILS", amount_minor: 420_000n, shared: false },
    { transaction_id: "t2", part: null, description: "חשבונית 118", supplier_name: "מחסני חשמל", project_name: "וילה בהרצליה", category_name: "חומרים", doc_date: "2026-10-04", currency: "ILS", amount_minor: 315_000n, shared: false },
    { transaction_id: "t3", part: null, description: "חשבונית 77", supplier_name: "אבן וסיד", project_name: "מגדל הים", category_name: "חומרים", doc_date: "2026-10-03", currency: "ILS", amount_minor: 288_000n, shared: true },
    { transaction_id: "t4", part: null, description: "זיכוי 12", supplier_name: "הום סנטר", project_name: null, category_name: "חומרים", doc_date: "2026-10-02", currency: "ILS", amount_minor: -19_400n, shared: false },
  ],
  has_more: false,
};

/** The group the lines story opens: its count and total match the four lines shown. */
const linesBreakdown: NonNullable<Breakdown> = {
  ...expenses,
  groups: [{ key: "c1", name: "חומרים", currency: "ILS", amount_minor: 1_003_600n, count: 4, shared: true }],
};

function breakdownStory(sample: Breakdown | undefined, entry = "/flow/expense", groupBy?: BreakdownGroupBy) {
  return () => (
    <StoryRoute entry={entry}>
      <Routes>
        <Route path="/flow/:direction" element={<BreakdownScreen sample={sample} sampleGroupBy={groupBy ?? sample?.group_by} />} />
      </Routes>
    </StoryRoute>
  );
}

function quadrant(render: () => ReactElement): { base: Story; dark: Story; narrow: Story; darkNarrow: Story } {
  return {
    base: { render },
    dark: { render, globals: { theme: "dark" } },
    narrow: { render, parameters: { viewport: { defaultViewport: "flow320" } } },
    darkNarrow: { render, globals: { theme: "dark" }, parameters: { viewport: { defaultViewport: "flow320" } } },
  };
}

const byCategory = quadrant(breakdownStory(expenses));
export const ExpensesByCategory: Story = byCategory.base;
export const ExpensesByCategoryDark: Story = byCategory.dark;
export const ExpensesByCategory320: Story = byCategory.narrow;
export const ExpensesByCategoryDark320: Story = byCategory.darkNarrow;

const projects = quadrant(breakdownStory(byProject));
export const ExpensesByProject: Story = projects.base;
export const ExpensesByProjectDark: Story = projects.dark;

const long = quadrant(breakdownStory(longNames));
export const LongNamesAndUsd: Story = long.base;
export const LongNamesAndUsd320: Story = long.narrow;

const incomeStory = quadrant(breakdownStory(income, "/flow/income"));
export const IncomeByCustomer: Story = incomeStory.base;
export const IncomeByCustomerDark: Story = incomeStory.dark;

export const Empty: Story = { render: breakdownStory(undefined, "/flow/expense?preview=empty", "category") };
export const Loading: Story = { render: breakdownStory(undefined, "/flow/expense?preview=loading", "category") };
export const ErrorState: Story = { render: breakdownStory(undefined, "/flow/expense?preview=error", "category") };

function linesStory() {
  return (
    <StoryRoute entry="/flow/expense/category/ILS/c1">
      <Routes>
        <Route
          path="/flow/:direction/:groupBy/:currency/:groupKey"
          element={<BreakdownLinesScreen sample={{ breakdown: linesBreakdown, pages: [linesPage] }} />}
        />
      </Routes>
    </StoryRoute>
  );
}

const lines = quadrant(linesStory);
export const GroupLines: Story = lines.base;
export const GroupLinesDark: Story = lines.dark;
export const GroupLines320: Story = lines.narrow;
