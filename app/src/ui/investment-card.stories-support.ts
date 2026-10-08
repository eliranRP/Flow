import type { InvestmentFigures } from "./investment-card";

/** FLOW-404. Invented figures only. */
export const FILLED: InvestmentFigures = {
  currency: "ILS",
  purchaseMinor: 125_000_000n,
  arvMinor: 190_000_000n,
  valueMinor: 165_000_000n,
  valueDate: "2026-10-01",
  rehabMinor: 31_240_000n,
  rehabOther: [],
  loanMinor: 80_000_000n,
  loanOther: [],
  forcedEquityMinor: 33_760_000n,
  currentEquityMinor: 85_000_000n,
};

/** No ARV yet, and a dollar loan: neither equity can be worked out. */
export const MISSING: InvestmentFigures = {
  ...FILLED,
  purchaseMinor: 240_000_000n,
  arvMinor: null,
  valueMinor: 275_000_000n,
  valueDate: "2026-09-15",
  rehabMinor: 41_805_000n,
  loanMinor: 110_000_000n,
  loanOther: [{ currency: "USD", minor: 12_000_000n }],
  forcedEquityMinor: null,
  currentEquityMinor: null,
};

/** A new project: nothing typed in yet. */
export const EMPTY: InvestmentFigures = {
  ...FILLED,
  purchaseMinor: null,
  arvMinor: null,
  valueMinor: null,
  valueDate: null,
  rehabMinor: 0n,
  loanMinor: 0n,
  forcedEquityMinor: null,
  currentEquityMinor: null,
};

/** A dollar project with a shekel cost in rehab and a shekel loan, listed apart. */
export const OTHER_CURRENCY: InvestmentFigures = {
  currency: "USD",
  purchaseMinor: 31_500_000n,
  arvMinor: 46_000_000n,
  valueMinor: 41_000_000n,
  valueDate: "2026-09-30",
  rehabMinor: 6_820_000n,
  rehabOther: [{ currency: "ILS", minor: 1_450_000n }],
  loanMinor: 24_000_000n,
  loanOther: [{ currency: "ILS", minor: 30_000_000n }],
  forcedEquityMinor: null,
  currentEquityMinor: null,
};

/** The ARV came in under cost: the equity is a loss, in bad with a minus. */
export const UNDER_WATER: InvestmentFigures = {
  ...FILLED,
  arvMinor: 150_000_000n,
  forcedEquityMinor: -6_240_000n,
};
