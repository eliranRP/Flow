import type { CategoryAmount, ProjectInvestment, RehabCategory } from "../screens/project-investment-data";

/**
 * FLOW-446 board fixture (rule 25: invented names, round amounts). A USD flip, "Birch Lane",
 * with the Harbor Lending loan still open and Brightwater Bridge paid off. The figures are the
 * board frame's: ARV $310,000, value today $240,000, rehab $61,300, loan balance $210,000.
 */
const usd = (dollars: number) => BigInt(dollars) * 100n;

/** The rehab categories as the sheet reads them (the four counted rows add up to $61,300). */
export const birchLaneRehabCategories: RehabCategory[] = [
  { id: "cat-contractors", name: "קבלני משנה", rehab: true, in_rehab: true },
  { id: "cat-materials", name: "חומרים", rehab: true, in_rehab: true },
  { id: "cat-equipment", name: "ציוד והשכרה", rehab: true, in_rehab: true },
  { id: "cat-tax", name: "מסים וביטוח", rehab: true, in_rehab: true },
  { id: "cat-loan", name: "תשלומי הלוואה", loan_part: "חלק מתשלום הלוואה", in_rehab: false },
];

/** Costs by category for the rehab sheet's rows; loan payments are not counted (their own line). */
export const birchLaneRehabCosts: CategoryAmount[] = [
  { id: "cat-contractors", name: "קבלני משנה", currency: "USD", minor: usd(31_400) },
  { id: "cat-materials", name: "חומרים", currency: "USD", minor: usd(19_700) },
  { id: "cat-equipment", name: "ציוד והשכרה", currency: "USD", minor: usd(6_450) },
  { id: "cat-tax", name: "מסים וביטוח", currency: "USD", minor: usd(3_750) },
  { id: "cat-loan", name: "תשלומי הלוואה", currency: "USD", minor: usd(7_350) },
];

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
    { id: "loan-harbor", name: "הלוואת שיפוץ", currency: "USD", balance_minor: usd(210_000) },
  ],
  categories: birchLaneRehabCosts,
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
