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




const linesPage: NonNullable<BreakdownLinesPage> = {
  rows: [
    { transaction_id: "t1", part: null, description: "חשבונית 5521", supplier_name: "טמבור בע״מ", project_name: "מגדל הים", category_name: "חומרים", doc_date: "2026-10-05", currency: "ILS", amount_minor: 420_000n, shared: false },
    { transaction_id: "t2", part: null, description: "חשבונית 118", supplier_name: "מחסני חשמל", project_name: "וילה בהרצליה", category_name: "חומרים", doc_date: "2026-10-04", currency: "ILS", amount_minor: 315_000n, shared: false, source: "mercury" },
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

function storyOf(render: () => ReactElement): Story {
  return { render };
}




/** FLOW-307: the largest totals step down from display until they fit, each line on its own. */


export const Empty: Story = { render: breakdownStory(undefined, "/flow/expense?preview=empty", "category") };

function linesStory(pages: Array<NonNullable<BreakdownLinesPage>> = [linesPage]) {
  return (
    <StoryRoute entry="/flow/expense/category/ILS/c1">
      <Routes>
        <Route
          path="/flow/:direction/:groupBy/:currency/:groupKey"
          element={<BreakdownLinesScreen sample={{ breakdown: linesBreakdown, pages }} />}
        />
      </Routes>
    </StoryRoute>
  );
}

const lines = storyOf(() => linesStory());
export const GroupLines: Story = lines;

/** FLOW-322: the lines pick their own period; an empty one offers another instead of a dead end. */
const emptyLines = storyOf(() => linesStory([{ ...linesPage, rows: [] }]));
export const GroupLinesEmpty: Story = emptyLines;
