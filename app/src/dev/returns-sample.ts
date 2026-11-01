import type { LinesSource, PropertyReturns, ReturnLineRow, ReturnLinesPage } from "../screens/project-returns-data";

/**
 * FLOW-451 board fixture (rule 25: invented names, round amounts). Birch Lane's last 12 months as a
 * rental, on the investment sample's figures (purchase $185,000, rehab $61,300, value $240,000, loans
 * $210,000 borrowed). The figures add up: rent $24,000 − operating $8,400 = NOI $15,600; − loan
 * payments $9,600 − CapEx $1,800 = cash flow $4,200. Building $200,000 (land $46,300) ÷ 27.5 × 24%
 * = $1,745.45 a year. Money in the deal $36,300.
 */
const usd = (dollars: number) => BigInt(dollars) * 100n;

const cat = (id: string, name: string, dollars: number, count: number) => ({ id, name, minor: usd(dollars), count });

export const birchLaneReturns: PropertyReturns = {
  currency: "USD",
  from: "2025-11-02",
  to: "2026-11-01",
  days: 365,
  otherCurrencies: [],
  missing: [],
  inputs: {
    purchaseMinor: usd(185_000),
    arvMinor: usd(310_000),
    valueMinor: usd(240_000),
    valueDate: "2026-10-01",
    units: 2,
    landMinor: usd(46_300),
    taxBracketBp: 2400,
    rehabMinor: usd(61_300),
    borrowedMinor: usd(210_000),
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
    notCountedMinor: usd(-185_000),
    counts: { income: 22, opex: 23, debt_service: 12, capex: 2, not_counted: 4 },
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
      not_counted: [cat("cat-purchase", "רכישה", -185_000, 4)],
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
  equity: { todayMinor: usd(30_000), forcedMinor: usd(63_700), moneyInMinor: usd(36_300) },
  metrics: { cashOnCashBp: 1157, capRateBp: 650, dscrMilli: 1625, perUnitMonthMinor: usd(175) },
};

/** No land, no tax bracket, no units, and no value a year back: those figures read "חסר". */
export const birchLaneReturnsMissing: PropertyReturns = {
  ...birchLaneReturns,
  missing: ["value_history", "land", "tax_bracket", "units"],
  inputs: { ...birchLaneReturns.inputs, landMinor: null, taxBracketBp: null, units: null, valueStart: null },
  sources: {
    ...birchLaneReturns.sources,
    appreciationMinor: null,
    taxSavingsMinor: null,
    depreciationYearMinor: null,
    buildingMinor: null,
    totalMinor: usd(6_000),
    totalBp: 1653,
  },
  metrics: { ...birchLaneReturns.metrics, perUnitMonthMinor: null },
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
  not_counted: [row("t-close", "First Title", "2026-02-02", -185_000, "cat-purchase", "רכישה", "invoice")],
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

const counts: Record<LinesSource, number> = { income: 22, opex: 23, debt_service: 12, capex: 2, not_counted: 4, principal: 12, rehab: 19 };

/** One page of a figure's lines (the first few), with the figure's whole count. */
export function birchLaneReturnLines(line: LinesSource): ReturnLinesPage {
  const list = rows[line];
  const total = list.reduce((sum, item) => sum + item.minor, 0n);
  return { currency: "USD", totalMinor: total, count: counts[line], hasMore: counts[line] > list.length, rows: list };
}
