import type { Meta, StoryObj } from "@storybook/react-vite";
import { Route, Routes } from "react-router-dom";
import { birchLaneReturnLines, birchLaneReturns, birchLaneReturnsMissing, birchLaneReturnsNegative } from "../dev/returns-sample";
import { StoryRoute } from "../ui/story-route";
import type { LinesSource } from "./project-returns-data";
import { PropertyMetricScreen, PropertyPartScreen } from "./project-returns-detail-screen";
import { PropertyReturnLineScreen, PropertyStatementScreen } from "./project-returns-screen";

/** FLOW-451: the pages behind the investment page's figures, on the invented Birch Lane fixture. */
const RETURNS = { complete: birchLaneReturns, missing: birchLaneReturnsMissing, negative: birchLaneReturnsNegative };

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
export const UnitsMissing: Story = { args: { entry: "/projects/p1/investment/metric/per-unit", returns: "missing" } };
export const BuildingCost: Story = { args: { entry: "/projects/p1/investment/part/building", lines: "rehab" } };
export const BuildingCostLandMissing: Story = { args: { entry: "/projects/p1/investment/part/building", lines: "rehab", returns: "missing" } };
