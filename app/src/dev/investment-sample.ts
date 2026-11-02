import type { ProjectInvestment } from "../screens/project-investment-data";

/**
 * FLOW-446 board fixture (rule 25: invented names, round amounts). A USD flip, "Birch Lane",
 * with the renovation loan still open and the bridge loan paid off. The figures are the
 * board frame's: ARV $310,000, value today $240,000, rehab $61,300, loan balance $210,000.
 */
const usd = (dollars: number) => BigInt(dollars) * 100n;

/** The flip with its open loan; expected: השבחה צפויה $63,700, הון עצמי היום $30,000. */
export const birchLaneInvestment: ProjectInvestment = {
  isOverhead: false,
  figures: {
    currency: "USD",
    purchaseMinor: usd(185_000),
    arvMinor: usd(310_000),
    valueMinor: usd(240_000),
    valueDate: "2026-10-01",
    rehabMinor: usd(61_300),
    rehabOther: [],
    loanMinor: usd(210_000),
    loanOther: [],
    forcedEquityMinor: usd(63_700),
    currentEquityMinor: usd(30_000),
  },
  loans: [
    {
      id: "loan-harbor",
      name: "הלוואת שיפוץ",
      currency: "USD",
      balance_minor: usd(210_000),
      status: "open",
      closedOn: null,
      // Interest only at 10.5%: the next payment is the 1st of next month (loan-outlook).
      terms: {
        principalMinor: usd(210_000),
        annualRatePpm: 105_000,
        termMonths: 12,
        startDate: "2026-01-01",
        paymentMinor: 183_750n,
        escrowMinor: 0n,
        kind: "interest_only",
        interestOnlyMonths: 12,
        amortizationMonths: null,
        rates: [],
      },
    },
    {
      id: "loan-brightwater",
      name: "הלוואת גישור",
      currency: "USD",
      balance_minor: 0n,
      status: "paid_off",
      closedOn: "2026-08-14",
      terms: null,
    },
  ],
};

/** NoArv frame: the ARV is missing, so the figure reads "הוספה" and the השבחה is not computed. */
export const birchLaneNoArvInvestment: ProjectInvestment = {
  ...birchLaneInvestment,
  figures: birchLaneInvestment.figures && { ...birchLaneInvestment.figures, arvMinor: null, forcedEquityMinor: null },
};

/** Negative story: value today $195,000, so הון עצמי היום is −$15,000 and reads in the signal colour. */
export const birchLaneNegativeInvestment: ProjectInvestment = {
  ...birchLaneInvestment,
  figures: birchLaneInvestment.figures && {
    ...birchLaneInvestment.figures,
    valueMinor: usd(195_000),
    currentEquityMinor: usd(-15_000),
  },
};

/**
 * FLOW-454: "Maple Court", the Sub2 deal of the returns sample: purchase $331,600 ($41,600 of lines
 * and the $290,000 mortgage taken over), rehab $18,400, ARV $380,000, value $360,000, the mortgage at
 * $286,000. השבחה צפויה $30,000, הון עצמי היום $74,000.
 */
export const mapleCourtSub2Investment: ProjectInvestment = {
  isOverhead: false,
  figures: {
    currency: "USD",
    purchaseMinor: null,
    arvMinor: usd(380_000),
    valueMinor: usd(360_000),
    valueDate: "2026-10-01",
    rehabMinor: usd(18_400),
    rehabOther: [],
    loanMinor: usd(286_000),
    loanOther: [],
    forcedEquityMinor: usd(30_000),
    currentEquityMinor: usd(74_000),
  },
  loans: [{ id: "loan-maple", name: "Maple Street Mortgage", currency: "USD", balance_minor: usd(286_000), status: "open", closedOn: null, terms: null }],
};
