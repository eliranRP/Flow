import type { LinesSource, PropertyReturns, ReturnLineRow, ReturnLinesPage } from "../screens/project-returns-data";

/**
 * FLOW-451 board fixture (rule 25: invented names, round amounts). Birch Lane's last 12 months as a
 * rental, on the investment sample's figures (purchase $185,000, rehab $61,300, value $240,000, loans
 * $210,000 borrowed). The figures add up: rent $24,000 − operating $8,400 = NOI $15,600; − loan
 * payments $9,600 − CapEx $1,800 = cash flow $4,200. Building $200,000 (land $46,300) ÷ 27.5 × 24%
 * = $1,745.45 a year.
 *
 * FLOW-453 (decision 0245): the first rent on 01/04/2026, inside the period. Money in the deal
 * $36,300 from the lines: purchase and closing $185,000 + renovation before the rent $59,500 +
 * holding $1,800 − net loan proceeds $210,000. The period's lines before the rent ($61,300) and its
 * kept-out lines (+$25,000) are shown apart.
 */
const usd = (dollars: number) => BigInt(dollars) * 100n;

const cat = (id: string, name: string, dollars: number, count: number) => ({ id, name, minor: usd(dollars), count });

export const birchLaneReturns: PropertyReturns = {
  currency: "USD",
  from: "2025-11-02",
  to: "2026-11-01",
  days: 365,
  firstRent: "2026-04-01",
  otherCurrencies: [],
  missing: [],
  inputs: {
    purchaseMinor: usd(185_000),
    purchaseSource: "lines",
    purchaseTypedMinor: usd(185_000),
    arvMinor: usd(310_000),
    valueMinor: usd(240_000),
    valueDate: "2026-10-01",
    units: 2,
    unitsDefault: false,
    takenOverMinor: 0n,
    takenOverLoans: [],
    landMinor: usd(46_300),
    taxBracketBp: 2400,
    rehabMinor: usd(61_300),
    loanBalanceMinor: usd(210_000),
    valueStart: { minor: usd(228_000), date: "2025-11-01" },
    valueEnd: { minor: usd(240_000), date: "2026-10-01" },
  },
  statement: {
    incomeMinor: usd(24_000),
    opexMinor: usd(-8_400),
    noiMinor: usd(15_600),
    debtServiceMinor: usd(-9_600),
    capexMinor: usd(-1_800),
    cashFlowMinor: usd(4_200),
    beforeRentMinor: usd(-61_300),
    notCountedMinor: usd(25_000),
    counts: { income: 22, opex: 23, debt_service: 12, capex: 2, before_rent: 23, not_counted: 4 },
    byCategory: {
      income: [cat("cat-rent", "שכר דירה", 24_000, 22)],
      opex: [
        cat("cat-contractors", "קבלני משנה", -2_700, 8),
        cat("cat-tax", "מסים וביטוח", -2_400, 2),
        cat("cat-other", "אחר", -1_800, 12),
        cat("cat-insurance", "ביטוח", -1_500, 1),
      ],
      debt_service: [cat("cat-interest", "ריבית", -7_800, 12), cat("cat-principal", "קרן הלוואה", -1_800, 12)],
      capex: [cat("cat-materials", "חומרים", -1_800, 2)],
      before_rent: [
        cat("cat-contractors", "קבלני משנה", -40_000, 10),
        cat("cat-materials", "חומרים", -19_500, 9),
        cat("cat-interest", "ריבית", -1_200, 3),
        cat("cat-insurance", "ביטוח", -600, 1),
      ],
      not_counted: [
        cat("cat-loan-in", "תקבולי הלוואה", 210_000, 1),
        cat("cat-purchase", "רכישה", -180_000, 1),
        cat("cat-closing", "עלויות סגירה", -5_000, 2),
      ],
    },
  },
  sources: {
    cashFlowMinor: usd(4_200),
    principalMinor: usd(1_800),
    appreciationMinor: usd(12_000),
    taxSavingsMinor: 174_545n,
    depreciationYearMinor: 727_273n,
    buildingMinor: usd(200_000),
    totalMinor: 1_974_545n,
    totalBp: 5440,
  },
  equity: {
    todayMinor: usd(30_000),
    forcedMinor: usd(63_700),
    moneyInMinor: usd(36_300),
    moneyInParts: { acquisitionMinor: usd(-185_000), renovationMinor: usd(-59_500), holdingMinor: usd(-1_800), financingMinor: usd(210_000) },
    allCashOut: false,
  },
  metrics: { cashOnCashBp: 1157, capRateBp: 650, dscrMilli: 1625, perUnitMonthMinor: usd(175) },
};

/**
 * No land, no tax bracket, and no value a year back: those figures read "חסר". Units are the default
 * 1 (decision 0246), so the cash flow per unit is $4,200 ÷ 12 = $350.
 */
export const birchLaneReturnsMissing: PropertyReturns = {
  ...birchLaneReturns,
  missing: ["value_history", "land", "tax_bracket"],
  inputs: { ...birchLaneReturns.inputs, landMinor: null, taxBracketBp: null, units: 1, unitsDefault: true, valueStart: null },
  sources: {
    ...birchLaneReturns.sources,
    appreciationMinor: null,
    taxSavingsMinor: null,
    depreciationYearMinor: null,
    buildingMinor: null,
    totalMinor: usd(6_000),
    totalBp: 1653,
  },
  metrics: { ...birchLaneReturns.metrics, perUnitMonthMinor: usd(350) },
};

/** Operating costs of $16,000: NOI $8,000 and a cash flow of −$3,400, the one signal on the page. */
export const birchLaneReturnsNegative: PropertyReturns = {
  ...birchLaneReturns,
  statement: {
    ...birchLaneReturns.statement,
    opexMinor: usd(-16_000),
    noiMinor: usd(8_000),
    cashFlowMinor: usd(-3_400),
    byCategory: {
      ...birchLaneReturns.statement.byCategory,
      opex: [
        cat("cat-contractors", "קבלני משנה", -10_300, 14),
        cat("cat-tax", "מסים וביטוח", -2_400, 2),
        cat("cat-other", "אחר", -1_800, 12),
        cat("cat-insurance", "ביטוח", -1_500, 1),
      ],
    },
    counts: { ...birchLaneReturns.statement.counts, opex: 29 },
  },
  sources: { ...birchLaneReturns.sources, cashFlowMinor: usd(-3_400), totalMinor: 1_214_545n, totalBp: 3346 },
  metrics: { cashOnCashBp: -937, capRateBp: 333, dscrMilli: 833, perUnitMonthMinor: -14_167n },
};

/**
 * Bought with a cash-out refinance after the rehab: net loan proceeds $280,300 in all, so the money in
 * is −$30,000 (all the cash came out, and $30,000 more), holding $5,800 before the first rent. The
 * refinance appraisal is the value today ($310,000, loans $280,000); the per-cent figures are null.
 */
export const birchLaneReturnsCashOut: PropertyReturns = {
  ...birchLaneReturns,
  inputs: { ...birchLaneReturns.inputs, valueMinor: usd(310_000), loanBalanceMinor: usd(280_000), valueEnd: { minor: usd(310_000), date: "2026-10-01" } },
  statement: {
    ...birchLaneReturns.statement,
    beforeRentMinor: usd(-65_300),
    notCountedMinor: usd(95_300),
    counts: { ...birchLaneReturns.statement.counts, before_rent: 28, not_counted: 5 },
    byCategory: {
      ...birchLaneReturns.statement.byCategory,
      before_rent: [
        cat("cat-contractors", "קבלני משנה", -40_000, 10),
        cat("cat-materials", "חומרים", -19_500, 9),
        cat("cat-interest", "ריבית", -4_600, 6),
        cat("cat-insurance", "ביטוח", -1_200, 3),
      ],
      not_counted: [
        cat("cat-loan-in", "תקבולי הלוואה", 280_300, 2),
        cat("cat-purchase", "רכישה", -180_000, 1),
        cat("cat-closing", "עלויות סגירה", -5_000, 2),
      ],
    },
  },
  sources: { ...birchLaneReturns.sources, appreciationMinor: usd(82_000), totalMinor: 8_974_545n, totalBp: null },
  equity: {
    todayMinor: usd(30_000),
    forcedMinor: usd(63_700),
    moneyInMinor: usd(-30_000),
    moneyInParts: { acquisitionMinor: usd(-185_000), renovationMinor: usd(-59_500), holdingMinor: usd(-5_800), financingMinor: usd(280_300) },
    allCashOut: true,
  },
  metrics: { ...birchLaneReturns.metrics, cashOnCashBp: null, capRateBp: 503 },
};

/**
 * FLOW-454: before the first rent. The rehab is done and nothing is rented yet: no income, an empty
 * statement, and the period's $61,300 before the rent. The amounts stay ($600 principal, $12,000
 * appreciation, $1,745.45 tax savings: $14,345.45); the per-cent figures read "לפני השכר הראשון".
 */
export const birchLaneReturnsBeforeRent: PropertyReturns = {
  ...birchLaneReturns,
  firstRent: null,
  statement: {
    ...birchLaneReturns.statement,
    incomeMinor: 0n,
    opexMinor: 0n,
    noiMinor: 0n,
    debtServiceMinor: 0n,
    capexMinor: 0n,
    cashFlowMinor: 0n,
    counts: { income: 0, opex: 0, debt_service: 0, capex: 0, before_rent: 23, not_counted: 4 },
    byCategory: { ...birchLaneReturns.statement.byCategory, income: [], opex: [], debt_service: [], capex: [] },
  },
  sources: { ...birchLaneReturns.sources, cashFlowMinor: 0n, principalMinor: usd(600), totalMinor: 1_434_545n, totalBp: 3952 },
  metrics: { cashOnCashBp: 0, capRateBp: 0, dscrMilli: null, perUnitMonthMinor: 0n },
};

/**
 * FLOW-454 (decision 0246): "Maple Court", a Sub2 deal. The bank shows $41,600 of purchase lines
 * (the cash to close); the $290,000 mortgage taken over never passed through it, so the purchase is
 * $331,600. The first rent on 01/03/2026, inside the period; one unit, the default. Rent $20,000 −
 * operating $6,000 = NOI $14,000; − loan payments $12,000 = cash flow $2,000. Money in $63,000 (cash
 * only: $41,600 + renovation $18,400 + holding $3,000). Building $331,600 + $18,400 − land $66,600 =
 * $283,400 ÷ 27.5 × 24% = $2,473.31 a year.
 */
export const mapleCourtSub2Returns: PropertyReturns = {
  currency: "USD",
  from: "2025-11-02",
  to: "2026-11-01",
  days: 365,
  firstRent: "2026-03-01",
  otherCurrencies: [],
  missing: [],
  inputs: {
    purchaseMinor: usd(331_600),
    purchaseSource: "lines",
    purchaseTypedMinor: null,
    arvMinor: usd(380_000),
    valueMinor: usd(360_000),
    valueDate: "2026-10-01",
    units: 1,
    unitsDefault: true,
    takenOverMinor: usd(290_000),
    takenOverLoans: [{ id: "loan-maple", name: "Maple Street Mortgage", minor: usd(290_000) }],
    landMinor: usd(66_600),
    taxBracketBp: 2400,
    rehabMinor: usd(18_400),
    loanBalanceMinor: usd(286_000),
    valueStart: { minor: usd(340_000), date: "2025-11-01" },
    valueEnd: { minor: usd(360_000), date: "2026-10-01" },
  },
  statement: {
    incomeMinor: usd(20_000),
    opexMinor: usd(-6_000),
    noiMinor: usd(14_000),
    debtServiceMinor: usd(-12_000),
    capexMinor: 0n,
    cashFlowMinor: usd(2_000),
    beforeRentMinor: usd(-21_400),
    notCountedMinor: usd(-41_600),
    counts: { income: 8, opex: 10, debt_service: 8, capex: 0, before_rent: 12, not_counted: 3 },
    byCategory: {
      income: [cat("cat-rent", "שכר דירה", 20_000, 8)],
      opex: [cat("cat-tax", "מסים וביטוח", -3_600, 2), cat("cat-other", "אחר", -2_400, 8)],
      debt_service: [cat("cat-interest", "ריבית", -8_800, 8), cat("cat-principal", "קרן הלוואה", -3_200, 8)],
      capex: [],
      before_rent: [
        cat("cat-contractors", "קבלני משנה", -12_000, 4),
        cat("cat-materials", "חומרים", -6_400, 5),
        cat("cat-interest", "ריבית", -3_000, 3),
      ],
      not_counted: [cat("cat-purchase", "רכישה", -38_000, 1), cat("cat-closing", "עלויות סגירה", -3_600, 2)],
    },
  },
  sources: {
    cashFlowMinor: usd(2_000),
    principalMinor: usd(3_200),
    appreciationMinor: usd(20_000),
    taxSavingsMinor: 247_331n,
    depreciationYearMinor: 1_030_545n,
    buildingMinor: usd(283_400),
    totalMinor: 2_767_331n,
    totalBp: 4393,
  },
  equity: {
    todayMinor: usd(74_000),
    forcedMinor: usd(30_000),
    moneyInMinor: usd(63_000),
    moneyInParts: { acquisitionMinor: usd(-41_600), renovationMinor: usd(-18_400), holdingMinor: usd(-3_000), financingMinor: 0n },
    allCashOut: false,
  },
  metrics: { cashOnCashBp: 317, capRateBp: 389, dscrMilli: 1167, perUnitMonthMinor: 16_667n },
};

function row(id: string, supplier: string, date: string, dollars: number, categoryId: string, categoryName: string, source = "mercury"): ReturnLineRow {
  return { transactionId: id, description: supplier, supplierName: supplier, categoryId, categoryName, date, minor: usd(dollars), parts: null, shared: false, source };
}

const rows: Record<LinesSource, ReturnLineRow[]> = {
  income: [
    row("t-rent-2", "Unit B tenant", "2026-10-01", 1_000, "cat-rent", "שכר דירה"),
    row("t-rent-1", "Unit A tenant", "2026-10-01", 1_000, "cat-rent", "שכר דירה"),
    row("t-rent-0", "Unit A tenant", "2026-09-01", 1_000, "cat-rent", "שכר דירה"),
  ],
  opex: [
    row("t-plumb", "Ace Plumbing LLC", "2026-10-09", -450, "cat-contractors", "קבלני משנה"),
    row("t-mgmt-10", "Lakeside Property Mgmt", "2026-10-01", -150, "cat-other", "אחר"),
    row("t-ins", "Harbor Insurance", "2026-09-11", -1_500, "cat-insurance", "ביטוח", "invoice"),
    row("t-mgmt-09", "Lakeside Property Mgmt", "2026-09-01", -150, "cat-other", "אחר"),
  ],
  debt_service: [
    row("t-loan-10", "Northfield Lending", "2026-10-01", -800, "cat-interest", "ריבית"),
    row("t-loan-09", "Northfield Lending", "2026-09-01", -800, "cat-interest", "ריבית"),
  ],
  capex: [row("t-paint", "Ferguson Supply", "2026-08-14", -1_100, "cat-materials", "חומרים"), row("t-floor", "Ferguson Supply", "2026-06-03", -700, "cat-materials", "חומרים")],
  before_rent: [
    row("t-hold-ins", "Harbor Insurance", "2026-03-20", -600, "cat-insurance", "ביטוח", "invoice"),
    row("t-roof", "Lone Star Roofing", "2026-03-14", -9_800, "cat-contractors", "קבלני משנה"),
    row("t-hold-int", "Northfield Lending", "2026-03-01", -400, "cat-interest", "ריבית"),
  ],
  not_counted: [
    row("t-loan-in", "Northfield Lending", "2026-02-02", 210_000, "cat-loan-in", "תקבולי הלוואה"),
    row("t-close", "First Title", "2026-02-02", -180_000, "cat-purchase", "רכישה", "invoice"),
    row("t-close-fee", "First Title", "2026-02-02", -3_000, "cat-closing", "עלויות סגירה", "invoice"),
  ],
  acquisition: [
    row("t-close", "First Title", "2026-02-02", -180_000, "cat-purchase", "רכישה", "invoice"),
    row("t-close-fee", "First Title", "2026-02-02", -3_000, "cat-closing", "עלויות סגירה", "invoice"),
  ],
  renovation: [
    row("t-roof", "Lone Star Roofing", "2026-03-14", -9_800, "cat-contractors", "קבלני משנה"),
    row("t-supply", "Ferguson Supply", "2026-03-06", -2_100, "cat-materials", "חומרים"),
  ],
  holding: [
    row("t-hold-ins", "Harbor Insurance", "2026-03-20", -600, "cat-insurance", "ביטוח", "invoice"),
    row("t-hold-int", "Northfield Lending", "2026-03-01", -400, "cat-interest", "ריבית"),
  ],
  financing: [row("t-loan-in", "Northfield Lending", "2026-02-02", 210_000, "cat-loan-in", "תקבולי הלוואה")],
  money_in: [
    row("t-hold-ins", "Harbor Insurance", "2026-03-20", -600, "cat-insurance", "ביטוח", "invoice"),
    row("t-roof", "Lone Star Roofing", "2026-03-14", -9_800, "cat-contractors", "קבלני משנה"),
    row("t-hold-int", "Northfield Lending", "2026-03-01", -400, "cat-interest", "ריבית"),
    row("t-loan-in", "Northfield Lending", "2026-02-02", 210_000, "cat-loan-in", "תקבולי הלוואה"),
    row("t-close", "First Title", "2026-02-02", -180_000, "cat-purchase", "רכישה", "invoice"),
  ],
  principal: [
    row("t-loan-10", "Northfield Lending", "2026-10-01", -150, "cat-principal", "קרן הלוואה"),
    row("t-loan-09", "Northfield Lending", "2026-09-01", -150, "cat-principal", "קרן הלוואה"),
  ],
  rehab: [
    row("t-roof", "Lone Star Roofing", "2026-03-14", -9_800, "cat-contractors", "קבלני משנה"),
    row("t-supply", "Ferguson Supply", "2026-03-06", -2_100, "cat-materials", "חומרים"),
    row("t-drywall", "Garcia Drywall", "2026-02-21", -6_500, "cat-contractors", "קבלני משנה"),
  ],
};

const counts: Record<LinesSource, number> = {
  income: 22,
  opex: 23,
  debt_service: 12,
  capex: 2,
  before_rent: 23,
  not_counted: 4,
  principal: 12,
  rehab: 19,
  acquisition: 3,
  renovation: 19,
  holding: 4,
  financing: 1,
  money_in: 27,
};

/** One page of a figure's lines (the first few), with the figure's whole count. */
export function birchLaneReturnLines(line: LinesSource): ReturnLinesPage {
  const list = rows[line];
  const total = list.reduce((sum, item) => sum + item.minor, 0n);
  return { currency: "USD", totalMinor: total, count: counts[line], hasMore: counts[line] > list.length, rows: list };
}
