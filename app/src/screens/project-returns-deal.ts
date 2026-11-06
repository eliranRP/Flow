import { formatDisplay } from "../ui/date-math";
import { grmText, multipleText, percentText, type PropertyReturns } from "./project-returns-data";
import {
  ANNUALIZED,
  BEFORE_FIRST_RENT,
  FEW_DAYS,
  INFINITY,
  METRIC_TITLES,
  beforeFirstRent,
  cents,
  computed,
  countHint,
  daysText,
  equityTodayFormula,
  fewDays,
  fewDaysText,
  firstMissing,
  metricCaption,
  metricPage,
  metricValue,
  missing,
  money,
  moneyInFormula,
  perYear,
  purchaseRows,
  rehabRow,
  typed,
  type EditField,
  type FigureValue,
  type FormulaRow,
  type MetricKey,
  type MetricPage,
  type MetricSection,
} from "./project-returns-info";

/* ------------------------------------------------------------------------------------------------
 * FLOW-1068 (decision 0261; boards V3-Investment, V3-Calc-Roi, V3-Calc-Roe, V3-Calc-FlipProfit): the
 * deal metrics of Real Estate by the Numbers that the מדדים tab adds to the four of FLOW-451. The
 * server works each one out (get_property_returns `metrics`); this file names them, says what each
 * is made of, and groups them by kind. A rental reads return, risk and price; a renovation reads its
 * return on the cash in the deal and what its price leaves room for.
 * ---------------------------------------------------------------------------------------------- */

export type DealMetricKey =
  | "irr"
  | "roi-since"
  | "roe"
  | "multiple"
  | "break-even"
  | "ltv"
  | "grm"
  | "expense-ratio"
  | "flip-roi"
  | "flip-roi-year"
  | "arv-margin"
  | "rule-70"
  | "break-even-sale";

/** Every metric with a page: the four of FLOW-451 and the deal metrics. */
export type AnyMetricKey = MetricKey | DealMetricKey;

export const DEAL_METRIC_KEYS: readonly DealMetricKey[] = [
  "irr", "roi-since", "roe", "multiple", "break-even", "ltv", "grm", "expense-ratio",
  "flip-roi", "flip-roi-year", "arv-margin", "rule-70", "break-even-sale",
];

export const DEAL_METRIC_TITLES: Record<DealMetricKey, string> = {
  irr: "תשואה פנימית (IRR)",
  "roi-since": "ROI מאז הקנייה",
  roe: "תשואה על ההון העצמי (ROE)",
  multiple: "מכפיל הון",
  "break-even": "תפוסת איזון",
  ltv: "מינוף (LTV)",
  grm: "מכפיל שכירות (GRM)",
  "expense-ratio": "יחס הוצאות",
  "flip-roi": "ROI על הכסף בעסקה",
  "flip-roi-year": "ROI שנתי",
  "arv-margin": "מרווח מה־ARV",
  "rule-70": "כלל ה־70%",
  "break-even-sale": "מחיר איזון במכירה",
};

/** One group of the מדדים tab: its heading and its metrics, in the boards' order. */
export type MetricGroup = { key: string; title: string; metrics: readonly AnyMetricKey[] };

export const RENT_GROUPS: readonly MetricGroup[] = [
  { key: "return", title: "תשואה", metrics: ["irr", "roi-since", "roe", "coc", "multiple"] },
  { key: "risk", title: "סיכון", metrics: ["dscr", "break-even", "ltv"] },
  { key: "price", title: "מחיר", metrics: ["cap-rate", "grm", "expense-ratio", "per-unit"] },
];

/** FLOW-1071 (the owner, 2026-11-06): a renovation keeps the four metrics of FLOW-451 beside its own. */
export const FLIP_GROUPS: readonly MetricGroup[] = [
  { key: "return", title: "תשואה", metrics: ["flip-roi", "flip-roi-year", "irr", "arv-margin", "coc"] },
  { key: "risk", title: "סיכון", metrics: ["dscr"] },
  { key: "price", title: "מחיר", metrics: ["rule-70", "break-even-sale", "cap-rate", "per-unit"] },
];

/** A deal metric read since the purchase, not over the period: its page's subtitle says so. */
export function dealAllTime(metric: string): boolean {
  return isDealMetric(metric) && !(AFTER_RENT as readonly string[]).includes(metric) && metric !== "ltv";
}

export function isDealMetric(value: string): value is DealMetricKey {
  return (DEAL_METRIC_KEYS as readonly string[]).includes(value);
}

/** The deal metrics a first rent inside the period scales to a year, as cash on cash (FLOW-464). */
const SCALED: readonly DealMetricKey[] = ["roe", "grm"];
/** The deal metrics that read the statement since the first rent: none before it. */
const AFTER_RENT: readonly DealMetricKey[] = ["roe", "break-even", "grm", "expense-ratio"];

function scaled(metric: DealMetricKey, r: PropertyReturns): boolean {
  return r.annualizedFrom != null && SCALED.includes(metric);
}

const NO_INCOME = "אין הכנסות עדיין";

/** A per-cent figure, or why there is none: the first input missing, else "לא מחושב". */
function bp(value: number | null, r: PropertyReturns, needs: readonly EditField[], text: (bp: number) => string = percentText): FigureValue {
  if (value != null) return { kind: "text", text: text(value) };
  const add = firstMissing(r, needs);
  return add == null ? { kind: "text", text: "לא מחושב" } : missing(add);
}

/** The row's value of a deal metric (the same as its page's figure). */
export function dealMetricValue(metric: DealMetricKey, r: PropertyReturns): FigureValue {
  const m = r.metrics;
  if (AFTER_RENT.includes(metric)) {
    if (beforeFirstRent(r)) return { kind: "note", text: BEFORE_FIRST_RENT };
    if (scaled(metric, r) && fewDays(r)) return { kind: "note", text: FEW_DAYS };
  }
  // All the cash out: a return on nothing in is no per-cent (FLOW-457), a gain reads ∞.
  const cashOut = r.equity.allCashOut;
  if (metric === "roi-since" || metric === "multiple") {
    if (cashOut) return { kind: "text", text: INFINITY };
    return metric === "roi-since" ? bp(m.roiSincePurchaseBp, r, ["purchase", "value"]) : bp(m.equityMultipleMilli, r, ["purchase", "value"], multipleText);
  }
  if (metric === "roe") return bp(m.roeBp, r, ["value"]);
  // FLOW-1069: with no value, the IRR's last flow is the ARV, so a renovation asks for either.
  // FLOW-1069: the IRR dates its cash from the purchase line; a typed price alone has no date (review of #1016).
  if (metric === "irr" && m.irrBp == null && r.deal.acquiredOn == null && r.inputs.purchaseMinor != null) {
    return { kind: "missing", add: null, note: "חסרה שורת רכישה" };
  }
  if (metric === "irr") return bp(m.irrBp, r, ["purchase", r.inputs.arvMinor == null ? "value" : "arv"]);
  if (metric === "break-even") return m.breakEvenOccupancyBp == null ? { kind: "text", text: NO_INCOME } : { kind: "text", text: percentText(m.breakEvenOccupancyBp) };
  if (metric === "expense-ratio") return m.expenseRatioBp == null ? { kind: "text", text: NO_INCOME } : { kind: "text", text: percentText(m.expenseRatioBp) };
  if (metric === "grm") return bp(m.grmMilli, r, ["purchase"], grmText);
  if (metric === "ltv") return bp(m.ltvBp, r, ["value"]);
  if (metric === "flip-roi" || metric === "flip-roi-year") {
    const profit = r.deal.netProfitMinor;
    if (cashOut && profit != null && profit >= 0n) return { kind: "text", text: INFINITY };
    return bp(metric === "flip-roi" ? m.flipRoiBp : m.flipRoiYearBp, r, ["arv", "purchase"]);
  }
  if (metric === "arv-margin") return bp(m.arvMarginBp, r, ["arv", "purchase"]);
  if (metric === "rule-70") return computed(m.rule70Minor, r, ["arv", "purchase"]);
  return computed(m.breakEvenSaleMinor, r, ["purchase"]);
}

/** How long the renovation has been held, in whole months, at least one. */
function heldMonths(r: PropertyReturns): number {
  return Math.max(1, Math.round((r.deal.heldDays ?? 0) / 30.44));
}

function heldText(r: PropertyReturns): string {
  const months = heldMonths(r);
  return months === 1 ? "חודש אחד" : `${String(months)} חודשים`;
}

/** The 70% rule's highest price: ARV × 70% − rehab, from the server's figure (rule − purchase back). */
function maxPrice(r: PropertyReturns): bigint | null {
  const rule = r.metrics.rule70Minor;
  const paid = r.inputs.purchaseMinor;
  return rule == null || paid == null ? null : rule + paid;
}

/** How a deal metric is made, on its row and its page. */
function dealFormula(metric: DealMetricKey, r: PropertyReturns): string {
  const cur = r.currency;
  switch (metric) {
    case "irr": return r.missing.includes("value_history") && r.inputs.valueMinor != null ? "שנתי, לפי תאריכי הכסף · הערכה לפי שווי אחד" : "שנתי, לפי תאריכי הכסף";
    case "roi-since": return "מה חזר ומה שווה היום, מול מה שנכנס";
    case "roe": return "תשואה כוללת ÷ הון עצמי היום";
    case "multiple": return "מה חזר ומה שווה ÷ מה נכנס";
    case "break-even": return "מתחת לזה התזרים שלילי";
    case "ltv": return "יתרת הלוואה ÷ שווי היום";
    case "grm": return "מחיר ÷ שכירות שנתית";
    case "expense-ratio": return "הוצאות תפעול ÷ הכנסות";
    case "flip-roi": return "רווח נקי ÷ כסף בעסקה";
    case "flip-roi-year": return r.deal.heldDays == null ? "ROI לשנה, מהקנייה" : `${heldText(r)} · מהקנייה`;
    case "arv-margin": return "רווח נקי ÷ ARV";
    case "rule-70": {
      const paid = r.inputs.purchaseMinor;
      const max = maxPrice(r);
      if (max == null || paid == null) return "ARV × 70% פחות השיפוץ, מול מה ששולם";
      return `מחיר מקסימלי ${cents(max, cur)} · שולם ${cents(paid, cur)}`;
    }
    case "break-even-sale": return "מתחתיו העסקה בהפסד";
  }
}

export function dealMetricCaption(metric: DealMetricKey, r: PropertyReturns): string {
  const value = dealMetricValue(metric, r);
  if (value.kind === "note" && value.text === FEW_DAYS) return fewDaysText(r);
  const days = scaled(metric, r) ? ` · ${ANNUALIZED} · ${daysText(r.earningDays ?? 365)}` : "";
  return `${dealFormula(metric, r)}${days}`;
}

/* -- the pages ------------------------------------------------------------------------------------ */

const text = (value: string): FigureValue => ({ kind: "text", text: value });

/** The cash back since the first rent: what the property paid out, never less than nothing. */
function cashBack(r: PropertyReturns): bigint {
  const life = r.deal.lifeCashFlowMinor;
  return life > 0n ? life : 0n;
}

function moneyInSection(r: PropertyReturns): MetricSection {
  return { key: "money-in", title: "כסף בעסקה", total: computed(r.equity.moneyInMinor, r, ["purchase"]), formula: moneyInFormula(r) };
}

function backSection(r: PropertyReturns): MetricSection {
  const equity = r.equity.todayMinor;
  const back = cashBack(r);
  return {
    key: "back",
    title: "מה חזר ומה שווה היום",
    total: equity == null ? undefined : money(back + equity),
    formula: {
      rows: [
        { key: "cash", op: "", label: "תזרים שחזר", hint: "מהשכירות הראשונה, מאז ומעולם", value: money(back), target: { kind: "statement" } },
        { key: "equity", op: "+", label: "הון עצמי היום", hint: "שווי היום פחות הלוואות", value: computed(equity, r, ["value"]), target: { kind: "metric", metric: "roe" } },
      ],
      result: { key: "back", op: "=", label: "מה חזר ומה שווה", value: equity == null ? missing("value") : money(back + equity) },
    },
  };
}

function totalSection(r: PropertyReturns): MetricSection {
  const s = r.sources;
  return {
    key: "total",
    title: "תשואה כוללת",
    total: money(s.totalMinor),
    formula: {
      rows: [
        { key: "cash", op: "", label: "תזרים", value: money(s.cashFlowMinor), target: { kind: "statement" } },
        { key: "principal", op: "+", label: "החזר קרן", value: money(s.principalMinor), target: { kind: "line", line: "principal" } },
        { key: "appreciation", op: "+", label: "עליית ערך", hint: "שווי היום מול שווי קודם · עריכה", value: s.appreciationMinor == null ? text("לא נספר") : money(s.appreciationMinor), target: { kind: "edit", field: "value" } },
        { key: "tax", op: "+", label: "חיסכון מס", hint: "פחת × מדרגת המס", value: s.taxSavingsMinor == null ? text("לא נספר") : money(s.taxSavingsMinor), target: { kind: "part", part: "building" } },
      ],
      result: { key: "total", op: "=", label: "תשואה כוללת", value: money(s.totalMinor) },
    },
  };
}

function oneRow(key: string, title: string, row: FormulaRow): MetricSection {
  return { key, title, formula: { rows: [row], result: null } };
}

function incomeRow(r: PropertyReturns): FormulaRow {
  return { key: "income", op: "", label: "הכנסות", hint: countHint(r.statement.counts.income), value: money(r.statement.incomeMinor, true), target: { kind: "line", line: "income" } };
}

function profitRow(r: PropertyReturns): FormulaRow {
  return { key: "profit", op: "", label: "רווח נקי צפוי", hint: "ARV פחות כל העלויות", value: computed(r.deal.netProfitMinor, r, ["arv", "purchase"]), target: { kind: "part", part: "profit" } };
}

function arvRow(r: PropertyReturns, op: FormulaRow["op"]): FormulaRow {
  return { key: "arv", op, label: "שווי אחרי שיפוץ (ARV)", hint: "הערכה שלך · עריכה", value: typed(r.inputs.arvMinor, "arv"), target: { kind: "edit", field: "arv" } };
}

/** The sections and the division of a deal metric's page. */
function dealParts(metric: DealMetricKey, r: PropertyReturns): { sections: MetricSection[]; division: string | null; yearly?: FormulaRow } {
  const cur = r.currency;
  const c = (minor: bigint) => cents(minor, cur);
  const st = r.statement;
  const moneyIn = r.equity.moneyInMinor;
  const equity = r.equity.todayMinor;
  const yearly = (minor: bigint) => (scaled(metric, r) ? perYear(minor, r) : minor);
  const yearRow = (label: string, minor: bigint): FormulaRow | undefined => (scaled(metric, r)
    ? { key: "yearly", op: "", label: `${label} לשנה`, hint: `⁦${c(minor)} ÷ ${String(r.earningDays)} × 365⁩`, value: money(perYear(minor, r)) }
    : undefined);
  switch (metric) {
    case "irr": {
      const valued = r.equity.todayMinor != null;
      const selling = r.deal.sellingCostMinor;
      const balance = r.inputs.loanBalanceMinor ?? 0n;
      // The last flow: today's equity, or with no value what a sale at the ARV would leave (the review of #1016:
      // each row opens lines, or a formula, that add up to it).
      const terminal: MetricSection = valued
        ? { key: "terminal", title: "הון עצמי היום", total: computed(r.equity.todayMinor, r, ["value"]), formula: equityTodayFormula(r) }
        : {
          key: "terminal",
          title: "אם נמכר היום",
          total: r.deal.irrTerminalMinor == null ? undefined : money(r.deal.irrTerminalMinor),
          formula: {
            rows: [
              arvRow(r, ""),
              { key: "selling", op: "−", label: "עלויות מכירה", hint: `${percentText(r.deal.sellingCostBp)} מה־ARV · עריכה`, value: selling == null ? missing("arv") : money(-selling), target: { kind: "edit", field: "selling_cost" } },
              { key: "loans", op: "−", label: "יתרת הלוואות", value: money(-balance), target: { kind: "loans" } },
            ],
            result: { key: "terminal", op: "=", label: "אם נמכר היום", value: r.deal.irrTerminalMinor == null ? missing("arv") : money(r.deal.irrTerminalMinor) },
          },
        };
      return {
        sections: [
          {
            key: "flows",
            title: "הכסף לפי תאריך",
            formula: {
              rows: [
                { key: "out", op: "", label: "מה נכנס לעסקה", hint: "כל תשלום מהקנייה: רכישה, שיפוץ, החזקה, הוצאות ותשלומי הלוואה", value: money(r.deal.irrOutMinor), target: { kind: "line", line: "irr_out" } },
                { key: "in", op: "+", label: "מה חזר", hint: "כל תקבול מהקנייה: שכירות ותקבולי הלוואות", value: money(r.deal.irrInMinor, true), target: { kind: "line", line: "irr_in" } },
              ],
              result: null,
            },
          },
          terminal,
        ],
        division: r.metrics.irrBp == null ? null : `XIRR · ${String(r.deal.irrDates)} תאריכים`,
      };
    }
    case "roi-since":
    case "multiple": {
      const back = cashBack(r);
      const division = moneyIn == null || equity == null || moneyIn <= 0n ? null
        : metric === "multiple" ? `(${c(back)} + ${c(equity)}) ÷ ${c(moneyIn)}` : `(${c(back)} + ${c(equity)} − ${c(moneyIn)}) ÷ ${c(moneyIn)}`;
      return { sections: [backSection(r), moneyInSection(r)], division };
    }
    case "roe":
      return {
        sections: [totalSection(r), { key: "equity", title: "הון עצמי היום", total: computed(equity, r, ["value"]), formula: equityTodayFormula(r) }],
        division: equity == null || equity <= 0n ? null : `${c(yearly(r.sources.totalMinor))} ÷ ${c(equity)}`,
        yearly: yearRow("תשואה כוללת", r.sources.totalMinor),
      };
    case "break-even":
      return {
        sections: [
          {
            key: "costs",
            title: "הוצאות ותשלומי הלוואה",
            total: money(st.opexMinor + st.debtServiceMinor),
            formula: {
              rows: [
                { key: "opex", op: "", label: "הוצאות תפעול", hint: countHint(st.counts.opex), value: money(st.opexMinor), target: { kind: "line", line: "opex" } },
                { key: "debt", op: "+", label: "תשלומי הלוואה", hint: countHint(st.counts.debt_service), value: money(st.debtServiceMinor), target: { kind: "line", line: "debt_service" } },
              ],
              result: { key: "costs", op: "=", label: "מה שצריך לכסות", value: money(st.opexMinor + st.debtServiceMinor) },
            },
          },
          oneRow("income", "הכנסות", incomeRow(r)),
        ],
        division: st.incomeMinor <= 0n ? null : `${c(-(st.opexMinor + st.debtServiceMinor))} ÷ ${c(st.incomeMinor)}`,
      };
    case "expense-ratio":
      return {
        sections: [
          oneRow("opex", "הוצאות תפעול", { key: "opex", op: "", label: "הוצאות תפעול", hint: countHint(st.counts.opex), value: money(st.opexMinor), target: { kind: "line", line: "opex" } }),
          oneRow("income", "הכנסות", incomeRow(r)),
        ],
        division: st.incomeMinor <= 0n ? null : `${c(-st.opexMinor)} ÷ ${c(st.incomeMinor)}`,
      };
    case "ltv": {
      const balance = r.inputs.loanBalanceMinor;
      const value = r.inputs.valueMinor;
      return {
        sections: [
          oneRow("loans", "יתרת הלוואות", { key: "loans", op: "", label: "יתרת הלוואות", value: balance == null ? text("לא מחושב") : money(balance), target: { kind: "loans" } }),
          oneRow("value", "שווי היום", { key: "value", op: "", label: "שווי היום", hint: "מנתוני הנכס · עריכה", value: typed(value, "value"), target: { kind: "edit", field: "value" } }),
        ],
        division: balance == null || value == null || value <= 0n ? null : `${c(balance)} ÷ ${c(value)}`,
      };
    }
    case "grm": {
      const purchase = r.inputs.purchaseMinor;
      return {
        sections: [
          { key: "purchase", title: "מחיר רכישה", total: computed(purchase, r, ["purchase"]), formula: { rows: purchaseRows(r, "", false), result: null } },
          oneRow("income", "הכנסות", incomeRow(r)),
        ],
        division: purchase == null || st.incomeMinor <= 0n ? null : `${c(purchase)} ÷ ${c(yearly(st.incomeMinor))}`,
        yearly: yearRow("הכנסות", st.incomeMinor),
      };
    }
    case "flip-roi":
      return {
        sections: [oneRow("profit", "רווח נקי צפוי", profitRow(r)), moneyInSection(r)],
        division: r.deal.netProfitMinor == null || moneyIn == null || moneyIn <= 0n ? null : `${c(r.deal.netProfitMinor)} ÷ ${c(moneyIn)}`,
      };
    case "flip-roi-year": {
      const roi = r.metrics.flipRoiBp;
      const since = r.deal.acquiredOn == null ? "אין עדיין שורת רכישה" : `מהקנייה ב־${formatDisplay(r.deal.acquiredOn)}`;
      return {
        sections: [
          // FLOW-1071: each part opens what it is made of: the ROI its own page, the time the purchase lines.
          oneRow("roi", "ROI על הכסף בעסקה", { key: "roi", op: "", label: "ROI על הכסף בעסקה", hint: "רווח נקי ÷ כסף בעסקה", value: dealMetricValue("flip-roi", r), target: { kind: "metric", metric: "flip-roi" } }),
          oneRow("held", "זמן בעסקה", { key: "held", op: "", label: "זמן בעסקה", hint: since, value: r.deal.heldDays == null ? text("לא מחושב") : text(daysText(r.deal.heldDays)), target: { kind: "line", line: "acquisition" } }),
        ],
        division: roi == null || r.deal.heldDays == null ? null : `${percentText(roi)} × 365 ÷ ${String(r.deal.heldDays)}`,
      };
    }
    case "arv-margin":
      return {
        sections: [oneRow("profit", "רווח נקי צפוי", profitRow(r)), oneRow("arv", "שווי אחרי שיפוץ (ARV)", arvRow(r, ""))],
        division: r.deal.netProfitMinor == null || r.inputs.arvMinor == null || r.inputs.arvMinor <= 0n ? null : `${c(r.deal.netProfitMinor)} ÷ ${c(r.inputs.arvMinor)}`,
      };
    case "rule-70": {
      const max = maxPrice(r);
      return {
        sections: [
          {
            key: "max",
            title: "מחיר מקסימלי",
            total: max == null ? undefined : money(max),
            formula: {
              rows: [arvRow(r, ""), { key: "seventy", op: "×", label: "70%", hint: "כלל אצבע של משקיעים", value: text("70%") }, rehabRow(r, "−", true)],
              result: { key: "max", op: "=", label: "מחיר מקסימלי", value: max == null ? missing("arv") : money(max) },
            },
          },
          { key: "paid", title: "מחיר רכישה", total: computed(r.inputs.purchaseMinor, r, ["purchase"]), formula: { rows: purchaseRows(r, "", false), result: null } },
        ],
        division: max == null || r.inputs.purchaseMinor == null ? null : `${c(max)} − ${c(r.inputs.purchaseMinor)}`,
      };
    }
    case "break-even-sale": {
      const costs = r.inputs.purchaseMinor == null || r.inputs.rehabMinor == null ? null : r.inputs.purchaseMinor + r.inputs.rehabMinor - r.deal.holdingMinor;
      const keep = 10_000 - r.deal.sellingCostBp;
      return {
        sections: [{
          key: "costs",
          title: "כל העלויות",
          total: costs == null ? undefined : money(costs),
          formula: {
            rows: [...purchaseRows(r, "", false), rehabRow(r, "+", false), { key: "holding", op: "+", label: "החזקה", hint: "ריבית ועלויות שלא נספרו בשיפוץ", value: money(-r.deal.holdingMinor), target: { kind: "line", line: "deal_holding" } }],
            result: { key: "costs", op: "=", label: "כל העלויות", value: costs == null ? missing("purchase") : money(costs) },
          },
        }, oneRow("selling", "עלויות מכירה", { key: "selling", op: "", label: "עלויות מכירה", hint: "מה־ARV · עריכה", value: text(percentText(r.deal.sellingCostBp)), target: { kind: "edit", field: "selling_cost" } })],
        division: costs == null ? null : `${c(costs)} ÷ ${percentText(keep)}`,
      };
    }
  }
}

export function dealMetricPage(metric: DealMetricKey, r: PropertyReturns): MetricPage {
  const value = dealMetricValue(metric, r);
  const { sections, division, yearly } = dealParts(metric, r);
  const period = AFTER_RENT.includes(metric) ? (r.annualizedFrom == null ? "12 חודשים" : `מהשכירות הראשונה ב־${formatDisplay(r.annualizedFrom)}`) : metric === "ltv" ? "היום" : "מאז הקנייה";
  const result = division == null || value.kind === "missing" || value.kind === "note" ? null : { text: `⁦${division}⁩`, value, yearly };
  // FLOW-1071: a figure since the purchase says so once, in the page's subtitle, not again in its caption.
  const caption = dealAllTime(metric) ? dealFormula(metric, r) : `${dealFormula(metric, r)} · ${period}`;
  return { title: DEAL_METRIC_TITLES[metric], caption, cashOut: null, value, sections, result };
}

/* -- one entry point for every metric ------------------------------------------------------------- */

export function anyMetricTitle(metric: AnyMetricKey): string {
  return isDealMetric(metric) ? DEAL_METRIC_TITLES[metric] : METRIC_TITLES[metric];
}

export function anyMetricValue(metric: AnyMetricKey, r: PropertyReturns): FigureValue {
  return isDealMetric(metric) ? dealMetricValue(metric, r) : metricValue(metric, r);
}

export function anyMetricCaption(metric: AnyMetricKey, r: PropertyReturns): string {
  return isDealMetric(metric) ? dealMetricCaption(metric, r) : metricCaption(metric, r);
}

export function anyMetricPage(metric: AnyMetricKey, r: PropertyReturns): MetricPage {
  return isDealMetric(metric) ? dealMetricPage(metric, r) : metricPage(metric, r);
}
