import type { Meta, StoryObj } from "@storybook/react-vite";
import { Route, Routes } from "react-router-dom";
import { expect, userEvent, waitFor, within } from "storybook/test";
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
  birchLaneReturnsFewDays,
  birchLaneReturnsNoRehab,
  mapleCourtAcquisitionLines,
  mapleCourtClosingPaidReturns,
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
 * FLOW-473: a cap rate fewer than 60 days after the first rent reads "מעט נתונים".
 * FLOW-466: the acquisition page adds the bank lines and the loans paid out at closing up to the price.
 */
const RETURNS = {
  complete: birchLaneReturns,
  missing: birchLaneReturnsMissing,
  negative: birchLaneReturnsNegative,
  cashOut: birchLaneReturnsCashOut,
  sub2: mapleCourtSub2Returns,
  closingPaid: mapleCourtClosingPaidReturns,
  beforeRent: birchLaneReturnsBeforeRent,
  nothingBeforeRent: { ...birchLaneReturns, statement: { ...birchLaneReturns.statement, beforeRentMinor: 0n } },
  noRehab: birchLaneReturnsNoRehab,
  annualized: birchLaneReturnsAnnualized,
  fewDays: birchLaneReturnsFewDays,
};

const REHAB = { three: birchLaneRehab, many: birchLaneRehabMany, none: [] };

/** `maple`: Maple Court's own acquisition lines, which add up to its bank row. */
type Args = { entry: string; lines?: ReturnLine | "maple"; returns?: keyof typeof RETURNS; rehab?: keyof typeof REHAB; learn?: boolean };

function Screen({ entry, lines = "opex", returns = "complete", rehab = "three", learn = false }: Args) {
  const page = lines === "maple" ? mapleCourtAcquisitionLines : birchLaneReturnLines(lines);
  const sample = { returns: RETURNS[returns], projectName: lines === "maple" ? "Maple Court" : "Birch Lane", lines: page, rehab: REHAB[rehab] };
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
/** FLOW-473: rented 21 days back: no figure scaled from so few days; the caption says from when. */
export const CapRateFewDays: Story = { name: "Cap rate, fewer than 60 days", args: { entry: "/projects/p1/investment/metric/cap-rate", returns: "fewDays" } };
export const CapRateLearn: Story = { args: { entry: "/projects/p1/investment/metric/cap-rate", learn: true } };
/* FLOW-1068 (boards V3-Calc-Roe, V3-Calc-Roi, V3-Calc-FlipProfit): the deal metrics' pages and a renovation's net profit. */
export const ReturnOnEquity: Story = { args: { entry: "/projects/p1/investment/metric/roe" } };
/** FLOW-1069: the IRR since the purchase, its dated flows opening where they come from. */
export const InternalRateOfReturn: Story = { name: "IRR", args: { entry: "/projects/p1/investment/metric/irr" } };
export const RoiSincePurchase: Story = { args: { entry: "/projects/p1/investment/metric/roi-since" } };
export const EquityMultiple: Story = { args: { entry: "/projects/p1/investment/metric/multiple" } };
export const BreakEvenOccupancy: Story = { args: { entry: "/projects/p1/investment/metric/break-even" } };
export const LoanToValue: Story = { args: { entry: "/projects/p1/investment/metric/ltv" } };
export const GrossRentMultiplier: Story = { args: { entry: "/projects/p1/investment/metric/grm" } };
export const ExpenseRatio: Story = { args: { entry: "/projects/p1/investment/metric/expense-ratio" } };
export const FlipRoi: Story = { name: "Flip ROI", args: { entry: "/projects/p1/investment/metric/flip-roi" } };
export const FlipRoiYear: Story = { name: "Flip ROI per year", args: { entry: "/projects/p1/investment/metric/flip-roi-year" } };
export const ArvMargin: Story = { name: "Margin on the ARV", args: { entry: "/projects/p1/investment/metric/arv-margin" } };
export const RuleOf70: Story = { name: "The 70% rule", args: { entry: "/projects/p1/investment/metric/rule-70" } };
export const BreakEvenSale: Story = { args: { entry: "/projects/p1/investment/metric/break-even-sale" } };
export const RoeBeforeFirstRent: Story = { args: { entry: "/projects/p1/investment/metric/roe", returns: "beforeRent" } };
export const NetProfitPart: Story = { name: "Net profit part", args: { entry: "/projects/p1/investment/part/profit", lines: "rehab" } };
export const AcquisitionLoansAtClosing: Story = {
  name: "Acquisition, loans paid out at closing",
  args: { entry: "/projects/p1/investment/returns/acquisition", lines: "maple", returns: "closingPaid" },
};

/**
 * The bank row opens the lines below and moves the focus to them, with no ring: a ring around the section ran down
 * both sides of the months, cut by each pinned month head (owner's screenshot, 2026-11-07).
 */
export const AcquisitionBankRowFocusesLines: Story = {
  name: "Acquisition, the bank row focuses the lines",
  args: { entry: "/projects/p1/investment/returns/acquisition", lines: "maple", returns: "closingPaid" },
  play: async ({ canvasElement }) => {
    const row = await within(canvasElement).findByRole("button", { name: /מהתנועות/ });
    row.focus();
    await userEvent.keyboard("{Enter}");
    const lines = canvasElement.querySelector<HTMLElement>(".ui-ret-lines");
    await waitFor(() => { void expect(document.activeElement).toBe(lines); });
    if (lines == null) throw new Error("no lines section");
    await expect(getComputedStyle(lines).outlineStyle).toBe("none");
  },
};

/** FLOW-1047 (V3-States): a calculation page with no sample, in a preview state. */
function LiveRoutes({ entry }: { entry: string }) {
  return (
    <StoryRoute entry={entry}>
      <Routes>
        <Route path="/projects/:projectId/investment/returns" element={<PropertyStatementScreen />} />
        <Route path="/projects/:projectId/investment/metric/:metric" element={<PropertyMetricScreen />} />
        <Route path="/projects/:projectId/investment/returns/:line" element={<PropertyReturnLineScreen />} />
        <Route path="/projects/:projectId/investment/part/:part" element={<PropertyPartScreen />} />
      </Routes>
    </StoryRoute>
  );
}

/** FLOW-1138: a calculation page loads as its hero and two blocks, not list rows. */
async function expectReturnsSkeleton(canvasElement: HTMLElement) {
  await expect(await within(canvasElement).findByText("טוען…")).toBeInTheDocument();
  await expect(canvasElement.querySelector(".ui-ret-hero .ui-skeleton-bar")).not.toBeNull();
  await expect(canvasElement.querySelectorAll(".ui-ret-calc")).toHaveLength(2);
  await expect(canvasElement.querySelector(".ui-skel-row")).toBeNull();
}

export const CalcLoading: Story = {
  args: { entry: "" },
  render: () => <LiveRoutes entry="/projects/p1/investment/returns?preview=loading" />,
  play: async ({ canvasElement }) => { await expectReturnsSkeleton(canvasElement); },
};
export const CalcLineLoading: Story = {
  args: { entry: "" },
  render: () => <LiveRoutes entry="/projects/p1/investment/returns/income?preview=loading" />,
  play: async ({ canvasElement }) => { await expectReturnsSkeleton(canvasElement); },
};
export const CalcMetricLoading: Story = {
  args: { entry: "" },
  render: () => <LiveRoutes entry="/projects/p1/investment/metric/coc?preview=loading" />,
  play: async ({ canvasElement }) => { await expectReturnsSkeleton(canvasElement); },
};
export const CalcPartLoading: Story = {
  args: { entry: "" },
  render: () => <LiveRoutes entry="/projects/p1/investment/part/money-in?preview=loading" />,
  play: async ({ canvasElement }) => { await expectReturnsSkeleton(canvasElement); },
};
export const CalcFailed: Story = { args: { entry: "" }, render: () => <LiveRoutes entry="/projects/p1/investment/metric/coc?preview=error-server" /> };
export const CalcOffline: Story = { args: { entry: "" }, render: () => <LiveRoutes entry="/projects/p1/investment/metric/coc?preview=error" /> };
export const CalcEmpty: Story = { args: { entry: "" }, render: () => <LiveRoutes entry="/projects/p1/investment/returns?preview=empty" /> };
