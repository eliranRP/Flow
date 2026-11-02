import { formatAmount } from "../ui/amount";
import { formatDisplay } from "../ui/date-math";
import { INVESTMENT_LABELS, type InvestmentField } from "../ui/investment-card";
import { bracketText, dscrText, percentText, type PropertyReturns, type RehabRow, type ReturnLine } from "./project-returns-data";

/* ------------------------------------------------------------------------------------------------
 * FLOW-451: what every ⓘ, part and metric shows, as data. A row is an operator, a name, a figure and
 * where it comes from; the "=" row is the result. Figures are signed as they count: a cost or a
 * figure taken away is negative, so the rows before "=" add up to it (except the tax rows' ÷ and ×).
 * ---------------------------------------------------------------------------------------------- */

/** The figures the owner types: the project's own, and the company's tax bracket. */
export type EditField = InvestmentField | "tax_bracket";
export type PartKey = "building" | "money-in" | "forced" | "rehab";
export const PART_KEYS: readonly PartKey[] = ["building", "money-in", "forced", "rehab"];
export type MetricKey = "coc" | "cap-rate" | "dscr" | "per-unit";
export const METRIC_KEYS: readonly MetricKey[] = ["coc", "cap-rate", "dscr", "per-unit"];

export type Target =
  /** A line's page; `categoryId` narrows it to one category (`?category=`). */
  | { kind: "line"; line: ReturnLine; categoryId?: string }
  | { kind: "statement" }
  | { kind: "part"; part: PartKey }
  | { kind: "edit"; field: EditField }
  /** One loan's page, or the loans list with no id. */
  | { kind: "loans"; loanId?: string };

export type FigureValue =
  | { kind: "money"; minor: bigint; income?: boolean }
  | { kind: "text"; text: string }
  /** A muted caption in a figure's place: a per-cent figure before the first rent. */
  | { kind: "note"; text: string }
  /** "חסר" and, when `add` names one, an accent הוספה that opens that figure's sheet. */
  | { kind: "missing"; add: EditField | null; note?: string };

export type Op = "" | "+" | "−" | "÷" | "×" | "=";

export type FormulaRow = { key: string; op: Op; label: string; hint?: string; value: FigureValue; target?: Target };
export type Formula = { rows: FormulaRow[]; result: FormulaRow | null };

export const MISSING_HISTORY = "חסר · שווי לפני שנה";
export const HISTORY_HINT = "השווי נשמר בכל פעם שמעדכנים אותו, ומכאן עליית הערך.";
export const TAX_CAPTION = "הערכה. במכירה הפחת חוזר כמס. החישוב המדויק אצל רואה החשבון.";
export const CASH_FLOW_CAPTION = "מהשכר הראשון בלבד. מה שלפניו נכנס לכסף בעסקה.";
export const MONEY_IN_BODY = "מה שהנכס לקח ממך עד שהתחיל להכניס שכירות, פחות מה שחזר מההלוואה.";
export const MONEY_IN_CAPTION = "רכישה, שיפוץ והחזקה פחות הלוואות";
export const ALL_TIME = "מאז הקנייה";
/** In place of a per-cent figure when all the cash came out, and its accessible name (FLOW-457). */
export const INFINITY = "∞";
export const INFINITY_NAME = "כל ההון חזר";
/** In place of a per-cent figure before the first rent: with no rent yet, the per-cents say nothing. */
export const BEFORE_FIRST_RENT = "לפני השכר הראשון";
export const UNITS_DEFAULT_HINT = "ברירת מחדל · עריכה";
export const TAKEN_OVER_LABEL = "הלוואה שנלקחה בסגירה";

/** Each input's one name, on its row, its sheet and a "חסר · …" hint (FLOW-457). */
export const FIELD_NAMES: Record<EditField, string> = { ...INVESTMENT_LABELS, tax_bracket: "מדרגת המס" };

/** "חסר · שווי היום": why a figure is missing, on its hint line. */
export function missingHint(field: EditField): string {
  return `חסר · ${FIELD_NAMES[field]}`;
}

const money = (minor: bigint, income = false): FigureValue => ({ kind: "money", minor, income });
const missing = (add: EditField | null, note?: string): FigureValue => ({ kind: "missing", add, note });

/** A typed figure, or "חסר · הוספה" for it. */
function typed(minor: bigint | null, field: EditField, negate = false): FigureValue {
  if (minor == null) return missing(field);
  return money(negate ? -minor : minor);
}

/** The first input a figure needs that is missing, in the order the owner would add them. */
export function firstMissing(r: PropertyReturns, needs: readonly EditField[]): EditField | null {
  for (const field of needs) {
    if (field === "purchase" && r.inputs.purchaseMinor == null) return field;
    if (field === "arv" && r.inputs.arvMinor == null) return field;
    if (field === "value" && r.inputs.valueMinor == null) return field;
    if (field === "land" && r.inputs.landMinor == null) return field;
    if (field === "tax_bracket" && r.inputs.taxBracketBp == null) return field;
  }
  return null;
}

/** A computed figure; when it is null, "חסר · הוספה" for the first input it needs, else "לא מחושב". */
function computed(minor: bigint | null, r: PropertyReturns, needs: readonly EditField[]): FigureValue {
  if (minor != null) return money(minor);
  const add = firstMissing(r, needs);
  return add == null ? { kind: "text", text: "לא מחושב" } : missing(add);
}

export function countHint(count: number): string {
  return count === 1 ? "תנועה אחת" : `${String(count)} תנועות`;
}

/** "עד השכר הראשון ב־01/04/2026", or "עדיין לפני השכר הראשון". */
export function firstRentHint(r: PropertyReturns): string {
  return r.firstRent == null ? "עדיין לפני השכר הראשון" : `עד השכר הראשון ב־${formatDisplay(r.firstRent)}`;
}

/** The first rent when it falls inside the period, so the statement starts there; else null. */
export function firstRentInPeriod(r: PropertyReturns): string | null {
  return r.firstRent != null && r.firstRent > r.from && r.firstRent <= r.to ? r.firstRent : null;
}

/** No rent yet (none at all, or only after the period): the per-cent figures read BEFORE_FIRST_RENT. */
export function beforeFirstRent(r: PropertyReturns): boolean {
  return r.firstRent == null || r.firstRent > r.to;
}

/** How much more came out than went in, when all the cash came out; else null. */
export function cashOutMinor(r: PropertyReturns): bigint | null {
  return r.equity.allCashOut && r.equity.moneyInMinor != null ? -r.equity.moneyInMinor : null;
}

/* -- the four sources ---------------------------------------------------------------------------- */

export function cashFlowFormula(r: PropertyReturns): Formula {
  const st = r.statement;
  return {
    rows: [
      { key: "income", op: "", label: "הכנסות", hint: countHint(st.counts.income), value: money(st.incomeMinor, true), target: { kind: "line", line: "income" } },
      { key: "opex", op: "−", label: "הוצאות תפעול", hint: countHint(st.counts.opex), value: money(st.opexMinor), target: { kind: "line", line: "opex" } },
      { key: "debt", op: "−", label: "תשלומי הלוואה", hint: countHint(st.counts.debt_service), value: money(st.debtServiceMinor), target: { kind: "line", line: "debt_service" } },
      { key: "capex", op: "−", label: "שיפוץ", hint: countHint(st.counts.capex), value: money(st.capexMinor), target: { kind: "line", line: "capex" } },
    ],
    result: { key: "cash", op: "=", label: "תזרים", value: money(st.cashFlowMinor) },
  };
}

export function principalFormula(r: PropertyReturns): Formula {
  return {
    rows: [{ key: "principal", op: "", label: "קרן שנפרעה", hint: "מתשלומי ההלוואה בתקופה", value: money(r.sources.principalMinor), target: { kind: "line", line: "principal" } }],
    result: null,
  };
}

export function appreciationFormula(r: PropertyReturns): Formula {
  const { valueEnd, valueStart } = r.inputs;
  const edit: Target = { kind: "edit", field: "value" };
  if (valueEnd == null) {
    return { rows: [{ key: "end", op: "", label: "שווי היום", value: missing("value"), target: edit }], result: { key: "diff", op: "=", label: "עליית ערך", value: missing(null) } };
  }
  const end: FormulaRow = { key: "end", op: "", label: `שווי ב־${formatDisplay(valueEnd.date)}`, hint: "בסוף התקופה", value: money(valueEnd.minor), target: edit };
  if (valueStart == null) {
    return {
      rows: [end, { key: "start", op: "−", label: "שווי לפני שנה", hint: HISTORY_HINT, value: missing(null, MISSING_HISTORY) }],
      result: { key: "diff", op: "=", label: "עליית ערך", value: missing(null) },
    };
  }
  return {
    rows: [end, { key: "start", op: "−", label: `שווי ב־${formatDisplay(valueStart.date)}`, hint: "בתחילת התקופה", value: money(-valueStart.minor), target: edit }],
    result: { key: "diff", op: "=", label: "עליית ערך", value: computed(r.sources.appreciationMinor, r, ["value"]) },
  };
}

export function taxFormula(r: PropertyReturns): Formula {
  const bracket = r.inputs.taxBracketBp;
  return {
    rows: [
      { key: "building", op: "", label: "עלות הבניין", hint: "קנייה ושיפוץ, בלי הקרקע", value: computed(r.sources.buildingMinor, r, ["purchase", "land"]), target: { kind: "part", part: "building" } },
      { key: "years", op: "÷", label: "פחת בשנה", hint: "לאורך 27.5 שנים", value: computed(r.sources.depreciationYearMinor, r, ["purchase", "land"]) },
      { key: "bracket", op: "×", label: "מדרגת המס", hint: "שלך · עריכה", value: bracket == null ? missing("tax_bracket") : { kind: "text", text: bracketText(bracket) }, target: { kind: "edit", field: "tax_bracket" } },
    ],
    result: { key: "tax", op: "=", label: "חיסכון מס בשנה", value: computed(r.sources.taxSavingsMinor, r, ["purchase", "land", "tax_bracket"]) },
  };
}

/* -- the equity card ------------------------------------------------------------------------------ */

export function equityTodayFormula(r: PropertyReturns): Formula {
  const balance = r.inputs.loanBalanceMinor ?? 0n;
  return {
    rows: [
      { key: "value", op: "", label: "שווי היום", value: typed(r.inputs.valueMinor, "value"), target: { kind: "edit", field: "value" } },
      { key: "loans", op: "−", label: "יתרת הלוואות", value: money(-balance), target: { kind: "loans" } },
    ],
    result: { key: "equity", op: "=", label: "הון עצמי היום", value: computed(r.equity.todayMinor, r, ["value"]) },
  };
}

/** The loans taken over at closing: one loan opens its page, several the loans list. */
function takenOverTarget(r: PropertyReturns): Target {
  const loans = r.inputs.takenOverLoans;
  return loans.length === 1 && loans[0] != null ? { kind: "loans", loanId: loans[0].id } : { kind: "loans" };
}

/**
 * The purchase: from the acquisition lines (opening them), or the typed price (opening its sheet).
 * Decision 0246: a loan taken over at closing (Sub2) is a row of its own, so the two add up to the
 * price: the cash lines (purchase − taken over), then "+ הלוואה שנלקחה בסגירה" opening the loan.
 */
export function purchaseRows(r: PropertyReturns, op: Op, negate: boolean): FormulaRow[] {
  const sign = (minor: bigint) => money(negate ? -minor : minor);
  if (r.inputs.purchaseSource === "lines" && r.inputs.purchaseMinor != null) {
    const minor = r.inputs.purchaseMinor;
    const takenOver = r.inputs.takenOverMinor;
    const acquisition: Target = { kind: "line", line: "acquisition" };
    if (takenOver <= 0n) return [{ key: "purchase", op, label: "מחיר רכישה (מהתנועות)", hint: "רכישה וסגירה", value: sign(minor), target: acquisition }];
    const names = r.inputs.takenOverLoans.map((loan) => loan.name).filter((name) => name !== "").join(", ");
    return [
      { key: "purchase", op, label: "רכישה וסגירה (מהתנועות)", value: sign(minor - takenOver), target: acquisition },
      { key: "taken-over", op: negate ? "−" : "+", label: TAKEN_OVER_LABEL, hint: names === "" ? undefined : names, value: sign(takenOver), target: takenOverTarget(r) },
    ];
  }
  return [{ key: "purchase", op, label: "מחיר רכישה", hint: "מנתוני הנכס · עריכה", value: typed(r.inputs.purchaseMinor, "purchase", negate), target: { kind: "edit", field: "purchase" } }];
}

/** The renovation so far, opening its own page (FLOW-460). */
function rehabRow(r: PropertyReturns, op: Op, negate: boolean): FormulaRow {
  const rehab = r.inputs.rehabMinor;
  return {
    key: "rehab",
    op,
    label: "שיפוץ עד היום",
    hint: "מחושב מההוצאות",
    value: rehab == null ? { kind: "text", text: "לא מחושב" } : money(negate ? -rehab : rehab),
    target: { kind: "part", part: "rehab" },
  };
}

export function forcedFormula(r: PropertyReturns): Formula {
  return {
    rows: [
      { key: "arv", op: "", label: "שווי אחרי שיפוץ (ARV)", hint: "הערכה שלך", value: typed(r.inputs.arvMinor, "arv"), target: { kind: "edit", field: "arv" } },
      ...purchaseRows(r, "−", true),
      rehabRow(r, "−", true),
    ],
    result: { key: "forced", op: "=", label: "השבחה צפויה", value: computed(r.equity.forcedMinor, r, ["arv", "purchase"]) },
  };
}

/**
 * The money in the deal by part (decision 0245): what the property took before the first rent, less
 * what came back from the loans. Each part is shown as it counts (a cost positive, the proceeds
 * negative), so the rows add up to the money in; each opens its lines.
 */
export function moneyInFormula(r: PropertyReturns): Formula {
  const parts = r.equity.moneyInParts;
  const acquisition: FormulaRow = parts.acquisitionMinor == null
    ? { key: "acquisition", op: "", label: "רכישה וסגירה", value: missing("purchase"), target: { kind: "edit", field: "purchase" } }
    : r.inputs.purchaseSource === "lines"
      ? { key: "acquisition", op: "", label: "רכישה וסגירה", hint: "מהתנועות", value: money(-parts.acquisitionMinor), target: { kind: "line", line: "acquisition" } }
      : { key: "acquisition", op: "", label: "רכישה וסגירה", hint: "מחיר הרכישה שהוזן · עריכה", value: money(-parts.acquisitionMinor), target: { kind: "edit", field: "purchase" } };
  return {
    rows: [
      acquisition,
      { key: "renovation", op: "+", label: "שיפוץ לפני השכרה", value: money(-parts.renovationMinor), target: { kind: "line", line: "renovation" } },
      { key: "holding", op: "+", label: "עלויות החזקה", hint: firstRentHint(r), value: money(-parts.holdingMinor), target: { kind: "line", line: "holding" } },
      { key: "financing", op: "−", label: "תקבולי הלוואות והחזרים", hint: "נטו, אחרי עלויות ההלוואה", value: money(-parts.financingMinor), target: { kind: "line", line: "financing" } },
    ],
    result: { key: "money-in", op: "=", label: "כסף בעסקה", hint: r.equity.allCashOut ? "כל הכסף חזר" : undefined, value: computed(r.equity.moneyInMinor, r, ["purchase"]) },
  };
}

export function buildingFormula(r: PropertyReturns): Formula {
  return {
    rows: [
      ...purchaseRows(r, "", false),
      rehabRow(r, "+", false),
      { key: "land", op: "−", label: FIELD_NAMES.land, hint: "שלך · עריכה", value: typed(r.inputs.landMinor, "land", true), target: { kind: "edit", field: "land" } },
    ],
    result: { key: "building", op: "=", label: "עלות הבניין", value: computed(r.sources.buildingMinor, r, ["purchase", "land"]) },
  };
}

/* -- the ⓘ sheet ---------------------------------------------------------------------------------- */

export type InfoKey = "cash_flow" | "principal" | "appreciation" | "tax" | "equity_today" | "forced" | "money_in";

export type ReturnInfo = { key: InfoKey; title: string; body: string; formula: Formula; caption?: string };

const INFO: Record<InfoKey, { title: string; body: string; caption?: string; formula: (r: PropertyReturns) => Formula }> = {
  cash_flow: { title: "תזרים", body: "מה שנשאר בחשבון אחרי כל ההוצאות והתשלומים", caption: CASH_FLOW_CAPTION, formula: cashFlowFormula },
  principal: { title: "החזר קרן", body: "חלק הקרן מתשלומי ההלוואה: חוב שנפרע, כסף שנשאר שלך", formula: principalFormula },
  appreciation: { title: "עליית ערך", body: "כמה השווי עלה מתחילת התקופה ועד סופה, לפי השווי שהזנת", formula: appreciationFormula },
  tax: {
    title: "חיסכון מס",
    body: "פחת הוא הוצאה על הנייר: את עלות הבניין (בלי הקרקע) מורידים מההכנסה לאורך 27.5 שנה. ההכנסה החייבת קטנה, וגם המס.",
    caption: TAX_CAPTION,
    formula: taxFormula,
  },
  equity_today: { title: "הון עצמי היום", body: "החלק בנכס שהוא שלך: השווי היום, פחות מה שעוד חייבים", formula: equityTodayFormula },
  forced: { title: "השבחה צפויה", body: "כמה ערך השיפוץ יוסיף: השווי אחרי השיפוץ, פחות מה שהנכס עלה", formula: forcedFormula },
  money_in: { title: "כסף בעסקה", body: MONEY_IN_BODY, formula: moneyInFormula },
};

export function returnInfo(key: InfoKey, r: PropertyReturns): ReturnInfo {
  const info = INFO[key];
  return { key, title: info.title, body: info.body, caption: info.caption, formula: info.formula(r) };
}

/** A sheet's own figure, by its title: the formula's result, or the single row it shows. */
export function infoFigure(info: ReturnInfo): FigureValue | null {
  return info.formula.result?.value ?? info.formula.rows[0]?.value ?? null;
}

/* -- a part's page -------------------------------------------------------------------------------- */

export type PartPage = { title: string; meta: string; body: string; back: string; formula: Formula };

export const REHAB_BODY = "כל הוצאות הנכס שנספרות בשיפוץ, מאז הקנייה.";
export const NO_CATEGORY = "בלי קטגוריה";

/**
 * The renovation so far by category (FLOW-460, decision 0247): each category that counts, largest
 * first, opening its lines; the rows add up to the figure, as the server sums them from the same lines.
 */
export function rehabFormula(r: PropertyReturns, rows: readonly RehabRow[]): Formula {
  const rehab = r.inputs.rehabMinor;
  return {
    rows: rows.map((row, index) => ({
      key: row.id ?? "none",
      op: index === 0 ? "" : "+",
      label: row.name ?? NO_CATEGORY,
      value: money(row.minor),
      // A line with no category has no page of its own: the transactions below list it.
      target: row.id == null ? undefined : { kind: "line", line: "rehab", categoryId: row.id },
    })),
    result: { key: "rehab", op: "=", label: "שיפוץ עד היום", value: rehab == null ? { kind: "text", text: "לא מחושב" } : money(rehab) },
  };
}

/** A part's page; `rehab` is the renovation's categories, for its own page. */
export function partPage(part: PartKey, r: PropertyReturns, rehab: readonly RehabRow[] = []): PartPage {
  if (part === "rehab") {
    return { title: "שיפוץ עד היום", meta: "", body: REHAB_BODY, back: "השקעה", formula: rehabFormula(r, rehab) };
  }
  if (part === "building") {
    return {
      title: "עלות הבניין",
      meta: "קנייה ושיפוץ, בלי הקרקע",
      body: "מה שהנכס עלה, בלי הקרקע: קרקע לא מתבלה, ולכן אין עליה פחת. מחלקים ב־27.5 שנה, תקופת הפחת של בניין מגורים.",
      back: "חיסכון",
      formula: buildingFormula(r),
    };
  }
  if (part === "money-in") {
    return { title: "כסף בעסקה", meta: MONEY_IN_CAPTION, body: MONEY_IN_BODY, back: "השקעה", formula: moneyInFormula(r) };
  }
  return { title: "השבחה צפויה", meta: "ARV פחות קנייה ושיפוץ", body: INFO.forced.body, back: "השקעה", formula: forcedFormula(r) };
}

/* -- the metrics ---------------------------------------------------------------------------------- */

export type MetricSection = { key: string; title: string; total?: FigureValue; formula: Formula };
/** `cashOut`: how much more came out than went in, when all the cash came out (the caption then says so). */
export type MetricPage = { title: string; caption: string; cashOut: bigint | null; value: FigureValue; sections: MetricSection[]; result: { text: string; value: FigureValue } | null };

const PERIOD = "12 חודשים";

function cents(minor: bigint, currency: string): string {
  return formatAmount(minor, "summary", currency);
}

function noiFormula(r: PropertyReturns): Formula {
  const st = r.statement;
  return {
    rows: [
      { key: "income", op: "", label: "הכנסות", hint: countHint(st.counts.income), value: money(st.incomeMinor, true), target: { kind: "line", line: "income" } },
      { key: "opex", op: "−", label: "הוצאות תפעול", hint: countHint(st.counts.opex), value: money(st.opexMinor), target: { kind: "line", line: "opex" } },
    ],
    result: { key: "noi", op: "=", label: "רווח תפעולי (NOI)", value: money(st.noiMinor) },
  };
}

function cashSection(r: PropertyReturns): MetricSection {
  return {
    key: "cash",
    title: "תזרים",
    total: money(r.statement.cashFlowMinor),
    formula: { rows: [{ key: "cash", op: "", label: "תזרים", hint: "רווח תפעולי פחות הלוואה ושיפוץ", value: money(r.statement.cashFlowMinor), target: { kind: "statement" } }], result: null },
  };
}

function bpValue(bp: number | null, r: PropertyReturns, needs: readonly EditField[]): FigureValue {
  if (beforeFirstRent(r)) return { kind: "note", text: BEFORE_FIRST_RENT };
  if (bp != null) return { kind: "text", text: percentText(bp) };
  const add = firstMissing(r, needs);
  return add == null ? { kind: "text", text: "לא מחושב" } : missing(add);
}

/** The card's row value of a metric (the same as its page's figure). */
export function metricValue(metric: MetricKey, r: PropertyReturns): FigureValue {
  const m = r.metrics;
  if (metric === "coc") return r.equity.allCashOut ? { kind: "text", text: INFINITY } : bpValue(m.cashOnCashBp, r, ["purchase"]);
  if (metric === "cap-rate") return bpValue(m.capRateBp, r, ["value"]);
  if (metric === "dscr") return m.dscrMilli == null ? { kind: "text", text: "אין תשלומים" } : { kind: "text", text: dscrText(m.dscrMilli) };
  return money(m.perUnitMonthMinor);
}

export const METRIC_TITLES: Record<MetricKey, string> = {
  coc: "תשואה על המזומן",
  "cap-rate": "Cap rate",
  dscr: "כיסוי חוב (DSCR)",
  "per-unit": "תזרים ליחידה",
};

export function metricCaption(metric: MetricKey, r: PropertyReturns): string {
  if (metric === "coc") return "תזרים ÷ כסף בעסקה";
  if (metric === "cap-rate") return "רווח תפעולי ÷ שווי היום";
  if (metric === "dscr") return "רווח תפעולי ÷ תשלומי הלוואה";
  const units = r.inputs.units;
  return `בחודש · תזרים ÷ ${String(units)} ${units === 1 ? "יחידה" : "יחידות"} ÷ 12`;
}

export function metricPage(metric: MetricKey, r: PropertyReturns): MetricPage {
  const cur = r.currency;
  const st = r.statement;
  const value = metricValue(metric, r);
  const title = METRIC_TITLES[metric];
  const caption = `${metricCaption(metric, r)} · ${PERIOD}`;
  // No result row for a figure that is missing, or that reads "לפני השכר הראשון".
  // The division reads left to right inside the Hebrew row (an LTR isolate), as numbers are written.
  const result = (text: string | null) => (text == null || value.kind === "missing" || value.kind === "note" ? null : { text: `\u2066${text}\u2069`, value });
  if (metric === "coc") {
    const moneyIn = r.equity.moneyInMinor;
    const cashOut = cashOutMinor(r);
    return {
      title,
      caption,
      cashOut,
      value,
      sections: [cashSection(r), { key: "money-in", title: "כסף בעסקה", total: computed(moneyIn, r, ["purchase"]), formula: moneyInFormula(r) }],
      result: result(moneyIn == null || cashOut != null ? null : `${cents(st.cashFlowMinor, cur)} ÷ ${cents(moneyIn, cur)}`),
    };
  }
  if (metric === "cap-rate") {
    const v = r.inputs.valueMinor;
    return {
      title,
      caption,
      cashOut: null,
      value,
      sections: [
        { key: "noi", title: "רווח תפעולי (NOI)", total: money(st.noiMinor), formula: noiFormula(r) },
        { key: "value", title: "שווי היום", formula: { rows: [{ key: "value", op: "", label: "שווי היום", hint: "מנתוני הנכס · עריכה", value: typed(v, "value"), target: { kind: "edit", field: "value" } }], result: null } },
      ],
      result: result(v == null ? null : `${cents(st.noiMinor, cur)} ÷ ${cents(v, cur)}`),
    };
  }
  if (metric === "dscr") {
    return {
      title,
      caption,
      cashOut: null,
      value,
      sections: [
        { key: "noi", title: "רווח תפעולי (NOI)", total: money(st.noiMinor), formula: noiFormula(r) },
        { key: "debt", title: "תשלומי הלוואה", formula: { rows: [{ key: "debt", op: "", label: "תשלומי הלוואה", hint: countHint(st.counts.debt_service), value: money(st.debtServiceMinor), target: { kind: "line", line: "debt_service" } }], result: null } },
      ],
      result: result(r.metrics.dscrMilli == null ? null : `${cents(st.noiMinor, cur)} ÷ ${cents(-st.debtServiceMinor, cur)}`),
    };
  }
  const units = r.inputs.units;
  return {
    title,
    caption,
    cashOut: null,
    value,
    sections: [
      cashSection(r),
      { key: "units", title: FIELD_NAMES.units, formula: { rows: [{ key: "units", op: "", label: FIELD_NAMES.units, hint: r.inputs.unitsDefault ? UNITS_DEFAULT_HINT : "מנתוני הנכס · עריכה", value: { kind: "text", text: String(units) }, target: { kind: "edit", field: "units" } }], result: null } },
    ],
    result: result(`${cents(st.cashFlowMinor, cur)} ÷ ${String(units)} ÷ 12`),
  };
}

/* -- the statement and its lines ------------------------------------------------------------------ */

export const LINE_TITLES: Record<ReturnLine, string> = {
  income: "שכר דירה",
  opex: "הוצאות תפעול",
  debt_service: "תשלומי הלוואה",
  capex: "שיפוץ (CapEx)",
  before_rent: "לפני השכרה",
  not_counted: "לא נספר בתזרים",
  principal: "החזר קרן",
  acquisition: "רכישה וסגירה",
  renovation: "שיפוץ לפני השכרה",
  holding: "עלויות החזקה",
  financing: "תקבולי הלוואות והחזרים",
  money_in: "כסף בעסקה",
  rehab: "שיפוץ עד היום",
};

/**
 * A line's figure, signed as its transactions: the statement's, the principal paid (a cost's part
 * shown as paid, so negative), or a part of the money in (all time). Null with no purchase at all.
 */
export function lineMinor(line: ReturnLine, r: PropertyReturns): bigint | null {
  const st = r.statement;
  const parts = r.equity.moneyInParts;
  if (line === "income") return st.incomeMinor;
  if (line === "opex") return st.opexMinor;
  if (line === "debt_service") return st.debtServiceMinor;
  if (line === "capex") return st.capexMinor;
  if (line === "before_rent") return st.beforeRentMinor;
  if (line === "not_counted") return st.notCountedMinor;
  if (line === "acquisition") return parts.acquisitionMinor;
  if (line === "renovation") return parts.renovationMinor;
  if (line === "holding") return parts.holdingMinor;
  if (line === "financing") return parts.financingMinor;
  if (line === "money_in") return r.equity.moneyInMinor == null ? null : -r.equity.moneyInMinor;
  if (line === "rehab") return r.inputs.rehabMinor == null ? null : -r.inputs.rehabMinor;
  return r.sources.principalMinor;
}

