import type { Meta, StoryObj } from "@storybook/react-vite";
import { Route, Routes } from "react-router-dom";
import {
  birchLaneReturnLines,
  birchLaneReturns,
  birchLaneReturnsBeforeRent,
  birchLaneReturnsCashOut,
  birchLaneReturnsMissing,
  birchLaneReturnsNegative,
  mapleCourtSub2Returns,
} from "../dev/returns-sample";
import { StoryRoute } from "../ui/story-route";
import type { LinesSource } from "./project-returns-data";
import { PropertyMetricScreen, PropertyPartScreen } from "./project-returns-detail-screen";
import { PropertyReturnLineScreen, PropertyStatementScreen } from "./project-returns-screen";

/**
 * FLOW-451: the pages behind the investment page's figures, on the invented Birch Lane fixture.
 * FLOW-453: the holding costs before the first rent, the money in by part, and all the cash out.
 * FLOW-454: the units by default, a Sub2 purchase split in two, and the per-cents before the first rent.
 * FLOW-457: a statement with nothing before the first rent: one row left out, a section that does not fold.
 */
const RETURNS = {
  complete: birchLaneReturns,
  missing: birchLaneReturnsMissing,
  negative: birchLaneReturnsNegative,
  cashOut: birchLaneReturnsCashOut,
  sub2: mapleCourtSub2Returns,
  beforeRent: birchLaneReturnsBeforeRent,
  nothingBeforeRent: { ...birchLaneReturns, statement: { ...birchLaneReturns.statement, beforeRentMinor: 0n } },
};

type Args = { entry: string; lines?: LinesSource; returns?: keyof typeof RETURNS };

function Screen({ entry, lines = "opex", returns = "complete" }: Args) {
  const sample = { returns: RETURNS[returns], projectName: "Birch Lane", lines: birchLaneReturnLines(lines) };
  return (
    <StoryRoute entry={entry}>
      <Routes>
        <Route path="/projects/:projectId/investment/returns" element={<PropertyStatementScreen sample={sample} />} />
        <Route path="/projects/:projectId/investment/returns/:line" element={<PropertyReturnLineScreen sample={sample} />} />
        <Route path="/projects/:projectId/investment/metric/:metric" element={<PropertyMetricScreen sample={sample} />} />
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
