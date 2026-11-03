import type { Meta, StoryObj } from "@storybook/react-vite";
import { Route, Routes } from "react-router-dom";
import {
  birchLaneRehab,
  birchLaneRehabMany,
  birchLaneReturnLines,
  birchLaneReturns,
  birchLaneReturnsBeforeRent,
  birchLaneReturnsCashOut,
  birchLaneReturnsMissing,
  birchLaneReturnsNegative,
  birchLaneReturnsAnnualized,
  birchLaneReturnsNoRehab,
  mapleCourtSub2Returns,
} from "../dev/returns-sample";
import { StoryRoute } from "../ui/story-route";
import type { ReturnLine } from "./project-returns-data";
import { PropertyMetricScreen, PropertyPartScreen } from "./project-returns-detail-screen";
import { PropertyReturnLineScreen, PropertyStatementScreen } from "./project-returns-screen";

/**
 * FLOW-451: the pages behind the investment page's figures, on the invented Birch Lane fixture.
 * FLOW-453: the holding costs before the first rent, the money in by part, and all the cash out.
 * FLOW-454: the units by default, a Sub2 purchase split in two, and the per-cents before the first rent.
 * FLOW-457: a statement with nothing before the first rent: one row left out, a section that does not fold.
 * FLOW-460: the renovation so far by category (three, seven with "עוד 2 קטגוריות", none yet).
 * FLOW-462: the ⓘ beside a page's title, open on the cap rate: מה זה, איך לקרוא, בשביל מה.
 */
const RETURNS = {
  complete: birchLaneReturns,
  missing: birchLaneReturnsMissing,
  negative: birchLaneReturnsNegative,
  cashOut: birchLaneReturnsCashOut,
  sub2: mapleCourtSub2Returns,
  beforeRent: birchLaneReturnsBeforeRent,
  nothingBeforeRent: { ...birchLaneReturns, statement: { ...birchLaneReturns.statement, beforeRentMinor: 0n } },
  noRehab: birchLaneReturnsNoRehab,
  annualized: birchLaneReturnsAnnualized,
};

const REHAB = { three: birchLaneRehab, many: birchLaneRehabMany, none: [] };

type Args = { entry: string; lines?: ReturnLine; returns?: keyof typeof RETURNS; rehab?: keyof typeof REHAB; learn?: boolean };

function Screen({ entry, lines = "opex", returns = "complete", rehab = "three", learn = false }: Args) {
  const sample = { returns: RETURNS[returns], projectName: "Birch Lane", lines: birchLaneReturnLines(lines), rehab: REHAB[rehab] };
  return (
    <StoryRoute entry={entry}>
      <Routes>
        <Route path="/projects/:projectId/investment/returns" element={<PropertyStatementScreen sample={sample} />} />
        <Route path="/projects/:projectId/investment/returns/:line" element={<PropertyReturnLineScreen sample={sample} />} />
        <Route path="/projects/:projectId/investment/metric/:metric" element={<PropertyMetricScreen sample={sample} learnOpen={learn} />} />
        <Route path="/projects/:projectId/investment/part/:part" element={<PropertyPartScreen sample={sample} />} />
      </Routes>
    </StoryRoute>
  );
}

const meta = {
  title: "Screens/Property returns",
  component: Screen,
  parameters: { flowRouter: false },
} satisfies Meta<typeof Screen>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Statement: Story = { args: { entry: "/projects/p1/investment/returns" } };
export const StatementNegative: Story = { args: { entry: "/projects/p1/investment/returns", returns: "negative" } };
export const OperatingLine: Story = { args: { entry: "/projects/p1/investment/returns/opex" } };
export const OperatingLineOneCategory: Story = { args: { entry: "/projects/p1/investment/returns/opex?category=cat-other" } };
export const CashOnCash: Story = { args: { entry: "/projects/p1/investment/metric/coc" } };
export const PerUnitDefault: Story = { args: { entry: "/projects/p1/investment/metric/per-unit", returns: "missing" } };
export const BuildingCost: Story = { args: { entry: "/projects/p1/investment/part/building", lines: "rehab" } };
export const BuildingCostLandMissing: Story = { args: { entry: "/projects/p1/investment/part/building", lines: "rehab", returns: "missing" } };
export const StatementCashOut: Story = { args: { entry: "/projects/p1/investment/returns", returns: "cashOut" } };
export const BeforeRentLine: Story = { args: { entry: "/projects/p1/investment/returns/before_rent", lines: "before_rent" } };
export const HoldingLine: Story = { args: { entry: "/projects/p1/investment/returns/holding", lines: "holding" } };
export const MoneyInPart: Story = { args: { entry: "/projects/p1/investment/part/money-in", lines: "money_in" } };
export const CashOnCashAllCashOut: Story = { args: { entry: "/projects/p1/investment/metric/coc", returns: "cashOut" } };
export const BuildingCostSub2: Story = { args: { entry: "/projects/p1/investment/part/building", lines: "rehab", returns: "sub2" } };
export const CashOnCashBeforeFirstRent: Story = { args: { entry: "/projects/p1/investment/metric/coc", returns: "beforeRent" } };
export const StatementOneRowOut: Story = { args: { entry: "/projects/p1/investment/returns", returns: "nothingBeforeRent" } };
export const RehabPart: Story = { name: "Rehab part", args: { entry: "/projects/p1/investment/part/rehab", lines: "rehab" } };
export const RehabPartManyCategories: Story = { name: "Rehab part, many categories", args: { entry: "/projects/p1/investment/part/rehab", lines: "rehab", rehab: "many" } };
export const RehabPartEmpty: Story = { name: "Rehab part, empty", args: { entry: "/projects/p1/investment/part/rehab", lines: "rehab", returns: "noRehab", rehab: "none" } };
export const RehabCategoryLines: Story = { args: { entry: "/projects/p1/investment/returns/rehab?category=cat-renovation", lines: "rehab" } };
export const CapRate: Story = { args: { entry: "/projects/p1/investment/metric/cap-rate" } };
/** FLOW-464: rented from 01/04, 215 days: a year's NOI over today's value. */
export const CapRateAnnualized: Story = { args: { entry: "/projects/p1/investment/metric/cap-rate", returns: "annualized" } };
export const CapRateLearn: Story = { args: { entry: "/projects/p1/investment/metric/cap-rate", learn: true } };
