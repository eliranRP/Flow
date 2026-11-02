import type { Meta, StoryObj } from "@storybook/react-vite";
import { birchLaneInvestment, birchLaneNegativeInvestment, birchLaneNoArvInvestment, mapleCourtSub2Investment } from "../dev/investment-sample";
import { project as sampleProject } from "../dev/project-cash-sample";
import {
  birchLaneReturns,
  birchLaneReturnsBeforeRent,
  birchLaneReturnsCashOut,
  birchLaneReturnsLandBooks,
  birchLaneReturnsLandSuggestion,
  birchLaneReturnsMissing,
  birchLaneReturnsNegative,
  mapleCourtSub2Returns,
} from "../dev/returns-sample";
import { StoryRoute } from "../ui/story-route";
import { ProjectInvestmentScreen } from "./project-investment-screen";
import type { ProjectInvestment } from "./project-investment-data";
import type { InfoKey } from "./project-returns-info";

/**
 * FLOW-446. Invented flip, the board's figures; value only (no ARV), under water, and the two sheets.
 * FLOW-451: the returns cards on top (complete, missing inputs, a negative cash flow) and the ⓘ sheet.
 * FLOW-453: a cash-out refinance (all the cash out, ∞), and the money in the deal's sheet by part.
 * FLOW-454: a Sub2 deal (the mortgage taken over inside the purchase) and before the first rent.
 * FLOW-461: the land from the books (its account named) and a suggested land account with השתמש.
 */
const VALUE_ONLY: ProjectInvestment = {
  ...birchLaneInvestment,
  figures: birchLaneInvestment.figures && { ...birchLaneInvestment.figures, arvMinor: null, forcedEquityMinor: null, purchaseMinor: null },
  loans: [],
};

const DATA = { flip: birchLaneInvestment, valueOnly: VALUE_ONLY, noArv: birchLaneNoArvInvestment, negative: birchLaneNegativeInvestment, sub2: mapleCourtSub2Investment };
const RETURNS = {
  complete: birchLaneReturns,
  missing: birchLaneReturnsMissing,
  negative: birchLaneReturnsNegative,
  cashOut: birchLaneReturnsCashOut,
  sub2: mapleCourtSub2Returns,
  beforeRent: birchLaneReturnsBeforeRent,
  landBooks: birchLaneReturnsLandBooks,
  landSuggestion: birchLaneReturnsLandSuggestion,
};

type Args = {
  data?: keyof typeof DATA;
  returns?: keyof typeof RETURNS;
  sheet?: "purchase" | "arv" | "value" | "land" | "units" | "tax" | null;
  info?: InfoKey | null;
  viewer?: boolean;
};

function Screen({ data = "flip", returns = "complete", sheet = null, info = null, viewer = false }: Args) {
  return (
    <StoryRoute entry="/projects/p1/investment" viewer={viewer}>
      <ProjectInvestmentScreen
        sample={sampleProject}
        sampleInvestment={DATA[data]}
        sampleReturns={RETURNS[returns]}
        initialSheet={sheet}
        initialInfo={info}
        backTo="/projects/p1"
        today="2026-10-17"
      />
    </StoryRoute>
  );
}

const meta = {
  title: "Screens/Project investment",
  component: Screen,
  parameters: { flowRouter: false },
} satisfies Meta<typeof Screen>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Flip: Story = {};
export const MissingArv: Story = { args: { data: "noArv" } };
export const Negative: Story = { args: { data: "negative" } };
export const Viewer: Story = { args: { data: "noArv", viewer: true } };
export const EditArv: Story = { args: { sheet: "arv" } };
export const MissingInputs: Story = { args: { returns: "missing" } };
export const NegativeCashFlow: Story = { args: { returns: "negative" } };
export const TaxInfoSheet: Story = { args: { info: "tax" } };
export const CashFlowInfoSheet: Story = { args: { info: "cash_flow" } };
export const EditUnits: Story = { args: { sheet: "units" } };
export const TaxBracketSheet: Story = { args: { sheet: "tax", returns: "missing" } };
export const AllCashOut: Story = { args: { returns: "cashOut" } };
export const MoneyInSheet: Story = { args: { info: "money_in" } };
export const Sub2: Story = { args: { data: "sub2", returns: "sub2" } };
export const Sub2ForcedSheet: Story = { args: { data: "sub2", returns: "sub2", info: "forced" } };
export const BeforeFirstRent: Story = { args: { returns: "beforeRent" } };
export const LandFromBooks: Story = { args: { returns: "landBooks" } };
export const LandSuggestion: Story = { args: { returns: "landSuggestion" } };
