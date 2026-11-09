import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, within } from "storybook/test";
import { birchLaneInvestment, birchLaneNegativeInvestment, birchLaneNoArvInvestment, mapleCourtSub2Investment } from "../dev/investment-sample";
import { project as sampleProject } from "../dev/project-cash-sample";
import {
  birchLaneReturns,
  birchLaneReturnsAnnualized,
  birchLaneReturnsBeforeRent,
  birchLaneReturnsCashOut,
  birchLaneReturnsCashOutLosing,
  birchLaneReturnsFewDays,
  birchLaneReturnsLandBooks,
  birchLaneReturnsLandSuggestion,
  birchLaneReturnsMissing,
  birchLaneReturnsNegative,
  mapleCourtSub2Returns,
} from "../dev/returns-sample";
import { StoryRoute } from "../ui/story-route";
import { ProjectInvestmentScreen, type InvestmentTab } from "./project-investment-screen";
import type { ProjectInvestment } from "./project-investment-data";
import type { PropertyReturns } from "./project-returns-data";
import type { InfoKey } from "./project-returns-info";

/**
 * FLOW-1047 (boards V3-Investment, V3-Investment-Rent, V3-States): the investment page as an Overview, by
 * kind. A renovation (the invented Birch Lane flip, with a budget and an ARV) leads with its expected
 * profit; a rental (no budget, no ARV) with its total return. Each with and without missing inputs,
 * the attention cards some and all hidden, the three tabs, the "איך מחושב" sheet and the ⓘ sheets,
 * and the loading, failed, offline and empty states.
 */
const RENTAL_PROJECT = { ...sampleProject, budget_agorot: null, state_label: null };

/** A rental's figures: the same property with no ARV, so the kind reads as a rental. */
const RENTAL: ProjectInvestment = {
  ...birchLaneInvestment,
  figures: birchLaneInvestment.figures && { ...birchLaneInvestment.figures, arvMinor: null, forcedEquityMinor: null },
};

function rental(r: PropertyReturns): PropertyReturns {
  return { ...r, inputs: { ...r.inputs, arvMinor: null }, equity: { ...r.equity, forcedMinor: null } };
}

const DATA = { flip: birchLaneInvestment, rental: RENTAL, noArv: birchLaneNoArvInvestment, negative: birchLaneNegativeInvestment, sub2: mapleCourtSub2Investment };
const RETURNS = {
  complete: birchLaneReturns,
  missing: birchLaneReturnsMissing,
  negative: birchLaneReturnsNegative,
  cashOut: birchLaneReturnsCashOut,
  cashOutLosing: birchLaneReturnsCashOutLosing,
  sub2: mapleCourtSub2Returns,
  beforeRent: birchLaneReturnsBeforeRent,
  landBooks: birchLaneReturnsLandBooks,
  landSuggestion: birchLaneReturnsLandSuggestion,
  annualized: birchLaneReturnsAnnualized,
  fewDays: birchLaneReturnsFewDays,
  noArv: { ...birchLaneReturns, inputs: { ...birchLaneReturns.inputs, arvMinor: null }, equity: { ...birchLaneReturns.equity, forcedMinor: null } },
};

/** The rental's missing inputs as their cards count them (flow.attention.investment:p1). */
const ALL_HIDDEN = { "missing-value": "history:2026-10-01", "missing-land": "land", "missing-tax_bracket": "tax_bracket" };

type Args = {
  data?: keyof typeof DATA;
  returns?: keyof typeof RETURNS;
  rent?: boolean;
  sheet?: "purchase" | "arv" | "value" | "land" | "units" | "tax" | "selling" | null;
  info?: InfoKey | null;
  how?: boolean;
  tab?: InvestmentTab;
  viewer?: boolean;
  hidden?: Record<string, string> | null;
  /** The returns are still out (FLOW-1138). */
  pending?: boolean;
};

/** The hidden cards a story starts with; every story sets its own, so none leaks into the next. */
function useHiddenRows(hidden: Record<string, string> | null) {
  useState(() => {
    try {
      if (hidden == null) window.localStorage.removeItem("flow.attention.investment:p1");
      else window.localStorage.setItem("flow.attention.investment:p1", JSON.stringify(hidden));
    } catch {
      // Storage blocked: the story shows every card.
    }
    return null;
  });
}

function Screen({ data = "flip", returns = "complete", rent = false, sheet = null, info = null, how = false, tab = "property", viewer = false, hidden = null, pending = false }: Args) {
  useHiddenRows(hidden);
  return (
    <StoryRoute entry="/projects/p1/investment" viewer={viewer}>
      <ProjectInvestmentScreen
        sample={rent ? RENTAL_PROJECT : sampleProject}
        sampleInvestment={rent ? RENTAL : DATA[data]}
        sampleReturns={pending ? undefined : rent ? rental(RETURNS[returns]) : RETURNS[returns]}
        initialSheet={sheet}
        initialInfo={info}
        initialHow={how}
        initialTab={tab}
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

/** A renovation: the expected profit at the sale, the ARV and the total cost, then where the profit comes from. */
export const Flip: Story = {};
export const FlipMissingArv: Story = { args: { data: "noArv", returns: "noArv" } };
export const FlipHow: Story = { name: "Flip, איך מחושב", args: { how: true } };
export const FlipMetrics: Story = { args: { tab: "metrics" } };
export const FlipLoans: Story = { args: { tab: "loans" } };
export const Negative: Story = { args: { data: "negative" } };
export const Viewer: Story = { args: { data: "noArv", returns: "noArv", viewer: true } };
export const EditArv: Story = { args: { sheet: "arv" } };
export const Sub2: Story = { args: { data: "sub2", returns: "sub2" } };
export const Sub2ForcedSheet: Story = { args: { data: "sub2", returns: "sub2", info: "forced" } };

/** A rental: the total return on the money in the deal, then its four sources. */
export const Rental: Story = { args: { rent: true } };
export const RentalHow: Story = { name: "Rental, איך מחושב", args: { rent: true, how: true } };
export const RentalMissingInputs: Story = { args: { rent: true, returns: "missing" } };
export const RentalAttentionSomeHidden: Story = { args: { rent: true, returns: "missing", hidden: { "missing-land": "land" } } };
export const RentalAttentionAllHidden: Story = { args: { rent: true, returns: "missing", hidden: ALL_HIDDEN } };
export const RentalMetrics: Story = { args: { rent: true, tab: "metrics" } };
export const RentalLoans: Story = { args: { rent: true, tab: "loans" } };
export const NegativeCashFlow: Story = { args: { rent: true, returns: "negative" } };
export const TaxInfoSheet: Story = { args: { rent: true, info: "tax" } };
export const CashFlowInfoSheet: Story = { args: { rent: true, info: "cash_flow" } };
export const EquityInfoSheet: Story = { args: { rent: true, info: "equity_today" } };
export const EditUnits: Story = { args: { rent: true, sheet: "units" } };
export const TaxBracketSheet: Story = { args: { rent: true, sheet: "tax", returns: "missing" } };
/** FLOW-1068: a renovation's costs of selling, the default 8% until the owner sets them. */
export const SellingCostSheet: Story = { args: { sheet: "selling" } };
export const AllCashOut: Story = { args: { rent: true, returns: "cashOut" } };
/** FLOW-1025: all the cash out but losing money: the loss, not ∞, and how long the cash out lasts. */
export const AllCashOutLosing: Story = { args: { rent: true, returns: "cashOutLosing" } };
export const AllCashOutLosingMoneyIn: Story = { args: { rent: true, returns: "cashOutLosing", info: "money_in" } };
export const MoneyInSheet: Story = { args: { rent: true, info: "money_in" } };
export const BeforeFirstRent: Story = { args: { rent: true, returns: "beforeRent" } };
export const LandFromBooks: Story = { args: { rent: true, returns: "landBooks" } };
export const LandSuggestion: Story = { args: { rent: true, returns: "landSuggestion" } };
export const Annualized: Story = { args: { rent: true, returns: "annualized", tab: "metrics" } };
/** FLOW-473: first rented 21 days back: the per-year figures read "מעט נתונים" and say why. */
export const FewDays: Story = { name: "Fewer than 60 days", args: { rent: true, returns: "fewDays" } };

/** V3-States: the band pulses while the project is read; after 300ms, the page's cards in their shape (FLOW-1138). */
export const Loading: Story = {
  render: () => (
    <StoryRoute entry="/projects/p1/investment?preview=loading">
      <ProjectInvestmentScreen backTo="/projects/p1" />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("טוען…")).toBeInTheDocument();
    await expect(canvasElement.querySelector(".ui-pinv-parts")).not.toBeNull();
    await expect(canvasElement.querySelector(".ui-skel-row")).toBeNull();
  },
};

/** FLOW-1138: the metrics tab while the returns load: the parts' card and the metrics' groups in their shape. */
export const MetricsLoading: Story = {
  args: { rent: true, tab: "metrics", pending: true },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("טוען…")).toBeInTheDocument();
    await expect(canvasElement.querySelectorAll(".ui-pinv-groups .ui-skel-group")).toHaveLength(3);
    await expect(canvasElement.querySelector(".ui-skel-row")).toBeNull();
  },
};

/** V3-States: the read failed; the band says so, with נסו שוב and צריך עזרה?. */
export const Failed: Story = {
  render: () => (
    <StoryRoute entry="/projects/p1/investment?preview=error-server">
      <ProjectInvestmentScreen backTo="/projects/p1" />
    </StoryRoute>
  ),
};

/** V3-States: no connection and nothing read yet. */
export const Offline: Story = {
  render: () => (
    <StoryRoute entry="/projects/p1/investment?preview=error">
      <ProjectInvestmentScreen backTo="/projects/p1" />
    </StoryRoute>
  ),
};

/** V3-States: nothing to show yet. */
export const Empty: Story = {
  render: () => (
    <StoryRoute entry="/projects/p1/investment?preview=empty">
      <ProjectInvestmentScreen backTo="/projects/p1" />
    </StoryRoute>
  ),
};
